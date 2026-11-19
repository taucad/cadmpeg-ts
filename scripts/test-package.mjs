#!/usr/bin/env node

/**
 * Clean-room runtime evidence for one platform package.
 *
 * Tarball mode (`CADMPEG_TS_TARBALL_DIR`) installs the frozen root tarball plus
 * the frozen `cadmpeg-ts-<suffix>` tarball; registry mode
 * (`CADMPEG_TS_REGISTRY_VERSION`) installs the published root the way a
 * consumer does, proves npm's selectors kept only the packages they can keep,
 * and proves the loader opened the named one. The caller always names the
 * suffix in `CADMPEG_TS_NATIVE_SUFFIX`: this script holds no host-to-target
 * map, because the generated loader owns selection.
 *
 * A pull request assembles a subset of the configured targets and names it in
 * `CADMPEG_TS_NATIVE_TARGETS`; the frozen manifest must then record exactly
 * that subset. Unset or empty, the manifest must record every configured
 * target, which is what a publishing run freezes.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';

import { parseTargetList, readNapiTargets, selectTargets } from './lib/napi-targets.mjs';

const ROOT_PACKAGE = 'cadmpeg-ts';
const SUFFIX_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const INSTALL_FLAGS = ['--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock'];

/**
 * Read the platform suffix the caller named, for example the `<suffix>` in
 * `cadmpeg-ts-<suffix>`.
 *
 * @param {Record<string, string | undefined>} environment - Process environment.
 * @returns {string} The validated suffix.
 */
export const requireNativeSuffix = (environment) => {
  const suffix = environment['CADMPEG_TS_NATIVE_SUFFIX'];
  if (typeof suffix !== 'string' || suffix.length === 0) {
    throw new Error('CADMPEG_TS_NATIVE_SUFFIX must name the suffix of the platform package to smoke');
  }
  if (!SUFFIX_PATTERN.test(suffix)) {
    throw new Error(`CADMPEG_TS_NATIVE_SUFFIX is not a platform suffix: ${suffix}`);
  }
  return suffix;
};

/**
 * Read the target subset the run assembled, if it assembled a subset.
 *
 * @param {Record<string, string | undefined>} environment - Process environment.
 * @returns {string[] | undefined} The subset's triples, or `undefined` for every configured target.
 */
export const readNativeTargets = (environment) => {
  const value = environment['CADMPEG_TS_NATIVE_TARGETS'];
  return value === undefined || value === '' ? undefined : parseTargetList(value);
};

/**
 * Hold the frozen tarball manifest to what the run assembled: the root package
 * and every configured platform package, or the root and exactly the named
 * subset. A tarball set that lost a platform package fails here rather than
 * passing every smoke row that happens not to need it.
 *
 * @param {{ packages?: unknown }} manifest - Parsed `test-tarballs.json`.
 * @param {Array<{ name: string, triple: string }>} targets - Configured platform packages.
 * @param {string[] | undefined} subset - Assembled target subset, or `undefined` for every target.
 * @returns {string[]} The sorted package names the manifest records.
 */
export const checkFrozenInventory = (manifest, targets, subset) => {
  const expected = new Set([ROOT_PACKAGE, ...selectTargets(targets, subset).map(({ name }) => name)]);
  const recorded = Object.keys(
    typeof manifest.packages === 'object' && manifest.packages !== null ? manifest.packages : {},
  ).sort();
  const missing = [...expected].filter((name) => !recorded.includes(name)).sort();
  const unexpected = recorded.filter((name) => !expected.has(name));
  const scope = subset === undefined ? 'every configured target' : `the target subset ${subset.join(', ')}`;
  if (missing.length > 0) {
    throw new Error(`the frozen tarball manifest for ${scope} is missing ${missing.join(', ')}`);
  }
  if (unexpected.length > 0) {
    throw new Error(`the frozen tarball manifest for ${scope} also records ${unexpected.join(', ')}`);
  }
  return recorded;
};

