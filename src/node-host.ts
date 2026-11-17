/**
 * Node.js reads the packaged WebAssembly modules from disk: its `fetch`
 * cannot read `file:` URLs.
 */

import { readFile } from 'node:fs/promises';

import { packagedModuleUrl } from '#create.js';
import type { ModuleId } from '#formats.js';

/**
 * Read a packaged module's WebAssembly binary.
 *
 * @internal
 * @param id - Module id.
 * @returns The binary's bytes.
 */
export const readPackagedModule = async (id: ModuleId): Promise<Uint8Array<ArrayBuffer>> =>
  new Uint8Array(await readFile(packagedModuleUrl(id)));
