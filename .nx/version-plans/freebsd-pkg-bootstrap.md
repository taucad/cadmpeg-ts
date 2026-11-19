---
cadmpeg-ts: prerelease
---

Ships the 0.1.0-beta.2 changes, which never reached npm: its FreeBSD addon build failed when the FreeBSD package mirrors stopped serving the `.tzst` repository catalogue. The FreeBSD build and smoke rows now reinstall the current `pkg` before installing Node.js. No API change.
