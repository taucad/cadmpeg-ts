#!/usr/bin/env node
// Apply patches/*.patch to the upstream submodule, in order.
//
// The submodule is pinned to an upstream release tag (charter D1); every
// build applies the queue first. A patch already applied is skipped, so the
// script is idempotent. `--check` fails unless every patch applies to the
// pristine pinned tree, which is the CI check that a bump still carries its
// queue. A patch that no longer applies is a failure, never a skip.

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const upstream = resolve(root, 'upstream/cadmpeg');
const patchDirectory = resolve(root, 'patches');
const check = process.argv.includes('--check');

const git = (...args) =>
  execFileSync('git', ['-C', upstream, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const succeeds = (...args) => {
  try {
    git(...args);
    return true;
  } catch {
    return false;
  }
};

const patches = readdirSync(patchDirectory)
  .filter((name) => /^\d{4}-.+\.patch$/u.test(name))
  .sort();

if (check) {
  if (git('status', '--porcelain').trim() !== '') {
    throw new Error('upstream/cadmpeg is not pristine; --check needs the pinned tree');
  }
  for (const name of patches) {
    git('apply', '--check', resolve(patchDirectory, name));
    git('apply', resolve(patchDirectory, name));
  }
  git('reset', '--hard', '--quiet');
  git('clean', '-fdq');
  console.log(`all ${patches.length} patches apply to ${git('describe', '--tags').trim()}`);
} else {
  for (const name of patches) {
    const path = resolve(patchDirectory, name);
    if (succeeds('apply', '--reverse', '--check', path)) {
      console.log(`already applied: ${name}`);
      continue;
    }
    git('apply', path);
    console.log(`applied: ${name}`);
  }
}
