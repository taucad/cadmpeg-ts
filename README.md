<h1 align="center">cadmpeg-ts</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/cadmpeg-ts"><img src="https://img.shields.io/npm/v/cadmpeg-ts?logo=npm&logoColor=white&label=npm&color=cb3837" alt="npm version"></a>
  <a href="https://github.com/taucad/cadmpeg-ts/actions/workflows/ci.yml"><img src="https://github.com/taucad/cadmpeg-ts/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://tau.new"><img src="https://img.shields.io/badge/Tau-ecosystem-6d28d9" alt="Part of the Tau ecosystem"></a>
</p>

Convert native CAD files to STEP, IGES and back in browsers and Node.js.
`cadmpeg-ts` is an unofficial TypeScript API for [cadmpeg](https://github.com/cadmpeg/cadmpeg),
a clean-room CAD transcoder. It is not affiliated with or endorsed by the cadmpeg
project. Format names identify file formats only.

Browsers load one WebAssembly module per input format; Node.js runs a native addon.
See [compatibility.md](compatibility.md) for hosts and formats.

## Install

```bash
npm install cadmpeg-ts
```

## Quick start

```typescript
import { readFile } from 'node:fs/promises';
import { convert } from 'cadmpeg-ts';

const bytes = new Uint8Array(await readFile('bracket.sldprt'));
const { files, losses } = await convert({ name: 'bracket.sldprt', bytes }, { to: 'step' });
// files[0]: { name: 'bracket.step', bytes }
// losses: what cadmpeg could not carry over, by phase and stable code
```

Pass `strict: true` to refuse any lossy conversion. Failures throw
`CadmpegError` with a stable `code`.

## Formats

Reads SOLIDWORKS parts, CATIA V5 parts, Inventor, NX, Creo, Fusion, FreeCAD,
Rhino, ACIS, Creo View, OpenUSD, STEP and IGES. Writes STEP, IGES, CADIR and,
as experimental writers, FreeCAD, Fusion, SOLIDWORKS, Rhino and OpenUSD.
`cadmpeg-ts/formats` lists both without loading an engine.

## Bundled browser apps

`cadmpeg-ts` makes a bundler emit all thirteen modules. To deliver them
yourself, import `cadmpeg-ts/core`, which emits none, and pass
`locateModule`; verify what you fetch against `cadmpeg-ts/digests`:

```typescript
import { createCadmpeg } from 'cadmpeg-ts/core';
import { digests } from 'cadmpeg-ts/digests';

const converter = await createCadmpeg({ locateModule: (id) => fetchVerified(id, digests[id]) });
```

Each GitHub Release also carries every module as `<id>_bg.wasm.gz`, named by
`digests[id].gzip`. Node.js resolves `cadmpeg-ts/core` to the native-first entry.

## Compatibility

Node.js 22.13 or later on sixteen native targets, and current Chromium, Firefox
and WebKit. Details: [compatibility.md](compatibility.md).

## Versioning and stability

Pre-1.0: a minor release may change the API. Each release pins one cadmpeg
release; the engine version is `engineVersion` in `cadmpeg-ts/formats`.
[BREAKING_CHANGES.md](BREAKING_CHANGES.md) lists migrations.

## Security and provenance

Every package is published from GitHub Actions with npm provenance. Report
vulnerabilities as described in [SECURITY.md](SECURITY.md).

## Links

- [Changelog](CHANGELOG.md)
- [Maintaining this package](MAINTAINER.md)
- [cadmpeg](https://github.com/cadmpeg/cadmpeg)

## License

Apache-2.0. See [license](license) and [NOTICE](NOTICE).
