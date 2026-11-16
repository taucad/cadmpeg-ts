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
  resolve: {
    alias: {
      // The `node` export condition never applies in a browser, so the public
      // facade resolves to the universal entry point the way a bundler does.
      'cadmpeg-ts': resolve(rootPackage, 'dist/index.mjs'),
    },
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
