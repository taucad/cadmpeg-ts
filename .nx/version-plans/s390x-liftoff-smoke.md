---
cadmpeg-ts: prerelease
---

Ships the 0.1.0-beta.2 and beta.3 changes, which never reached npm. Release checks only: on s390x the package smoke checks WebAssembly parity on V8's baseline tier, because V8's optimizing tier runs the SOLIDWORKS module wrongly there under emulation (compatibility.md). No API change; on s390x prefer the native backend, which is the default.