/**
 * Decide which package source this run installs from.
 *
 * @param {Record<string, string | undefined>} environment - Process environment.
 * @returns {{ kind: 'tarball', directory: string } | { kind: 'registry', version: string }} The mode.
 */
export const resolveSmokeMode = (environment) => {
  const directory = environment['CADMPEG_TS_TARBALL_DIR'];
  const version = environment['CADMPEG_TS_REGISTRY_VERSION'];
  const named = [directory, version].filter((value) => typeof value === 'string' && value.length > 0);
  if (named.length !== 1) {
    throw new Error(
      'set exactly one of CADMPEG_TS_TARBALL_DIR (frozen tarballs) or CADMPEG_TS_REGISTRY_VERSION (published release)',
    );
  }
  return directory !== undefined && directory.length > 0
    ? { kind: 'tarball', directory }
    : { kind: 'registry', version: /** @type {string} */ (version) };
};

/**
 * Read `test-tarballs.json` out of the directory `CADMPEG_TS_TARBALL_DIR` named.
 *
 * A silently empty artifact download leaves the directory absent or bare, and
 * reading straight through it reports an ENOENT against a path the operator
 * still has to trace back to the download. Name the directory instead, and say
 * what it actually holds.
 *
 * @param {string} directory - Directory the caller named.
 * @returns {Record<string, unknown>} Parsed manifest.
 */
export const readFrozenManifest = (directory) => {
  const resolved = resolve(directory);
  if (!existsSync(resolved)) throw new Error(`no tarball directory: ${resolved}`);
  const landed = readdirSync(resolved);
  if (landed.length === 0) throw new Error(`the tarball directory ${resolved} is empty`);
  const manifest = join(resolved, 'test-tarballs.json');
  if (!existsSync(manifest)) {
    throw new Error(`no test-tarballs.json in ${resolved}, which holds: ${landed.join(', ')}`);
  }
  return JSON.parse(readFileSync(manifest, 'utf8'));
};

/**
 * Look up the frozen root and platform tarballs recorded for one suffix.
 *
 * @param {{ version?: unknown, packages?: unknown }} manifest - Parsed `test-tarballs.json`.
 * @param {string} suffix - Platform suffix the caller named.
 * @returns {{ platformName: string, platformTarball: string, rootTarball: string, version: string }} Selection.
 */
export const selectTarballs = (manifest, suffix) => {
  const { packages, version } = manifest;
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('the frozen tarball manifest records no version');
  }
  if (typeof packages !== 'object' || packages === null) {
    throw new Error('the frozen tarball manifest records no packages');
  }
  const filenameOf = (name) => {
    const entry = /** @type {Record<string, { filename?: unknown, version?: unknown }>} */ (packages)[name];
    if (entry === undefined) {
      throw new Error(`the frozen tarball manifest has no tarball for ${name}`);
    }
    if (typeof entry.filename !== 'string' || entry.filename.length === 0) {
      throw new Error(`${name} records no tarball filename`);
    }
    if (entry.version !== version) {
      throw new Error(`${name} is packed at ${String(entry.version)}, expected ${version}`);
    }
    return entry.filename;
  };
  const platformName = `${ROOT_PACKAGE}-${suffix}`;
  return {
    platformName,
    platformTarball: filenameOf(platformName),
    rootTarball: filenameOf(ROOT_PACKAGE),
    version,
  };
};

/**
 * Pick the configured platform packages out of an installed dependency listing.
 *
 * Only names the release itself configures count: a dependency that merely
 * shares the root prefix, such as an adjacent `cadmpeg-ts-*` tool, is not a
 * platform package and must not make the smoke report two of them. The clean
 * room resolves no repository dependency, so the configured set comes from the
 * frozen tarball manifest (tarball mode) or the installed root's optional
 * dependencies (registry mode) rather than from a triple parser.
 *
 * @param {string[]} entries - Directory entry names of a `node_modules` directory.
 * @param {Iterable<string>} configuredNames - Every package name the release configures.
 * @returns {string[]} Sorted platform package names.
 */
