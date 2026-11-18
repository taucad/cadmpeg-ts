/**
 * The engine contract both backends implement, and the report shapes that
 * cross it.
 */

import type { Phase } from '#errors.js';

/** How serious a loss is, as cadmpeg grades it. */
export type Severity = 'info' | 'warning' | 'error';

/** One attributable instance of incomplete or approximate transfer. */
export type Loss = {
  /** The phase that reported the loss. */
  readonly phase: Phase;
  /** cadmpeg's stable `namespace/code` loss code, such as `shared/pcurve_omitted`. */
  readonly code: string;
  /** How serious the loss is. */
  readonly severity: Severity;
  /** cadmpeg's explanation. */
  readonly message: string;
  /** Where in the source the loss occurred, when cadmpeg attributes it. */
  readonly provenance?: unknown;
};

/** What one engine call transferred and lost. */
export type EngineReport = {
  /** Input format id. */
  readonly from: string;
  /** Output format id. */
  readonly to: string;
  /** Decode losses first, then export losses, in cadmpeg's order. */
  readonly losses: readonly Loss[];
  /** cadmpeg's informational notes. */
  readonly notes: readonly string[];
};

/** One engine conversion: written bytes and the report. */
export type EngineConversion = {
  /** The written file. */
  readonly bytes: Uint8Array;
  /** What the conversion transferred and lost. */
  readonly report: EngineReport;
};

/** The backend that ran a conversion. */
export type Backend = 'native' | 'wasm';

/**
 * A loaded engine. Implementations route a conversion to the code that
 * carries the input's codec and the output's writer.
 *
 * @internal
 */
export type Engine = {
  /** The backend this engine runs on. */
  readonly backend: Backend;
  /**
   * Convert one file.
   *
   * @param bytes - Input file bytes.
   * @param name - Input file name, which chooses the codec module.
   * @param to - Output format, optionally with a dialect: `step:ap242`.
   * @returns The written bytes and the report.
   */
  readonly convert: (bytes: Uint8Array, name: string | undefined, to: string) => Promise<EngineConversion>;
};

/**
 * Parse a report JSON string an engine returned.
 *
 * @internal
 * @param json - Report JSON from the binding.
 * @returns The typed report.
 */
export const parseReport = (json: string): EngineReport => JSON.parse(json) as EngineReport;

/**
 * Join the two legs of a route that crosses modules as STEP bytes (charter
 * D11): the written file is the second leg's, and the report names the source
 * format and lists both legs' losses and notes, first leg first.
 *
 * @internal
 * @param step - The source-to-STEP leg.
 * @param written - The STEP-to-target leg.
 * @returns The joined conversion.
 */
export const joinLegs = (step: EngineConversion, written: EngineConversion): EngineConversion => ({
  bytes: written.bytes,
  report: {
    from: step.report.from,
    to: written.report.to,
    losses: [...step.report.losses, ...written.report.losses],
    notes: [...step.report.notes, ...written.report.notes],
  },
});
