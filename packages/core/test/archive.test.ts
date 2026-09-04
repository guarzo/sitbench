import { mkdir, mkdtemp, open, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  Archive,
  ArchiveLockedError,
  CatalogRebuildError,
  DuplicateRunError,
  InvalidRunIdError,
  RunNotFoundError,
  acquireLock,
  writeFileAtomic,
  writeRunDirectoryAtomic,
} from '../src/archive.js';
import type { NormalizedEvent, RunSummary } from '../src/schemas.js';

let archiveDir: string;

beforeEach(async () => {
  archiveDir = await mkdtemp(path.join(tmpdir(), 'sitbench-archive-'));
});

afterEach(async () => {
  await rm(archiveDir, { recursive: true, force: true });
});

function buildEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    kind: 'damage-dealt',
    timestamp: '2026-09-03T04:51:14.000Z',
    observedBy: 'Dah Nee',
    sourceFile: 'Gamelogs_20260903.txt',
    sourceLine: 1,
    raw: 'raw-line',
    actor: 'Dah Nee',
    target: 'Sleepless Guardian',
    amount: 100,
    hitQuality: 'Hits',
    targetClassification: 'npc',
    ...overrides,
  } as NormalizedEvent;
}

function buildSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    schemaVersion: 1,
    parserVersion: '0.1.0',
    metricsVersion: '0.1.0',
    id: '2026-09-03T045114Z-core-bastion',
    site: { name: 'Core Bastion', key: 'core-bastion' },
    fleetProfile: { id: '8-kikis-2-deacons', name: '8 Kikis + 2 Deacons' },
    window: {
      start: '2026-09-03T04:51:14.000Z',
      end: '2026-09-03T05:03:36.000Z',
      source: 'first-and-last-outgoing-npc-damage',
      manuallyAdjusted: false,
    },
    participants: ['Dah Nee'],
    calculation: { episodeThresholdSeconds: 180, activeCombatGapSeconds: 30 },
    metrics: {
      elapsedSeconds: 742,
      activeCombatSeconds: 694,
      idleSeconds: 48,
      fleetDamageDealt: 100,
      averageFleetDps: 0.13,
      activeFleetDps: 0.14,
      damageTaken: 0,
      remoteRepairDelivered: 0,
      participantCount: 1,
    },
    characterMetrics: [],
    coverage: {
      logFiles: 1,
      participantsWithOutgoingDamage: 1,
      unparsedCombatLines: 0,
      ambiguousEventsExcluded: 0,
      repairPairing: 'none',
    },
    notes: null,
    fingerprint: 'fingerprint-abc',
    createdAt: '2026-09-03T05:05:12.000Z',
    updatedAt: '2026-09-03T05:05:12.000Z',
    ...overrides,
  };
}

