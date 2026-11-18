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
