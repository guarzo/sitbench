import { randomUUID } from 'node:crypto';
import type { FileHandle } from 'node:fs/promises';
import { mkdir, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import { canonicalKey } from './canonicalize.js';
import {
  CatalogEntrySchema,
  FleetProfileSchema,
  NormalizedEventSchema,
  RUN_ID_PATTERN,
  RunSummarySchema,
  type CatalogEntry,
  type FleetProfile,
  type NormalizedEvent,
  type RunSummary,
} from './schemas.js';

const LOCK_FILE_NAME = '.lock';
const TMP_PREFIX = '.tmp-';

export class DuplicateRunError extends Error {}
export class RunNotFoundError extends Error {}
export class ArchiveLockedError extends Error {}

/** Thrown when a run id is not a single safe path segment (see `RUN_ID_PATTERN`). */
export class InvalidRunIdError extends Error {}

/**
 * Thrown when the authoritative run write succeeds but the derived
 * `catalog.json` rebuild that follows it fails. The durable run remains on
 * disk; callers should surface this error and may retry `rebuildCatalog()`
 * later. The durable run is never deleted to compensate.
 */
export class CatalogRebuildError extends Error {}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

/**
 * Rejects any run id that is not a single safe path segment, independent of
 * whether the caller went through `RunSummarySchema` (e.g. `loadRun`/
 * `updateRun` accept a raw id string directly). This is defense in depth at
 * the archive's path-construction boundary: a value such as
 * `"../../outside-archive"` is rejected before it is ever joined into a
 * filesystem path.
 */
function assertSafeRunId(id: string): void {
  if (!RUN_ID_PATTERN.test(id)) {
    throw new InvalidRunIdError(
      `Run id "${id}" is not a single safe path segment (letters, digits, "-", "_", "." only; must not start with those symbols).`,
    );
  }
}

/**
 * Writes content to a temp file in the same directory, then renames it into
 * place atomically. If any step fails, the temp file is removed in
 * `finally`; the (possibly pre-existing) target path is never touched
 * except by a successful rename.
 */
export async function writeFileAtomic(targetPath: string, content: string): Promise<void> {
  const dir = path.dirname(targetPath);
  await mkdir(dir, { recursive: true });
  const tmpPath = path.join(dir, `${TMP_PREFIX}${randomUUID()}`);
  let renamed = false;
  try {
    const handle = await open(tmpPath, 'w');
    try {
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmpPath, targetPath);
    renamed = true;
  } finally {
    if (!renamed) {
      await rm(tmpPath, { force: true });
    }
  }
}

/** Writes content to a fresh file (caller-owned directory), flushing and closing before returning. */
async function writeFileFlushed(targetPath: string, content: string): Promise<void> {
  const handle = await open(targetPath, 'w');
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function serializeEvents(events: NormalizedEvent[]): string {
  if (events.length === 0) {
    return '';
  }
  return `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;
}

/**
 * Writes `run.json` and `events.jsonl` into a fresh temporary sibling
 * directory under `runsDir`, flushes and closes each file, then renames the
 * temporary directory into `targetDir` atomically. If any step before the
 * rename fails (or the rename itself fails), the temporary directory is
 * removed in `finally`; `targetDir` — including any pre-existing content —
 * is only ever touched by a successful rename, never deleted by this
 * function.
 */
export async function writeRunDirectoryAtomic(
  runsDir: string,
  targetDir: string,
  summary: RunSummary,
  events: NormalizedEvent[],
): Promise<void> {
  await mkdir(runsDir, { recursive: true });
  const tmpDir = path.join(runsDir, `${TMP_PREFIX}${randomUUID()}`);
  let renamed = false;
  try {
    await mkdir(tmpDir, { recursive: true });
    await writeFileFlushed(path.join(tmpDir, 'run.json'), `${JSON.stringify(summary, null, 2)}\n`);
    await writeFileFlushed(path.join(tmpDir, 'events.jsonl'), serializeEvents(events));
    await rename(tmpDir, targetDir);
    renamed = true;
  } finally {
    if (!renamed) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }
}

/**
 * Acquires an archive-local exclusive lock by atomically creating a lock
 * file (`open(..., 'wx')` fails with EEXIST if one already exists). A
 * competing writer fails clearly and immediately rather than spin-waiting or
 * racing; a held lock is never force-broken.
 *
 * The lock file's content is an ownership token (a fresh UUID) unique to
 * this acquisition. The returned release function only removes the lock
 * file if it still contains that exact token — if the lock file was
 * manually removed and then re-created by a different acquisition (e.g. an
 * operator recovering from what they believed was a stale lock, followed by
 * another process legitimately acquiring it), releasing the original
 * acquisition must never delete the replacement lock out from under its
 * new owner.
 *
 * If writing/syncing/closing the lock file's token fails after the file was
 * successfully created, the just-created lock file is removed before
 * rethrowing so a failed acquisition never leaks a lock. `writeLockMetadata`
 * is an injectable seam (defaulting to the real implementation) purely so
 * this failure path can be exercised deterministically in tests; production
 * callers never override it.
 *
 * Callers must release the returned function in a `finally` block.
 */
export async function acquireLock(
  archiveDir: string,
  writeLockMetadata: (handle: FileHandle, token: string) => Promise<void> = async (handle, token) => {
    await handle.writeFile(token, 'utf8');
    await handle.sync();
  },
): Promise<() => Promise<void>> {
  await mkdir(archiveDir, { recursive: true });
  const lockPath = path.join(archiveDir, LOCK_FILE_NAME);
  const token = randomUUID();

  let handle: FileHandle;
  try {
    handle = await open(lockPath, 'wx');
  } catch (error) {
    if (isErrnoException(error) && error.code === 'EEXIST') {
      throw new ArchiveLockedError(
        `Archive at "${archiveDir}" is locked by another process (lock file present at "${lockPath}"). ` +
          'If no other sitbench process is running, remove the lock file manually and retry.',
      );
    }
    throw error;
  }

  try {
    try {
      await writeLockMetadata(handle, token);
    } finally {
      await handle.close();
    }
  } catch (error) {
    // Setup failed after we exclusively created the lock file: we know we
    // own it (no one else could have), so clean it up rather than leak it.
    await rm(lockPath, { force: true });
    throw error;
  }

  return async () => {
    let currentToken: string;
    try {
      currentToken = await readFile(lockPath, 'utf8');
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') {
        return; // Already gone (e.g. manually removed); nothing to clean up.
      }
      throw error;
    }
    if (currentToken === token) {
      await rm(lockPath, { force: true });
    }
    // Else: the lock file has since been replaced by a different owner.
    // Never delete a lock we do not currently own.
  };
}

function toCatalogEntry(summary: RunSummary): CatalogEntry {
  return CatalogEntrySchema.parse({
    id: summary.id,
    siteKey: summary.site.key,
    siteName: summary.site.name,
    fleetProfileId: summary.fleetProfile.id,
    fleetProfileName: summary.fleetProfile.name,
    windowStart: summary.window.start,
    windowEnd: summary.window.end,
    elapsedSeconds: summary.metrics.elapsedSeconds,
    activeCombatSeconds: summary.metrics.activeCombatSeconds,
    participantCount: summary.metrics.participantCount,
    fingerprint: summary.fingerprint,
    createdAt: summary.createdAt,
  });
}

function parseEventsJsonl(raw: string): NormalizedEvent[] {
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => NormalizedEventSchema.parse(JSON.parse(line)));
}

/**
 * Local JSON/JSONL archive of run summaries, normalized events, a rebuildable
 * catalog, and fleet profiles. No database is used; every mutation writes to
 * a temporary sibling path and renames atomically into place. Mutations are
 * serialized with an archive-local exclusive lock (see `acquireLock`) held
 * through the duplicate check, the authoritative write, and the derivative
 * catalog rebuild.
 */
export class Archive {
  constructor(private readonly archiveDir: string) {}

  private runsDir(): string {
    return path.join(this.archiveDir, 'runs');
  }

  private runDir(id: string): string {
    assertSafeRunId(id);
    return path.join(this.runsDir(), id);
  }

  private catalogPath(): string {
    return path.join(this.archiveDir, 'catalog.json');
  }

  private profilesPath(): string {
    return path.join(this.archiveDir, 'profiles.json');
  }

  /** Reads and validates every `runs/<id>/run.json` file. Ignores in-progress `.tmp-*` directories. */
  private async readAllRunSummaries(): Promise<RunSummary[]> {
    const runsDir = this.runsDir();
    if (!(await pathExists(runsDir))) {
      return [];
    }

    const entries = await readdir(runsDir, { withFileTypes: true });
    const summaries: RunSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(TMP_PREFIX)) {
        continue;
      }
      const runJsonPath = path.join(runsDir, entry.name, 'run.json');
      if (!(await pathExists(runJsonPath))) {
        continue;
      }
      const raw = await readFile(runJsonPath, 'utf8');
      summaries.push(RunSummarySchema.parse(JSON.parse(raw)));
    }
    return summaries;
  }

  /** Rebuilds `catalog.json` from validated run summaries. Assumes the caller already holds the lock. */
  private async rebuildCatalogLocked(): Promise<CatalogEntry[]> {
    const summaries = await this.readAllRunSummaries();
    const entries = summaries.map(toCatalogEntry).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    try {
      await writeFileAtomic(this.catalogPath(), `${JSON.stringify(entries, null, 2)}\n`);
    } catch (error) {
      throw new CatalogRebuildError(
        'The run was saved, but rebuilding catalog.json from validated run summaries failed. ' +
          'The run remains authoritative; call rebuildCatalog() to retry.',
        { cause: error },
      );
    }

    return entries;
  }

  /**
   * Validates and persists a new run. Writes into a temporary sibling
   * directory, validates `run.json` against `RunSummarySchema`, flushes and
   * closes every file, then renames the directory into place atomically. If
   * a run with the same id or fingerprint already exists, the save aborts
   * without any partial mutation. On success, `catalog.json` is rebuilt; a
   * rebuild failure is reported via `CatalogRebuildError` without deleting
   * the already-persisted run.
   */
  async saveRun(summary: RunSummary, events: NormalizedEvent[]): Promise<RunSummary> {
    const release = await acquireLock(this.archiveDir);
    try {
      const validatedSummary = RunSummarySchema.parse(summary);
      const validatedEvents = events.map((event) => NormalizedEventSchema.parse(event));

      const targetDir = this.runDir(validatedSummary.id);
      if (await pathExists(targetDir)) {
        throw new DuplicateRunError(`A run with id "${validatedSummary.id}" already exists in the archive.`);
      }

      const existingSummaries = await this.readAllRunSummaries();
      if (existingSummaries.some((run) => run.fingerprint === validatedSummary.fingerprint)) {
        throw new DuplicateRunError(
          `A run with fingerprint "${validatedSummary.fingerprint}" already exists in the archive (id "${
            existingSummaries.find((run) => run.fingerprint === validatedSummary.fingerprint)?.id
          }").`,
        );
      }

      await writeRunDirectoryAtomic(this.runsDir(), targetDir, validatedSummary, validatedEvents);

      await this.rebuildCatalogLocked();

      return validatedSummary;
    } finally {
      await release();
    }
  }

  /**
   * Loads and validates a single run's summary and events without acquiring
   * the archive lock. Used internally by mutation methods that already hold
   * the lock (re-acquiring it would self-deadlock against a plain
   * create-exclusive file lock).
   */
  private async loadRunLocked(id: string): Promise<{ summary: RunSummary; events: NormalizedEvent[] } | null> {
    const dir = this.runDir(id);
    if (!(await pathExists(dir))) {
      return null;
    }
    const summaryRaw = await readFile(path.join(dir, 'run.json'), 'utf8');
    const summary = RunSummarySchema.parse(JSON.parse(summaryRaw));

    const eventsPath = path.join(dir, 'events.jsonl');
    const eventsRaw = (await pathExists(eventsPath)) ? await readFile(eventsPath, 'utf8') : '';
    const events = parseEventsJsonl(eventsRaw);

    return { summary, events };
  }

  /**
   * Loads and validates a single run's summary and events. Returns `null` if
   * the run does not exist. A run is stored as two separate files
   * (`run.json` and `events.jsonl`); `updateRun` rewrites them via two
   * separate atomic renames (a true multi-file transaction is not possible
   * with plain filesystem renames). Acquiring the archive lock for the
   * duration of this read prevents observing a "mixed generation" — e.g. the
   * new `run.json` paired with the old `events.jsonl` mid-update. If the
   * archive is currently locked by another operation, this fails clearly
   * with `ArchiveLockedError` rather than silently risking a mixed read; no
   * retry loop is implemented.
   */
  async loadRun(id: string): Promise<{ summary: RunSummary; events: NormalizedEvent[] } | null> {
    const release = await acquireLock(this.archiveDir);
    try {
      return await this.loadRunLocked(id);
    } finally {
      await release();
    }
  }

  /** Returns every validated run summary in the archive (read-only; no lock required). */
  async listRuns(): Promise<RunSummary[]> {
    return this.readAllRunSummaries();
  }

  /** Rebuilds and returns `catalog.json` from validated run summaries. Safe to call for recovery. */
  async rebuildCatalog(): Promise<CatalogEntry[]> {
    const release = await acquireLock(this.archiveDir);
    try {
      return await this.rebuildCatalogLocked();
    } finally {
      await release();
    }
  }

  /**
   * Applies `updater` to an existing run's current summary/events and
   * persists the result. The run id may not change. `createdAt` is
   * preserved from the existing record; `updatedAt` is always refreshed to
   * the current time regardless of what `updater` returns. Each file is
   * rewritten via temp-file-then-rename inside the existing run directory
   * (the directory itself already exists, so it cannot be replaced with a
   * single atomic rename the way a new run can). Rebuilds `catalog.json` on
   * success, following the same reporting behavior as `saveRun`.
   */
  async updateRun(
    id: string,
    updater: (current: {
      summary: RunSummary;
      events: NormalizedEvent[];
    }) => { summary: RunSummary; events: NormalizedEvent[] },
  ): Promise<RunSummary> {
    const release = await acquireLock(this.archiveDir);
    try {
      const dir = this.runDir(id);
      if (!(await pathExists(dir))) {
        throw new RunNotFoundError(`Run "${id}" does not exist in the archive.`);
      }

      const current = await this.loadRunLocked(id);
      if (current === null) {
        throw new RunNotFoundError(`Run "${id}" does not exist in the archive.`);
      }

      const updated = updater(current);
      if (updated.summary.id !== id) {
        throw new Error(
          `updateRun must not change the run id (expected "${id}", received "${updated.summary.id}").`,
        );
      }

      const finalSummary = RunSummarySchema.parse({
        ...updated.summary,
        createdAt: current.summary.createdAt,
        updatedAt: new Date().toISOString(),
      });
      const finalEvents = updated.events.map((event) => NormalizedEventSchema.parse(event));

      const otherSummaries = (await this.readAllRunSummaries()).filter((run) => run.id !== id);
      if (otherSummaries.some((run) => run.fingerprint === finalSummary.fingerprint)) {
        throw new DuplicateRunError(
          `Cannot update run "${id}": fingerprint "${finalSummary.fingerprint}" is already used by another run (id "${
            otherSummaries.find((run) => run.fingerprint === finalSummary.fingerprint)?.id
          }").`,
        );
      }

      await writeFileAtomic(path.join(dir, 'run.json'), `${JSON.stringify(finalSummary, null, 2)}\n`);
      await writeFileAtomic(path.join(dir, 'events.jsonl'), serializeEvents(finalEvents));

      await this.rebuildCatalogLocked();

      return finalSummary;
    } finally {
      await release();
    }
  }

  /** Reads and validates `profiles.json`. Returns `[]` if it does not exist yet. */
  async loadProfiles(): Promise<FleetProfile[]> {
    if (!(await pathExists(this.profilesPath()))) {
      return [];
    }
    const raw = await readFile(this.profilesPath(), 'utf8');
    return z.array(FleetProfileSchema).parse(JSON.parse(raw));
  }

  /**
   * Canonicalizes `name` into a stable id (via `canonicalKey`) and inserts
   * or updates the corresponding profile, preserving the exact display name
   * as entered. A later call with the same canonical id updates the stored
   * display name (last-write-wins) rather than silently discarding it.
   */
  async upsertProfile(name: string): Promise<FleetProfile> {
    const release = await acquireLock(this.archiveDir);
    try {
      const profiles = await this.loadProfiles();
      const id = canonicalKey(name);
      const profile = FleetProfileSchema.parse({ id, name });

      const existingIndex = profiles.findIndex((candidate) => candidate.id === id);
      const nextProfiles =
        existingIndex >= 0
          ? profiles.map((candidate, index) => (index === existingIndex ? profile : candidate))
          : [...profiles, profile];

      await writeFileAtomic(this.profilesPath(), `${JSON.stringify(nextProfiles, null, 2)}\n`);
      return profile;
    } finally {
      await release();
    }
  }
}
