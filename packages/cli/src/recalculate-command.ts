import {
  Archive,
  CatalogRebuildError,
  RunNotFoundError,
  calculateRun,
  fingerprintRun,
  type CalculationSettings,
  type CharacterMetrics,
  type NormalizedEvent,
  type RunMetrics,
  type RunSummary,
  type RunWindow,
} from '@sitbench/core';
import { defaultArchiveDir } from './paths.js';

export interface RecalculateArguments {
  runId?: string;
  all?: boolean;
  archive?: string;
}

export interface RecalculateDependencies {
  write?: (line: string) => void;
  createArchive?: (directory: string) => Archive;
  rebuildCatalog?: (archive: Archive) => Promise<void>;
}

export type RecalculateOutcome =
  | { id: string; status: 'recalculated' }
  | { id: string; status: 'recalculated-with-warning'; reason: string }
  | { id: string; status: 'incompatible'; reason: string }
  | { id: string; status: 'not-found' }
  | { id: string; status: 'error'; reason: string };

export type RecalculateResult =
  | { status: 'ok'; outcomes: RecalculateOutcome[] }
  | { status: 'partial'; outcomes: RecalculateOutcome[] }
  | { status: 'fatal'; reason: string };

/**
 * The current metrics-calculation version. There is no incrementing
 * version-bump scheme yet beyond this single literal, which matches the
 * value `analyze` already writes for every newly saved run; recalculation
 * sets it explicitly rather than leaving a stale prior value in place.
 */
export const METRICS_VERSION = '0.1.0';

export interface RecalculatedFields {
  calculation: CalculationSettings;
  metrics: RunMetrics;
  characterMetrics: CharacterMetrics[];
  fingerprint: string;
}

/**
 * Recomputes every metric/fingerprint field derivable purely from the
 * confirmed `window`, the recorded `calculation` thresholds, and the
 * archived normalized `events` — the only durable source of truth
 * recalculation and window edits are allowed to read. `events` is always
 * the *full* archived event stream (never pre-filtered by the caller);
 * `calculateRun`/`fingerprintRun` filter internally by `window` bounds, so
 * passing the complete archived events here is both correct and keeps
 * callers from accidentally truncating what gets persisted. Coverage is
 * ingestion provenance recorded once at analyze-time; this function
 * intentionally has no coverage input or output — callers must carry the
 * current summary's `coverage` over unchanged.
 */
export function recalculateFields(
  window: RunWindow,
  events: NormalizedEvent[],
  calculation: CalculationSettings,
): RecalculatedFields {
  const calculated = calculateRun(events, window, calculation);
  return {
    calculation: calculated.calculation,
    metrics: calculated.metrics,
    characterMetrics: calculated.characterMetrics,
    fingerprint: fingerprintRun(events, window),
  };
}

export function isInWindow(event: NormalizedEvent, window: { start: string; end: string }): boolean {
  const timestamp = Date.parse(event.timestamp);
  return timestamp >= Date.parse(window.start) && timestamp <= Date.parse(window.end);
}

export function isValidWindow(window: { start: string; end: string }): boolean {
  const start = Date.parse(window.start);
  const end = Date.parse(window.end);
  return Number.isFinite(start) && Number.isFinite(end) && end > start;
}

export function isQualifyingNpcDamage(event: NormalizedEvent): boolean {
  return event.kind === 'damage-dealt' && event.targetClassification === 'npc';
}

/**
 * Duck-types a zod `ZodError` without importing `zod` directly — it is only
 * a dependency of `@sitbench/core`, not of this package. Any error thrown
 * while `Archive` parses archived `run.json`/`events.jsonl` against the
 * current strict schemas surfaces this way, and is mapped to an explicit
 * `incompatible` result at this command boundary instead of a fabricated
 * metric, a weakened schema, or a crash.
 */
