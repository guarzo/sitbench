import {
  Archive,
  ArchiveLockedError,
  CatalogRebuildError,
  DuplicateRunError,
  calculateRun,
  canonicalKey,
  compareMatchingRuns,
  detectEpisodes,
  fingerprintRun,
  normalizeLogFile,
  type CandidateEpisode,
  type FleetProfile,
  type NormalizedEvent,
  type RunSummary,
  type RunWindow,
} from '@sitbench/core';
import { defaultArchiveDir, loadConfig, resolveGameLogDir, saveConfig, type AnalyzeConfig } from './paths.js';
import { readRecentLogFiles, type LogDiscovery, type LogFile } from './log-discovery.js';
import { isValidWindow } from './recalculate-command.js';

export type { LogFile };

export interface AnalyzeArguments {
  logs?: string;
  archive?: string;
  site?: string;
  profile?: string;
}

export type CandidateChoice =
  | { action: 'accept' }
  | { action: 'adjust'; start: string; end: string }
  | { action: 'select'; index: number }
  | { action: 'cancel' };

export interface AnalyzePrompts {
  confirmCandidate(context: { candidate: CandidateEpisode; candidates: CandidateEpisode[] }): Promise<CandidateChoice>;
  requestSite(initial: string | undefined): Promise<string>;
  requestProfile(profiles: FleetProfile[], initial: string | undefined): Promise<string>;
  requestNotes(): Promise<string | null>;
  confirmSave(summary: RunSummary): Promise<boolean>;
}

export interface AnalyzeDependencies {
  prompts: AnalyzePrompts;
  clock?: () => Date;
  write?: (line: string) => void;
  discoverGameLogDirs?: () => Promise<string[]>;
  readRecentLogFiles?: (directory: string, options: { now: Date }) => Promise<LogDiscovery>;
  createArchive?: (directory: string) => Archive;
  rebuildCatalog?: (archive: Archive) => Promise<void>;
}

export type AnalyzeResult =
  | { status: 'saved'; id: string }
  | { status: 'saved-with-warning'; id: string; reason: string }
  | { status: 'cancelled' }
  | { status: 'fatal'; reason: string };

/**
 * Coordinates filesystem input, user choices, and core APIs. Parsing,
 * episode detection, metric calculation, fingerprinting, and comparisons all
 * remain owned by @sitbench/core.
 */