describe('Archive.saveRun', () => {
  it('creates exactly runs/<id>/run.json, runs/<id>/events.jsonl, and catalog.json', async () => {
    const archive = new Archive(archiveDir);
    const summary = buildSummary();
    await archive.saveRun(summary, [buildEvent()]);

    const runDirEntries = await readdir(path.join(archiveDir, 'runs', summary.id));
    expect(runDirEntries.sort()).toEqual(['events.jsonl', 'run.json']);

    const topLevelEntries = await readdir(archiveDir);
    expect(topLevelEntries).toContain('catalog.json');
    expect(topLevelEntries).toContain('runs');

    const catalog = JSON.parse(await readFile(path.join(archiveDir, 'catalog.json'), 'utf8'));
    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({ id: summary.id, siteKey: 'core-bastion', fleetProfileId: '8-kikis-2-deacons' });
  });

  it('persists the run summary and events such that loadRun round-trips them', async () => {
    const archive = new Archive(archiveDir);
    const summary = buildSummary();
    const events = [buildEvent({ sourceLine: 1 }), buildEvent({ sourceLine: 2, amount: 50 })];
    await archive.saveRun(summary, events);

    const loaded = await archive.loadRun(summary.id);
    expect(loaded).not.toBeNull();
    expect(loaded?.summary).toEqual(summary);
    expect(loaded?.events).toEqual(events);
  });

  it('rejects a duplicate run id without adding a second run', async () => {
    const archive = new Archive(archiveDir);
    const summary = buildSummary();
    await archive.saveRun(summary, [buildEvent()]);

    await expect(archive.saveRun(summary, [buildEvent()])).rejects.toThrow(DuplicateRunError);

    const runs = await archive.listRuns();
    expect(runs).toHaveLength(1);
  });

  it('rejects a duplicate fingerprint under a different run id without adding a second run', async () => {
    const archive = new Archive(archiveDir);
    const first = buildSummary();
    await archive.saveRun(first, [buildEvent()]);

    const second = buildSummary({ id: '2026-09-04T045114Z-core-bastion', fingerprint: first.fingerprint });
    await expect(archive.saveRun(second, [buildEvent()])).rejects.toThrow(DuplicateRunError);

    const runs = await archive.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.id).toBe(first.id);
  });

  it('rejects a run summary that fails schema validation and writes nothing', async () => {
    const archive = new Archive(archiveDir);
    const invalid = { ...buildSummary(), schemaVersion: 2 } as unknown as RunSummary;

    await expect(archive.saveRun(invalid, [buildEvent()])).rejects.toThrow();

    const topLevelEntries = await readdir(archiveDir).catch(() => []);
    expect(topLevelEntries.includes('runs')).toBe(false);
  });

  it('fails clearly when a lock directory is already held by another process, without creating a run', async () => {
    await mkdir(archiveDir, { recursive: true });
    await mkdir(path.join(archiveDir, '.lock'));

    const archive = new Archive(archiveDir);
    await expect(archive.saveRun(buildSummary(), [buildEvent()])).rejects.toThrow(ArchiveLockedError);

    const runsDirExists = await readdir(archiveDir).then((entries) => entries.includes('runs')).catch(() => false);
    expect(runsDirExists).toBe(false);
  });

  it('releases the lock after a successful save so a subsequent save can proceed', async () => {
    const archive = new Archive(archiveDir);
    await archive.saveRun(buildSummary(), [buildEvent()]);

    const second = buildSummary({ id: '2026-09-05T045114Z-core-bastion', fingerprint: 'fingerprint-def' });
    await expect(archive.saveRun(second, [buildEvent()])).resolves.toBeDefined();

    const runs = await archive.listRuns();
    expect(runs).toHaveLength(2);
  });

  it('releases the lock after a failed save (duplicate) so a subsequent independent save can proceed', async () => {
    const archive = new Archive(archiveDir);
    const first = buildSummary();
    await archive.saveRun(first, [buildEvent()]);

    await expect(archive.saveRun(first, [buildEvent()])).rejects.toThrow(DuplicateRunError);

    const second = buildSummary({ id: '2026-09-06T045114Z-core-bastion', fingerprint: 'fingerprint-ghi' });
    await expect(archive.saveRun(second, [buildEvent()])).resolves.toBeDefined();
  });

  it('genuinely concurrent saveRun calls: exactly one wins and the loser fails clearly with no corruption', async () => {
    const archive = new Archive(archiveDir);
    const first = buildSummary({ id: 'run-a', fingerprint: 'fp-a' });
    const second = buildSummary({ id: 'run-b', fingerprint: 'fp-b' });

    const [outcomeOne, outcomeTwo] = await Promise.allSettled([
      archive.saveRun(first, [buildEvent()]),
      archive.saveRun(second, [buildEvent()]),
    ]);

    const outcomes = [outcomeOne, outcomeTwo];
    const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ArchiveLockedError);

    const runs = await archive.listRuns();
    expect(runs).toHaveLength(1);
  });

  it('reports a catalog rebuild failure while keeping the durable run persisted (no rollback)', async () => {
    // Force catalog.json to collide with a directory so the rebuild write fails.
    await mkdir(path.join(archiveDir, 'catalog.json'), { recursive: true });

    const archive = new Archive(archiveDir);
    const summary = buildSummary();
    await expect(archive.saveRun(summary, [buildEvent()])).rejects.toThrow(CatalogRebuildError);

    // The authoritative run must still exist on disk despite the catalog failure.
    const runDirEntries = await readdir(path.join(archiveDir, 'runs', summary.id));
    expect(runDirEntries.sort()).toEqual(['events.jsonl', 'run.json']);

    // Clearing the obstruction and rebuilding later must succeed.
    await rm(path.join(archiveDir, 'catalog.json'), { recursive: true, force: true });
    const entries = await archive.rebuildCatalog();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe(summary.id);
  });

  it('rejects a run id containing a path-traversal segment before touching the filesystem', async () => {
    const archive = new Archive(archiveDir);
    const traversal = buildSummary({ id: '../../outside-archive' });

    await expect(archive.saveRun(traversal, [buildEvent()])).rejects.toThrow();

    const topLevelEntries = await readdir(archiveDir).catch(() => []);
    expect(topLevelEntries.includes('runs')).toBe(false);
  });
});

