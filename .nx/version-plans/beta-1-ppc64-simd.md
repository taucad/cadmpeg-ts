---
cadmpeg-ts: prerelease
---

First published beta. The 0.1.0-beta.0 release run stopped before publishing because Node 22 on ppc64le cannot compile the WebAssembly modules, which use SIMD. On such runtimes the wasm backend refuses with `BACKEND_UNAVAILABLE` and Node uses the native addon, and the package smoke test now checks exactly that.