export const detectPlatformPackages = (entries, configuredNames) => {
  const platforms = new Set(
    [...configuredNames].filter((name) => name.startsWith(`${ROOT_PACKAGE}-`) && SUFFIX_PATTERN.test(name)),
  );
  return entries.filter((entry) => platforms.has(entry)).sort();
};

/**
 * Name the platform package this run expects, and the ones npm legitimately
 * installs beside it.
 *
 * NAPI-RS writes a `libc` selector for the `gnu` and `musl` ABIs only, so the
 * two armv7 `eabihf` packages carry none: npm keeps both on an armv7 host and
 * the generated loader probes the runtime to pick one. Every other `os`/`cpu`
 * pair is split by `libc`, so npm resolves it to a single package. The rule
 * reads that property off the configured targets rather than naming any
 * package, so a change to `napi.targets` moves it without an edit here.
 *
 * @param {string} suffix - Platform suffix the caller named.
 * @param {Array<{ cpu: string, libc?: string | undefined, name: string, os: string, suffix: string }>} targets - Configured platform packages.
 * @returns {{ expected: string, siblings: string[] }} Expected package and the siblings no selector excludes.
 */
export const expectedPlatformPackageSet = (suffix, targets) => {
  const expected = targets.find((target) => target.suffix === suffix);
  if (expected === undefined) {
    throw new Error(`${ROOT_PACKAGE}.napi.targets configures no ${ROOT_PACKAGE}-${suffix}`);
  }
  return {
    expected: expected.name,
    siblings: targets
      .filter(
        (target) =>
          target.name !== expected.name &&
          target.libc === undefined &&
          target.os === expected.os &&
          target.cpu === expected.cpu,
      )
      .map((target) => target.name)
      .sort(),
  };
};

/**
 * Settle an installed platform package listing against that rule.
 *
 * @param {string[]} installed - Configured platform packages the install holds.
 * @param {{ expected: string, siblings: string[] }} rule - Expected package and its siblings.
 * @returns {string} The evidence line naming what npm installed.
 */
export const checkInstalledPlatformPackages = (installed, { expected, siblings }) => {
  const allowed = new Set([expected, ...siblings]);
  if (!installed.includes(expected) || installed.some((name) => !allowed.has(name))) {
    const beside = siblings.length === 0 ? '' : `, optionally beside ${siblings.join(', ')}`;
    throw new Error(
      `expected the platform package ${expected}${beside}, but installed: ${installed.join(', ') || 'none'}`,
    );
  }
  const beside = installed.filter((name) => name !== expected);
  return beside.length === 0 ? expected : `${expected} beside ${beside.join(', ')}`;
};

/**
 * Name every platform package whose native binding the process has open.
 *
 * `process.report` lists the shared objects the process loaded, the addon among
 * them, which is the only builtin-only way to prove which of two installed
 * packages the generated loader actually selected. Module paths are matched by
 * directory name so a Windows path reads the same as a POSIX one.
 *
 * @param {readonly string[]} sharedObjects - `process.report.getReport().sharedObjects`.
 * @param {Iterable<string>} platformNames - Platform package names to look for.
 * @returns {string[]} Sorted names whose binding is loaded.
 */
export const selectedPlatformPackages = (sharedObjects, platformNames) => {
  const wanted = new Set(platformNames);
  /** @type {Set<string>} */
  const loaded = new Set();
  for (const object of sharedObjects) {
    const path = String(object).replaceAll('\\', '/');
    if (!path.endsWith('.node')) continue;
    for (const segment of path.split('/')) if (wanted.has(segment)) loaded.add(segment);
  }
  return [...loaded].sort();
};

/**
 * Settle which platform binding the generated loader opened.
 *
 * A binding from any other installed package is always wrong. An absent
 * listing is another matter: Windows reports no addon among its shared objects
 * before Node 22.14, and 22.13.0 is the supported floor. That only costs
 * evidence where npm resolved a single package, because the install listing
 * already proves which package the loader had to open; where npm kept more
 * than one, nothing else proves the choice, so an absent listing fails.
 *
 * @param {string[]} loaded - Platform packages whose binding is open.
 * @param {string} expected - Platform package this run smokes.
 * @param {string[]} installed - Configured platform packages the install holds.
 * @returns {string} The evidence line.
 */
