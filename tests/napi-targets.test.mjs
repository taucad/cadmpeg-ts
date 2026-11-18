// `scripts/lib/napi-targets.mjs` derives the platform-package contract without
// importing the NAPI-RS CLI, because `registry-verify` runs the attestation
// verifier from a checkout that installs nothing. This test is the binding that
// keeps the two spellings identical: it reads the target list out of
// `package.json` and asserts the in-repo derivation against the pinned CLI's
// own parser, so a CLI bump that renames a suffix fails here rather than at the
// end of a release run.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { parseTriple as parseTripleWithCli } from '@napi-rs/cli';

import {
  parseTargetList,
  parseTriple,
  readNapiTargets,
  selectTargets,
} from '../scripts/lib/napi-targets.mjs';

const manifestUrl = new URL('../package.json', import.meta.url);
const TARGETS = JSON.parse(readFileSync(manifestUrl, 'utf8')).napi.targets;

// Triple shapes the CLI supports that this repository does not ship. They cover
// the derivation branches the sixteen configured targets leave untaken: a
// two-field triple, a system name spelled in the ABI field, and the three CPU
// rewrites no configured target uses.
const UNSHIPPED = [
  'aarch64-fuchsia',
  'aarch64-unknown-linux-ohos',
  'loongarch64-unknown-linux-gnu',
  'riscv64gc-unknown-linux-gnu',
  'x86_64-pc-windows-gnu',
];

describe('napi target derivation', () => {
  it('should parse every configured triple exactly as the pinned NAPI-RS CLI does', () => {
    assert.equal(TARGETS.length, 16);
    for (const triple of [...TARGETS, ...UNSHIPPED]) {
      const { abi, arch, platform, platformArchABI } = parseTripleWithCli(triple);
      assert.deepEqual(parseTriple(triple), { abi, arch, platform, platformArchABI, triple }, triple);
    }
  });

  it('should refuse a triple that names no single platform package', () => {
    for (const triple of ['wasm32-wasip1', 'wasm32-wasip1-threads', 'universal-apple-darwin']) {
      assert.throws(() => parseTriple(triple), new RegExp(`^Error: ${triple} names no single`, 'u'));
    }
  });

  it('should attach a libc selector to the glibc and musl targets alone', () => {
    const { packages } = readNapiTargets(manifestUrl);
    const withLibc = packages
      .filter(({ libc }) => libc !== undefined)
      .map(({ suffix, libc }) => [suffix, libc]);
    assert.deepEqual(withLibc, [
      ['linux-x64-gnu', 'glibc'],
      ['linux-arm64-gnu', 'glibc'],
      ['linux-ppc64-gnu', 'glibc'],
      ['linux-s390x-gnu', 'glibc'],
      ['linux-x64-musl', 'musl'],
      ['linux-arm64-musl', 'musl'],
    ]);
  });
});

describe('napi target subsets', () => {
  const { packages } = readNapiTargets(manifestUrl);

  it('should read a comma-separated subset in the order given', () => {
    assert.deepEqual(parseTargetList(' x86_64-unknown-linux-gnu,aarch64-apple-darwin ,'), [
      'x86_64-unknown-linux-gnu',
      'aarch64-apple-darwin',
    ]);
  });

  it('should refuse a subset that names nothing', () => {
    for (const value of ['', ' , ']) {
      assert.throws(() => parseTargetList(value), /must name at least one target triple/u);
    }
  });

  it('should select every configured target when no subset is named', () => {
    assert.equal(selectTargets(packages, undefined), packages);
  });

  it('should select exactly the named targets in configured order', () => {
    const selected = selectTargets(packages, ['x86_64-unknown-linux-gnu', 'aarch64-apple-darwin']);
    assert.deepEqual(
      selected.map(({ suffix }) => suffix),
      ['darwin-arm64', 'linux-x64-gnu'],
    );
  });

  it('should refuse an unconfigured, repeated, or empty subset', () => {
    assert.throws(
      () => selectTargets(packages, ['riscv64gc-unknown-linux-gnu']),
      /is not a configured napi target/u,
    );
    assert.throws(
      () => selectTargets(packages, ['aarch64-apple-darwin', 'aarch64-apple-darwin']),
      /named twice/u,
    );
    assert.throws(() => selectTargets(packages, []), /must name at least one target triple/u);
  });
});
