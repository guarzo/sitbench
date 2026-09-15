import { readFile, realpath } from 'node:fs/promises';
import * as path from 'node:path';
import {
  Archive,
  CatalogRebuildError,
  RunNotFoundError,
  calculateRun,
  fingerprintRun,
  normalizeLogFile,
  type NormalizedEvent,
  type RunSummary,
} from '@sitbench/core';
import { defaultArchiveDir, loadConfig } from './paths.js';
import { isInWindow, isSchemaValidationError, isValidWindow, message, METRICS_VERSION } from './recalculate-command.js';

export interface BackfillArguments {
  runId?: string;
  all?: boolean;
  archive?: string;
  logs?: string;
  dryRun?: boolean;
}

export interface BackfillDependencies {
  write?: (line: string) => void;
  createArchive?: (directory: string) => Archive;
  rebuildCatalog?: (archive: Archive) => Promise<void>;
}

export type BackfillOutcome =
  | { id: string; status: 'backfilled' | 'ready'; eventCount: number }
  | { id: string; status: 'backfilled-with-warning'; eventCount: number; reason: string }
  | { id: string; status: 'already-recorded' | 'not-found' }
  | { id: string; status: 'error' | 'incompatible'; reason: string };

export type BackfillResult =
  | { status: 'ok' | 'partial'; outcomes: BackfillOutcome[] }
  | { status: 'fatal'; reason: string };

/** Supplements existing evidence, never re-detects a run or reinterprets its other event kinds. */
export async function runBackfill(
  arguments_: BackfillArguments,
  dependencies: BackfillDependencies = {},
): Promise<BackfillResult> {
  const write = dependencies.write ?? console.log;
  if (arguments_.all === true && arguments_.runId !== undefined) {
    write('Error: Provide either a run id or --all, not both.');
    return { status: 'fatal', reason: 'conflicting-target' };
  }
  if (arguments_.all !== true && !arguments_.runId?.trim()) {
    write('Error: Provide a run id or --all.');
    return { status: 'fatal', reason: 'missing-target' };
  }

  const directory = arguments_.archive ?? defaultArchiveDir();
  const archive = (dependencies.createArchive ?? ((dir) => new Archive(dir)))(directory);
  const getLogDirectory = async (): Promise<string> => {
    const configured = arguments_.logs ?? (await loadConfig(directory)).gameLogDir;
    if (!configured?.trim()) throw new Error('Provide --logs or configure a game log directory with analyze.');
    return realpath(configured);
  };
  let ids: string[];
  try {
    ids = arguments_.all === true ? await archive.listRunIds() : [arguments_.runId!.trim()];
  } catch (error) {
    write(`Error: Cannot prepare backfill: ${message(error)}`);
    return { status: 'fatal', reason: 'input' };
  }

  write('Backfill measures drain in referenced source logs only. Historical archives cannot verify discarded lines or identify sessions with no archived events.');
  const outcomes: BackfillOutcome[] = [];
  for (const id of ids) {
    const outcome = await backfillOne(archive, id, getLogDirectory, arguments_.dryRun === true, dependencies);
    outcomes.push(outcome);
    write(describeOutcome(outcome));
  }
  const failed = outcomes.some((outcome) => ['error', 'incompatible', 'not-found'].includes(outcome.status));
  return { status: failed ? 'partial' : 'ok', outcomes };
}