export const settleLoaderSelection = (loaded, expected, installed) => {
  const strays = loaded.filter((name) => name !== expected);
  if (strays.length > 0) {
    throw new Error(`the loader opened ${strays.join(', ')}, expected ${expected}`);
  }
  if (loaded.includes(expected)) return `loader selected: ${expected}`;
  if (installed.length > 1) {
    throw new Error(
      `the loader opened no platform binding out of ${installed.join(', ')}, so nothing proves it selected ${expected}`,
    );
  }
  return `loader selection unproven: this runtime lists no addon among its shared objects, and ${expected} is the only platform package installed`;
};

/**
 * Render a thrown value and every `cause` beneath it as message and stack.
 *
 * @param {unknown} error - The thrown value.
 * @returns {string} One report line group per link in the chain.
 */
export const formatCauseChain = (error) => {
  const lines = [];
  const seen = new Set();
  let current = error;
  let depth = 0;
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    const label = depth === 0 ? 'error' : `cause ${depth}`;
    if (current instanceof Error) {
      lines.push(`${label}: ${current.message}`);
      if (typeof current.stack === 'string') lines.push(current.stack);
      current = current.cause;
    } else {
      lines.push(`${label}: ${typeof current === 'string' ? current : inspect(current)}`);
      current = undefined;
    }
    depth += 1;
  }
  return lines.join('\n');
};

