// The WebAssembly optimization profile, shared by the build and its tests.
//
// Speed first, then size (charter Q11). Rust builds every module at
// opt-level 3 with fat LTO, one codegen unit and fixed-width SIMD (`+simd128`,
// Safari 16.4 and later); relaxed SIMD would give up the Safari row and is
// never enabled.
//
// Binaryen's wasm-opt is measured and left off. On the STEP and SolidWorks
// modules, -O3 made repeated conversions 6 to 13 percent faster but the first
// conversion in a fresh process 30 to 44 percent slower, and grew the brotli
// size by 6 percent; -O4 was no faster than -O3. A host converts a file once,
// so the first conversion is the one that counts. `--traps-never-happen` and
// `--fast-math` stay excluded if a pass is reinstated: the first turns an
// overflow-check trap into undefined behaviour, the second changes float
// results and breaks byte parity with the native addon.

/** Arguments passed to Binaryen's wasm-opt; empty skips the pass. */
export const WASM_OPT_ARGS = [];
