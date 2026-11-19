---
cadmpeg-ts: prerelease
---

`cadmpeg-ts/core` is a new entry for browser apps that deliver the WebAssembly modules themselves. It names no packaged binary, so a bundler that follows it emits no `.wasm` file; `createCadmpeg` there needs `locateModule` and refuses with `INVALID_OPTIONS` without one. Under the `node` export condition it is the Node.js entry, unchanged. `cadmpeg-ts` itself still locates and emits all thirteen modules.

`cadmpeg-ts/digests` states every module's SHA-256 and byte length, as packed (`wasm`) and as the `<id>_bg.wasm.gz` file attached to the version's GitHub Release (`gzip`), so a host can verify a module fetched from anywhere before it runs. The generated glue no longer falls back to a default binary URL, and the packaged glue is imported through one literal specifier per module, so bundlers that skip template imports under `node_modules` now emit it.