export function isSchemaValidationError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'ZodError';
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Recalculates one archived run (or every archived run with `--all`) from
 * its durable confirmed window, recorded calculation thresholds, and
 * archived normalized events. The confirmed window, site, fleet profile,
 * notes, calculation thresholds, coverage (ingestion provenance), and
 * `createdAt` are always preserved untouched; only derived
 * metrics/characterMetrics/participants and `metricsVersion` are replaced.
 * Every mutation goes through `Archive.updateRun`, which persists atomically
 * and rebuilds `catalog.json`. `--all` enumerates run ids via
 * `Archive.listRunIds()` (which never parses `run.json`) rather than
 * `Archive.listRuns()`, so one incompatible archived run never blocks
 * recalculation of every other run in the batch; the top-level result is
 * `'partial'` whenever any requested run could not be recalculated
 * (incompatible, not found, or another error), while every processable run
 * in the batch is still recalculated.
 */
export async function runRecalculate(
  arguments_: RecalculateArguments,
  dependencies: RecalculateDependencies,
): Promise<RecalculateResult> {
  const write = dependencies.write ?? console.log;

  if (arguments_.all === true && arguments_.runId !== undefined) {
    return fatal(write, 'Provide either a run id or --all, not both.', 'conflicting-target');
  }
  if (arguments_.all !== true && (arguments_.runId === undefined || arguments_.runId.trim().length === 0)) {
    return fatal(write, 'Provide a run id or --all.', 'missing-target');
  }

  const archiveDirectory = arguments_.archive ?? defaultArchiveDir();
  const archive = (dependencies.createArchive ?? ((directory) => new Archive(directory)))(archiveDirectory);

  let ids: string[];
  if (arguments_.all === true) {
    try {
      ids = await archive.listRunIds();
    } catch (error) {
      return fatal(write, `Cannot read archived runs: ${message(error)}`, 'archive');
    }
  } else {
    ids = [(arguments_.runId as string).trim()];
  }

  const outcomes: RecalculateOutcome[] = [];
  for (const id of ids) {
    const outcome = await recalculateOne(archive, id, dependencies);
    outcomes.push(outcome);
    write(describeOutcome(id, outcome));
  }

  const hasFailure = outcomes.some(
    (outcome) => outcome.status === 'incompatible' || outcome.status === 'not-found' || outcome.status === 'error',
  );
  return { status: hasFailure ? 'partial' : 'ok', outcomes };
}

async function recalculateOne(
  archive: Archive,
  id: string,
  dependencies: RecalculateDependencies,
): Promise<RecalculateOutcome> {
  try {
    await archive.updateRun(id, ({ summary, events }) => {
      const fields = recalculateFields(summary.window, events, summary.calculation);
      const nextSummary: RunSummary = {
        ...summary,
        calculation: fields.calculation,
        metrics: fields.metrics,
        characterMetrics: fields.characterMetrics,
        participants: fields.characterMetrics.map((metric) => metric.character),
        metricsVersion: METRICS_VERSION,
      };
      return { summary: nextSummary, events };
    });
  } catch (error) {
    if (error instanceof RunNotFoundError) {
      return { id, status: 'not-found' };
    }
    if (error instanceof CatalogRebuildError) {
      return { id, status: 'recalculated-with-warning', reason: message(error) };
    }
    if (isSchemaValidationError(error)) {
      return { id, status: 'incompatible', reason: message(error) };
    }
    return { id, status: 'error', reason: message(error) };
  }

  await (dependencies.rebuildCatalog ?? rebuildCatalogNoop)(archive);
  return { id, status: 'recalculated' };
}

async function rebuildCatalogNoop(): Promise<void> {
  // Archive.updateRun already rebuilds catalog.json. Dashboard regeneration
  // is wired through the rebuildCatalog dependency.
}

function describeOutcome(id: string, outcome: RecalculateOutcome): string {
  switch (outcome.status) {
    case 'recalculated':
      return `Recalculated run ${id}.`;
    case 'recalculated-with-warning':
      return `Run ${id} was recalculated, but its catalog could not be rebuilt: ${outcome.reason}`;
    case 'incompatible':
      return `Run ${id} was left untouched: archived events do not satisfy the current schema (${outcome.reason}).`;
    case 'not-found':
      return `Run ${id} was not found.`;
    case 'error':
      return `Run ${id} was not recalculated: ${outcome.reason}`;
  }
}

function fatal(write: (line: string) => void, text: string, reason: string): RecalculateResult {
  write(`Error: ${text}`);
  return { status: 'fatal', reason };
}
