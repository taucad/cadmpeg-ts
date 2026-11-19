## 0.1.0-beta.3 (2026-11-19)

### 🩹 Fixes

- Ships the 0.1.0-beta.2 changes, which never reached npm: its FreeBSD addon build failed when the FreeBSD package mirrors stopped serving the `.tzst` repository catalogue. The FreeBSD build and smoke rows now reinstall the current `pkg` before installing Node.js. No API change. ([#14](https://github.com/taucad/cadmpeg-ts/pull/14))

### ❤️ Thank You

- Richard Fontein @rifont

## 0.1.0-beta.2 (2026-11-18)

### 🩹 Fixes

- The WebAssembly backend now converts STEP and CADIR input straight to OpenUSD and the other native writers, as the native addon does, instead of round-tripping through STEP first. A Tau cube written as OpenUSD was 14,819 bytes with 15 losses on the native addon and 14,680 bytes with 22 losses on WebAssembly; both now write the same bytes and report the same losses. ([#10](https://github.com/taucad/cadmpeg-ts/pull/10))

  Where a WebAssembly writer module cannot read the source, such as SolidWorks to OpenUSD, the native addon now crosses as STEP bytes too, so both backends take the same route; its output for those routes changes accordingly. Some inputs, SolidWorks parts among them, still differ across backends by an ulp in a few coordinates, a known issue in the pinned cadmpeg listed in `compatibility.md`.

### ❤️ Thank You

- Richard Fontein @rifont

## 0.1.0-beta.1 (2026-11-17)

### 🩹 Fixes

- First published beta. The 0.1.0-beta.0 release run stopped before publishing because Node 22 on ppc64le cannot compile the WebAssembly modules, which use SIMD. On such runtimes the wasm backend refuses with `BACKEND_UNAVAILABLE` and Node uses the native addon, and the package smoke test now checks exactly that. ([#7](https://github.com/taucad/cadmpeg-ts/pull/7))

### ❤️ Thank You

- Richard Fontein @rifont

## 0.1.0-beta.0 (2026-11-17)

### 🚀 Features

- First beta: convert native CAD files with cadmpeg 0.6.12 through per-format WebAssembly modules in browsers and through the native addon on Node.js, with typed losses and stable error codes. ([#1](https://github.com/taucad/cadmpeg-ts/pull/1))

### ❤️ Thank You

- Richard Fontein @rifont

# Changelog
