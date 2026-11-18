import { describe, expect, it } from 'vitest';

import * as core from '#core.js';
import * as browser from '#index.js';
import * as node from '#index.node.js';

describe('entry points', () => {
  it('export the same runtime surface', () => {
    for (const api of [browser, node]) {
      expect(typeof api.createCadmpeg).toBe('function');
      expect(typeof api.convert).toBe('function');
      expect(typeof api.convertFormats).toBe('function');
      expect(typeof api.CadmpegError).toBe('function');
    }
    expect(Object.keys(browser).sort()).toEqual(Object.keys(node).sort());
  });

  it('the browser entry runs on WebAssembly', async () => {
    expect((await browser.createCadmpeg()).backend).toBe('wasm');
    await expect(browser.createCadmpeg({ backend: 'native' })).rejects.toMatchObject({
      code: 'BACKEND_UNAVAILABLE',
    });
  });

  it('the core entry exports the factory and refuses to guess where modules live', async () => {
    expect(Object.keys(core).sort()).toEqual(['CadmpegError', 'createCadmpeg']);
    await expect(core.createCadmpeg()).rejects.toMatchObject({ code: 'INVALID_OPTIONS' });
    expect((await core.createCadmpeg({ locateModule: () => '/step_bg.wasm' })).backend).toBe('wasm');
  });

  it('the Node entry prefers the addon and falls back to WebAssembly', async () => {
    expect(['native', 'wasm']).toContain((await node.createCadmpeg()).backend);
    expect((await node.createCadmpeg({ backend: 'wasm' })).backend).toBe('wasm');
  });
});
