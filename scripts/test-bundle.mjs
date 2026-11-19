#!/usr/bin/env node

/**
 * Packed-consumer bundler evidence (engine delivery charter F2): build a
 * browser app with Vite against the frozen root tarball, once through each
 * entry, and count the WebAssembly files the bundler emits.
 *
 *   node scripts/test-bundle.mjs --tarballs tarballs
 *   node scripts/test-bundle.mjs --package <extracted package directory>
 *
 * `cadmpeg-ts` locates its packaged modules and must emit all thirteen.
 * `cadmpeg-ts/core` names no binary and must emit none. No glue file in the
 * package may read `import.meta.url`, whichever entry reaches it.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { MODULES } from './package-files.mjs';

/** What each entry must emit. */
export const EXPECTED_WASM = { 'cadmpeg-ts': MODULES.length, 'cadmpeg-ts/core': 0 };

/**
 * Every file under a directory, relative to it.
 *
 * @param {string} directory - Directory to list.
 * @returns {string[]} Relative paths.
 */
export const listFiles = (directory) =>
  readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(directory.length + 1));

/**
 * Name every glue file that still carries a default binary URL.
 *
 * @param {string} packageDir - Package root.
 * @returns {string[]} Offending glue files.
 */
export const glueWithDefaultUrl = (packageDir) =>
  MODULES.map((id) => `dist/wasm/${id}.js`).filter((file) =>
    readFileSync(join(packageDir, file), 'utf8').includes('import.meta.url'),
  );

const extractRootTarball = (tarballDir, destination) => {
  const manifest = JSON.parse(readFileSync(join(tarballDir, 'test-tarballs.json'), 'utf8'));
  const filename = manifest.packages?.['cadmpeg-ts']?.filename;
  if (typeof filename !== 'string') throw new Error('test-tarballs.json records no cadmpeg-ts tarball');
  mkdirSync(destination, { recursive: true });
  execFileSync('tar', ['-xzf', resolve(tarballDir, filename), '-C', destination, '--strip-components=1']);
};

const main = async () => {
  const { values } = parseArgs({ options: { tarballs: { type: 'string' }, package: { type: 'string' } } });
  if (Boolean(values.tarballs) === Boolean(values.package)) {
    throw new Error('pass exactly one of --tarballs <dir> or --package <dir>');
  }
  const { build } = await import('vite');
  const work = mkdtempSync(join(tmpdir(), 'cadmpeg-ts-bundle-'));
  try {
    const installed = join(work, 'node_modules', 'cadmpeg-ts');
    if (values.tarballs) extractRootTarball(resolve(values.tarballs), installed);
    else cpSync(resolve(/** @type {string} */ (values.package)), installed, { recursive: true });

    const stale = glueWithDefaultUrl(installed);
    if (stale.length > 0) throw new Error(`glue that still reads import.meta.url: ${stale.join(', ')}`);
    console.log(`no glue file of ${MODULES.length} reads import.meta.url`);

    writeFileSync(join(work, 'package.json'), '{"private":true,"type":"module"}\n');
    const failures = [];
    for (const [specifier, expected] of Object.entries(EXPECTED_WASM)) {
      const name = specifier.replace(/\W+/gu, '-');
      const entry = join(work, `${name}.js`);
      writeFileSync(
        entry,
        `import { createCadmpeg } from '${specifier}';\n` +
          `globalThis.converter = createCadmpeg({ locateModule: (id) => \`/engines/\${id}.wasm\` });\n`,
      );
      const outDir = join(work, `out-${name}`);
      await build({
        configFile: false,
        logLevel: 'warn',
        root: work,
        build: { emptyOutDir: true, outDir, rollupOptions: { input: entry } },
      });
      const files = listFiles(outDir);
      const wasm = files.filter((file) => file.endsWith('.wasm'));
      console.log(`${specifier}: ${wasm.length} .wasm emitted (expected ${expected}), ${files.length} files`);
      if (wasm.length !== expected)
        failures.push(`${specifier} emitted ${wasm.length} .wasm, expected ${expected}`);
    }
    if (failures.length > 0) throw new Error(failures.join('\n'));
  } finally {
    rmSync(work, { force: true, recursive: true });
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
