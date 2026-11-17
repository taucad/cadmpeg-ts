#!/usr/bin/env node
// Build the per-format WebAssembly modules (charter D11) into src/wasm/.
//
//   node scripts/build-wasm.mjs                  every module
//   node scripts/build-wasm.mjs --modules step,sldprt
//
// Each module is rust/binding-wasm built with that module's codec features,
// bound with wasm-bindgen's `web` target as src/wasm/<id>.js and
// src/wasm/<id>_bg.wasm, then optimized with the exact-pinned Binaryen. The
// module table is src/formats.ts; this script reads it rather than repeat it.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { WASM_OPT_ARGS } from './lib/wasm-profile.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = resolve(root, 'src/wasm');
const wasmOpt = fileURLToPath(import.meta.resolve('binaryen/bin/wasm-opt'));

/** The module table, read from the TypeScript source of truth. */
const readModules = () => {
  const source = readFileSync(resolve(root, 'src/formats.ts'), 'utf8');
  const body = /export const modules = \{([\s\S]*?)\} as const;/u.exec(source)?.[1];
  if (!body) throw new Error('src/formats.ts has no modules table');
  return Object.fromEntries(
    [...body.matchAll(/^\s*(\w+): \[([^\]]*)\],$/gmu)].map(([, id, codecs]) => [
      id,
      [...codecs.matchAll(/'(\w+)'/gu)].map(([, codec]) => codec),
    ]),
  );
};

const modules = readModules();
const flag = process.argv.indexOf('--modules');
const selected = flag === -1 ? Object.keys(modules) : process.argv[flag + 1].split(',');
for (const id of selected) if (!modules[id]) throw new Error(`unknown module ${id}`);

const targetDirectory = process.env.CARGO_TARGET_DIR ?? resolve(root, 'rust/target');
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, 'package.json'), '{"type":"module"}\n');

for (const id of selected) {
  const started = Date.now();
  execFileSync(
    'cargo',
    [
      'build',
      '--locked',
      '--manifest-path',
      'rust/Cargo.toml',
      '-p',
      'cadmpeg-wasm',
      '--target',
      'wasm32-unknown-unknown',
      '--profile',
      'wasm',
      '--features',
      modules[id].join(','),
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        RUSTFLAGS: [process.env.RUSTFLAGS, `--remap-path-prefix=${root}=.`, '-C', 'target-feature=+simd128']
          .filter(Boolean)
          .join(' '),
      },
      stdio: 'inherit',
    },
  );
  execFileSync(
    'wasm-bindgen',
    [
      '--target',
      'web',
      '--out-dir',
      output,
      '--out-name',
      id,
      '--remove-name-section',
      '--remove-producers-section',
      resolve(targetDirectory, 'wasm32-unknown-unknown/wasm/cadmpeg_wasm.wasm'),
    ],
    { cwd: root, stdio: 'inherit' },
  );
  const wasmPath = resolve(output, `${id}_bg.wasm`);
  if (WASM_OPT_ARGS.length > 0) {
    execFileSync(process.execPath, [wasmOpt, wasmPath, ...WASM_OPT_ARGS, '-o', `${wasmPath}.opt`], {
      cwd: root,
      stdio: 'inherit',
    });
    renameSync(`${wasmPath}.opt`, wasmPath);
  }
  rmSync(resolve(output, `${id}.d.ts`), { force: true });
  rmSync(resolve(output, `${id}_bg.wasm.d.ts`), { force: true });
  if (readFileSync(wasmPath).includes(Buffer.from(root))) throw new Error(`${id} embeds the checkout path`);
  console.log(
    `${id}: ${readFileSync(wasmPath).length} bytes in ${Math.round((Date.now() - started) / 1000)} s`,
  );
}
rmSync(resolve(output, '.gitignore'), { force: true });
