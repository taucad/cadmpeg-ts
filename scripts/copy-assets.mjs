#!/usr/bin/env node
// Copy the per-format WebAssembly modules and the CommonJS error stub into
// dist/ after tsdown, which owns only the TypeScript output.

import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
