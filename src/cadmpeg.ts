/**
 * The conversion API: `convert`, `convertFormats` and `createCadmpeg`,
 * shaped after libassimp's converter API (charter F10).
 */

import type { Backend, Engine, Loss } from '#engine.js';
import { CadmpegError } from '#errors.js';
import { outputExtension } from '#formats.js';

/** One input file. */
export type InputFile = {
  /** File name; its extension chooses the format module on the WASM backend. */
  readonly name?: string;
  /** File contents. */
  readonly bytes: Uint8Array;
};

/** One written file. */
export type OutputFile = {
  /** The input's base name with the output format's extension. */
  readonly name: string;
  /** File contents. */
  readonly bytes: Uint8Array;
};

/** Options for one conversion. */
export type ConvertOptions = {
  /**
   * Output format id, optionally with a dialect: `step`, `step:ap242`,
   * `iges`, `rhino`, `fcstd`, `f3d`, `sldprt`, `usd`, `cadir`.
   */
  readonly to: string;
  /** Cancels the conversion before or between engine calls. */
  readonly signal?: AbortSignal;
  /**
   * Refuse the conversion when cadmpeg reports any loss. Off by default:
   * losses are returned as warnings (charter Q8).
   */
  readonly strict?: boolean;
};

/** Phase timings of one conversion, in milliseconds. */
export type ConversionTimings = {
  /** Wall-clock time of the whole conversion, including module loading. */
  readonly totalMs: number;
};

/** A completed conversion. */
export type ConvertResult = {
  /** The written files; one for every format cadmpeg writes. */
  readonly files: readonly OutputFile[];
  /** Input format id. */
  readonly from: string;
  /** Output format id. */
  readonly to: string;
  /** Every loss cadmpeg reported, decode first, never dropped (charter I3). */
  readonly losses: readonly Loss[];
  /** cadmpeg's informational notes. */
  readonly notes: readonly string[];
  /** Phase timings. */
  readonly timings: ConversionTimings;
  /** The backend that ran the conversion. */
  readonly backend: Backend;
};

/** One target of {@link Cadmpeg.convertFormats}. */
export type ConvertTarget = Omit<ConvertOptions, 'signal'>;

/** Options for {@link Cadmpeg.convertFormats}. */
export type ConvertFormatsOptions = {
  /** The targets, converted in order. */
  readonly targets: readonly ConvertTarget[];
  /** Cancels the remaining conversions. */
  readonly signal?: AbortSignal;
};

/** A loaded converter. */
export type Cadmpeg = {
  /** The backend this converter runs on. */
  readonly backend: Backend;
  /**
   * Convert one CAD file.
   *
   * @param input - The file, or its bytes alone when the format is STEP.
   * @param options - Output format and policy.
   * @returns The written file, losses and timings.
   */
  readonly convert: (input: InputFile | Uint8Array, options: ConvertOptions) => Promise<ConvertResult>;
  /**
   * Convert one CAD file to several formats, in order.
   *
   * @param input - The file.
   * @param options - Targets and cancellation.
   * @returns One result per target.
   */
  readonly convertFormats: (
    input: InputFile | Uint8Array,
    options: ConvertFormatsOptions,
  ) => Promise<readonly ConvertResult[]>;
};

const now = (): number => globalThis.performance.now();

const throwIfAborted = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted) {
    throw new CadmpegError('ABORTED', 'conversion aborted', { cause: signal.reason });
  }
};

const baseName = (name: string | undefined): string => {
  if (name === undefined) return 'output';
  const file = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
  const dot = file.indexOf('.');
  return dot > 0 ? file.slice(0, dot) : file;
};

const normalize = (input: InputFile | Uint8Array): InputFile => {
  const file = input instanceof Uint8Array ? { bytes: input } : input;
  if (!(file.bytes instanceof Uint8Array) || file.bytes.length === 0) {
    throw new CadmpegError('NO_FILES', 'convert needs a non-empty input file');
  }
  return file;
};

const validate = (options: ConvertTarget): void => {
  if (typeof options.to !== 'string' || options.to.length === 0) {
    throw new CadmpegError('INVALID_OPTIONS', 'options.to must name an output format');
  }
};

/**
 * Wrap an engine in the public API.
 *
 * @internal
 * @param engine - The loaded engine.
 * @returns The converter.
 */
export const fromEngine = (engine: Engine): Cadmpeg => {
  const convert = async (input: InputFile | Uint8Array, options: ConvertOptions): Promise<ConvertResult> => {
    const start = now();
    const file = normalize(input);
    validate(options);
    throwIfAborted(options.signal);
    const { bytes, report } = await engine.convert(file.bytes, file.name, options.to);
    throwIfAborted(options.signal);
    if (options.strict === true && report.losses.length > 0) {
      const first = report.losses[0] as Loss;
      throw new CadmpegError(
        'REFUSED',
        `strict conversion refused: ${report.losses.length} loss(es), first ${first.code}: ${first.message}`,
        { phase: first.phase, cause: report.losses },
      );
    }
    return {
      files: [{ name: `${baseName(file.name)}.${outputExtension(report.to)}`, bytes }],
      from: report.from,
      to: report.to,
      losses: report.losses,
      notes: report.notes,
      timings: { totalMs: now() - start },
      backend: engine.backend,
    };
  };

  return {
    backend: engine.backend,
    convert,
    async convertFormats(input, { targets, signal }) {
      const results: ConvertResult[] = [];
      for (const target of targets) {
        results.push(await convert(input, signal === undefined ? target : { ...target, signal }));
      }
      return results;
    },
  };
};
