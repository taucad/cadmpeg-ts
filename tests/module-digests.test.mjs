import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { gunzipSync } from 'node:zlib';

import { stripDefaultModuleUrl } from '../scripts/lib/wasm-glue.mjs';
import {
  assetFindings,
  describeFile,
  gzipModule,
  packedModuleFindings,
  readDigests,
  writeModuleDigests,
} from '../scripts/module-digests.mjs';
import { MODULES } from '../scripts/package-files.mjs';

const glue = (id) => `async function __wbg_init_once(module_or_path) {

    if (module_or_path === undefined) {
        module_or_path = new URL('${id}_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();
}
`;

/** A package tree with thirteen distinct stand-in modules. */
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'cadmpeg-ts-digests-'));
  mkdirSync(join(root, 'dist/wasm'), { recursive: true });
  for (const [index, id] of MODULES.entries()) {
    const bytes = Buffer.concat([Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]), Buffer.alloc(4096, index)]);
    writeFileSync(join(root, 'dist/wasm', `${id}_bg.wasm`), bytes);
  }
  return root;
};

describe('glue post-processing', () => {
  it('should replace the default binary URL with a refusal', () => {
    const stripped = stripDefaultModuleUrl(glue('sldprt'), 'sldprt');
    assert(!stripped.includes('import.meta.url'));
    assert(stripped.includes("throw new Error('cadmpeg-ts: the sldprt module needs module_or_path');"));
    assert(stripped.includes('const imports = __wbg_get_imports();'));
  });

  it('should refuse glue whose shape changed or that names another module', () => {
    assert.throws(() => stripDefaultModuleUrl('export default 1;', 'step'), /found 0/u);
    assert.throws(() => stripDefaultModuleUrl(glue('step') + glue('step'), 'step'), /found 2/u);
    assert.throws(() => stripDefaultModuleUrl(glue('nx'), 'creo'), /creo_bg\.wasm/u);
    assert.throws(
      () => stripDefaultModuleUrl(`${glue('step')}const x = import.meta.url;\n`, 'step'),
      /still reads import\.meta\.url/u,
    );
  });
});

describe('module digests', () => {
  it('should gzip deterministically with no name, time or platform in the header', () => {
    const bytes = Buffer.alloc(100_000, 7);
    const first = gzipModule(bytes);
    assert.deepEqual(first, gzipModule(bytes));
    assert.equal(first.readUInt32LE(4), 0, 'MTIME');
    assert.equal(first[3], 0, 'FLG');
    assert.equal(first[9], 3, 'OS');
    assert.deepEqual(gunzipSync(first), bytes);
  });

  it('should write a map and assets from the same bytes, and accept both', async () => {
    const root = fixture();
    try {
      const written = writeModuleDigests({ distDir: join(root, 'dist'), assetsDir: join(root, 'assets') });
      const digests = await readDigests(root);
      assert.deepEqual(JSON.parse(JSON.stringify(digests)), written);
      assert.deepEqual(Object.keys(digests), MODULES);
      assert(Object.isFrozen(digests) && Object.isFrozen(digests.step) && Object.isFrozen(digests.step.gzip));
      const step = readFileSync(join(root, 'dist/wasm/step_bg.wasm'));
      assert.deepEqual(digests.step.wasm, describeFile(step));
      assert.equal(digests.step.wasm.byteLength, step.byteLength);
      assert.match(digests.step.gzip.sha256, /^[0-9a-f]{64}$/u);
      assert.deepEqual(packedModuleFindings(digests, root), []);
      assert.deepEqual(assetFindings(digests, join(root, 'assets')), []);
      assert(
        readFileSync(join(root, 'assets/SHA256SUMS'), 'utf8').includes(
          `${digests.usd.gzip.sha256}  usd_bg.wasm.gz\n`,
        ),
      );
      assert(
        readFileSync(join(root, 'dist/digests.d.mts'), 'utf8').includes(
          'Readonly<Record<ModuleId, ModuleDigest>>',
        ),
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('should refuse a map that drifted from the packed modules', async () => {
    const root = fixture();
    try {
      writeModuleDigests({ distDir: join(root, 'dist'), assetsDir: join(root, 'assets') });
      const digests = await readDigests(root);
      writeFileSync(join(root, 'dist/wasm/catia_bg.wasm'), Buffer.from([0, 97, 115, 109]));
      const findings = packedModuleFindings(digests, root);
      assert.equal(findings.length, 1);
      assert.match(findings[0], /^catia: /u);
      const short = Object.fromEntries(Object.entries(digests).filter(([id]) => id !== 'usd'));
      assert.match(packedModuleFindings(short, root)[0], /names \[/u);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('should refuse a missing, extra, altered or mislabeled release asset', async () => {
    const root = fixture();
    const assets = join(root, 'assets');
    try {
      writeModuleDigests({ distDir: join(root, 'dist'), assetsDir: assets });
      const digests = await readDigests(root);
      rmSync(join(assets, 'nx_bg.wasm.gz'));
      writeFileSync(join(assets, 'extra_bg.wasm.gz'), gzipModule(Buffer.from('x')));
      const flipped = readFileSync(join(assets, 'rhino_bg.wasm.gz'));
      flipped[flipped.length - 20] ^= 1;
      writeFileSync(join(assets, 'rhino_bg.wasm.gz'), flipped);
      writeFileSync(join(assets, 'sat_bg.wasm.gz'), readFileSync(join(assets, 'pvz_bg.wasm.gz')));
      const findings = assetFindings(digests, assets).join('\n');
      assert.match(findings, /missing release assets: nx_bg\.wasm\.gz/u);
      assert.match(findings, /unexpected release assets: extra_bg\.wasm\.gz/u);
      assert.match(findings, /rhino_bg\.wasm\.gz: .* differs from the map/u);
      assert.match(findings, /sat_bg\.wasm\.gz: .* differs from the map/u);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

describe('packaged glue imports', () => {
  it('should name every module with one literal import a bundler can follow', () => {
    const source = readFileSync(new URL('../src/create.ts', import.meta.url), 'utf8');
    const named = [...source.matchAll(/(\w+): async \(\) => import\('\.\/wasm\/(\w+)\.js' as string\)/gu)];
    assert.deepEqual(
      named.map(([, key, file]) => [key, file]),
      MODULES.map((id) => [id, id]),
    );
    assert(!source.includes('import.meta.url'), 'create.ts must not locate a packaged binary');
  });
});
