#!/usr/bin/env node
// Byte ceilings for every per-format WebAssembly module.
//
// Each ceiling is the measured size plus headroom, recorded in
// scripts/lib/wasm-budgets.json with the run that measured it. Raising one is
// an explicit budget edit in the pull request that causes it. A module with no
// budget fails: admission is a deliberate entry, never a default.

import { readFileSync } from 'node:fs';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const budgets = JSON.parse(readFileSync(new URL('./lib/wasm-budgets.json', import.meta.url), 'utf8'));
const source = readFileSync(new URL('../src/formats.ts', import.meta.url), 'utf8');
const ids = [
  ...(/export const modules = \{([\s\S]*?)\} as const;/u.exec(source)?.[1] ?? '').matchAll(/^\s*(\w+):/gmu),
].map(([, id]) => id);

const failures = [];
const rows = [];
for (const id of ids) {
  const wasm = readFileSync(new URL(`../src/wasm/${id}_bg.wasm`, import.meta.url));
  const size = {
    raw: wasm.byteLength,
    gzip9: gzipSync(wasm, { level: 9 }).byteLength,
    brotli11: brotliCompressSync(wasm, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 24 },
    }).byteLength,
  };
  rows.push({ module: id, ...size });
  const budget = budgets.modules[id];
  if (!budget) {
    failures.push(`${id} has no budget in scripts/lib/wasm-budgets.json (measured ${JSON.stringify(size)})`);
    continue;
  }
  for (const key of ['raw', 'brotli11']) {
    if (size[key] > budget[key])
      failures.push(`${id} ${key} ${size[key]} exceeds its ${budget[key]} ceiling`);
  }
}
console.table(rows);
if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
