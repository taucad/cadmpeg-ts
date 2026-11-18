/**
 * The WASM backend: one module per native format (charter D11), loaded
 * lazily and routed by file name and content.
 */

import { CadmpegError, fromEngine } from '#errors.js';
import type { Engine, EngineConversion } from '#engine.js';
import { joinLegs, parseReport } from '#engine.js';
import { candidateModules, crossesAsStep, writerModule, type ModuleId } from '#formats.js';

/** What `locateModule` may return for a module's WebAssembly binary. */
export type ModuleSource =
  | string
  | URL
  | Response
  | ArrayBuffer
  | ArrayBufferView<ArrayBuffer>
  | WebAssembly.Module;

/**
 * Find a format module's WebAssembly binary. The default resolves
 * `cadmpeg-ts/wasm/<id>.wasm` next to the package.
 */
export type LocateModule = (id: ModuleId) => ModuleSource | Promise<ModuleSource>;

/** The exports of one generated wasm-bindgen module. */
type WasmConversion = {
  takeBytes: () => Uint8Array;
  readonly report: string;
  free: () => void;
};

/** One wasm-bindgen glue module, as `scripts/build-wasm.mjs` emits it. */
export type WasmGlue = {
  default: (options: { module_or_path: ModuleSource | Promise<ModuleSource> }) => Promise<unknown>;
  convert: (input: Uint8Array, to: string) => WasmConversion;
  detect: (input: Uint8Array) => string | undefined;
};

/** Load one module's glue. Injected so tests and Node can substitute it. */
export type LoadGlue = (id: ModuleId) => Promise<WasmGlue>;

/** The bytes a module's `detect` needs: cadmpeg's detection prefix. */
const detectionPrefixBytes = 128 * 1024;

/** A STEP file starts with this header; cadmpeg routes native-to-native through it. */
const stepHeader = 'ISO-10303-21;';

const startsWith = (bytes: Uint8Array, text: string): boolean => {
  if (bytes.length < text.length) return false;
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[index] !== text.codePointAt(index)) return false;
  }
  return true;
};

/**
 * Create the WASM backend.
 *
 * Each module instance is reused across calls. A trap (a Rust panic, which
 * aborts on WebAssembly) leaves the instance in an unknown state, so the
 * instance is dropped and the next call loads a fresh one.
 *
 * @internal
 * @param loadGlue - Loads a module's wasm-bindgen glue.
 * @param locateModule - Finds a module's WebAssembly binary.
 * @returns The engine.
 */
export const createWasmEngine = (loadGlue: LoadGlue, locateModule: LocateModule): Engine => {
  const instances = new Map<ModuleId, Promise<WasmGlue>>();

  const load = async (id: ModuleId): Promise<WasmGlue> => {
    let instance = instances.get(id);
    if (!instance) {
      instance = (async () => {
        const glue = await loadGlue(id);
        await glue.default({ module_or_path: locateModule(id) });
        return glue;
      })();
      instances.set(id, instance);
      instance.catch(() => instances.delete(id));
    }
    try {
      return await instance;
    } catch (error) {
      throw new CadmpegError('BACKEND_UNAVAILABLE', `could not load the ${id} WebAssembly module`, {
        cause: error,
      });
    }
  };

  const run = async (id: ModuleId, bytes: Uint8Array, to: string): Promise<EngineConversion> => {
    const glue = await load(id);
    let conversion: WasmConversion;
    try {
      conversion = glue.convert(bytes, to);
    } catch (thrown) {
      const error = fromEngine(thrown);
      if (error.code === 'ENGINE_FAILED') instances.delete(id);
      throw error;
    }
    try {
      return { bytes: conversion.takeBytes(), report: parseReport(conversion.report) };
    } finally {
      conversion.free();
    }
  };

  const chooseModule = async (bytes: Uint8Array, name: string | undefined): Promise<ModuleId> => {
    if (startsWith(bytes, stepHeader)) return 'step';
    const candidates = candidateModules(name);
    if (candidates.length === 1) return candidates[0] as ModuleId;
    if (candidates.length === 0) {
      throw new CadmpegError(
        'UNSUPPORTED_FORMAT',
        name === undefined
          ? 'cannot choose a format module without a file name; pass { name, bytes }'
          : `no format module reads ${name}`,
        { phase: 'decode' },
      );
    }
    // Two codecs claim the extension (NX and Creo both write `.prt`): ask each
    // module's detector, in table order.
    const prefix = bytes.subarray(0, detectionPrefixBytes);
    for (const id of candidates) {
      const glue = await load(id);
      if (glue.detect(prefix) !== undefined) return id;
    }
    throw new CadmpegError('UNSUPPORTED_FORMAT', `no format module recognizes ${name}`, { phase: 'decode' });
  };

  return {
    backend: 'wasm',
    async convert(bytes, name, to) {
      const source = await chooseModule(bytes, name);
      const format = to.replace(/:.*$/su, '');
      const writer = writerModule(format, source);
      // Every module reads STEP and CADIR, so those inputs go straight to the
      // writer, as on the native addon. Only a writer that cannot read the
      // source gets STEP bytes, never the IR (charter D11, F11).
      if (!crossesAsStep(format, source)) return run(writer, bytes, to);
      const step = await run(source, bytes, 'step');
      return joinLegs(step, await run(writer, step.bytes, to));
    },
  };
};
