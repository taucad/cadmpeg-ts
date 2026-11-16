#!/usr/bin/env node
// Record, not gate, the conversion speed of the shipped modules (charter Q13):
// load time, first conversion and the median of five warm conversions for the
// STEP and SOLIDWORKS fixtures. The numbers go to the job log and the step
// summary so a profile change shows its cost in the pull request that makes it.

import { appendFileSync, readFileSync } from 'node:fs';

const fixtures = [
  ['step', 'nist_ctc_01_asme1_ap242-e1.stp'],
  ['sldprt', 'nist_ftc_06_asme1_rd_sw1802.SLDPRT'],
];
const median = (values) => values.toSorted((a, b) => a - b)[values.length >> 1];
const rows = [];
for (const [id, fixture] of fixtures) {
  const input = new Uint8Array(readFileSync(new URL(`../tests/fixtures/${fixture}`, import.meta.url)));
  let started = performance.now();
  const glue = await import(new URL(`../src/wasm/${id}.js`, import.meta.url).href);
  await glue.default({ module_or_path: readFileSync(new URL(`../src/wasm/${id}_bg.wasm`, import.meta.url)) });
  const load = performance.now() - started;
  const convert = () => {
    started = performance.now();
    const conversion = glue.convert(input, 'step');
    conversion.takeBytes();
    conversion.free();
    return performance.now() - started;
  };
  const cold = convert();
  const warm = median(Array.from({ length: 5 }, convert));
  rows.push({
    module: id,
    fixture,
    loadMs: Math.round(load),
    coldMs: Math.round(cold),
    warmMs: Math.round(warm),
  });
}
console.table(rows);
if (process.env['GITHUB_STEP_SUMMARY']) {
  const lines = ['| module | fixture | load ms | cold ms | warm ms |', '| --- | --- | --- | --- | --- |'];
  for (const row of rows)
    lines.push(`| ${row.module} | ${row.fixture} | ${row.loadMs} | ${row.coldMs} | ${row.warmMs} |`);
  appendFileSync(process.env['GITHUB_STEP_SUMMARY'], `${lines.join('\n')}\n`);
}
