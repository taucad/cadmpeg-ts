import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { readNapiTargets } from '../scripts/lib/napi-targets.mjs';
import { extractPreviewPackages, npmPack, packTestTarballs } from '../scripts/pack-test-tarballs.mjs';

const { manifest, packages } = readNapiTargets(new URL('../package.json', import.meta.url));
const written = [];

const temporaryDirectory = (prefix) => {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  written.push(directory);
  return directory;
};

const createTree = () => {
  const root = temporaryDirectory('cadmpeg-ts-tarballs-');
  writeFileSync(join(root, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const target of packages) {
    mkdirSync(join(root, 'npm', target.suffix), { recursive: true });
  }
  return root;
};

// Names the packed directory so the assertions can prove every configured
// package was packed exactly once, in place of a real 17-way `npm pack`.
const recordingPack = (overrides = {}) => {
  const calls = [];
  const pack = (directory, destination) => {
    calls.push({ destination, directory });
    const suffix = directory.split(/[/\\]/u).at(-1);
    const target = packages.find((candidate) => candidate.suffix === suffix);
    const name = target ? target.name : manifest.name;
    return {
      filename: `${name}-${manifest.version}.tgz`,
      integrity: `sha512-${Buffer.from(name).toString('base64')}`,
      name,
      version: manifest.version,
      ...overrides[name],
    };
  };
  return { calls, pack };
};

afterEach(() => {
  for (const directory of written.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('frozen test tarball manifest', () => {
  it('should record one entry per generated package plus the root, sorted by name', () => {
    const root = createTree();
    const out = join(root, 'tarballs');
    const { calls, pack } = recordingPack();

    const result = packTestTarballs({ out, pack, root });

    assert.equal(calls.length, 17);
    assert.deepEqual(new Set(calls.map(({ destination }) => destination)), new Set([out]));
    const names = Object.keys(result.packages);
    assert.equal(names.length, 17);
    assert.deepEqual(names, [...names].sort());
    assert.deepEqual(names.slice(0, 2), ['cadmpeg-ts', 'cadmpeg-ts-android-arm-eabi']);
    assert.equal(result.version, manifest.version);
    assert.deepEqual(result.packages['cadmpeg-ts-linux-s390x-gnu'], {
      filename: `cadmpeg-ts-linux-s390x-gnu-${manifest.version}.tgz`,
      integrity: `sha512-${Buffer.from('cadmpeg-ts-linux-s390x-gnu').toString('base64')}`,
      version: manifest.version,
    });
  });

  it('should write the same manifest beside the tarballs and into the frozen tree', () => {
    const root = createTree();
    const out = join(root, 'tarballs');
    const { pack } = recordingPack();

    const result = packTestTarballs({ out, pack, root });

    const beside = readFileSync(join(out, 'test-tarballs.json'), 'utf8');
    const frozen = readFileSync(join(root, 'test-tarballs.json'), 'utf8');
    assert.equal(beside, frozen);
    assert.deepEqual(JSON.parse(frozen), result);
    assert.equal(beside.at(-1), '\n');
  });

  it('should reject a package whose packed version differs from the root version', () => {
    const root = createTree();
    const { pack } = recordingPack({ 'cadmpeg-ts-win32-ia32-msvc': { version: '0.0.1' } });

    assert.throws(
      () => packTestTarballs({ out: join(root, 'tarballs'), pack, root }),
      /cadmpeg-ts-win32-ia32-msvc packed version 0\.0\.1, expected /u,
    );
  });

  it('should reject a package whose packed name is not the configured one', () => {
    const root = createTree();
    const { pack } = recordingPack({
      'cadmpeg-ts-freebsd-x64': { name: 'cadmpeg-ts-freebsd-arm64' },
    });

    assert.throws(
      () => packTestTarballs({ out: join(root, 'tarballs'), pack, root }),
      /packed cadmpeg-ts-freebsd-arm64, expected cadmpeg-ts-freebsd-x64/u,
    );
  });

  it('should pack a real directory and report its name, version, filename, and integrity', () => {
    const source = temporaryDirectory('cadmpeg-ts-pack-source-');
    const destination = temporaryDirectory('cadmpeg-ts-pack-out-');
    writeFileSync(
      join(source, 'package.json'),
      `${JSON.stringify({ files: ['index.js'], name: 'cadmpeg-ts-linux-x64-gnu', private: false, version: '9.9.9' }, null, 2)}\n`,
    );
    writeFileSync(join(source, 'index.js'), 'export const nothing = 0;\n');

    const packed = npmPack(source, destination);

    assert.equal(packed.name, 'cadmpeg-ts-linux-x64-gnu');
    assert.equal(packed.version, '9.9.9');
    assert.equal(packed.filename, 'cadmpeg-ts-linux-x64-gnu-9.9.9.tgz');
    assert.match(packed.integrity, /^sha512-[\w+/=]+$/u);
    // The recorded filename names a real gzip member, not an empty placeholder.
    const bytes = readFileSync(join(destination, packed.filename));
    assert.deepEqual([...bytes.subarray(0, 2)], [0x1f, 0x8b], 'the packed file is a gzip stream');
    assert(bytes.length > 2);
  });

  it('should expand only the packages named by the frozen manifest', () => {
    const source = temporaryDirectory('cadmpeg-ts-preview-source-');
    const destination = temporaryDirectory('cadmpeg-ts-preview-parent-');
    const output = join(destination, 'packages');
    const packagesToPack = [
      { name: 'cadmpeg-ts', version: '9.9.9' },
      { name: 'cadmpeg-ts-darwin-arm64', version: '9.9.9' },
    ];
    const entries = {};

    for (const manifest of packagesToPack) {
      const directory = join(source, manifest.name);
      mkdirSync(directory);
      writeFileSync(join(directory, 'package.json'), `${JSON.stringify(manifest)}\n`);
      writeFileSync(join(directory, 'README.md'), `${manifest.name} preview\n`);
      const packed = npmPack(directory, source);
      entries[manifest.name] = packed;
    }
    writeFileSync(join(source, 'test-tarballs.json'), `${JSON.stringify({ packages: entries })}\n`);

    const directories = extractPreviewPackages({ from: source, out: output });

    assert.equal(directories.length, 2);
    assert.deepEqual(
      directories.map((directory) => JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))),
      packagesToPack,
    );
    assert.equal(readFileSync(join(directories[0], 'README.md'), 'utf8'), 'cadmpeg-ts preview\n');
  });

  it('should reject a tarball path outside the frozen directory', () => {
    const source = temporaryDirectory('cadmpeg-ts-preview-unsafe-');
    writeFileSync(
      join(source, 'test-tarballs.json'),
      `${JSON.stringify({ packages: { 'cadmpeg-ts': { filename: '../cadmpeg-ts.tgz', version: '1.0.0' } } })}\n`,
    );

    assert.throws(
      () => extractPreviewPackages({ from: source, out: join(source, 'out') }),
      /unsafe tarball filename/u,
    );
  });
});

describe('frozen test tarball manifest for a pull request subset', () => {
  it('should pack the root and exactly the named platform packages', () => {
    const root = createTree();
    const out = join(root, 'tarballs');
    const { calls, pack } = recordingPack();

    const result = packTestTarballs({
      out,
      pack,
      root,
      targets: ['x86_64-unknown-linux-gnu', 'aarch64-apple-darwin'],
    });

    assert.equal(calls.length, 3);
    assert.deepEqual(Object.keys(result.packages), [
      'cadmpeg-ts',
      'cadmpeg-ts-darwin-arm64',
      'cadmpeg-ts-linux-x64-gnu',
    ]);
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'test-tarballs.json'), 'utf8')), result);
  });

  it('should refuse a subset that names an unconfigured target', () => {
    const root = createTree();
    const { calls, pack } = recordingPack();

    assert.throws(
      () => packTestTarballs({ out: join(root, 'tarballs'), pack, root, targets: ['wasm32-wasip1'] }),
      /wasm32-wasip1 is not a configured napi target/u,
    );
    assert.equal(calls.length, 0);
  });
});
