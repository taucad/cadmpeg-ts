# Compatibility

`cadmpeg-ts` is an unofficial package. The engine is
[cadmpeg](https://github.com/cadmpeg/cadmpeg) at the tag named by
`engineVersion` in `cadmpeg-ts/formats`; what it can read and write, and how
well, is cadmpeg's. Each mark below maps to a CI job in `.github/workflows/ci.yml`.

## Hosts

| Host                                          | Backend     | CI job                      |
| --------------------------------------------- | ----------- | --------------------------- |
| Node 22.13 and 26, macOS arm64 and x64        | Native      | `smoke`                     |
| Node 22.13 and 26, Windows x64, arm64, ia32   | Native      | `smoke`                     |
| Node 22.13 and 26, Linux glibc x64 and arm64  | Native      | `smoke`                     |
| Node 22.13 and 26, Linux musl x64 and arm64   | Native      | `smoke`                     |
| Node 22.13, Linux armv7 glibc and musl        | Native      | `smoke` (emulated)          |
| Node 22.13, Linux ppc64le and s390x           | Native      | `smoke` (emulated)          |
| Node 22.13, FreeBSD x64                       | Native      | `smoke` (virtualized)       |
| Android arm64 and armv7                       | Native      | `build` only, not executed  |
| Chromium, Firefox, WebKit                     | WebAssembly | `browser`                   |
| Any Node host without a matching native addon | WebAssembly | `smoke` (`backend: 'wasm'`) |

The native addon and the WebAssembly modules produce byte-identical STEP for
the same input; `smoke` checks this on every row.

## Formats

Reading:

| Format                   | Extensions                    | WebAssembly module |
| ------------------------ | ----------------------------- | ------------------ |
| STEP AP203, AP214, AP242 | `step`, `stp`                 | `step`             |
| IGES                     | `iges`, `igs`                 | `iges`             |
| ACIS SAT and SAB         | `sat`, `sab`, `smt`, `smb`    | `sat`              |
| FreeCAD                  | `fcstd`                       | `fcstd`            |
| Fusion 360               | `f3d`, `f3z`                  | `f3d`              |
| Autodesk Inventor        | `ipt`, `iam`                  | `inventor`         |
| SolidWorks               | `sldprt`                      | `sldprt`           |
| CATIA V5                 | `catpart`                     | `catia`            |
| Creo                     | `prt`, `prt.<n>`              | `creo`             |
| Siemens NX               | `prt`                         | `nx`               |
| Rhino                    | `3dm`                         | `rhino`            |
| Creo View                | `pvz`                         | `pvz`              |
| OpenUSD                  | `usd`, `usda`, `usdc`, `usdz` | `usd`              |
| cadmpeg CADIR            | `cadir`, `json`               | `step`             |

A `.prt` file goes to whichever of the Creo and NX detectors recognizes it.

Writing: STEP, IGES and CADIR are stable. FreeCAD, Fusion 360, SolidWorks,
Rhino and OpenUSD writers are experimental in cadmpeg itself and are reported
as `experimental: true` in `outputs`.

cadmpeg refuses a write it cannot make faithfully rather than dropping data.
With the pinned engine:

- STEP, OpenUSD and CADIR take any model.
- IGES, Rhino, Fusion 360 and SolidWorks refuse a model that carries data they
  cannot encode yet, such as features, PMI, appearances or AP242 product
  definitions, with `UNSUPPORTED_FORMAT`. Most real parts carry some of it.
- SolidWorks rewrites a SolidWorks file.
- FreeCAD only rewrites a FreeCAD document; from any other format it refuses
  with `REFUSED`.

Every conversion returns the losses cadmpeg records; pass `strict: true` to
refuse a lossy one.

The `rust` job runs the binding's corpus tests on the pinned engine. The
`browser` job converts STEP, SolidWorks, and SolidWorks to OpenUSD through
the published modules.
