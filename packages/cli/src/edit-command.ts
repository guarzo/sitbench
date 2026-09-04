import {
  Archive,
  ArchiveLockedError,
  CatalogRebuildError,
  DuplicateRunError,
  RunNotFoundError,
  canonicalKey,
  type CalculationSettings,
  type CharacterMetrics,
  type FleetProfile,
  type NormalizedEvent,
  type RunMetrics,
  type RunSummary,
  type RunWindow,
} from '@sitbench/core';
import { defaultArchiveDir } from './paths.js';
import {
  METRICS_VERSION,
  isInWindow,
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
  fingerprint: string;
}

/**
 * Thrown by the `Archive.updateRun` updater when the archived run's
 * `updatedAt` no longer matches the snapshot this edit loaded before
 * prompting. This is an optimistic-concurrency guard: a concurrent process
 * (another `edit`, or `recalculate`) may have mutated this exact run while
 * this edit's user was answering prompts. It is thrown from inside the
 * updater (never via a direct JSON write) so `Archive.updateRun`'s own lock
 * and atomic-replace guarantees are what actually prevent the overwrite;
 * this error only decides whether the replacement is offered at all.
 */
class EditConflictError extends Error {}

/**
 * Loads an existing run, prompts for its durable metadata (site, fleet
 * profile, notes, confirmed window), and — only after explicit confirmation
 * — rewrites it through `Archive.updateRun`. Changing only site, profile, or
 * notes never touches metrics, coverage, `metricsVersion`, or the
 * fingerprint. Changing the confirmed window is only accepted when the
 * adjusted window still contains qualifying outgoing NPC damage among the
 * archived events; a qualifying window change recomputes metrics from those
 * archived events (the full archived event stream is always preserved —
 * only the *metrics/fingerprint computation* is windowed, never what gets
 * persisted) using the run's recorded calculation thresholds, marks
 * `window.manuallyAdjusted: true`, and recomputes the window-dependent
 * fingerprint. Coverage is ingestion provenance and is never recomputed by
 * an edit. If the run was mutated by another process after this edit loaded
 * it, the update is rejected as a conflict rather than silently overwriting
 * that concurrent change. A newly entered fleet profile is persisted via
 * `Archive.upsertProfile` only once the edit is confirmed and successfully
 * written.
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
  const loadedUpdatedAt = current.updatedAt;

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
    if (!events.some((event) => isInWindow(event, candidateWindow) && isQualifyingNpcDamage(event))) {
      return fatal(write, 'The adjusted window contains no qualifying outgoing NPC damage.', 'no-qualifying-damage');
    }
    // The full archived event stream (`events`) is handed to core alongside
    // the new window; core filters internally. Nothing narrower than the
    // complete archived stream is ever computed from or persisted here.
    const fields = recalculateFields(candidateWindow, events, current.calculation);
    window = candidateWindow;
    recalculated = {
      calculation: fields.calculation,
      metrics: fields.metrics,
      characterMetrics: fields.characterMetrics,
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
          metricsVersion: METRICS_VERSION,
          fingerprint: recalculated.fingerprint,
        }),
  };

  if (!(await dependencies.prompts.confirmSave(pending))) {
    write('Edit cancelled before saving.');
    return { status: 'cancelled' };
  }

  let catalogWarning: string | null = null;
  try {
    await archive.updateRun(runId, ({ summary: latest, events: latestEvents }) => {
      if (latest.updatedAt !== loadedUpdatedAt) {
        throw new EditConflictError(
          `Run "${runId}" was modified by another process after this edit began; the concurrent change was not overwritten.`,
        );
      }
      return { summary: pending, events: latestEvents };
    });
  } catch (error) {
    if (error instanceof EditConflictError) {
      return fatal(write, error.message, 'conflict');
    }
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
      catalogWarning = error.message;
    } else if (isSchemaValidationError(error)) {
      return fatal(
        write,
        `Run "${runId}" cannot be edited: archived events do not satisfy the current schema.`,
        'incompatible',
      );
    } else {
      return fatal(write, `Run was not updated: ${message(error)}`, 'archive');
    }
  }

  // Derivative generation: each attempted independently.
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

  if (derivativeWarnings.length > 0) {
    if (derivativeWarnings.length === 1 && catalogWarning !== null) {
      write(`Run ${runId} was updated, but its catalog could not be rebuilt: ${catalogWarning}`);
      return { status: 'updated-with-warning', id: runId, reason: 'catalog' };
    }
    write(`Run ${runId} was updated, but follow-up generation failed: ${derivativeWarnings.join('; ')}`);
    return { status: 'updated-with-warning', id: runId, reason: 'post-save' };
  }

  write(`Updated run ${runId}.`);
  return { status: 'updated', id: runId };
}

async function rebuildCatalogNoop(): Promise<void> {
  // Archive.updateRun already rebuilds catalog.json. Dashboard regeneration
  // is wired through the rebuildCatalog dependency.
}

function fatal(write: (line: string) => void, text: string, reason: string): EditResult {
  write(`Error: ${text}`);
  return { status: 'fatal', reason };
}