describe('Archive.loadRun', () => {
  it('fails clearly with ArchiveLockedError when the archive is locked by another process', async () => {
    const archive = new Archive(archiveDir);
    const summary = buildSummary();
    await archive.saveRun(summary, [buildEvent()]);

    // Simulate a concurrent writer holding the lock (guards against a
    // "mixed generation" read — run.json from one update paired with a stale
    // or in-progress events.jsonl).
    await mkdir(path.join(archiveDir, '.lock'));

    await expect(archive.loadRun(summary.id)).rejects.toThrow(ArchiveLockedError);
  });

  it('rejects a path-traversal id before touching the filesystem', async () => {
    const archive = new Archive(archiveDir);
    await expect(archive.loadRun('../../outside-archive')).rejects.toThrow(InvalidRunIdError);
  });
});

describe('Archive.listRuns / rebuildCatalog', () => {
  it('returns an empty list and rebuilds an empty catalog when no runs exist', async () => {
    const archive = new Archive(archiveDir);
    expect(await archive.listRuns()).toEqual([]);
    expect(await archive.rebuildCatalog()).toEqual([]);
  });

  it('rebuilds catalog.json entries from validated run.json files after deletion', async () => {
    const archive = new Archive(archiveDir);
    const summary = buildSummary();
    await archive.saveRun(summary, [buildEvent()]);
    await rm(path.join(archiveDir, 'catalog.json'));

    const entries = await archive.rebuildCatalog();
    expect(entries).toEqual([
      {
        id: summary.id,
        siteKey: 'core-bastion',
        siteName: 'Core Bastion',
        fleetProfileId: '8-kikis-2-deacons',
        fleetProfileName: '8 Kikis + 2 Deacons',
        windowStart: summary.window.start,
        windowEnd: summary.window.end,
        elapsedSeconds: summary.metrics.elapsedSeconds,
        activeCombatSeconds: summary.metrics.activeCombatSeconds,
        participantCount: summary.metrics.participantCount,
        fingerprint: summary.fingerprint,
        createdAt: summary.createdAt,
      },
    ]);
  });
});

