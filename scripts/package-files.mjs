import path from 'node:path';

// The package contract: the TypeScript facade, the generated NAPI-RS loader,
// one glue file plus one binary per format module (src/formats.ts), and the
// generated digest map. Changes require explicit admission. 0.1.0-beta.0
// shipped 55 files; the engine-free `core` entry and the `digests` map add a
// module and a declaration each, and the packaged locator moved out of
// create.mjs into packaged.mjs so `core` does not reach it.
const PACKAGE_FILE_COUNT_CEILING = 60;

export const MODULES = [
  'step',
  'iges',
  'sat',
  'fcstd',
  'f3d',
  'inventor',
  'sldprt',
  'catia',
  'creo',
  'nx',
  'rhino',
  'pvz',
  'usd',
];
const TYPESCRIPT = [
  'cadmpeg',
  'core',
  'create',
  'digests',
  'engine',
  'errors',
  'formats',
  'index',
  'index.node',
  'wasm-engine',
];

export const PACKAGE_FILES = [
  'BREAKING_CHANGES.md',
  'CHANGELOG.md',
  'NOTICE',
  'README.md',
  'compatibility.md',
  'dist/cjs-error.cjs',
  'dist/cjs-error.d.cts',
  'dist/native-engine.mjs',
  'dist/node-host.mjs',
  'dist/packaged.mjs',
  'dist/native/index.js',
  'dist/wasm/package.json',
  'license',
  'package.json',
  ...TYPESCRIPT.flatMap((name) => [`dist/${name}.mjs`, `dist/${name}.d.mts`]),
  ...MODULES.flatMap((id) => [`dist/wasm/${id}.js`, `dist/wasm/${id}_bg.wasm`]),
].sort();

export const validatePackageFiles = (files) => {
  const normalized = files.map((file) => file.replaceAll(path.sep, '/')).sort();
  const missing = PACKAGE_FILES.filter((file) => !normalized.includes(file));
  const extra = normalized.filter((file) => !PACKAGE_FILES.includes(file));
  // `napi artifacts` copies every addon into the package root as well as into
  // its platform directory, and the generated loader declarations are a build
  // input: neither may ever reach the root tarball.
  const forbidden = normalized.filter(
    (file) =>
      file.endsWith('.rs') ||
      file.endsWith('.node') ||
      file.endsWith('.d.ts.map') ||
      file === 'dist/native/index.d.ts' ||
      file.includes('/target/'),
  );

  if (
    normalized.length > PACKAGE_FILE_COUNT_CEILING ||
    missing.length > 0 ||
    extra.length > 0 ||
    forbidden.length > 0
  ) {
    throw new Error(
      `npm package mismatch; count=${normalized.length}/${PACKAGE_FILE_COUNT_CEILING} ` +
        `missing=[${missing.join(', ')}] extra=[${extra.join(', ')}] forbidden=[${forbidden.join(', ')}]`,
    );
  }

  return normalized;
};
