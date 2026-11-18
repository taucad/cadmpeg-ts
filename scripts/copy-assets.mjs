#!/usr/bin/env node
// Copy the per-format WebAssembly modules and the CommonJS error stub into
// dist/ after tsdown, which owns only the TypeScript output, then generate the
// digest map (dist/digests.mjs) and the gzip release assets (engine-assets/)
// from the copied modules in one pass.

import { cpSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeModuleDigests } from './module-digests.mjs';
import { MODULES } from './package-files.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
if (!existsSync(resolve(root, 'src/wasm')))
  throw new Error('src/wasm is missing; run pnpm run build:wasm first');
cpSync(resolve(root, 'src/wasm'), resolve(root, 'dist/wasm'), { recursive: true });
for (const name of ['cjs-error.cjs', 'cjs-error.d.cts'])
  cpSync(resolve(root, 'src', name), resolve(root, 'dist', name));
// The NAPI-RS loader is generated into src/native/ because tsdown's `clean`
// wipes dist/ first. Its declarations are a build input and the addon binary
// belongs to the platform packages, so neither is copied.
cpSync(resolve(root, 'src/native/index.js'), resolve(root, 'dist/native/index.js'));
// The glue must load only the binary the engine hands it (charter F2):
// build-wasm.mjs strips wasm-bindgen's default URL, and a stale src/wasm/
// from an older build must not reach the package.
for (const id of MODULES) {
  if (readFileSync(resolve(root, 'dist/wasm', `${id}.js`), 'utf8').includes('import.meta.url')) {
    throw new Error(`dist/wasm/${id}.js still names a default binary; rebuild it with pnpm run build:wasm`);
  }
}
writeModuleDigests({ distDir: resolve(root, 'dist'), assetsDir: resolve(root, 'engine-assets') });
