# Candidate: codec elementary functions through `Portable`

Status: candidate, not a patch. `pnpm run patches` applies `NNNN-*.patch`
only, so nothing here is applied, and no upstream issue or pull request has
been opened. Upstream contact is the operator's.

Upstream: cadmpeg 0.6.12 (`upstream/cadmpeg` at `9d7592c6`).

## Symptom

For one input and one engine version the native addon and the WebAssembly
modules must write the same bytes (charter I2). Measured on Linux x86_64,
Node 24, with the routing fix in this branch, over the NIST and CC0 corpus
(every writer, both backends):

| Source                                           | Same-route byte drift              |
| ------------------------------------------------ | ---------------------------------- |
| STEP `nist_ctc_02`, `nist_ctc_03`, `nist_ftc_06` | STEP, CADIR                        |
| STEP, the six other NIST files, Tau's cube       | none                               |
| SOLIDWORKS `nist_ftc_06`, `nist_ftc_08`          | STEP, CADIR, OpenUSD               |
| CATIA `nist_ftc_07`                              | STEP, CADIR, OpenUSD               |
| Creo `nist_ctc_01`                               | STEP, CADIR, OpenUSD               |
| Fusion `1WireRGBWController`                     | STEP, CADIR, OpenUSD               |
| Inventor `nist_ctc_01`                           | CADIR                              |
| NX `nist_ctc_03`, three FreeCAD fixtures         | none                               |

Every refusal and every native rewrite (SLDPRT to SLDPRT, F3D to F3D, FCStd to
FCStd) matches. The differing reals are one or two units in the last place
apart and the loss codes match. Examples:

- `nist_ctc_03` STEP to STEP, one value:
  `PARAMETER_VALUE(0.7853981633974818)` native,
  `PARAMETER_VALUE(0.7853981633974817)` WASM.
- `nist_ftc_06` SOLIDWORKS to STEP, seven values, among them
  `-1.5707963267948988` against `-1.570796326794899`.

## Cause

`cadmpeg-ir/src/math/portable.rs` already states the rule: `f64::sin` and its
siblings call the platform's C library, which rounds differently on glibc,
MSVC, Apple and the `libm` port Rust uses on `wasm32-unknown-unknown`; the
`Portable` trait computes them with the `libm` crate so every target gets the
same bits. The IR, `cadmpeg-tessellate` and the USD codec use it, which is why
STEP to OpenUSD is byte-identical. The codecs mostly do not. Outside tests,
direct `std` calls number roughly 21 in `cadmpeg-codec-step`, 305 in
`-sldprt`, 301 in `-catia`, 268 in `-creo`, 173 in `-f3d`, 40 in `-nx`, 28 in
`-iges`, 25 in `-inventor`, 23 in `-rhino`, 14 in `-freecad` and 69 in
`cadmpeg-measure`.

The STEP value above matches `reader/geometry.rs` line 4331, which turns a
trim point into a circle parameter with
`radial.dot(y_axis).atan2(radial.dot(*ref_direction))`.

## Proposed change

One pull request per crate, STEP first because every cross-module route
passes through it, then SOLIDWORKS, CATIA, Creo, Fusion, Inventor and the rest:

1. Replace each `f64` elementary-function call in the crate's non-test code
   with the `cadmpeg_ir::math::portable::Portable` method of the same name
   (`x.sin()` becomes `x.portable_sin()`, `y.atan2(x)` becomes
   `y.portable_atan2(x)`). Add `portable_powf` to `Portable`; the STEP reader's
   unit scaling and the SOLIDWORKS decoder need it and the trait lacks it.
2. Hold the line: list `f64::sin`, `cos`, `sin_cos`, `tan`, `asin`, `acos`,
   `atan`, `atan2`, `hypot`, `exp`, `exp_m1`, `ln`, `powf`, `sinh`, `cosh`
   and `tanh` in `disallowed-methods`, and deny `clippy::disallowed_methods`
   in each converted crate, as hardened decoder modules already do for
   allocation methods.
3. Test: pin a SHA-256 of the STEP written from one affected corpus file per
   crate (`nist_ctc_03` for STEP, `nist_ftc_06` for SOLIDWORKS) and check it in
   CI on Linux, macOS and Windows, which catches the same drift a
   native-versus-`wasm32` comparison would.

`f64::sqrt`, `mul_add` and `powi` need no change: IEEE-754 rounds the first
two exactly, and `powi` is repeated multiplication with no C library call.

Expected effect: native and WASM conversions become byte-identical for these
inputs, and native results stop varying by operating system. Output digits
change by an ulp in places, so upstream would note it in its changelog.

## In cadmpeg-ts until then

`compatibility.md` lists the drift as a known issue. The package smoke test
(`scripts/test-package.mjs`) compares every writer byte for byte on
`nist_ctc_01` STEP, which does not drift, and holds a SOLIDWORKS source to the
same files and the same loss codes, with bytes compared only for the SOLIDWORKS
rewrite. Once a release with this change is pinned, drop that exception.