async function backfillOne(
  archive: Archive,
  id: string,
  getLogDirectory: () => Promise<string>,
  dryRun: boolean,
  dependencies: BackfillDependencies,
): Promise<BackfillOutcome> {
  let eventCount = 0;
  const warnings: string[] = [];
  try {
    const loaded = await archive.loadRun(id);
    if (loaded === null) return { id, status: 'not-found' };
    const { summary, events } = loaded;
    if (summary.coverage.neutPressure === 'recorded') return { id, status: 'already-recorded' };
    if (!isValidWindow(summary.window)) throw new Error('The archived confirmed window is invalid.');

    const neuts = await readNeutEvidence(await getLogDirectory(), summary, events);
    eventCount = neuts.length;
    // Keep every old observation outside the replacement window, including
    // evidence retained by a previous window edit. Do not deduplicate hits.
    const nextEvents = [
      ...events.filter((event) => event.kind !== 'neut-received' || !isInWindow(event, summary.window)),
      ...neuts,
    ];
    const calculated = calculateRun(nextEvents, summary.window, summary.calculation, { neutPressureAvailable: true });
    const byCharacter = new Map(calculated.characterMetrics.map((metric) => [metric.character, metric.neutPressure]));
    const characterMetrics: RunSummary['characterMetrics'] = summary.characterMetrics.map((metric) => {
      const neutPressure = byCharacter.get(metric.character);
      if (neutPressure === undefined) throw new Error(`No in-window evidence for character ${metric.character}.`);
      return { ...metric, neutPressure };
    });
    // A retained source can recover a neut-only participant omitted by an
    // earlier window edit. Preserve existing values and add that participant.
    const existingCharacters = new Set(characterMetrics.map((metric) => metric.character));
    characterMetrics.push(...calculated.characterMetrics.filter((metric) => !existingCharacters.has(metric.character)));
    characterMetrics.sort((left, right) => left.character < right.character ? -1 : left.character > right.character ? 1 : 0);
    const nextSummary: RunSummary = {
      ...summary,
      characterMetrics,
      participants: characterMetrics.map((metric) => metric.character),
      metrics: { ...summary.metrics, participantCount: characterMetrics.length },
      coverage: { ...summary.coverage, neutPressure: 'recorded' },
      fingerprint: fingerprintRun(nextEvents, summary.window),
      metricsVersion: METRICS_VERSION,
    };
    if (dryRun) return { id, status: 'ready', eventCount };

    await archive.updateRun(id, (current) => {
      // Logs are read outside the lock. Refuse to overwrite any intervening
      // summary or evidence change when the authoritative lock is acquired.
      if (JSON.stringify(current) !== JSON.stringify(loaded)) {
        throw new Error('The run changed while its logs were being read. Retry backfill; no concurrent changes were overwritten.');
      }
      return { summary: nextSummary, events: nextEvents };
    });
  } catch (error) {
    if (error instanceof RunNotFoundError) return { id, status: 'not-found' };
    if (error instanceof CatalogRebuildError) {
      warnings.push(`catalog: ${message(error)}`);
    } else {
      return { id, status: isSchemaValidationError(error) ? 'incompatible' : 'error', reason: message(error) };
    }
  }

  try {
    await dependencies.rebuildCatalog?.(archive);
  } catch (error) {
    warnings.push(`dashboard: ${message(error)}`);
  }
  return warnings.length > 0
    ? { id, status: 'backfilled-with-warning', eventCount, reason: warnings.join('; ') }
    : { id, status: 'backfilled', eventCount };
}

async function readNeutEvidence(
  logDirectory: string,
  summary: RunSummary,
  events: NormalizedEvent[],
): Promise<NormalizedEvent[]> {
  const sources = new Map<string, NormalizedEvent[]>();
  for (const event of events) {
    const own = sources.get(event.sourceFile) ?? [];
    own.push(event);
    sources.set(event.sourceFile, own);
  }
  if (sources.size === 0 || summary.participants.some((character) => !events.some((event) => event.observedBy === character))) {
    throw new Error('Archived evidence does not identify source logs for every participant.');
  }
  if (summary.participants.some((character) => !summary.characterMetrics.some((metric) => metric.character === character))) {
    throw new Error('The run is missing character metrics. Recalculate before backfilling.');
  }

  const neuts: NormalizedEvent[] = [];
  for (const [sourceFile, archived] of sources) {
    // Source filenames are external persisted input, not trusted paths.
    if (!/^[^/\\\0]+\.txt$/i.test(sourceFile) || path.basename(sourceFile) !== sourceFile) {
      throw new Error(`Unsafe source log filename: ${sourceFile}`);
    }
    const file = await realpath(path.join(logDirectory, sourceFile));
    if (path.dirname(file) !== logDirectory) throw new Error(`Source log escapes the chosen logs directory: ${sourceFile}`);
    const text = await readFile(file, 'utf8');
    const normalized = normalizeLogFile({ text, sourceFile });
    const lines = text.split(/\r?\n/);
    if (normalized.character === null || archived.some((event) => event.observedBy !== normalized.character)) {
      throw new Error(`Source log listener does not match archived character: ${sourceFile}`);
    }
    if (archived.some((event) => lines[event.sourceLine - 1] !== event.raw)) {
      throw new Error(`Source log no longer matches archived evidence (changed or truncated): ${sourceFile}`);
    }
    neuts.push(...normalized.events.filter((event) => event.kind === 'neut-received' && isInWindow(event, summary.window)));
  }
  return neuts;
}

function describeOutcome(outcome: BackfillOutcome): string {
  switch (outcome.status) {
    case 'ready': return `Would backfill run ${outcome.id}: ${outcome.eventCount} neut event(s). No files changed.`;
    case 'backfilled': return `Backfilled run ${outcome.id}: ${outcome.eventCount} neut event(s).`;
    case 'backfilled-with-warning': return `Backfilled run ${outcome.id}: ${outcome.eventCount} neut event(s), but follow-up generation failed: ${outcome.reason}`;
    case 'already-recorded': return `Run ${outcome.id} already has recorded neut evidence; skipped.`;
    case 'not-found': return `Run ${outcome.id} was not found.`;
    case 'error':
    case 'incompatible': return `Run ${outcome.id} was not backfilled: ${outcome.reason}`;
  }
}
