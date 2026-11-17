/**
 * `cadmpeg-ts` on Node.js: the universal surface with the native addon
 * behind `backend: 'auto'`, and WebAssembly read from disk as the fallback.
 */

import { bindHost, packagedGlue } from '#create.js';
import { loadNativeEngine } from '#native-engine.js';
import { readPackagedModule } from '#node-host.js';

const api = bindHost({
  loadGlue: packagedGlue,
  loadNative: async () => loadNativeEngine(),
  locateModule: readPackagedModule,
});

/** Create a converter: the native addon first, WebAssembly if it is absent. */
export const createCadmpeg = api.createCadmpeg;
/** Convert one CAD file with a shared converter. */
export const convert = api.convert;
/** Convert one CAD file to several formats with a shared converter. */
export const convertFormats = api.convertFormats;

export type * from '#index.js';
export { CadmpegError } from '#errors.js';
