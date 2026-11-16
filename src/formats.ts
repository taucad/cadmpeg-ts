/**
 * `cadmpeg-ts/formats`: what the engine reads and writes and which
 * WebAssembly module carries each format, with no engine load.
 *
 * `tests/formats.test.ts` holds this table equal to the engine's own
 * `capabilities()`, so it cannot drift from the pinned cadmpeg release.
 */

/** A format cadmpeg reads. */
export type InputFormat = {
  /** Format id, as conversion reports name it. */
  readonly id: string;
  /** Lowercase file extensions, without the dot. */
  readonly extensions: readonly string[];
  /** The WebAssembly module that reads it. */
  readonly module: ModuleId;
};

/** A format cadmpeg writes. */
export type OutputFormat = {
  /** Format id, as `convert({ to })` takes it. */
  readonly id: string;
  /** The extension a written file gets. */
  readonly extension: string;
  /** Whether the written file is binary. */
  readonly binary: boolean;
  /** Writers cadmpeg itself marks as experimental (charter EQ2). */
  readonly experimental: boolean;
};

/** One WebAssembly module per native format, each with the STEP codec (charter D11). */
export const modules = {
  step: ['step'],
  iges: ['iges', 'step'],
  sat: ['sat', 'step'],
  fcstd: ['fcstd', 'step'],
  f3d: ['f3d', 'step'],
  inventor: ['inventor', 'step'],
  sldprt: ['sldprt', 'step'],
  catia: ['catia', 'step'],
  creo: ['creo', 'step'],
  nx: ['nx', 'step'],
  rhino: ['rhino', 'step'],
  pvz: ['pvz', 'step'],
  usd: ['usd', 'step'],
} as const;

/** A WebAssembly module id: the codec it adds to STEP. */
export type ModuleId = keyof typeof modules;

/** The cadmpeg release the engine is pinned to. */
export const engineVersion = '0.6.12';

/** Every readable format, in the engine's catalog order. */
export const inputs: readonly InputFormat[] = [
  { id: 'fcstd', extensions: ['fcstd'], module: 'fcstd' },
  { id: 'f3d', extensions: ['f3d', 'f3z'], module: 'f3d' },
  { id: 'inventor', extensions: ['ipt', 'iam'], module: 'inventor' },
  { id: 'sldprt', extensions: ['sldprt'], module: 'sldprt' },
  { id: 'catia', extensions: ['catpart'], module: 'catia' },
  { id: 'creo', extensions: ['prt'], module: 'creo' },
  { id: 'nx', extensions: ['prt'], module: 'nx' },
  { id: 'rhino', extensions: ['3dm'], module: 'rhino' },
  { id: 'step', extensions: ['step', 'stp'], module: 'step' },
  { id: 'iges', extensions: ['iges', 'igs'], module: 'iges' },
  { id: 'sat', extensions: ['sat', 'sab', 'smt', 'smb'], module: 'sat' },
  { id: 'pvz', extensions: ['pvz'], module: 'pvz' },
  { id: 'usd', extensions: ['usd', 'usda', 'usdc', 'usdz'], module: 'usd' },
  { id: 'cadir', extensions: ['cadir', 'json'], module: 'step' },
];

/** Every writable format. */
export const outputs: readonly OutputFormat[] = [
  { id: 'cadir', extension: 'cadir.json', binary: false, experimental: false },
  { id: 'step', extension: 'step', binary: false, experimental: false },
  { id: 'fcstd', extension: 'fcstd', binary: true, experimental: true },
  { id: 'f3d', extension: 'f3d', binary: true, experimental: true },
  { id: 'sldprt', extension: 'sldprt', binary: true, experimental: true },
  { id: 'rhino', extension: '3dm', binary: true, experimental: true },
  { id: 'iges', extension: 'iges', binary: false, experimental: false },
  { id: 'usd', extension: 'usda', binary: false, experimental: true },
];

const extensionOf = (name: string): string[] => {
  const lower = name.toLowerCase();
  const file = lower.slice(Math.max(lower.lastIndexOf('/'), lower.lastIndexOf('\\')) + 1);
  // Creo appends a save counter: `bracket.prt.5`.
  const extension = (/\.([^.]+)\.\d+$/u.exec(file) ?? /\.([^.]+)$/u.exec(file))?.[1];
  return extension === undefined ? [] : [extension];
};

/**
 * The modules that may read a file, from its name, in catalog order.
 *
 * @param name - File name, or `undefined`.
 * @returns Candidate module ids; empty when no format claims the extension.
 */
export const candidateModules = (name: string | undefined): ModuleId[] => {
  if (name === undefined) return [];
  const [extension] = extensionOf(name);
  return inputs
    .filter((format) => extension !== undefined && format.extensions.includes(extension))
    .map((format) => format.module);
};

/**
 * The module that writes `format` when the source was read by `source`.
 * STEP and CADIR are written by every module; a native writer only by its own.
 *
 * @param format - Output format id.
 * @param source - The module that read the input.
 * @returns The writing module id.
 */
export const writerModule = (format: string, source: ModuleId): ModuleId => {
  if (format === 'step' || format === 'cadir') return source;
  if ((modules[source] as readonly string[]).includes(format)) return source;
  return format in modules ? (format as ModuleId) : source;
};

/**
 * The extension a written file of `format` gets.
 *
 * @param format - Output format id.
 * @returns The extension, without the dot.
 */
export const outputExtension = (format: string): string =>
  outputs.find((output) => output.id === format)?.extension ?? format;
