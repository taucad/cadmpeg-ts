import { describe, expect, it, vi } from 'vitest';

import { createNativeEngine, loadNativeEngine, type Addon, type NativeHost } from '#native-engine.js';

const littleEndian: NativeHost = { arch: 'x64', platform: 'linux', node: '26.0.0', endianness: 'LE' };
const report = JSON.stringify({ from: 'step', to: 'step', losses: [], notes: [] });

describe('createNativeEngine', () => {
  it('passes bytes to the addon and reads its report', async () => {
    const convert = vi.fn<Addon['convert']>(async () => ({ bytes: Buffer.from([7, 8]), report }));
    const engine = createNativeEngine({ convert, detect: () => 'step' });
    const view = new Uint8Array([0, 1, 2, 3]).subarray(1, 3);
    const result = await engine.convert(view, 'a.stp', 'step');
    expect(engine.backend).toBe('native');
    expect([...(convert.mock.calls[0]?.[0] ?? [])]).toEqual([1, 2]);
    expect([...result.bytes]).toEqual([7, 8]);
    expect(result.report.from).toBe('step');
  });

  it('crosses as STEP where the wasm writer module cannot read the source, and joins both reports', async () => {
    const convert = vi.fn<Addon['convert']>(async (input, to) => ({
      bytes: Buffer.from(`${input.toString()}>${to}`),
      report: JSON.stringify({
        from: input.toString() === 'native' ? 'sldprt' : 'step',
        to: to.split(':')[0],
        losses: [{ phase: 'export', code: `${to}/loss`, severity: 'warning', message: 'm' }],
        notes: [`${to} note`],
      }),
    }));
    const detect = vi.fn<Addon['detect']>(() => 'sldprt');
    const engine = createNativeEngine({ convert, detect });
    const native = new TextEncoder().encode('native');

    const crossed = await engine.convert(native, 'part.sldprt', 'usd');
    expect(convert.mock.calls.map(([input, to]) => [input.toString(), to])).toEqual([
      ['native', 'step'],
      ['native>step', 'usd'],
    ]);
    expect(new TextDecoder().decode(crossed.bytes)).toBe('native>step>usd');
    expect(crossed.report).toEqual({
      from: 'sldprt',
      to: 'usd',
      losses: [
        { phase: 'export', code: 'step/loss', severity: 'warning', message: 'm' },
        { phase: 'export', code: 'usd/loss', severity: 'warning', message: 'm' },
      ],
      notes: ['step note', 'usd note'],
    });

    convert.mockClear();
    await engine.convert(native, 'part.sldprt', 'sldprt');
    await engine.convert(native, 'part.sldprt', 'step:ap242');
    expect(convert.mock.calls.map(([, to]) => to)).toEqual(['sldprt', 'step:ap242']);
    expect(detect).toHaveBeenCalledTimes(2);

    convert.mockClear();
    detect.mockReturnValue('step');
    await engine.convert(native, 'part.step', 'usd');
    detect.mockReturnValue(null);
    await engine.convert(native, 'part.bin', 'usd');
    expect(convert.mock.calls.map(([, to]) => to)).toEqual(['usd', 'usd']);
  });

  it('translates addon failures', async () => {
    const engine = createNativeEngine({
      convert: async () =>
        Promise.reject(new Error('{"code":"IMPORT_FAILED","message":"bad","phase":"decode"}')),
      detect: () => undefined,
    });
    await expect(engine.convert(new Uint8Array([1]), undefined, 'step')).rejects.toMatchObject({
      code: 'IMPORT_FAILED',
    });
  });
});

describe('loadNativeEngine', () => {
  it('loads the addon through the injected import', async () => {
    const engine = await loadNativeEngine(
      async () => ({ convert: async () => ({ bytes: Buffer.from([]), report }), detect: () => undefined }),
      littleEndian,
    );
    expect(engine.backend).toBe('native');
  });

  it('refuses a big-endian POWER host before loading', async () => {
    const importAddon = vi.fn();
    await expect(
      loadNativeEngine(importAddon, { ...littleEndian, arch: 'ppc64', endianness: 'BE' }),
    ).rejects.toMatchObject({
      code: 'BACKEND_UNAVAILABLE',
    });
    expect(importAddon).not.toHaveBeenCalled();
    await expect(
      loadNativeEngine(async () => ({}), { ...littleEndian, arch: 'ppc64' }),
    ).resolves.toMatchObject({ backend: 'native' });
  });

  it('reports a loader failure with its cause', async () => {
    const cause = new Error('no package');
    await expect(loadNativeEngine(async () => Promise.reject(cause), littleEndian)).rejects.toMatchObject({
      code: 'BACKEND_UNAVAILABLE',
      cause,
    });
  });

  it('defaults to the generated loader and this host', async () => {
    const outcome = await loadNativeEngine().then(
      (engine) => engine.backend,
      (error: unknown) => (error as { code: string }).code,
    );
    expect(['native', 'BACKEND_UNAVAILABLE']).toContain(outcome);
  });
});
