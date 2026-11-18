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

The native addon and the WebAssembly modules produce byte-identical output and
equal reports for the same input, except for the known issue below; `smoke`
checks every writer on every row whose runtime runs WebAssembly SIMD. The
modules are built with SIMD, which Node 22 on ppc64le does not run: there the
wasm backend refuses with `BACKEND_UNAVAILABLE` and Node uses the
native addon. Node 26 on ppc64le runs both and is parity-checked.

A conversion whose writer module cannot read the source, such as SolidWorks to
OpenUSD, crosses modules as STEP bytes, and the native addon takes the same
route so that both backends write the same file.

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

## Known issues

Some inputs are not byte-identical across backends. Several of the pinned
cadmpeg's codecs compute sines, cosines, arctangents and hypotenuses through
the platform's C library, so the native addon and the WebAssembly modules
decode a few coordinates one or two units in the last place apart. For the
same reason a native result can differ between operating systems. The upstream
fix is described in `patches/candidate-portable-elementary-functions.md`.

On the NIST corpus the drift reaches STEP and CADIR written from three of nine
STEP files, and STEP, CADIR and OpenUSD written from SolidWorks, CATIA, Creo
and Fusion parts, plus CADIR from Inventor. Loss codes and refusals match, and
so does a rewrite in the source's own format.
