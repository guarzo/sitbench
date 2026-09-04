import { describe, expect, it } from 'vitest';
import {
  buildLocalDashboardDataset,
  buildPublicDashboardDataset,
  LocalDashboardDatasetSchema,
  PublicDashboardDatasetSchema,
  DashboardDatasetSchema,
} from '../src/export.js';
import type { RunSummary } from '../src/schemas.js';

let idCounter = 0;

function buildRun(overrides: Partial<RunSummary> & { windowStart: string }): RunSummary {
  idCounter += 1;
  const { windowStart, ...rest } = overrides;
  const windowEnd = new Date(Date.parse(windowStart) + 600_000).toISOString();
  return {
    schemaVersion: 1,
    parserVersion: '0.1.0',
    metricsVersion: '0.1.0',
    id: `run-${idCounter}`,
    site: { name: 'Core Bastion', key: 'core-bastion' },
    fleetProfile: { id: '8-kikis-2-deacons', name: '8 Kikis + 2 Deacons' },
    window: {
      start: windowStart,
      end: windowEnd,
      source: 'outgoing-npc-damage',
      manuallyAdjusted: false,
    },
    participants: ['Alpha', 'Bravo'],
    calculation: { episodeThresholdSeconds: 180, activeCombatGapSeconds: 30 },
    metrics: {
      elapsedSeconds: 600,
      activeCombatSeconds: 540,
      idleSeconds: 60,
      fleetDamageDealt: 120000,
      averageFleetDps: 200,
      activeFleetDps: 222.2,
      damageTaken: 30000,
      remoteRepairDelivered: 5000,
      participantCount: 2,
    },
    characterMetrics: [
      {
        character: 'Alpha',
        damageDealt: 70000,
        fleetDamageShare: 0.583,
        averageDps: 116.7,
        activeDps: 129.6,
        damageTaken: 20000,
        remoteRepairDelivered: 3000,
        remoteRepairReceived: 2000,
        shotsHit: 150,
        shotsMissed: 10,
        missRate: 0.0625,
        hitQualityCounts: { Wrecking: 5 },
        firstRelevantEvent: windowStart,
        lastRelevantEvent: windowEnd,
      },
      {
        character: 'Bravo',
        damageDealt: 50000,
        fleetDamageShare: 0.417,
        averageDps: 83.3,
        activeDps: 92.6,
        damageTaken: 10000,
        remoteRepairDelivered: 2000,
        remoteRepairReceived: 3000,
        shotsHit: 120,
        shotsMissed: 5,
        missRate: 0.04,
        hitQualityCounts: {},
        firstRelevantEvent: windowStart,
        lastRelevantEvent: windowEnd,
      },
    ],
    coverage: {
      logFiles: 2,
      participantsWithOutgoingDamage: 2,
      unparsedCombatLines: 0,
      ambiguousEventsExcluded: 0,
      repairPairing: 'full',
    },
    notes: 'Smooth run, no incidents.',
    fingerprint: `fp-${idCounter}`,
    createdAt: windowStart,
    updatedAt: windowStart,
    ...rest,
  };
}

