#!/usr/bin/env node
// Verify a directory of `<id>_bg.wasm.gz` release assets against the digest
// map of a package tree, and the map against that tree's packed modules.
//
//   node scripts/verify-engine-assets.mjs --package release --assets engine-assets
//
// The release-assets job runs it on the assembled files before it attaches
// them, and again on the files it downloads back from the draft release; npm
// publication waits on both. Builtins only: that job installs nothing.

import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { assetFindings, packedModuleFindings, readDigests } from './module-digests.mjs';

const { values } = parseArgs({
  options: { package: { type: 'string' }, assets: { type: 'string' } },
});
if (!values.package || !values.assets) throw new Error('pass --package <dir> and --assets <dir>');

const packageDir = resolve(values.package);
const digests = await readDigests(packageDir);
const findings = [
  ...packedModuleFindings(digests, packageDir),
  ...assetFindings(digests, resolve(values.assets)),
];
if (findings.length > 0) {
  console.error(findings.join('\n'));
  process.exit(1);
}
console.log(`${Object.keys(digests).length} release assets match cadmpeg-ts/digests and the packed modules`);