describe('Archive.updateRun', () => {
  it('updates a run in place, preserves id/createdAt, and bumps updatedAt', async () => {
    const archive = new Archive(archiveDir);
    const summary = buildSummary();
    await archive.saveRun(summary, [buildEvent()]);

    const updated = await archive.updateRun(summary.id, ({ summary: current, events }) => ({
      summary: { ...current, notes: 'Great run' },
      events,
    }));

    expect(updated.notes).toBe('Great run');
    expect(updated.id).toBe(summary.id);
    expect(updated.createdAt).toBe(summary.createdAt);
    expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(Date.parse(summary.updatedAt));

    const reloaded = await archive.loadRun(summary.id);
    expect(reloaded?.summary.notes).toBe('Great run');
  });

  it('rebuilds the catalog after an update', async () => {
    const archive = new Archive(archiveDir);
    const summary = buildSummary();
    await archive.saveRun(summary, [buildEvent()]);

    await archive.updateRun(summary.id, ({ summary: current, events }) => ({
      summary: { ...current, metrics: { ...current.metrics, elapsedSeconds: 999 } },
      events,
    }));

    const catalog = JSON.parse(await readFile(path.join(archiveDir, 'catalog.json'), 'utf8'));
    expect(catalog[0].elapsedSeconds).toBe(999);
  });

  it('throws RunNotFoundError for a nonexistent run id', async () => {
    const archive = new Archive(archiveDir);
    await expect(
      archive.updateRun('does-not-exist', ({ summary, events }) => ({ summary, events })),
    ).rejects.toThrow(RunNotFoundError);
  });

  it('rejects an updater that changes the run id', async () => {
    const archive = new Archive(archiveDir);
    const summary = buildSummary();
    await archive.saveRun(summary, [buildEvent()]);

    await expect(
      archive.updateRun(summary.id, ({ summary: current, events }) => ({
        summary: { ...current, id: 'different-id' },
        events,
      })),
    ).rejects.toThrow();
  });

  it('rejects a path-traversal id before touching the filesystem', async () => {
    const archive = new Archive(archiveDir);
    await expect(
      archive.updateRun('../../outside-archive', ({ summary, events }) => ({ summary, events })),
    ).rejects.toThrow(InvalidRunIdError);
  });

  it('rejects an update whose new fingerprint collides with a different existing run, leaving both runs unchanged', async () => {
    const archive = new Archive(archiveDir);
    const runA = buildSummary({ id: 'run-a', fingerprint: 'fp-a' });
    const runB = buildSummary({ id: 'run-b', fingerprint: 'fp-b' });
    await archive.saveRun(runA, [buildEvent()]);
    await archive.saveRun(runB, [buildEvent()]);

    await expect(
      archive.updateRun(runB.id, ({ summary: current, events }) => ({
        summary: { ...current, fingerprint: runA.fingerprint },
        events,
      })),
    ).rejects.toThrow(DuplicateRunError);

    const reloadedA = await archive.loadRun(runA.id);
    const reloadedB = await archive.loadRun(runB.id);
    expect(reloadedA?.summary.fingerprint).toBe('fp-a');
    expect(reloadedB?.summary.fingerprint).toBe('fp-b');
  });

  it('allows an update that keeps the same fingerprint it already had (self-match is not a collision)', async () => {
    const archive = new Archive(archiveDir);
    const summary = buildSummary();
    await archive.saveRun(summary, [buildEvent()]);

    const updated = await archive.updateRun(summary.id, ({ summary: current, events }) => ({
      summary: { ...current, notes: 'still the same fingerprint' },
      events,
    }));

    expect(updated.fingerprint).toBe(summary.fingerprint);
  });
});

describe('Archive.loadProfiles / upsertProfile', () => {
  it('returns an empty array when no profiles exist yet', async () => {
    const archive = new Archive(archiveDir);
    expect(await archive.loadProfiles()).toEqual([]);
  });

  it('canonicalizes the id while preserving the original display name', async () => {
    const archive = new Archive(archiveDir);
    const profile = await archive.upsertProfile('8 Kikis + 2 Deacons');

    expect(profile).toEqual({ id: '8-kikis-2-deacons', name: '8 Kikis + 2 Deacons' });
    expect(await archive.loadProfiles()).toEqual([profile]);
  });

  it('updates the stored display name on a subsequent upsert with the same canonical id', async () => {
    const archive = new Archive(archiveDir);
    await archive.upsertProfile('8 Kikis + 2 Deacons');
    const updated = await archive.upsertProfile('8 KIKIS + 2 DEACONS');

    const profiles = await archive.loadProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toEqual(updated);
    expect(updated).toEqual({ id: '8-kikis-2-deacons', name: '8 KIKIS + 2 DEACONS' });
  });

  it('adds a distinct profile for a distinct canonical id', async () => {
    const archive = new Archive(archiveDir);
    await archive.upsertProfile('8 Kikis + 2 Deacons');
    await archive.upsertProfile('Solo Vindicator');

    const profiles = await archive.loadProfiles();
    expect(profiles.map((p) => p.id).sort()).toEqual(['8-kikis-2-deacons', 'solo-vindicator']);
  });
});

