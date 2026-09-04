import { describe, expect, it } from 'vitest';
import { buildLocalDashboardDataset } from '../src/export.js';
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
