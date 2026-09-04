import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  Archive,
  ArchiveLockedError,
  CatalogRebuildError,
  DuplicateRunError,
  RunNotFoundError,
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

  it('fails clearly when a lock file is already held by another process, without creating a run', async () => {
    await mkdir(archiveDir, { recursive: true });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path.join(archiveDir, '.lock'), '999999', 'utf8');

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