export async function runAnalyze(
  arguments_: AnalyzeArguments,
  dependencies: AnalyzeDependencies,
): Promise<AnalyzeResult> {
  const write = dependencies.write ?? console.log;
  const archiveDirectory = arguments_.archive ?? defaultArchiveDir();
  let config: AnalyzeConfig;
  try {
    config = await loadConfig(archiveDirectory);
  } catch (error) {
    return fatal(write, `Cannot read config: ${message(error)}`, 'config');
  }

  const logDirectory = await resolveGameLogDir({
    ...(arguments_.logs !== undefined ? { explicitLogs: arguments_.logs } : {}),
    ...(config.gameLogDir !== undefined ? { configuredLogs: config.gameLogDir } : {}),
    ...(dependencies.discoverGameLogDirs !== undefined ? { discover: dependencies.discoverGameLogDirs } : {}),
  });
  if (logDirectory === null || logDirectory.trim() === '') {
    return fatal(write, 'No game log directory was provided, configured, or discovered.', 'logs');
  }

  const clock = dependencies.clock ?? (() => new Date());
  let discovery: LogDiscovery;
  try {
    discovery = await (dependencies.readRecentLogFiles ?? readRecentLogFiles)(logDirectory, { now: clock() });
  } catch (error) {
    return fatal(write, `Cannot inspect game logs: ${message(error)}`, 'logs');
  }
  const logFiles = discovery.files;

  const normalized = logFiles.map((file) => normalizeLogFile({ text: file.text, sourceFile: file.name }));
  const events = normalized
    .flatMap((result) => result.events)
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.sourceFile.localeCompare(right.sourceFile) || left.sourceLine - right.sourceLine);
  const unparsedCombatLines = normalized.reduce((sum, result) => sum + result.counts.unparsedCombatLines, 0);
  const ambiguousEventsExcluded = normalized.reduce((sum, result) => sum + result.counts.ambiguousEventsExcluded, 0);
  const candidates = detectEpisodes(events, { episodeThresholdSeconds: config.episodeThresholdSeconds });
  if (candidates.length === 0) {
    // The no-candidate path is the one place where the classifier's
    // deliberately narrow NPC confidence is most likely to be mistaken for
    // "the fleet dealt no damage", so the same coverage counts the candidate
    // preview shows are reported here too, together with an explicit
    // unsupported-classification note whenever ambiguous targets were seen.
    displayCoverage(write, normalized.length, discovery.skippedFiles, unparsedCombatLines, ambiguousEventsExcluded);
    if (ambiguousEventsExcluded > 0) {
      write(
        'Note: ambiguous events are outgoing damage whose target could not be confirmed as an NPC. They may indicate target names not yet supported by NPC classification rather than meaning no damage was dealt.',
      );
    }
    return fatal(write, 'No confirmed outgoing NPC damage was found in the inspected logs.', 'no-outgoing-npc-damage');
  }

  let candidate = candidates.at(-1);
  if (candidate === undefined) {
    return fatal(write, 'No candidate episode was available.', 'no-candidate');
  }
  displayCandidate(write, candidate, candidates);
  displayCoverage(write, normalized.length, discovery.skippedFiles, unparsedCombatLines, ambiguousEventsExcluded);

  const choice = await dependencies.prompts.confirmCandidate({ candidate, candidates });
  if (choice.action === 'cancel') {
    write('Analysis cancelled before saving.');
    return { status: 'cancelled' };
  }
  if (choice.action === 'select') {
    const selected = candidates[choice.index];
    if (selected === undefined) {
      return fatal(write, 'The selected candidate does not exist.', 'invalid-candidate');
    }
    candidate = selected;
  }

  const window: RunWindow =
    choice.action === 'adjust'
      ? { start: choice.start, end: choice.end, source: 'manually-adjusted', manuallyAdjusted: true }
      : { start: candidate.start, end: candidate.end, source: 'outgoing-npc-damage', manuallyAdjusted: false };
  if (!isValidWindow(window)) {
    return fatal(
      write,
      'The adjusted window must use ISO 8601 timestamps with a UTC offset (for example 2026-09-03T05:00:00Z) and end after its start.',
      'invalid-window',
    );
  }

  const siteName = (arguments_.site ?? (await dependencies.prompts.requestSite(undefined))).trim();
  const siteKey = canonicalKey(siteName);
  if (siteName.length === 0 || siteKey.length === 0) {
    return fatal(write, 'A non-empty site name is required.', 'site');
  }

  const archive = (dependencies.createArchive ?? ((directory) => new Archive(directory)))(archiveDirectory);
  let profiles: FleetProfile[];
  try {
    profiles = await archive.loadProfiles();
  } catch (error) {
    return fatal(write, `Cannot load fleet profiles: ${message(error)}`, 'profiles');
  }
  const profileName = (arguments_.profile ?? (await dependencies.prompts.requestProfile(profiles, undefined))).trim();
  const profileId = canonicalKey(profileName);
  if (profileName.length === 0 || profileId.length === 0) {
    return fatal(write, 'A non-empty fleet profile is required.', 'profile');
  }

  const runEvents = events.filter((event) => isInWindow(event, window));
  const calculated = calculateRun(runEvents, window, {
    episodeThresholdSeconds: config.episodeThresholdSeconds,
    activeCombatGapSeconds: config.activeCombatGapSeconds,
  });
  const now = clock().toISOString();
  const summary: RunSummary = {
    schemaVersion: 1,
    parserVersion: '0.1.0',
    metricsVersion: '0.1.0',
    id: `${runIdTimestamp(now)}-${runIdSiteSegment(siteKey)}`,
    site: { name: siteName, key: siteKey },
    fleetProfile: { id: profileId, name: profileName },
    window,
    participants: calculated.characterMetrics.map((metric) => metric.character),
    calculation: calculated.calculation,
    metrics: calculated.metrics,
    characterMetrics: calculated.characterMetrics,
    coverage: coverageFor(runEvents, normalized.length, unparsedCombatLines, ambiguousEventsExcluded),
    notes: (await dependencies.prompts.requestNotes())?.trim() || null,
    fingerprint: fingerprintRun(runEvents, window),
    createdAt: now,
    updatedAt: now,
  };

  let previousRuns: RunSummary[];
  try {
    previousRuns = await archive.listRuns();
  } catch (error) {
    return fatal(write, `Cannot read archived runs: ${message(error)}`, 'archive');
  }
  const comparison = compareMatchingRuns(summary, previousRuns);
  displayPreview(write, summary, comparison);
  if (summary.window.manuallyAdjusted) {
    write('Warning: window was manually adjusted.');
  }
  if (summary.coverage.participantsWithOutgoingDamage < summary.participants.length) {
    write('Warning: partial participation detected.');
  }

  if (!(await dependencies.prompts.confirmSave(summary))) {
    write('Analysis cancelled before saving.');
    return { status: 'cancelled' };
  }

  let catalogWarning: string | null = null;
  try {
    await archive.saveRun(summary, runEvents);
  } catch (error) {
    if (error instanceof DuplicateRunError) {
      return fatal(write, `Run was not saved: duplicate fingerprint or run id. ${error.message}`, 'duplicate');
    }
    if (error instanceof ArchiveLockedError) {
      return fatal(write, `Run was not saved because the archive is locked. ${error.message}`, 'locked');
    }
    if (error instanceof CatalogRebuildError) {
      // Authoritative mutation succeeded; catalog derivative failed.
      // Continue to attempt dashboard regeneration and other derivatives.
      catalogWarning = error.message;
    } else {
      return fatal(write, `Run was not saved: ${message(error)}`, 'archive');
    }
  }

  // Derivative generation: dashboard data, profile upsert, config save.
  // Each is attempted independently; failures accumulate as warnings.
  const derivativeWarnings: string[] = [];
  if (catalogWarning !== null) derivativeWarnings.push(`catalog: ${catalogWarning}`);

  try {
    await archive.upsertProfile(profileName);
  } catch (error) {
    derivativeWarnings.push(`profile: ${message(error)}`);
  }
  try {
    await (dependencies.rebuildCatalog ?? rebuildCatalogNoop)(archive);
  } catch (error) {
    derivativeWarnings.push(`dashboard: ${message(error)}`);
  }
  try {
    await saveConfig(archiveDirectory, {
      gameLogDir: logDirectory,
      episodeThresholdSeconds: config.episodeThresholdSeconds,
      activeCombatGapSeconds: config.activeCombatGapSeconds,
    });
  } catch (error) {
    derivativeWarnings.push(`config: ${message(error)}`);
  }

  if (derivativeWarnings.length > 0) {
    if (derivativeWarnings.length === 1 && catalogWarning !== null) {
      // Backward-compatible catalog-only message
      write(`Run ${summary.id} was saved, but its catalog could not be rebuilt: ${catalogWarning}`);
      return { status: 'saved-with-warning', id: summary.id, reason: 'catalog' };
    }
    write(`Run ${summary.id} was saved, but follow-up generation failed: ${derivativeWarnings.join('; ')}`);
    return { status: 'saved-with-warning', id: summary.id, reason: 'post-save' };
  }

  write(`Saved run ${summary.id}.`);
  return { status: 'saved', id: summary.id };
}

