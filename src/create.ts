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
   * a compiled `WebAssembly.Module`. `cadmpeg-ts` and its Node.js entry
   * default to the binary that ships beside the package,
   * `cadmpeg-ts/wasm/<id>_bg.wasm`. `cadmpeg-ts/core` outside Node.js has no
   * default and needs this option.
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
  /**
   * The default module locator. Absent on `cadmpeg-ts/core`, whose callers
   * locate every module themselves.
   */
  readonly locateModule?: LocateModule;
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
    const locateModule = options.locateModule ?? host.locateModule;
    const wasm = (): Cadmpeg => {
      if (!locateModule) {
        throw new CadmpegError(
          'INVALID_OPTIONS',
          'cadmpeg-ts/core packages no module locator; pass `locateModule`, or import `cadmpeg-ts` to load the packaged modules',
        );
      }
      return fromEngine(createWasmEngine(host.loadGlue, locateModule));
    };
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

// One literal specifier per module. Bundlers skip template-literal imports
// under node_modules (Vite's dynamic-import-vars excludes it by default), so a
// template would leave the glue unbundled in every consumer app; literals are
// followed by every bundler. The `as string` keeps TypeScript from resolving
// glue that exists only after `pnpm run build:wasm`; the emitted JavaScript
// keeps the literal. tests/workflow-policy and test-bundle.mjs hold the table
// to src/formats.ts.
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-unsafe-return -- the assertion stops TypeScript resolving build output; the result is typed by `packagedGlue` */
const glue: Readonly<Record<ModuleId, () => Promise<unknown>>> = {
  step: async () => import('./wasm/step.js' as string),
  iges: async () => import('./wasm/iges.js' as string),
  sat: async () => import('./wasm/sat.js' as string),
  fcstd: async () => import('./wasm/fcstd.js' as string),
  f3d: async () => import('./wasm/f3d.js' as string),
  inventor: async () => import('./wasm/inventor.js' as string),
  sldprt: async () => import('./wasm/sldprt.js' as string),
  catia: async () => import('./wasm/catia.js' as string),
  creo: async () => import('./wasm/creo.js' as string),
  nx: async () => import('./wasm/nx.js' as string),
  rhino: async () => import('./wasm/rhino.js' as string),
  pvz: async () => import('./wasm/pvz.js' as string),
  usd: async () => import('./wasm/usd.js' as string),
};
/* eslint-enable @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-unsafe-return */

/**
 * Load a packaged module's glue.
 *
 * @internal
 * @param id - Module id.
 * @returns The glue module.
 */
export const packagedGlue: LoadGlue = async (id) => (await glue[id]()) as Awaited<ReturnType<LoadGlue>>;
