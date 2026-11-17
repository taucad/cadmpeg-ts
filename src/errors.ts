/**
 * The failure taxonomy every `cadmpeg-ts` operation reports through.
 */

/** Stable machine-readable failure codes. */
export type CadmpegErrorCode =
  | 'NO_FILES'
  | 'UNSUPPORTED_FORMAT'
  | 'INVALID_OPTIONS'
  | 'IMPORT_FAILED'
  | 'EXPORT_FAILED'
  | 'REFUSED'
  | 'LIMIT_EXCEEDED'
  | 'ENGINE_FAILED'
  | 'BACKEND_UNAVAILABLE'
  | 'ABORTED'
  | 'INTERNAL';

/** The conversion phase a failure or loss belongs to. */
export type Phase = 'decode' | 'export';

const codes = new Set<string>([
  'NO_FILES',
  'UNSUPPORTED_FORMAT',
  'INVALID_OPTIONS',
  'IMPORT_FAILED',
  'EXPORT_FAILED',
  'REFUSED',
  'LIMIT_EXCEEDED',
  'ENGINE_FAILED',
  'BACKEND_UNAVAILABLE',
  'ABORTED',
  'INTERNAL',
]);

/** Options for {@link CadmpegError}. */
export type CadmpegErrorOptions = {
  /** The phase that failed, when one did. */
  readonly phase?: Phase;
  /** The underlying error. */
  readonly cause?: unknown;
};

/** A failed `cadmpeg-ts` operation; `code` says why. */
export class CadmpegError extends Error {
  /** Stable machine-readable failure code. */
  public readonly code: CadmpegErrorCode;
  /** The phase that failed, when one did. */
  public readonly phase: Phase | undefined;

  /**
   * Create an error with a stable code.
   *
   * @param code - Stable failure code.
   * @param message - Human-readable explanation.
   * @param options - Failed phase and underlying cause.
   */
  public constructor(code: CadmpegErrorCode, message: string, options: CadmpegErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'CadmpegError';
    this.code = code;
    this.phase = options.phase;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * Translate whatever an engine threw into a {@link CadmpegError}.
 *
 * The engines throw a binding error as a JSON string (WASM) or as an `Error`
 * whose message is that JSON (NAPI). Anything else is an engine failure: a
 * WASM trap or a contained native panic.
 *
 * @internal
 * @param thrown - The value the engine threw.
 * @returns The error to report.
 */
export const fromEngine = (thrown: unknown): CadmpegError => {
  if (thrown instanceof CadmpegError) return thrown;
  const text = typeof thrown === 'string' ? thrown : thrown instanceof Error ? thrown.message : undefined;
  if (text?.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (isRecord(parsed) && typeof parsed['code'] === 'string' && codes.has(parsed['code'])) {
        const phase =
          parsed['phase'] === 'decode' || parsed['phase'] === 'export' ? parsed['phase'] : undefined;
        return new CadmpegError(
          parsed['code'] as CadmpegErrorCode,
          typeof parsed['message'] === 'string' ? parsed['message'] : text,
          { phase },
        );
      }
    } catch {
      // Not binding JSON; fall through to an engine failure.
    }
  }
  return new CadmpegError('ENGINE_FAILED', `engine failed: ${text ?? String(thrown)}`, { cause: thrown });
};
