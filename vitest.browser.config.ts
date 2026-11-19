import { resolve } from 'node:path';

import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const providers = {
  chromium: { browser: 'chromium', headless: true },
  firefox: { browser: 'firefox', headless: true },
  webkit: { browser: 'webkit', headless: true },
} as const;

const requestedBrowser = process.env['BROWSER'];
if (requestedBrowser && !(requestedBrowser in providers)) {
  throw new Error(`unsupported BROWSER: ${requestedBrowser}`);
}
const instances = requestedBrowser
  ? [providers[requestedBrowser as keyof typeof providers]]
  : [providers.chromium, providers.firefox, providers.webkit];

// CI extracts the frozen root tarball and points this at its `package/`
// directory, so the browser tests resolve the same bytes the registry serves.
const rootPackage = resolve(process.env['CADMPEG_TS_ROOT_PACKAGE'] ?? '.');

export default defineConfig({
  // `cadmpeg-ts/core` callers fetch the modules themselves; the test serves
  // them from the package under test.
  define: { __CADMPEG_TS_WASM_BASE__: JSON.stringify(`/@fs${resolve(rootPackage, 'dist/wasm')}/`) },
  resolve: {
    // The `node` export condition never applies in a browser, so each public
    // entry resolves to its default condition the way a bundler does.
    alias: [
      { find: /^cadmpeg-ts$/u, replacement: resolve(rootPackage, 'dist/index.mjs') },
      { find: /^cadmpeg-ts\/core$/u, replacement: resolve(rootPackage, 'dist/core.mjs') },
      { find: /^cadmpeg-ts\/digests$/u, replacement: resolve(rootPackage, 'dist/digests.mjs') },
    ],
  },
  server: { fs: { allow: [resolve('.'), rootPackage] } },
  test: {
    browser: {
      enabled: true,
      provider: playwright(),
      instances,
    },
    hookTimeout: 120_000,
    include: ['tests/browser/**/*.browser.test.mjs'],
    reporters: ['verbose'],
    testTimeout: 240_000,
  },
});