describe('buildLocalDashboardDataset', () => {
  it('returns mode "local" with full capabilities', () => {
    const runs = [buildRun({ windowStart: '2026-09-01T10:00:00.000Z' })];
    const dataset = buildLocalDashboardDataset(runs);

    expect(dataset.mode).toBe('local');
    expect(dataset.schemaVersion).toBe(1);
    expect(dataset.capabilities).toEqual({ characters: true, notes: true });
    expect(typeof dataset.generatedAt).toBe('string');
  });

  it('uses the injected generatedAt when provided', () => {
    const runs = [buildRun({ windowStart: '2026-09-01T10:00:00.000Z' })];
    const dataset = buildLocalDashboardDataset(runs, { generatedAt: '2026-09-05T00:00:00.000Z' });
    expect(dataset.generatedAt).toBe('2026-09-05T00:00:00.000Z');
  });

  it('includes complete run summaries needed for filters, detail, and comparison', () => {
    const run = buildRun({ windowStart: '2026-09-02T10:00:00.000Z' });
    const dataset = buildLocalDashboardDataset([run]);

    expect(dataset.runs).toHaveLength(1);
    const included = dataset.runs[0]!;
    expect(included.id).toBe(run.id);
    expect(included.site).toEqual(run.site);
    expect(included.fleetProfile).toEqual(run.fleetProfile);
    expect(included.window).toEqual(run.window);
    expect(included.metrics).toEqual(run.metrics);
    expect(included.characterMetrics).toEqual(run.characterMetrics);
    expect(included.participants).toEqual(run.participants);
    expect(included.coverage).toEqual(run.coverage);
    expect(included.notes).toBe(run.notes);
  });

  it('sorts runs ascending by window start timestamp', () => {
    const earlier = buildRun({ windowStart: '2026-09-01T10:00:00.000Z' });
    const later = buildRun({ windowStart: '2026-09-02T10:00:00.000Z' });
    // Pass in reverse order
    const dataset = buildLocalDashboardDataset([later, earlier]);

    expect(dataset.runs[0]!.id).toBe(earlier.id);
    expect(dataset.runs[1]!.id).toBe(later.id);
  });

  it('breaks equal window.start ties by run id for stable ordering', () => {
    const runB = buildRun({ windowStart: '2026-09-01T10:00:00.000Z', id: 'run-b' });
    const runA = buildRun({ windowStart: '2026-09-01T10:00:00.000Z', id: 'run-a' });
    const dataset = buildLocalDashboardDataset([runB, runA]);

    expect(dataset.runs[0]!.id).toBe('run-a');
    expect(dataset.runs[1]!.id).toBe('run-b');
  });

  it('returns an empty runs array when given no runs', () => {
    const dataset = buildLocalDashboardDataset([]);
    expect(dataset.runs).toEqual([]);
    expect(dataset.mode).toBe('local');
  });

  it('does not leak raw event fields or source-file fields onto runs', () => {
    const run = buildRun({ windowStart: '2026-09-01T10:00:00.000Z' });
    const dataset = buildLocalDashboardDataset([run]);
    const serialized = JSON.stringify(dataset);

    // These are fields from NormalizedEvent that should never appear
    expect(serialized).not.toContain('"sourceFile"');
    expect(serialized).not.toContain('"sourceLine"');
    expect(serialized).not.toContain('"raw"');
    expect(serialized).not.toContain('"observedBy"');
    expect(serialized).not.toContain('"targetClassification"');
  });

  it('accepts only RunSummary objects and preserves their identity', () => {
    const runA = buildRun({
      windowStart: '2026-09-01T10:00:00.000Z',
      site: { name: 'Site A', key: 'site-a' },
    });
    const runB = buildRun({
      windowStart: '2026-09-01T11:00:00.000Z',
      site: { name: 'Site B', key: 'site-b' },
    });
    const dataset = buildLocalDashboardDataset([runA, runB]);

    expect(dataset.runs).toHaveLength(2);
    expect(dataset.runs[0]!.site.key).toBe('site-a');
    expect(dataset.runs[1]!.site.key).toBe('site-b');
  });
});

describe('Zod dataset schemas', () => {
  it('LocalDashboardDatasetSchema rejects unknown top-level keys', () => {
    const base = buildLocalDashboardDataset([buildRun({ windowStart: '2026-09-01T10:00:00.000Z' })]);
    const withExtra = { ...base, extraTopLevel: true };
    const result = LocalDashboardDatasetSchema.safeParse(withExtra);
    expect(result.success).toBe(false);
  });

  it('LocalDashboardDatasetSchema rejects unknown keys in nested run objects', () => {
    const base = buildLocalDashboardDataset([buildRun({ windowStart: '2026-09-01T10:00:00.000Z' })]);
    const corrupted = { ...base, runs: [{ ...base.runs[0], unknownNestedField: 42 }] };
    const result = LocalDashboardDatasetSchema.safeParse(corrupted);
    expect(result.success).toBe(false);
  });

  it('LocalDashboardDatasetSchema accepts output of buildLocalDashboardDataset', () => {
    const dataset = buildLocalDashboardDataset([buildRun({ windowStart: '2026-09-01T10:00:00.000Z' })]);
    const result = LocalDashboardDatasetSchema.safeParse(dataset);
    expect(result.success).toBe(true);
  });

  it('PublicDashboardDatasetSchema requires comparisonOrder on runs', () => {
    const result = PublicDashboardDatasetSchema.safeParse({
      schemaVersion: 1,
      mode: 'public',
      generatedAt: '2026-09-01T10:00:00.000Z',
      capabilities: { characters: false, notes: false },
      runs: [{
        id: 'run-1',
        site: { name: 'S', key: 's' },
        fleetProfile: { id: 'p', name: 'P' },
        window: { start: '2026-09-01T10:00:00.000Z', end: '2026-09-01T10:10:00.000Z', source: 'test', manuallyAdjusted: false },
        calculation: { episodeThresholdSeconds: 180, activeCombatGapSeconds: 30 },
        metrics: { elapsedSeconds: 600, activeCombatSeconds: 540, idleSeconds: 60, fleetDamageDealt: 120000, averageFleetDps: 200, activeFleetDps: 222, damageTaken: 0, remoteRepairDelivered: 0, participantCount: 1 },
        coverage: { logFiles: 1, participantsWithOutgoingDamage: 1, unparsedCombatLines: 0, ambiguousEventsExcluded: 0, repairPairing: 'full' },
        // missing comparisonOrder
      }],
    });
    expect(result.success).toBe(false);
  });

  it('DashboardDatasetSchema discriminates local vs public by mode', () => {
    const localData = buildLocalDashboardDataset([buildRun({ windowStart: '2026-09-01T10:00:00.000Z' })]);
    const localResult = DashboardDatasetSchema.safeParse(localData);
    expect(localResult.success).toBe(true);
    if (localResult.success) expect(localResult.data.mode).toBe('local');
  });
});

