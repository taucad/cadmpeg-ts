// The WebAssembly optimization profile, shared by the build and its tests.
//
// Speed first, then size (charter Q11). Rust builds every module at
// opt-level 3 with fat LTO, one codegen unit and fixed-width SIMD (`+simd128`,
// Safari 16.4 and later); relaxed SIMD would give up the Safari row and is
// never enabled. `--traps-never-happen` and `--fast-math` are excluded: the
// first turns an overflow-check trap into undefined behaviour, the second
// changes float results and breaks byte parity with the native addon.
// The level below is the measured choice; see the charter's Q11 evidence.

/** Features rustc emits for wasm32-unknown-unknown, plus fixed SIMD. */
export const WASM_FEATURES = [
  '--enable-bulk-memory',
  '--enable-sign-ext',
  '--enable-nontrapping-float-to-int',
  '--enable-mutable-globals',
  '--enable-multivalue',
  '--enable-reference-types',
  '--enable-simd',
];

/** Arguments passed to Binaryen's wasm-opt; empty skips the pass. */
export const WASM_OPT_ARGS = ['-O3', ...WASM_FEATURES];