describe('writeFileAtomic (temp-file cleanup on failure)', () => {
  it('removes its temp file when the final rename fails, without touching the pre-existing target', async () => {
    const targetPath = path.join(archiveDir, 'target.json');
    // Pre-occupy the target with a directory so renaming a file onto it fails.
    await mkdir(targetPath, { recursive: true });
    await writeFile(path.join(targetPath, 'sentinel.txt'), 'do-not-touch', 'utf8');

    await expect(writeFileAtomic(targetPath, '{}')).rejects.toThrow();

    // The pre-existing target directory and its contents must be untouched.
    const targetEntries = await readdir(targetPath);
    expect(targetEntries).toEqual(['sentinel.txt']);

    // No leftover .tmp-* file anywhere in the archive directory.
    const archiveEntries = await readdir(archiveDir);
    expect(archiveEntries.some((name) => name.startsWith('.tmp-'))).toBe(false);
  });
});

describe('writeRunDirectoryAtomic (temp-directory cleanup on failure)', () => {
  it('removes its temp directory when the final rename fails, without touching the pre-existing target', async () => {
    const runsDir = path.join(archiveDir, 'runs');
    const targetDir = path.join(runsDir, 'existing-run');
    // A non-empty pre-existing target directory makes the final rename fail
    // (renaming a directory onto a non-empty directory is rejected).
    await mkdir(targetDir, { recursive: true });
    await writeFile(path.join(targetDir, 'sentinel.txt'), 'do-not-touch', 'utf8');

    await expect(
      writeRunDirectoryAtomic(runsDir, targetDir, buildSummary(), [buildEvent()]),
    ).rejects.toThrow();

    // The pre-existing target must be untouched.
    const targetEntries = await readdir(targetDir);
    expect(targetEntries).toEqual(['sentinel.txt']);

    // No leftover .tmp-* directory remains inside runs/.
    const runsEntries = await readdir(runsDir);
    expect(runsEntries).toEqual(['existing-run']);
  });
});

