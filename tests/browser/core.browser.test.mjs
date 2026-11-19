import { createCadmpeg } from 'cadmpeg-ts';
import { expect, test } from 'vitest';

// The engine-free entry: the caller fetches each module, verifies it against
// `cadmpeg-ts/digests`, and hands the verified bytes over. Output must equal
// the packaged entry's byte for byte.
//
// This file stays separate from convert.browser.test.mjs on purpose: an
// instantiated glue module is a singleton per realm, so the core engine must
// be the first to load `sldprt` here for its locator to be called at all.
test('converts through cadmpeg-ts/core with modules the caller locates and verifies', async () => {
  const response = await fetch(new URL('../fixtures/nist_ftc_06_asme1_rd_sw1802.SLDPRT', import.meta.url));
  expect(response.ok).toBe(true);
  const input = { name: 'ftc06.SLDPRT', bytes: new Uint8Array(await response.arrayBuffer()) };

  const { createCadmpeg: createCore } = await import('cadmpeg-ts/core');
  const { digests } = await import('cadmpeg-ts/digests');
  await expect(createCore()).rejects.toMatchObject({ code: 'INVALID_OPTIONS' });

  const located = [];
  const core = await createCore({
    locateModule: async (id) => {
      located.push(id);
      const module = await fetch(`${__CADMPEG_TS_WASM_BASE__}${id}_bg.wasm`);
      const bytes = new Uint8Array(await module.arrayBuffer());
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      expect(bytes.byteLength).toBe(digests[id].wasm.byteLength);
      expect([...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('')).toBe(
        digests[id].wasm.sha256,
      );
      return bytes;
    },
  });
  const fromCore = await core.convert(input, { to: 'step' });
  expect(located).toEqual(['sldprt']);

  const packaged = await createCadmpeg({ backend: 'wasm' });
  const fromPackaged = await packaged.convert(input, { to: 'step' });
  expect(fromCore.files[0].bytes).toEqual(fromPackaged.files[0].bytes);
  expect(fromCore.losses).toEqual(fromPackaged.losses);
});
