/**
 * The native backend: the NAPI-RS addon, every codec in one binary.
 */

import { endianness } from 'node:os';

import type { Engine } from '#engine.js';
import { parseReport } from '#engine.js';
import { CadmpegError, fromEngine } from '#errors.js';

/**
 * The addon surface `rust/binding-napi` exports.
 *
 * @internal
 */
export type Addon = {
  convert: (input: Buffer, to: string) => Promise<{ bytes: Buffer; report: string }>;
};

/**
 * The host facts the loader checks before it opens the addon.
 *
 * @internal
 */
export type NativeHost = {
  readonly arch: string;
  readonly platform: string;
  readonly node: string;
  readonly endianness: 'BE' | 'LE';
};

const compatibility = 'https://github.com/taucad/cadmpeg-ts/blob/main/compatibility.md';

// A variable specifier: the loader is generated at build time, so the type
// checker must not resolve it, and no bundler should follow it.
const loaderPath = './native/index.js';

const currentHost = (): NativeHost => ({
  arch: process.arch,
  platform: process.platform,
  node: process.versions.node,
  endianness: endianness(),
});

/**
 * Wrap a loaded addon as an engine.
 *
 * @internal
 * @param addon - The loaded addon.
 * @returns The native engine.
 */
export const createNativeEngine = (addon: Addon): Engine => ({
  backend: 'native',
  async convert(bytes, _name, to) {
    try {
      const result = await addon.convert(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), to);
      return {
        bytes: new Uint8Array(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength),
        report: parseReport(result.report),
      };
    } catch (error) {
      throw fromEngine(error);
    }
  },
});

/**
 * Load the addon the generated loader selects for this host.
 *
 * npm's `cpu: "ppc64"` selector does not encode endianness, so a big-endian
 * POWER host installs a package it cannot run; that is checked first so the
 * answer is a typed failure rather than a relocation error.
 *
 * @internal
 * @param importAddon - Imports the generated loader.
 * @param host - The host facts to check.
 * @returns The native engine.
 */
export const loadNativeEngine = async (
  importAddon: () => Promise<unknown> = async () => import(loaderPath),
  host: NativeHost = currentHost(),
): Promise<Engine> => {
  if (host.arch === 'ppc64' && host.endianness !== 'LE') {
    throw new CadmpegError(
      'BACKEND_UNAVAILABLE',
      `cadmpeg-ts builds ppc64 little-endian only, and this host is big-endian. See ${compatibility}.`,
    );
  }
  try {
    return createNativeEngine((await importAddon()) as Addon);
  } catch (error) {
    throw new CadmpegError(
      'BACKEND_UNAVAILABLE',
      `the native addon did not load on ${host.platform}-${host.arch} (node ${host.node}). See ${compatibility}.`,
      { cause: error },
    );
  }
};