// npm is a `.cmd` shim on Windows, which `execFileSync` can only start through
// a shell; quoting is ours to do once the shell parses the command line.
const windows = process.platform === 'win32';
const quoteForShell = (value) => (windows && /[\s&|<>^"]/u.test(value) ? `"${value}"` : value);
const runNpm = (arguments_, cwd) =>
  execFileSync(windows ? 'npm.cmd' : 'npm', arguments_.map(quoteForShell), {
    cwd,
    shell: windows,
    stdio: 'inherit',
  });

const installedPlatformPackages = (work, configuredNames) =>
  detectPlatformPackages(
    [
      ...readdirSync(join(work, 'node_modules')),
      ...(existsSync(join(work, 'node_modules', ROOT_PACKAGE, 'node_modules'))
        ? readdirSync(join(work, 'node_modules', ROOT_PACKAGE, 'node_modules'))
        : []),
    ],
    configuredNames,
  );

// Two phases, run as two processes: a fault inside the addon takes the process
// down with it, so the load evidence has to come from a child that has already
// exited rather than from output the conversion may swallow.
const consumerSource = (helperUrl) => `import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { formatCauseChain, selectedPlatformPackages, settleLoaderSelection } from ${JSON.stringify(helperUrl)};

const [phase, stepFixture, sldprtFixture] = process.argv.slice(2);
// The WebAssembly modules use SIMD. V8 refuses it on some hosts (Node 22 on
// ppc64le), where the wasm backend is unavailable and Node runs native only.
// The probe is the smallest module that uses a v128 value.
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
const wasmSimd = await WebAssembly.compile(SIMD_PROBE).then(() => true, () => false);
const NO_SIMD_HOSTS = new Set(['cadmpeg-ts-linux-ppc64-gnu']);
if (!wasmSimd) {
  assert(
    NO_SIMD_HOSTS.has(process.env['CADMPEG_TS_SMOKE_EXPECTED']) && process.versions.node.startsWith('22.'),
    \`only Node 22 on ppc64le may lack WebAssembly SIMD, not \${process.env['CADMPEG_TS_SMOKE_EXPECTED']} on Node \${process.versions.node}\`,
  );
}
try {
  const api = await import('cadmpeg-ts');
  if (phase === 'load') {
    // The published modules are packed beside the native loader; a consumer
    // bundling for browsers resolves exactly these bytes.
    const stepModule = await readFile(new URL(import.meta.resolve('cadmpeg-ts/wasm/step_bg.wasm')));
    if (wasmSimd) await WebAssembly.compile(stepModule);
    else {
      assert.deepEqual([...stepModule.subarray(0, 4)], [0, 97, 115, 109], 'step_bg.wasm must be a WebAssembly module');
      console.log('wasm compile not attempted: this runtime lacks WebAssembly SIMD');
    }
    const native = await api.createCadmpeg({ backend: 'native' });
    assert.equal(native.backend, 'native');
    // The engine-free entry's \`node\` condition is the Node entry itself
    // (engine delivery charter I7): the same factory, the same addon.
    const core = await import('cadmpeg-ts/core');
    assert.equal(core.createCadmpeg, api.createCadmpeg, 'cadmpeg-ts/core must resolve the Node entry under node');
    assert.equal((await core.createCadmpeg({ backend: 'native' })).backend, 'native');
    // The digest map names the packed bytes.
    const { digests } = await import('cadmpeg-ts/digests');
    const { createHash } = await import('node:crypto');
    assert.equal(createHash('sha256').update(stepModule).digest('hex'), digests.step.wasm.sha256);
    assert.equal(stepModule.byteLength, digests.step.wasm.byteLength);
    // The addon is open by now, so the loaded shared objects say which of the
    // installed platform packages the generated loader chose.
    const installed = JSON.parse(process.env['CADMPEG_TS_SMOKE_INSTALLED']);
    const expected = process.env['CADMPEG_TS_SMOKE_EXPECTED'];
    const loaded = selectedPlatformPackages(process.report.getReport().sharedObjects, installed);
    console.log(settleLoaderSelection(loaded, expected, installed));
  } else {
    const input = { name: 'part.stp', bytes: new Uint8Array(await readFile(stepFixture)) };
    const native = await api.createCadmpeg({ backend: 'native' });
    const nativeStep = await native.convert(input, { to: 'step' });
    assert.equal(nativeStep.backend, 'native');
    assert.equal(nativeStep.files[0].name, 'part.step');
    assert.equal(new TextDecoder().decode(nativeStep.files[0].bytes.subarray(0, 13)), 'ISO-10303-21;');
    if (!wasmSimd) {
      await assert.rejects(
        async () => (await api.createCadmpeg({ backend: 'wasm' })).convert(input, { to: 'step' }),
        (error) => error?.code === 'BACKEND_UNAVAILABLE',
        'without WebAssembly SIMD the wasm backend must refuse with BACKEND_UNAVAILABLE',
      );
      console.log(\`converted \${input.bytes.length} bytes of STEP natively; wasm backend unavailable without SIMD\`);
      process.exit(0);
    }
    const wasm = await api.createCadmpeg({ backend: 'wasm' });
    const { outputs } = await import('cadmpeg-ts/formats');
    const settle = (promise) => promise.then((result) => ({ result }), (error) => ({ error }));
    // Charter I2: one engine version, one input, identical bytes and equal
    // reports on both backends, for every writer. A writer that refuses must
    // refuse alike on both. \`exact\` names the writers held to that; the others
    // are held to the same files and the same losses by code, phase and severity.
    const lossKeys = (losses) => losses.map(({ code, phase, severity }) => \`\${phase} \${severity} \${code}\`);
    const checkParity = async (label, file, exact) => {
      const written = [];
      for (const { id } of outputs) {
        const a = await settle(native.convert(file, { to: id }));
        const b = await settle(wasm.convert(file, { to: id }));
        if (a.error || b.error) {
          assert.ok(a.error && b.error, \`\${label} to \${id}: one backend refused, the other did not\`);
          assert.deepEqual(
            { code: b.error.code, phase: b.error.phase, message: b.error.message },
            { code: a.error.code, phase: a.error.phase, message: a.error.message },
            \`\${label} to \${id}: the backends refused differently\`,
          );
          continue;
        }
        assert.equal(a.result.backend, 'native');
        assert.equal(b.result.backend, 'wasm');
        assert.deepEqual(
          b.result.files.map((f) => f.name),
          a.result.files.map((f) => f.name),
          \`\${label} to \${id}: file names differ\`,
        );
        if (exact(id)) {
          assert.deepEqual(b.result.losses, a.result.losses, \`\${label} to \${id}: losses differ\`);
          assert.deepEqual(b.result.notes, a.result.notes, \`\${label} to \${id}: notes differ\`);
          a.result.files.forEach((f, index) =>
            assert.deepEqual(b.result.files[index].bytes, f.bytes, \`\${label} to \${id}: bytes differ\`),
          );
        } else {
          assert.deepEqual(lossKeys(b.result.losses), lossKeys(a.result.losses), \`\${label} to \${id}: losses differ\`);
        }
        written.push(id);
      }
      assert.ok(written.length > 0, \`\${label}: no writer accepted the input\`);
      return written;
    };
    const fromStep = await checkParity('STEP', input, () => true);
    assert.ok(fromStep.includes('step') && fromStep.includes('usd'), \`STEP wrote only \${fromStep.join(', ')}\`);
    console.log(\`converted \${input.bytes.length} bytes of STEP to \${fromStep.join(', ')}; native and wasm outputs are byte-identical\`);
    // Known exception (compatibility.md): several of the pinned cadmpeg's
    // codecs, SOLIDWORKS among them, call the platform C library for sin, cos,
    // atan2 and hypot, so the native addon and wasm32 (Rust's libm port) decode
    // a few reals one or two ulps apart, and every writer that re-emits decoded
    // geometry (STEP, CADIR, OpenUSD) differs in those digits. The fix is
    // upstream: patches/candidate-portable-elementary-functions.md. The STEP
    // fixture above does not drift. Until the fix lands, a SOLIDWORKS source is
    // held exactly only where the writer rewrites it (SLDPRT); elsewhere the
    // drift also reaches byte counts in notes and could reach loss messages.
    // It still exercises the native-to-native route that crosses modules as
    // STEP, whose losses differ wholesale when the backends route differently.
    const sldprt = { name: 'part.sldprt', bytes: new Uint8Array(await readFile(sldprtFixture)) };
    const fromSldprt = await checkParity('SOLIDWORKS', sldprt, (id) => id === 'sldprt');
    assert.ok(fromSldprt.includes('usd'), \`SOLIDWORKS wrote only \${fromSldprt.join(', ')}\`);
    console.log(\`converted \${sldprt.bytes.length} bytes of SOLIDWORKS to \${fromSldprt.join(', ')}; native and wasm losses match\`);
  }
} catch (error) {
  console.error(\`\${phase} phase failed:\`);
  console.error(formatCauseChain(error));
  process.exit(1);
}
`;

const cjsProbeSource = `'use strict';
const assert = require('node:assert/strict');
assert.throws(() => require('cadmpeg-ts'), /cadmpeg-ts is ESM-only; use import\\("cadmpeg-ts"\\) from CommonJS\\./u);
`;

const main = () => {
  const suffix = requireNativeSuffix(process.env);
  const mode = resolveSmokeMode(process.env);
  const subset = readNativeTargets(process.env);
  // The rule comes off this checkout's `napi.targets`, which is what the
  // release under test was configured from; `readNapiTargets` resolves no
  // package, so the clean room stays dependency-free.
  const { packages: targets } = readNapiTargets(new URL('../package.json', import.meta.url));
  const rule = expectedPlatformPackageSet(suffix, targets);
  if (mode.kind === 'registry' && subset !== undefined) {
    throw new Error(
      'a registry smoke installs the complete published release; unset CADMPEG_TS_NATIVE_TARGETS',
    );
  }
  if (subset !== undefined && !selectTargets(targets, subset).some((target) => target.suffix === suffix)) {
    throw new Error(`${suffix} is outside the assembled target subset ${subset.join(', ')}`);
  }
  const platformName = rule.expected;
  const fixture = (name) => fileURLToPath(new URL(`../tests/fixtures/${name}`, import.meta.url));
  const work = mkdtempSync(join(tmpdir(), 'cadmpeg-ts-package-'));

  try {
    writeFileSync(join(work, 'package.json'), '{"private":true,"type":"module"}\n');
    let version;
    let configuredNames;
    if (mode.kind === 'tarball') {
      const frozen = readFrozenManifest(mode.directory);
      checkFrozenInventory(frozen, targets, subset);
      const selection = selectTarballs(frozen, suffix);
      version = selection.version;
      configuredNames = Object.keys(frozen.packages);
      const tarballs = [selection.rootTarball, selection.platformTarball].map((filename) =>
        resolve(mode.directory, filename),
      );
      for (const tarball of tarballs) {
        if (!existsSync(tarball)) throw new Error(`frozen tarball missing: ${tarball}`);
      }
      // The frozen tarballs are the only bytes under test, so the root's
      // optional dependencies must not pull sibling platforms off the registry.
      runNpm(['install', ...INSTALL_FLAGS, '--omit=optional', ...tarballs], work);
    } else {
      version = mode.version;
      runNpm(['install', ...INSTALL_FLAGS, `${ROOT_PACKAGE}@${version}`], work);
    }

    const installedManifest = JSON.parse(
      readFileSync(join(work, 'node_modules', ROOT_PACKAGE, 'package.json'), 'utf8'),
    );
    // A published root names its platform packages in `optionalDependencies`;
    // that is the registry's own record of the configured set.
    configuredNames ??= Object.keys(installedManifest.optionalDependencies ?? {});

    const installed = installedPlatformPackages(work, configuredNames);
    console.log(`installed platform packages: ${checkInstalledPlatformPackages(installed, rule)}`);

    writeFileSync(join(work, 'consumer.mjs'), consumerSource(import.meta.url));
    // Under QEMU, V8's optimizing WebAssembly tier on s390x runs the
    // SOLIDWORKS module wrongly: Node 22 crashes with SIGSEGV once a hot
    // function tiers up, and Node 26 writes a different byte. The baseline
    // tier (Liftoff), the native addon and every other host agree, so the
    // s390x rows check parity on Liftoff only. compatibility.md records it.
    const v8Flags = suffix.startsWith('linux-s390x') ? ['--liftoff-only'] : [];
    const runConsumer = (...phase) =>
      execFileSync(process.execPath, [...v8Flags, 'consumer.mjs', ...phase], {
        cwd: work,
        env: {
          ...process.env,
          CADMPEG_TS_SMOKE_EXPECTED: platformName,
          CADMPEG_TS_SMOKE_INSTALLED: JSON.stringify(installed),
          // The loader's version check is a runtime opt-in; a published release
          // is where a drifted platform package could actually reach a consumer.
          ...(mode.kind === 'registry' ? { NAPI_RS_ENFORCE_VERSION_CHECK: '1' } : {}),
        },
        stdio: 'inherit',
      });
    runConsumer('load');
    runConsumer(
      'convert',
      fixture('nist_ctc_01_asme1_ap242-e1.stp'),
      fixture('nist_ftc_06_asme1_rd_sw1802.SLDPRT'),
    );

    writeFileSync(join(work, 'consumer.cjs'), cjsProbeSource);
    execFileSync(process.execPath, ['consumer.cjs'], { cwd: work, stdio: 'inherit' });

    if (installedManifest.version !== version) {
      throw new Error(`installed ${ROOT_PACKAGE}@${installedManifest.version}, expected ${version}`);
    }
    console.log(
      `clean-room ${mode.kind} smoke passed: ${ROOT_PACKAGE}@${version} through ${platformName} on ${process.platform}-${process.arch}`,
    );
  } finally {
    rmSync(work, { force: true, recursive: true });
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(formatCauseChain(error));
    // A consumer that died without output: the exit status and the signal
    // (a SIGSEGV/SIGABRT inside the addon prints nothing) are the only clues.
    if (error !== null && typeof error === 'object' && ('status' in error || 'signal' in error)) {
      console.error(`child exit: status=${String(error.status)} signal=${String(error.signal)}`);
    }
    process.exit(1);
  }
}
