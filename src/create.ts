/**
 * `createCadmpeg` and the one-shot `convert` functions, parameterized by the
 * backends an entry point can offer.
 */

import {
  fromEngine,
  type Cadmpeg,
  type ConvertFormatsOptions,
  type ConvertOptions,
  type ConvertResult,
  type InputFile,
} from '#cadmpeg.js';
import type { Engine } from '#engine.js';
import { CadmpegError } from '#errors.js';
import type { ModuleId } from '#formats.js';
import { createWasmEngine, type LoadGlue, type LocateModule } from '#wasm-engine.js';

/** Which engine to run. */
export type BackendPreference = 'auto' | 'native' | 'wasm';

/** Options for {@link createCadmpeg}. */
export type CreateCadmpegOptions = {
  /**
   * `auto` (the default) uses the native addon where the `node` export
   * condition provides one, and WebAssembly everywhere else.
   */
  readonly backend?: BackendPreference;
  /**
   * Find a format module's WebAssembly binary: a URL, a `Response`, bytes or
   * a compiled `WebAssembly.Module`. The default resolves the binary that
   * ships beside the package, `cadmpeg-ts/wasm/<id>_bg.wasm`.
   */
  readonly locateModule?: LocateModule;
};

/**
 * What an entry point provides.
 *
 * @internal
 */
export type Host = {
  /** Loads the native engine, or throws when the host has none. */
  readonly loadNative?: () => Promise<Engine>;
  /** Loads a module's wasm-bindgen glue. */
  readonly loadGlue: LoadGlue;
  /** The default module locator. */
  readonly locateModule: LocateModule;
};

const backends = new Set<string>(['auto', 'native', 'wasm']);

/**
 * Bind the public factory and one-shot functions to an entry point's host.
 *
 * @internal
 * @param host - The backends the entry point offers.
 * @returns The entry point's public functions.
 */
export const bindHost = (host: Host) => {
  const createCadmpeg = async (options: CreateCadmpegOptions = {}): Promise<Cadmpeg> => {
    const backend = options.backend ?? 'auto';
    // JavaScript callers can pass anything, so the union is checked at runtime.
    if (!backends.has(backend)) {
      throw new CadmpegError('INVALID_OPTIONS', `unknown backend ${backend}`);
    }
    const wasm = (): Cadmpeg =>
      fromEngine(createWasmEngine(host.loadGlue, options.locateModule ?? host.locateModule));
    if (backend === 'wasm') return wasm();
    if (!host.loadNative) {
      if (backend === 'native') {
        throw new CadmpegError(
          'BACKEND_UNAVAILABLE',
          'the native backend needs Node.js and the `node` export condition',
        );
      }
      return wasm();
    }
    try {
      return fromEngine(await host.loadNative());
    } catch (error) {
      if (backend === 'native') {
        throw error instanceof CadmpegError
          ? error
          : new CadmpegError('BACKEND_UNAVAILABLE', 'the native addon did not load', { cause: error });
      }
      return wasm();
    }
  };

  // `auto` never rejects: a native failure falls back to WebAssembly, whose
  // modules load lazily on first use. One converter serves every call.
  let shared: Promise<Cadmpeg> | undefined;
  const sharedConverter = async (): Promise<Cadmpeg> => {
    shared ??= createCadmpeg();
    return shared;
  };

  /**
   * Convert one CAD file with a shared converter on the default backend.
   *
   * @param input - The file, or its bytes alone when the format is STEP.
   * @param options - Output format and policy.
   * @returns The written file, losses and timings.
   */
  const convert = async (input: InputFile | Uint8Array, options: ConvertOptions): Promise<ConvertResult> =>
    (await sharedConverter()).convert(input, options);

  /**
   * Convert one CAD file to several formats with a shared converter.
   *
   * @param input - The file.
   * @param options - Targets and cancellation.
   * @returns One result per target.
   */
  const convertFormats = async (
    input: InputFile | Uint8Array,
    options: ConvertFormatsOptions,
  ): Promise<readonly ConvertResult[]> => (await sharedConverter()).convertFormats(input, options);

  return { createCadmpeg, convert, convertFormats };
};

/**
 * The module locator that resolves binaries shipped beside the package.
 *
 * @internal
 * @param id - Module id.
 * @returns The binary's URL.
 */
export const packagedModuleUrl = (id: ModuleId): URL => new URL(`./wasm/${id}_bg.wasm`, import.meta.url);

/**
 * Load a packaged module's glue.
 *
 * @internal
 * @param id - Module id.
 * @returns The glue module.
 */
export const packagedGlue: LoadGlue = async (id) =>
  (await import(`./wasm/${id}.js`)) as Awaited<ReturnType<LoadGlue>>;
