/**
 * `cadmpeg-ts/core`: the converter with no packaged module locator, for
 * bundled browser apps that deliver the WebAssembly modules themselves.
 *
 * A bundler that follows this entry emits no `.wasm` file: nothing it imports
 * names a packaged binary, and the generated glue carries no default URL.
 * Pass `locateModule` to `createCadmpeg`; without it the factory refuses with
 * `INVALID_OPTIONS`. Node.js resolves the `node` export condition instead,
 * which is the `cadmpeg-ts` Node.js entry unchanged.
 */

import { bindHost, packagedGlue } from '#create.js';

const api = bindHost({ loadGlue: packagedGlue });

/** Create a converter; outside Node.js, `locateModule` is required. */
export const createCadmpeg = api.createCadmpeg;

export type {
  Cadmpeg,
  ConversionTimings,
  ConvertFormatsOptions,
  ConvertOptions,
  ConvertResult,
  ConvertTarget,
  InputFile,
  OutputFile,
} from '#cadmpeg.js';
export type { BackendPreference, CreateCadmpegOptions } from '#create.js';
export type { Backend, Loss, Severity } from '#engine.js';
export { CadmpegError, type CadmpegErrorCode, type CadmpegErrorOptions, type Phase } from '#errors.js';
export type { ModuleId } from '#formats.js';
export type { LocateModule, ModuleSource } from '#wasm-engine.js';