describe('buildPublicDashboardDataset', () => {
  it('defaults to mode "public" with both capabilities false and excludes character/notes fields', () => {
    const run = buildRun({ windowStart: '2026-09-01T10:00:00.000Z' });
    const dataset = buildPublicDashboardDataset([run]);

    expect(dataset.mode).toBe('public');
    expect(dataset.schemaVersion).toBe(1);
    expect(dataset.capabilities).toEqual({ characters: false, notes: false });
    expect(dataset.runs).toHaveLength(1);

    const published = dataset.runs[0]!;
    expect(published.id).toBe(run.id);
    expect(published.site).toEqual(run.site);
    expect(published.fleetProfile).toEqual(run.fleetProfile);
    expect(published.window).toEqual(run.window);
    expect(published.calculation).toEqual(run.calculation);
    expect(published.metrics).toEqual(run.metrics);
    expect(published.coverage).toEqual(run.coverage);
    expect(published.comparisonOrder).toBe(0);
    expect(published).not.toHaveProperty('participants');
    expect(published).not.toHaveProperty('characterMetrics');
    expect(published).not.toHaveProperty('notes');

    const serializedRuns = JSON.stringify(dataset.runs);
    expect(serializedRuns).not.toContain('"participants"');
    expect(serializedRuns).not.toContain('"characterMetrics"');
    expect(serializedRuns).not.toContain('"notes"');
  });

  it('includeCharacters restores participants and characterMetrics and sets only the characters capability', () => {
    const run = buildRun({ windowStart: '2026-09-01T10:00:00.000Z' });
    const dataset = buildPublicDashboardDataset([run], { includeCharacters: true });

    expect(dataset.capabilities).toEqual({ characters: true, notes: false });
    const published = dataset.runs[0]!;
    expect(published.participants).toEqual(run.participants);
    expect(published.characterMetrics).toEqual(run.characterMetrics);
    expect(published).not.toHaveProperty('notes');
  });

  it('includeNotes restores notes (including null) and sets only the notes capability', () => {
    const run = buildRun({ windowStart: '2026-09-01T10:00:00.000Z' });
    const dataset = buildPublicDashboardDataset([run], { includeNotes: true });

    expect(dataset.capabilities).toEqual({ characters: false, notes: true });
    const published = dataset.runs[0]!;
    expect(published.notes).toBe(run.notes);
    expect(published).not.toHaveProperty('participants');
    expect(published).not.toHaveProperty('characterMetrics');

    const runWithNullNotes = buildRun({ windowStart: '2026-09-02T10:00:00.000Z', notes: null });
    const withNull = buildPublicDashboardDataset([runWithNullNotes], { includeNotes: true });
    expect(withNull.runs[0]!.notes).toBeNull();
  });

  it('enabling both restores both groups and sets both capability flags', () => {
    const run = buildRun({ windowStart: '2026-09-01T10:00:00.000Z' });
    const dataset = buildPublicDashboardDataset([run], { includeCharacters: true, includeNotes: true });

    expect(dataset.capabilities).toEqual({ characters: true, notes: true });
    const published = dataset.runs[0]!;
    expect(published.participants).toEqual(run.participants);
    expect(published.characterMetrics).toEqual(run.characterMetrics);
    expect(published.notes).toBe(run.notes);
  });

  it.each([
    [{}],
    [{ includeCharacters: true }],
    [{ includeNotes: true }],
    [{ includeCharacters: true, includeNotes: true }],
  ])('excludes raw events, local paths, fingerprint, and creation/update metadata for options %#', (options) => {
    const run = buildRun({ windowStart: '2026-09-01T10:00:00.000Z' });
    const dataset = buildPublicDashboardDataset([run], options);
    const serialized = JSON.stringify(dataset);

    expect(serialized).not.toContain('"fingerprint"');
    expect(serialized).not.toContain('"createdAt"');
    expect(serialized).not.toContain('"updatedAt"');
    expect(serialized).not.toContain('"sourceFile"');
    expect(serialized).not.toContain('"sourceLine"');
    expect(serialized).not.toContain('"raw"');
    expect(serialized).not.toContain('"observedBy"');

    const validation = PublicDashboardDatasetSchema.safeParse(dataset);
    expect(validation.success).toBe(true);
  });

  it('assigns comparisonOrder within each exact (site.key, fleetProfile.id) group by (createdAt, id) chronology, independent of payload order', () => {
    const siteA = { name: 'Site A', key: 'site-a' };
    const siteB = { name: 'Site B', key: 'site-b' };
    const profile = { id: '8-kikis-2-deacons', name: '8 Kikis + 2 Deacons' };

    // Payload order deliberately scrambled and inverted relative to createdAt.
    const aOldest = buildRun({ windowStart: '2026-09-03T10:00:00.000Z', site: siteA, fleetProfile: profile, id: 'a-oldest', createdAt: '2026-09-01T00:00:00.000Z' });
    const aMiddle = buildRun({ windowStart: '2026-09-01T10:00:00.000Z', site: siteA, fleetProfile: profile, id: 'a-middle', createdAt: '2026-09-02T00:00:00.000Z' });
    const aNewest = buildRun({ windowStart: '2026-09-02T10:00:00.000Z', site: siteA, fleetProfile: profile, id: 'a-newest', createdAt: '2026-09-03T00:00:00.000Z' });
    const bOnly = buildRun({ windowStart: '2026-09-01T09:00:00.000Z', site: siteB, fleetProfile: profile, id: 'b-only', createdAt: '2026-09-01T00:00:00.000Z' });

    const dataset = buildPublicDashboardDataset([aNewest, bOnly, aOldest, aMiddle]);
    const byId = new Map(dataset.runs.map((run) => [run.id, run.comparisonOrder]));

    // Group A ordered by createdAt regardless of payload order.
    expect(byId.get('a-oldest')).toBe(0);
    expect(byId.get('a-middle')).toBe(1);
    expect(byId.get('a-newest')).toBe(2);
    // Group B is independent and also starts at 0.
    expect(byId.get('b-only')).toBe(0);
  });

  it('breaks equal createdAt ties within a group by run id', () => {
    const site = { name: 'Site', key: 'site' };
    const profile = { id: 'profile', name: 'Profile' };
    const runB = buildRun({ windowStart: '2026-09-01T10:00:00.000Z', site, fleetProfile: profile, id: 'run-b', createdAt: '2026-09-01T00:00:00.000Z' });
    const runA = buildRun({ windowStart: '2026-09-01T11:00:00.000Z', site, fleetProfile: profile, id: 'run-a', createdAt: '2026-09-01T00:00:00.000Z' });

    const dataset = buildPublicDashboardDataset([runB, runA]);
    const byId = new Map(dataset.runs.map((run) => [run.id, run.comparisonOrder]));

    expect(byId.get('run-a')).toBe(0);
    expect(byId.get('run-b')).toBe(1);
  });

  it('sorts the overall runs array ascending by window.start with an id tiebreak, matching the local builder', () => {
    const later = buildRun({ windowStart: '2026-09-02T10:00:00.000Z' });
    const earlier = buildRun({ windowStart: '2026-09-01T10:00:00.000Z' });
    const dataset = buildPublicDashboardDataset([later, earlier]);

    expect(dataset.runs[0]!.id).toBe(earlier.id);
    expect(dataset.runs[1]!.id).toBe(later.id);
  });

  it('returns an empty runs array when given no runs', () => {
    const dataset = buildPublicDashboardDataset([]);
    expect(dataset.runs).toEqual([]);
    expect(dataset.mode).toBe('public');
  });

  it('uses the injected generatedAt when provided', () => {
    const run = buildRun({ windowStart: '2026-09-01T10:00:00.000Z' });
    const dataset = buildPublicDashboardDataset([run], { generatedAt: '2026-09-05T00:00:00.000Z' });
    expect(dataset.generatedAt).toBe('2026-09-05T00:00:00.000Z');
  });
});
