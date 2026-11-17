# Contributing

1. Fork or branch from `main`, and clone with `--recurse-submodules` (or run
   `git submodule update --init`).
2. Install with `pnpm install --frozen-lockfile`.
3. Add tests that assert the changed public behavior: Rust tests in
   `rust/binding/src/tests.rs` for engine behavior, Vitest tests beside the
   TypeScript source for the facade.
4. Run `pnpm nx run cadmpeg-ts:quality` and `pnpm run test:rust`.
5. Add a Version Plan with `pnpm nx release plan` when package behavior or
   shipped artifacts change. Pending plans feed an automated release pull
   request; a maintainer merges it to publish.
6. Update a byte budget in the causing pull request when the larger artifact is
   intentional. Explain the measured origin beside the threshold.
7. Fix engine bugs upstream first. A change to `patches/` needs the upstream
   pull request or issue it stands in for.
8. Open a pull request with commands and results.

Only GitHub Actions publishes npm packages, creates tags or releases. Never run
`npm publish` from a workstation.
