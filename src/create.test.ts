import { describe, expect, it, vi } from 'vitest';

import { bindHost, packagedGlue, packagedModuleUrl, type Host } from '#create.js';
import type { Engine } from '#engine.js';
import { CadmpegError } from '#errors.js';

const stepGlue = {
  default: vi.fn(async () => undefined),
  detect: vi.fn(() => 'step'),
  convert: vi.fn(() => ({
    takeBytes: () => new Uint8Array([1]),
    report: JSON.stringify({ from: 'step', to: 'step', losses: [], notes: [] }),
    free: () => undefined,
  })),
};
const step = new TextEncoder().encode('ISO-10303-21;');
const nativeEngine: Engine = {
  backend: 'native',
  convert: async () => ({
    bytes: new Uint8Array([2]),
    report: { from: 'step', to: 'step', losses: [], notes: [] },
  }),
};

const host = (overrides: Partial<Host> = {}): Host => ({
  loadGlue: async () => stepGlue,
  locateModule: () => '/default',
  ...overrides,
});

describe('createCadmpeg', () => {
  it('uses WebAssembly when the entry point has no native backend', async () => {
    const api = bindHost(host());
    expect((await api.createCadmpeg()).backend).toBe('wasm');
    expect((await api.createCadmpeg({ backend: 'wasm' })).backend).toBe('wasm');
    await expect(api.createCadmpeg({ backend: 'native' })).rejects.toMatchObject({
      code: 'BACKEND_UNAVAILABLE',
    });
  });

  it('prefers the native backend, and falls back to WebAssembly under auto', async () => {
    expect((await bindHost(host({ loadNative: async () => nativeEngine })).createCadmpeg()).backend).toBe(
      'native',
    );
    const failing = bindHost(host({ loadNative: async () => Promise.reject(new Error('no addon')) }));
    expect((await failing.createCadmpeg()).backend).toBe('wasm');
    await expect(failing.createCadmpeg({ backend: 'native' })).rejects.toMatchObject({
      code: 'BACKEND_UNAVAILABLE',
    });
    const typed = bindHost(
      host({ loadNative: async () => Promise.reject(new CadmpegError('BACKEND_UNAVAILABLE', 'big-endian')) }),
    );
    await expect(typed.createCadmpeg({ backend: 'native' })).rejects.toThrow('big-endian');
  });

  it('rejects an unknown backend', async () => {
    await expect(bindHost(host()).createCadmpeg({ backend: 'gpu' as 'wasm' })).rejects.toMatchObject({
      code: 'INVALID_OPTIONS',
    });
  });

  it('uses a caller-supplied module locator', async () => {
    const locateModule = vi.fn(() => '/custom');
    const converter = await bindHost(host()).createCadmpeg({ backend: 'wasm', locateModule });
    await converter.convert(step, { to: 'step' });
    expect(locateModule).toHaveBeenCalledWith('step');
  });
});

describe('one-shot functions', () => {
  it('share one converter', async () => {
    const loadNative = vi.fn(async () => nativeEngine);
    const api = bindHost({ ...host(), loadNative });
    expect((await api.convert(step, { to: 'step' })).backend).toBe('native');
    expect((await api.convertFormats(step, { targets: [{ to: 'step' }] }))[0]?.backend).toBe('native');
    expect(loadNative).toHaveBeenCalledOnce();
  });
});

describe('packaged modules', () => {
  it('resolve beside the package', () => {
    expect(packagedModuleUrl('sldprt').pathname.endsWith('/wasm/sldprt_bg.wasm')).toBe(true);
  });

  it('import glue from ./wasm', async () => {
    const outcome = await packagedGlue('step').then(
      (glue) => typeof glue.convert,
      (error: unknown) => (error instanceof Error ? 'missing' : 'unknown'),
    );
    expect(['function', 'missing']).toContain(outcome);
  });
});
