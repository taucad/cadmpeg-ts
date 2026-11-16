import { describe, expect, it, vi } from 'vitest';

import { fromEngine } from '#cadmpeg.js';
import type { Engine, EngineReport } from '#engine.js';

const report = (losses: EngineReport['losses'] = []): EngineReport => ({
  from: 'sldprt',
  to: 'rhino',
  losses,
  notes: ['n'],
});

const fakeEngine = (losses: EngineReport['losses'] = []) => {
  const convert = vi.fn<Engine['convert']>(async () => ({
    bytes: new Uint8Array([1, 2]),
    report: report(losses),
  }));
  const engine: Engine = { backend: 'native', convert };
  return { engine, convert };
};

const loss = { phase: 'export', code: 'geometry.approximated', severity: 'warning', message: 'm' } as const;

describe('convert', () => {
  it('returns named files, losses, notes, timings and the backend', async () => {
    const { engine, convert } = fakeEngine([loss]);
    const result = await fromEngine(engine).convert(
      { name: 'dir/bracket.v2.SLDPRT', bytes: new Uint8Array([9]) },
      { to: 'rhino' },
    );
    expect(convert).toHaveBeenCalledWith(new Uint8Array([9]), 'dir/bracket.v2.SLDPRT', 'rhino');
    expect(result).toMatchObject({
      files: [{ name: 'bracket.3dm', bytes: new Uint8Array([1, 2]) }],
      from: 'sldprt',
      to: 'rhino',
      losses: [loss],
      notes: ['n'],
      backend: 'native',
    });
    expect(result.timings.totalMs).toBeGreaterThanOrEqual(0);
  });

  it('accepts bare bytes and names the output after `output`', async () => {
    const { engine } = fakeEngine();
    const result = await fromEngine(engine).convert(new Uint8Array([1]), { to: 'rhino' });
    expect(result.files[0]?.name).toBe('output.3dm');
  });

  it('keeps a dotfile name whole', async () => {
    const { engine } = fakeEngine();
    const result = await fromEngine(engine).convert(
      { name: '.hidden', bytes: new Uint8Array([1]) },
      { to: 'rhino' },
    );
    expect(result.files[0]?.name).toBe('.hidden.3dm');
  });

  it('rejects empty input and a missing target', async () => {
    const converter = fromEngine(fakeEngine().engine);
    await expect(converter.convert(new Uint8Array(0), { to: 'step' })).rejects.toMatchObject({
      code: 'NO_FILES',
    });
    await expect(
      converter.convert({ bytes: 'x' as unknown as Uint8Array }, { to: 'step' }),
    ).rejects.toMatchObject({
      code: 'NO_FILES',
    });
    await expect(converter.convert(new Uint8Array([1]), { to: '' })).rejects.toMatchObject({
      code: 'INVALID_OPTIONS',
    });
  });

  it('honours an aborted signal before and after the engine call', async () => {
    const { engine, convert } = fakeEngine();
    const converter = fromEngine(engine);
    await expect(
      converter.convert(new Uint8Array([1]), { to: 'step', signal: AbortSignal.abort('stop') }),
    ).rejects.toMatchObject({
      code: 'ABORTED',
      cause: 'stop',
    });
    expect(convert).not.toHaveBeenCalled();
    const controller = new AbortController();
    convert.mockImplementationOnce(async () => {
      controller.abort();
      return { bytes: new Uint8Array([1]), report: report() };
    });
    await expect(
      converter.convert(new Uint8Array([1]), { to: 'step', signal: controller.signal }),
    ).rejects.toMatchObject({
      code: 'ABORTED',
    });
  });

  it('refuses a lossy conversion in strict mode only', async () => {
    const lossy = fromEngine(fakeEngine([loss]).engine);
    await expect(lossy.convert(new Uint8Array([1]), { to: 'rhino', strict: true })).rejects.toMatchObject({
      code: 'REFUSED',
      phase: 'export',
    });
    const clean = fromEngine(fakeEngine().engine);
    await expect(clean.convert(new Uint8Array([1]), { to: 'rhino', strict: true })).resolves.toMatchObject({
      losses: [],
    });
  });
});

describe('convertFormats', () => {
  it('converts once per target, in order, passing the signal through', async () => {
    const { engine, convert } = fakeEngine();
    const signal = new AbortController().signal;
    const results = await fromEngine(engine).convertFormats(new Uint8Array([1]), {
      targets: [{ to: 'step' }, { to: 'iges', strict: false }],
      signal,
    });
    expect(results).toHaveLength(2);
    expect(convert.mock.calls.map((call) => call[2])).toEqual(['step', 'iges']);
  });

  it('works without a signal', async () => {
    const { engine } = fakeEngine();
    await expect(
      fromEngine(engine).convertFormats(new Uint8Array([1]), { targets: [{ to: 'step' }] }),
    ).resolves.toHaveLength(1);
  });
});
