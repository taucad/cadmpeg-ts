/**
 * The binaries shipped beside the package. Only `cadmpeg-ts` and its Node.js
 * entry import this module: bundlers read the expression below and emit every
 * binary it can name, so `cadmpeg-ts/core` must never reach it.
 */

import type { ModuleId } from '#formats.js';

/**
 * Resolve a packaged module's WebAssembly binary.
 *
 * @internal
 * @param id - Module id.
 * @returns The binary's URL.
 */
export const packagedModuleUrl = (id: ModuleId): URL => new URL(`./wasm/${id}_bg.wasm`, import.meta.url);