describe('acquireLock (lock directory + per-owner marker)', () => {
  it('does not delete a replacement lock created by another owner after the original lock directory was manually removed', async () => {
    const release1 = await acquireLock(archiveDir);

    // An operator (or another process) removes what it believes is a stale
    // lock directory, then a different process legitimately acquires a
    // fresh one.
    await rm(path.join(archiveDir, '.lock'), { recursive: true, force: true });
    const release2 = await acquireLock(archiveDir);

    // While release2 holds the lock, no third acquisition may proceed —
    // "no two owners proceed" at once.
    await expect(acquireLock(archiveDir)).rejects.toThrow(ArchiveLockedError);

    // The original (now-stale) release must NOT delete the replacement's
    // marker or directory.
    await release1();
    const lockDirEntriesAfterStaleRelease = await readdir(path.join(archiveDir, '.lock'));
    expect(lockDirEntriesAfterStaleRelease).toHaveLength(1);

    // The legitimate owner's release still works normally and fully cleans up.
    await release2();
    const lockDirGone = await stat(path.join(archiveDir, '.lock')).then(
      () => false,
      () => true,
    );
    expect(lockDirGone).toBe(true);
  });

  it('does not delete a replacement lock created between a failed marker write and this owner\'s setup-failure cleanup', async () => {
    let replacementRelease: (() => Promise<void>) | undefined;

    const failingMarkerWriteThatRaces = async (markerPath: string): Promise<void> => {
      // Simulate: our marker write is about to fail, but before this
      // acquisition's own cleanup runs, another process notices the
      // (transiently marker-less) directory, decides it is abandoned,
      // removes it, and legitimately re-acquires a fresh lock of its own.
      await rm(path.dirname(markerPath), { recursive: true, force: true });
      replacementRelease = await acquireLock(archiveDir);
      throw new Error('simulated marker-write failure');
    };

    await expect(acquireLock(archiveDir, failingMarkerWriteThatRaces)).rejects.toThrow(
      'simulated marker-write failure',
    );

    // The replacement lock (created by the "other process" simulated above)
    // must still be completely intact: this failed acquisition's cleanup
    // must not have deleted it — "no two owners proceed", but a subsequent
    // acquisition attempt while it's held must still fail, and the
    // replacement's own marker must still be exactly one entry.
    const lockDirEntries = await readdir(path.join(archiveDir, '.lock'));
    expect(lockDirEntries).toHaveLength(1);
    await expect(acquireLock(archiveDir)).rejects.toThrow(ArchiveLockedError);

    // The legitimate replacement owner can still release cleanly.
    await replacementRelease?.();
    const lockDirGone = await stat(path.join(archiveDir, '.lock')).then(
      () => false,
      () => true,
    );
    expect(lockDirGone).toBe(true);
  });

  it('cleans up its own marker and the now-empty directory when the failure occurs after the marker file was actually created (e.g. a post-create sync/close failure)', async () => {
    const writeMarkerThenFailAfterCreatingFile = async (markerPath: string): Promise<void> => {
      // Simulate: the marker file itself was genuinely created on disk, but
      // a later step (e.g. fsync) failed.
      const handle = await open(markerPath, 'wx');
      await handle.close();
      throw new Error('simulated post-create marker failure');
    };

    await expect(acquireLock(archiveDir, writeMarkerThenFailAfterCreatingFile)).rejects.toThrow(
      'simulated post-create marker failure',
    );

    // Because our marker genuinely existed on disk, `unlink` succeeds during
    // cleanup, so the now-empty directory is removed too — nothing leaked.
    const lockDirGoneAfterFailure = await stat(path.join(archiveDir, '.lock')).then(
      () => false,
      () => true,
    );
    expect(lockDirGoneAfterFailure).toBe(true);

    const release = await acquireLock(archiveDir);
    await release();
  });

  it('leaves an empty (but harmless) lock directory behind if the marker write fails before the marker file is ever created — documented safety tradeoff', async () => {
    // If cleanup instead removed the directory unconditionally here, it
    // could just as easily destroy a legitimate replacement's directory in
    // the narrow window described by the two race tests above. Requiring a
    // successful `unlink` of our own marker before ever attempting `rmdir`
    // means this specific edge case (a failure so early that our marker was
    // never created) is left as a stale, empty, manually-recoverable
    // directory instead — the same manual recovery already documented for
    // any stale lock.
    const failBeforeCreatingAnything = async (): Promise<void> => {
      throw new Error('simulated failure before the marker file exists');
    };

    await expect(acquireLock(archiveDir, failBeforeCreatingAnything)).rejects.toThrow(
      'simulated failure before the marker file exists',
    );

    const lockDirEntries = await readdir(path.join(archiveDir, '.lock'));
    expect(lockDirEntries).toEqual([]);
    await expect(acquireLock(archiveDir)).rejects.toThrow(ArchiveLockedError);

    // Manual recovery (as for any stale lock): remove the empty directory,
    // then acquisition succeeds normally again.
    await rm(path.join(archiveDir, '.lock'), { recursive: true, force: true });
    const release = await acquireLock(archiveDir);
    await release();
  });
});
