# AGENTS.md

## Commands

```bash
pnpm nx run cadmpeg-ts:quality
pnpm nx run cadmpeg-ts:test
pnpm nx run cadmpeg-ts:build
pnpm nx run cadmpeg-ts:validate-pack
pnpm run build:napi
```

## Architecture

`cadmpeg-ts` is an unofficial TypeScript API for the
[cadmpeg](https://github.com/cadmpeg/cadmpeg) CAD transcoder. Upstream is a git
submodule at `upstream/cadmpeg`, pinned to a release tag; `patches/` holds the
small changes this package needs on top of it, applied by
`pnpm run patches` and proven against a pristine checkout by
`pnpm run patches:check`. Every patch is meant for upstream; keep each one
small, self-describing, and produced by `git format-patch --zero-commit`.

`rust/binding` wraps the upstream registry in three calls (`capabilities`,
`detect`, `convert`) with JSON reports and coded errors. `rust/binding-napi`
and `rust/binding-wasm` are host shells over it: the native addon carries every
codec, while the browser gets one wasm module per format family (the codec plus
the STEP writer) and a STEP-only module. `src/formats.ts` owns the module table;
`scripts/build-wasm.mjs` reads it, and `src/wasm-engine.ts` routes a file to its
module by extension, a STEP header sniff, or a detector for ambiguous `.prt`.
A conversion between two native formats crosses modules as STEP bytes.

`src/` is the ESM TypeScript facade. Its Node entry sits behind the `node`
export condition and prefers the native addon; the default entry loads the wasm
modules and imports no Node builtin.

`package.json`'s `napi.targets` is the only architecture list: the sixteen
target triples there produce the sixteen platform packages, their npm selectors,
and the root `optionalDependencies` of a release. `pnpm run build:napi` writes
the generated loader and host addon into `src/native/`, `pnpm run build:wasm`
writes the format modules into `src/wasm/`, and release assembly generates
`npm/`. All three directories are build output, ignored by git, and never
hand-edited.

The wasm profile (`rust/Cargo.toml` `[profile.wasm]` and
`scripts/lib/wasm-profile.mjs`) is tuned for conversion speed first and size
second. Change it only with a measured before-and-after on the corpus.

## Conventions

- ESM-only public API through package exports.
- Keep `unbundle: true`; binary URL resolution depends on relative output.
- Public exports require stable JSDoc and consumer-shape tests.
- Options are flat by default; nest only value objects, tagged unions, or
  co-varying subsystems. When a feature needs configuration, widen its own key
  so the object's presence is the flag. Revisit at more than five annotations,
  or once two of them each carry three or more configuration fields.
- GitHub Actions is the sole npm publisher.
- Every compatibility check mark maps to a CI job.
- Admission changes are explicit budget diffs in `scripts/lib/wasm-budgets.json`
  or `.size-limit.json`.
- Never claim a format, writer or fidelity level the pinned engine does not
  pass in `pnpm run test:rust`.

## Skills

| Skill                | When to use                                      |
| -------------------- | ------------------------------------------------ |
| `release-cadmpeg-ts` | Auditing or preparing a reviewed package release |
