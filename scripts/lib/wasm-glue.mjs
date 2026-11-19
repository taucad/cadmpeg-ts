// Post-process wasm-bindgen's `web` glue (engine delivery charter F2, D7).
//
// The generated init function falls back to
// `new URL('<id>_bg.wasm', import.meta.url)` when it is called without a
// module. Bundlers read that expression statically and emit the binary for
// every glue file they reach, whatever entry imported it. cadmpeg-ts always
// passes `module_or_path`, so the fallback is dead code here; it becomes a
// thrown error, and no glue file names a binary of its own.

const DEFAULT_URL =
  /\n( *)if \(module_or_path === undefined\) \{\n *module_or_path = new URL\('([\w-]+)_bg\.wasm', import\.meta\.url\);\n *\}\n/gu;

/**
 * Remove the default binary URL from one module's glue.
 *
 * @param {string} source - The glue wasm-bindgen wrote.
 * @param {string} id - The module id the glue was generated for.
 * @returns {string} The glue without the default.
 */
export const stripDefaultModuleUrl = (source, id) => {
  const matches = [...source.matchAll(DEFAULT_URL)];
  if (matches.length !== 1 || matches[0][2] !== id) {
    throw new Error(
      `${id}.js: expected exactly one default binary URL for ${id}_bg.wasm, found ${matches.length}; ` +
        'the wasm-bindgen output changed shape',
    );
  }
  const stripped = source.replace(
    DEFAULT_URL,
    (_match, indent) =>
      `\n${indent}if (module_or_path === undefined) {\n` +
      `${indent}    throw new Error('cadmpeg-ts: the ${id} module needs module_or_path');\n` +
      `${indent}}\n`,
  );
  if (stripped.includes('import.meta.url')) {
    throw new Error(`${id}.js still reads import.meta.url after the default binary URL was removed`);
  }
  return stripped;
};
