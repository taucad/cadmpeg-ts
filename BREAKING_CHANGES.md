# Breaking changes

## 0.x

- **0.1.0-beta.3:** the generated glue in `cadmpeg-ts/wasm/<id>.js` no longer
  falls back to `<id>_bg.wasm` beside it. A caller that imports a glue file
  directly must pass `{ module_or_path }` to its default export; calling it
  with no argument now throws. `createCadmpeg` and `convert` are unaffected:
  they always pass the module.
