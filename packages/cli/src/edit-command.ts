import {
  Archive,
  ArchiveLockedError,
  CatalogRebuildError,
  DuplicateRunError,
  RunNotFoundError,
  canonicalKey,
  type CalculationSettings,
  type CharacterMetrics,
  type Coverage,
  type FleetProfile,
  type NormalizedEvent,
  type RunMetrics,
  type RunSummary,
  type RunWindow,
} from '@sitbench/core';
import { defaultArchiveDir } from './paths.js';
import {
  METRICS_VERSION,
  isQualifyingNpcDamage,
  isSchemaValidationError,
  isValidWindow,
  message,
  recalculateFields,
} from './recalculate-command.js';

export interface EditArguments {
  runId: string;
  archive?: string;
}

export type WindowEditChoice = { action: 'keep' } | { action: 'adjust'; start: string; end: string };

export interface EditPrompts {
  requestSite(current: string): Promise<string>;
  requestProfile(profiles: FleetProfile[], current: string): Promise<string>;
  requestNotes(current: string | null): Promise<string | null>;
  requestWindow(current: RunWindow): Promise<WindowEditChoice>;
  confirmSave(pending: RunSummary): Promise<boolean>;
}

export interface EditDependencies {
  prompts: EditPrompts;
  write?: (line: string) => void;
  createArchive?: (directory: string) => Archive;
  rebuildCatalog?: (archive: Archive) => Promise<void>;
}

export type EditResult =
  | { status: 'updated'; id: string }
  | { status: 'updated-with-warning'; id: string; reason: string }
  | { status: 'cancelled' }
  | { status: 'fatal'; reason: string };

interface RecalculatedFieldsForEdit {
  calculation: CalculationSettings;
  metrics: RunMetrics;
  characterMetrics: CharacterMetrics[];
  coverage: Coverage;
  fingerprint: string;
}

/**
 * Loads an existing run, prompts for its durable metadata (site, fleet
 * profile, notes, confirmed window), and — only after explicit confirmation
 * — rewrites it through `Archive.updateRun`. Changing only site, profile, or
 * notes never touches metrics, coverage, `metricsVersion`, or the
 * fingerprint. Changing the confirmed window is only accepted when the
 * adjusted window still contains qualifying outgoing NPC damage among the
 * archived events; a qualifying window change recomputes metrics/coverage
 * from those archived events using the run's recorded calculation
 * thresholds, marks `window.manuallyAdjusted: true`, and recomputes the
 * window-dependent fingerprint.
 */
