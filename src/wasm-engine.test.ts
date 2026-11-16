import { describe, expect, it, vi } from 'vitest';

import { CadmpegError } from '#errors.js';
import type { ModuleId } from '#formats.js';
import { createWasmEngine, type WasmGlue } from '#wasm-engine.js';

const encoder = new TextEncoder();
const stepBytes = encoder.encode('ISO-10303-21; data');

type FakeOptions = {
  readonly detects?: string;
  readonly fail?: unknown;
};

/** A fake module: converts anything to `<module>:<to>` bytes and reports it. */
const fakeGlue = (id: ModuleId, options: FakeOptions = {}) => {
  const freed = vi.fn();
  const glue: WasmGlue = {
    default: vi.fn(async () => undefined),
    detect: vi.fn(() => options.detects),
    convert: vi.fn((input: Uint8Array, to: string) => {
      if (options.fail !== undefined) throw options.fail;
      const from = new TextDecoder().decode(input).startsWith('ISO-10303-21;') ? 'step' : id;
      return {
        takeBytes: () => (to === 'step' ? stepBytes : encoder.encode(`${id}:${to}`)),
        report: JSON.stringify({
          from,
          to: to.split(':')[0],
          losses: [{ phase: 'decode', code: `${id}.loss`, severity: 'warning', message: 'm' }],
          notes: [`${id} note`],
        }),
        free: freed,
      };
    }),
  };
  return { glue, freed };
};

const engineWith = (glues: Partial<Record<ModuleId, WasmGlue>>) => {
  const loadGlue = vi.fn(async (id: ModuleId) => {
    const glue = glues[id];
    if (!glue) throw new Error(`no glue ${id}`);
    return glue;
  });
  const locateModule = vi.fn((id: ModuleId) => `/wasm/${id}_bg.wasm`);
  return { engine: createWasmEngine(loadGlue, locateModule), loadGlue, locateModule };
};

describe('createWasmEngine', () => {
  it('converts in the source module when it carries the writer, and frees the result', async () => {
    const sldprt = fakeGlue('sldprt');
    const { engine, locateModule } = engineWith({ sldprt: sldprt.glue });
    expect(engine.backend).toBe('wasm');
    const result = await engine.convert(encoder.encode('native'), 'part.sldprt', 'sldprt');
    expect(new TextDecoder().decode(result.bytes)).toBe('sldprt:sldprt');
    expect(result.report.from).toBe('sldprt');
    expect(sldprt.freed).toHaveBeenCalledOnce();
    expect(locateModule).toHaveBeenCalledWith('sldprt');
  });

  it('routes STEP input to the step module without a name', async () => {
    const step = fakeGlue('step');
    const { engine } = engineWith({ step: step.glue });
    const result = await engine.convert(stepBytes, undefined, 'step:ap242');
    expect(result.report.to).toBe('step');
    expect(step.glue.convert).toHaveBeenCalledWith(stepBytes, 'step:ap242');
  });

  it('hands a native-to-native conversion over as STEP bytes and joins both reports', async () => {
    const sldprt = fakeGlue('sldprt');
    const rhino = fakeGlue('rhino');
    const { engine } = engineWith({ sldprt: sldprt.glue, rhino: rhino.glue });
    const result = await engine.convert(encoder.encode('native'), 'part.sldprt', 'rhino');
    expect(rhino.glue.convert).toHaveBeenCalledWith(stepBytes, 'rhino');
    expect(new TextDecoder().decode(result.bytes)).toBe('rhino:rhino');
    expect(result.report).toEqual({
      from: 'sldprt',
      to: 'rhino',
      losses: [
        { phase: 'decode', code: 'sldprt.loss', severity: 'warning', message: 'm' },
        { phase: 'decode', code: 'rhino.loss', severity: 'warning', message: 'm' },
      ],
      notes: ['sldprt note', 'rhino note'],
    });
  });

  it('routes by name when the bytes are long enough to sniff but are not STEP', async () => {
    const { engine, loadGlue } = engineWith({ sldprt: fakeGlue('sldprt').glue });
    const result = await engine.convert(encoder.encode('ISO-10303-22; not a header'), 'part.sldprt', 'step');
    expect(result.report.from).toBe('sldprt');
    expect(loadGlue).toHaveBeenCalledWith('sldprt');
  });

  it('asks each candidate module to detect an ambiguous extension', async () => {
    const creo = fakeGlue('creo');
    const nx = fakeGlue('nx', { detects: 'nx' });
    const { engine } = engineWith({ creo: creo.glue, nx: nx.glue });
    const result = await engine.convert(encoder.encode('native'), 'part.prt', 'step');
    expect(result.report.from).toBe('nx');
    expect(creo.glue.detect).toHaveBeenCalledOnce();
  });

  it('refuses when no candidate recognizes the file', async () => {
    const { engine } = engineWith({ creo: fakeGlue('creo').glue, nx: fakeGlue('nx').glue });
    await expect(engine.convert(encoder.encode('x'), 'part.prt', 'step')).rejects.toMatchObject({
      code: 'UNSUPPORTED_FORMAT',
      phase: 'decode',
    });
  });

  it('refuses a file without a usable name', async () => {
    const { engine } = engineWith({});
    await expect(engine.convert(encoder.encode('x'), undefined, 'step')).rejects.toThrow(
      /pass \{ name, bytes \}/u,
    );
    await expect(engine.convert(encoder.encode('x'), 'a.obj', 'step')).rejects.toThrow(
      /no format module reads a\.obj/u,
    );
    await expect(engine.convert(new Uint8Array(0), undefined, 'step')).rejects.toBeInstanceOf(CadmpegError);
  });

  it('reuses a loaded module, and reloads after a failed load', async () => {
    const step = fakeGlue('step');
    let attempts = 0;
    const loadGlue = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('network');
      return step.glue;
    });
    const engine = createWasmEngine(loadGlue, () => '/x');
    await expect(engine.convert(stepBytes, undefined, 'step')).rejects.toMatchObject({
      code: 'BACKEND_UNAVAILABLE',
    });
    await engine.convert(stepBytes, undefined, 'step');
    await engine.convert(stepBytes, undefined, 'step');
    expect(loadGlue).toHaveBeenCalledTimes(2);
  });

  it('reports binding errors and keeps the instance', async () => {
    const step = fakeGlue('step', { fail: '{"code":"REFUSED","message":"no","phase":"export"}' });
    const { engine, loadGlue } = engineWith({ step: step.glue });
    await expect(engine.convert(stepBytes, undefined, 'step')).rejects.toMatchObject({ code: 'REFUSED' });
    await expect(engine.convert(stepBytes, undefined, 'step')).rejects.toMatchObject({ code: 'REFUSED' });
    expect(loadGlue).toHaveBeenCalledOnce();
  });

  it('drops an instance that trapped', async () => {
    const step = fakeGlue('step', { fail: new WebAssembly.RuntimeError('unreachable') });
    const { engine, loadGlue } = engineWith({ step: step.glue });
    await expect(engine.convert(stepBytes, undefined, 'step')).rejects.toMatchObject({
      code: 'ENGINE_FAILED',
    });
    await expect(engine.convert(stepBytes, undefined, 'step')).rejects.toMatchObject({
      code: 'ENGINE_FAILED',
    });
    expect(loadGlue).toHaveBeenCalledTimes(2);
  });
});