async function rebuildCatalogNoop(): Promise<void> {
  // Archive.saveRun already rebuilds catalog.json. Dashboard regeneration
  // is wired through the rebuildCatalog dependency.
}

function coverageFor(events: NormalizedEvent[], logFiles: number, unparsedCombatLines: number, ambiguousEventsExcluded: number): RunSummary['coverage'] {
  const participantsWithOutgoingDamage = new Set(
    events.filter((event) => event.kind === 'damage-dealt').map((event) => event.observedBy),
  ).size;
  const repairs = events.filter(
    (event) => event.kind === 'remote-repair-delivered' || event.kind === 'remote-repair-received',
  );
  return {
    logFiles,
    participantsWithOutgoingDamage,
    unparsedCombatLines,
    ambiguousEventsExcluded,
    repairPairing: repairs.length === 0 ? 'none' : 'partial',
  };
}

function displayCandidate(write: (line: string) => void, candidate: CandidateEpisode, candidates: CandidateEpisode[]): void {
  write(`Newest candidate: ${candidate.start} to ${candidate.end} (${candidate.qualifyingEventCount} qualifying events).`);
  write(`Adjacent activity: previous ${candidate.previousQualifyingActivityAt ?? 'none'}; next ${candidate.nextQualifyingActivityAt ?? 'none'}; ${candidates.length} candidate window(s).`);
}

/** Reports the same inspected-input counts on both the candidate and no-candidate paths. */
function displayCoverage(
  write: (line: string) => void,
  logFiles: number,
  skippedFiles: number,
  unparsed: number,
  ambiguous: number,
): void {
  write(
    `Coverage: ${logFiles} log file(s) inspected, ${skippedFiles} skipped as outside the recent-log window or over the file cap, ${unparsed} unparsed combat line(s), ${ambiguous} ambiguous event(s) excluded from qualifying analysis.`,
  );
}

function displayPreview(write: (line: string) => void, summary: RunSummary, comparison: ReturnType<typeof compareMatchingRuns>): void {
  write(`Preview: ${summary.metrics.elapsedSeconds.toFixed(1)}s elapsed, ${summary.metrics.fleetDamageDealt} fleet damage.`);
  if (comparison.previous !== null) {
    write(`Previous run: ${comparison.previous.metrics.elapsedSeconds.toFixed(1)}s`);
  }
  if (comparison.best !== null) {
    write(`Best run: ${comparison.best.metrics.elapsedSeconds.toFixed(1)}s`);
  }
  if (comparison.trailingFiveAverageElapsedSeconds !== null) {
    write(`Trailing five average: ${comparison.trailingFiveAverageElapsedSeconds.toFixed(1)}s`);
  }
}

function isInWindow(event: NormalizedEvent, window: RunWindow): boolean {
  const timestamp = Date.parse(event.timestamp);
  return timestamp >= Date.parse(window.start) && timestamp <= Date.parse(window.end);
}

function runIdTimestamp(isoTimestamp: string): string {
  return isoTimestamp.replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
}

/** Converts a Unicode site key to the ASCII-only run-id segment required by Archive. */
function runIdSiteSegment(siteKey: string): string {
  const ascii = siteKey
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
  return ascii || 'site';
}

function fatal(write: (line: string) => void, text: string, reason: string): AnalyzeResult {
  write(`Error: ${text}`);
  return { status: 'fatal', reason };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