export async function runEdit(arguments_: EditArguments, dependencies: EditDependencies): Promise<EditResult> {
  const write = dependencies.write ?? console.log;
  const runId = arguments_.runId.trim();
  if (runId.length === 0) {
    return fatal(write, 'A run id is required.', 'run-id');
  }

  const archiveDirectory = arguments_.archive ?? defaultArchiveDir();
  const archive = (dependencies.createArchive ?? ((directory) => new Archive(directory)))(archiveDirectory);

  let loaded: { summary: RunSummary; events: NormalizedEvent[] } | null;
  try {
    loaded = await archive.loadRun(runId);
  } catch (error) {
    if (isSchemaValidationError(error)) {
      return fatal(
        write,
        `Run "${runId}" cannot be edited: archived events do not satisfy the current schema.`,
        'incompatible',
      );
    }
    if (error instanceof ArchiveLockedError) {
      return fatal(write, `Run was not edited because the archive is locked. ${error.message}`, 'locked');
    }
    return fatal(write, `Cannot load run: ${message(error)}`, 'archive');
  }
  if (loaded === null) {
    return fatal(write, `Run "${runId}" was not found.`, 'not-found');
  }
  const { summary: current, events } = loaded;

  let profiles: FleetProfile[];
  try {
    profiles = await archive.loadProfiles();
  } catch (error) {
    return fatal(write, `Cannot load fleet profiles: ${message(error)}`, 'profiles');
  }

  const siteName = (await dependencies.prompts.requestSite(current.site.name)).trim();
  if (siteName.length === 0) {
    return fatal(write, 'A non-empty site name is required.', 'site');
  }
  const profileName = (await dependencies.prompts.requestProfile(profiles, current.fleetProfile.name)).trim();
  if (profileName.length === 0) {
    return fatal(write, 'A non-empty fleet profile is required.', 'profile');
  }
  const notes = (await dependencies.prompts.requestNotes(current.notes))?.trim() || null;
  const windowChoice = await dependencies.prompts.requestWindow(current.window);

  let window = current.window;
  let finalEvents = events;
  let recalculated: RecalculatedFieldsForEdit | null = null;

  if (windowChoice.action === 'adjust') {
    const candidateWindow: RunWindow = {
      start: windowChoice.start,
      end: windowChoice.end,
      source: 'manually-adjusted',
      manuallyAdjusted: true,
    };
    if (!isValidWindow(candidateWindow)) {
      return fatal(
        write,
        'The adjusted window must have valid timestamps with an end after its start.',
        'invalid-window',
      );
    }
    const fields = recalculateFields(candidateWindow, events, current.calculation, current.coverage);
    if (!fields.events.some(isQualifyingNpcDamage)) {
      return fatal(write, 'The adjusted window contains no qualifying outgoing NPC damage.', 'no-qualifying-damage');
    }
    window = candidateWindow;
    finalEvents = fields.events;
    recalculated = {
      calculation: fields.calculation,
      metrics: fields.metrics,
      characterMetrics: fields.characterMetrics,
      coverage: fields.coverage,
      fingerprint: fields.fingerprint,
    };
  }

  const siteKey = canonicalKey(siteName);
  const profileId = canonicalKey(profileName);
  const pending: RunSummary = {
    ...current,
    site: { name: siteName, key: siteKey },
    fleetProfile: { id: profileId, name: profileName },
    notes,
    window,
    ...(recalculated === null
      ? {}
      : {
          calculation: recalculated.calculation,
          metrics: recalculated.metrics,
          characterMetrics: recalculated.characterMetrics,
          participants: recalculated.characterMetrics.map((metric) => metric.character),
          coverage: recalculated.coverage,
          metricsVersion: METRICS_VERSION,
          fingerprint: recalculated.fingerprint,
        }),
  };

  if (!(await dependencies.prompts.confirmSave(pending))) {
    write('Edit cancelled before saving.');
    return { status: 'cancelled' };
  }

  try {
    await archive.updateRun(runId, () => ({ summary: pending, events: finalEvents }));
  } catch (error) {
    if (error instanceof RunNotFoundError) {
      return fatal(write, `Run "${runId}" was not found.`, 'not-found');
    }
    if (error instanceof DuplicateRunError) {
      return fatal(write, `Run was not updated: ${error.message}`, 'duplicate');
    }
    if (error instanceof ArchiveLockedError) {
      return fatal(write, `Run was not updated because the archive is locked. ${error.message}`, 'locked');
    }
    if (error instanceof CatalogRebuildError) {
      write(`Run ${runId} was updated, but its catalog could not be rebuilt: ${error.message}`);
      return { status: 'updated-with-warning', id: runId, reason: 'catalog' };
    }
    if (isSchemaValidationError(error)) {
      return fatal(
        write,
        `Run "${runId}" cannot be edited: archived events do not satisfy the current schema.`,
        'incompatible',
      );
    }
    return fatal(write, `Run was not updated: ${message(error)}`, 'archive');
  }

  await (dependencies.rebuildCatalog ?? rebuildCatalogNoop)(archive);
  write(`Updated run ${runId}.`);
  return { status: 'updated', id: runId };
}

async function rebuildCatalogNoop(): Promise<void> {
  // Archive.updateRun already rebuilds catalog.json. Same Task 7
  // dashboard-export extension point `analyze`/`recalculate` use.
}

function fatal(write: (line: string) => void, text: string, reason: string): EditResult {
  write(`Error: ${text}`);
  return { status: 'fatal', reason };
}
