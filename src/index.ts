/**
 * `cadmpeg-ts`: convert native CAD files with cadmpeg, in the browser and
 * any other JavaScript host, through per-format WebAssembly modules.
 *
 * This entry imports no Node.js builtin (charter I1). Node.js resolves the
 * `node` export condition instead, which adds the native addon.
 */

import { bindHost, packagedGlue, packagedModuleUrl } from '#create.js';

const api = bindHost({ loadGlue: packagedGlue, locateModule: packagedModuleUrl });

/** Create a converter on the chosen backend. */
export const createCadmpeg = api.createCadmpeg;
/** Convert one CAD file with a shared WebAssembly converter. */
export const convert = api.convert;
/** Convert one CAD file to several formats with a shared WebAssembly converter. */
export const convertFormats = api.convertFormats;

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
