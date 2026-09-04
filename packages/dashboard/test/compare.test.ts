import { describe, expect, it } from 'vitest';
import { alignCharacterRows, bestRunUpTo, previousRun, trailingFiveAverage, trailingFiveRuns } from '../src/compare.js';
import type { CharacterMetrics } from '@sitbench/core';
import type { DashboardRun } from '../src/data.js';
import type { RunSummary } from '@sitbench/core';

let idCounter = 0;

function buildRun(overrides: { windowStart: string; elapsed?: number }): RunSummary {
  idCounter += 1;
  const windowEnd = new Date(Date.parse(overrides.windowStart) + 600_000).toISOString();
  return {
    schemaVersion: 1,
    parserVersion: '0.1.0',
    metricsVersion: '0.1.0',
    id: `run-${idCounter}`,
    site: { name: 'Core Bastion', key: 'core-bastion' },
    fleetProfile: { id: 'default', name: 'Default' },
    window: { start: overrides.windowStart, end: windowEnd, source: 'outgoing-npc-damage', manuallyAdjusted: false },
    participants: ['Alpha'],
    calculation: { episodeThresholdSeconds: 180, activeCombatGapSeconds: 30 },
    metrics: {
      elapsedSeconds: overrides.elapsed ?? 600,
      activeCombatSeconds: 540,
      idleSeconds: 60,
      fleetDamageDealt: 120000,
      averageFleetDps: 200,
      activeFleetDps: 222,
      damageTaken: 30000,
      remoteRepairDelivered: 5000,
      participantCount: 1,
    },
    characterMetrics: [{
      character: 'Alpha',
      damageDealt: 120000,
      fleetDamageShare: 1,
      averageDps: 200,
      activeDps: 222,
      damageTaken: 30000,
      remoteRepairDelivered: 5000,
      remoteRepairReceived: 0,
      shotsHit: 150,
      shotsMissed: 10,
      missRate: 0.0625,
      hitQualityCounts: {},
      firstRelevantEvent: overrides.windowStart,
      lastRelevantEvent: windowEnd,
    }],
    coverage: { logFiles: 1, participantsWithOutgoingDamage: 1, unparsedCombatLines: 0, ambiguousEventsExcluded: 0, repairPairing: 'full' },
    notes: null,
    fingerprint: `fp-${idCounter}`,
    createdAt: overrides.windowStart,
    updatedAt: overrides.windowStart,
  };
}

function buildCharMetrics(character: string, damageDealt: number): CharacterMetrics {
  return {
    character,
    damageDealt,
    fleetDamageShare: 0.5,
    averageDps: 100,
    activeDps: 120,
    damageTaken: 10000,
    remoteRepairDelivered: 0,
    remoteRepairReceived: 0,
    shotsHit: 50,
    shotsMissed: 5,
    missRate: 0.09,
    hitQualityCounts: {},
    firstRelevantEvent: null,
    lastRelevantEvent: null,
  };
}

describe('trailingFiveRuns', () => {
  it('returns up to five runs before the current index', () => {
    const runs = Array.from({ length: 8 }, (_, i) =>
      buildRun({ windowStart: `2026-09-0${i + 1}T10:00:00.000Z`, elapsed: 600 + i * 10 }),
    );
    // Current is index 7 (the 8th run)
    const trailing = trailingFiveRuns(runs, 7);
    expect(trailing).toHaveLength(5);
    expect(trailing[0]!.id).toBe(runs[2]!.id);
    expect(trailing[4]!.id).toBe(runs[6]!.id);
  });

  it('returns fewer than five when not enough prior runs exist', () => {
    const runs = [
      buildRun({ windowStart: '2026-09-01T10:00:00.000Z' }),
      buildRun({ windowStart: '2026-09-02T10:00:00.000Z' }),
      buildRun({ windowStart: '2026-09-03T10:00:00.000Z' }),
    ];
    const trailing = trailingFiveRuns(runs, 2);
    expect(trailing).toHaveLength(2);
  });

  it('never includes the current run itself', () => {
    const runs = [
      buildRun({ windowStart: '2026-09-01T10:00:00.000Z' }),
      buildRun({ windowStart: '2026-09-02T10:00:00.000Z' }),
    ];
    const trailing = trailingFiveRuns(runs, 1);
    expect(trailing).toHaveLength(1);
    expect(trailing[0]!.id).toBe(runs[0]!.id);
  });

  it('returns empty for the first run', () => {
    const runs = [buildRun({ windowStart: '2026-09-01T10:00:00.000Z' })];
    expect(trailingFiveRuns(runs, 0)).toHaveLength(0);
  });
});

describe('trailingFiveAverage', () => {
  it('averages the elapsed seconds of trailing runs', () => {
    const runs = [
      buildRun({ windowStart: '2026-09-01T10:00:00.000Z', elapsed: 500 }),
      buildRun({ windowStart: '2026-09-02T10:00:00.000Z', elapsed: 600 }),
      buildRun({ windowStart: '2026-09-03T10:00:00.000Z', elapsed: 700 }),
    ];
    expect(trailingFiveAverage(runs, 2)).toBeCloseTo(550); // (500+600)/2
  });

  it('returns null when there are no prior runs', () => {
    const runs = [buildRun({ windowStart: '2026-09-01T10:00:00.000Z' })];
    expect(trailingFiveAverage(runs, 0)).toBeNull();
  });
});

describe('bestRunUpTo', () => {
  it('returns the fastest run up to and including the current index', () => {
    const fastest = buildRun({ windowStart: '2026-09-01T10:00:00.000Z', elapsed: 400 });
    const slower = buildRun({ windowStart: '2026-09-02T10:00:00.000Z', elapsed: 600 });
    const current = buildRun({ windowStart: '2026-09-03T10:00:00.000Z', elapsed: 500 });
    expect(bestRunUpTo([fastest, slower, current], 2)?.id).toBe(fastest.id);
  });

  it('lets the current run be best when it is fastest', () => {
    const prior = buildRun({ windowStart: '2026-09-01T10:00:00.000Z', elapsed: 700 });
    const current = buildRun({ windowStart: '2026-09-02T10:00:00.000Z', elapsed: 400 });
    expect(bestRunUpTo([prior, current], 1)?.id).toBe(current.id);
  });

  it('returns null for an empty array', () => {
    expect(bestRunUpTo([], 0)).toBeNull();
  });
});

describe('previousRun', () => {
  it('returns the run immediately before the current index', () => {
    const prior = buildRun({ windowStart: '2026-09-01T10:00:00.000Z' });
    const current = buildRun({ windowStart: '2026-09-02T10:00:00.000Z' });
    expect(previousRun([prior, current], 1)?.id).toBe(prior.id);
  });

  it('returns null for the first run', () => {
    const only = buildRun({ windowStart: '2026-09-01T10:00:00.000Z' });
    expect(previousRun([only], 0)).toBeNull();
  });
});

describe('alignCharacterRows', () => {
  it('aligns characters from two runs by exact name', () => {
    const left = [buildCharMetrics('Alpha', 70000), buildCharMetrics('Bravo', 50000)];
    const right = [buildCharMetrics('Alpha', 80000), buildCharMetrics('Bravo', 40000)];
    const aligned = alignCharacterRows(left, right);

    expect(aligned).toHaveLength(2);
    expect(aligned[0]!.character).toBe('Alpha');
    expect(aligned[0]!.left?.damageDealt).toBe(70000);
    expect(aligned[0]!.right?.damageDealt).toBe(80000);
  });

  it('fills null for characters present in only one run', () => {
    const left = [buildCharMetrics('Alpha', 70000)];
    const right = [buildCharMetrics('Charlie', 60000)];
    const aligned = alignCharacterRows(left, right);

    expect(aligned).toHaveLength(2);
    const alphaRow = aligned.find((r) => r.character === 'Alpha')!;
    const charlieRow = aligned.find((r) => r.character === 'Charlie')!;
    expect(alphaRow.left?.damageDealt).toBe(70000);
    expect(alphaRow.right).toBeNull();
    expect(charlieRow.left).toBeNull();
    expect(charlieRow.right?.damageDealt).toBe(60000);
  });

  it('handles undefined character metrics gracefully', () => {
    const aligned = alignCharacterRows(undefined, undefined);
    expect(aligned).toEqual([]);
  });

  it('sorts aligned rows alphabetically by character name', () => {
    const left = [buildCharMetrics('Charlie', 30000), buildCharMetrics('Alpha', 70000)];
    const right = [buildCharMetrics('Bravo', 50000)];
    const aligned = alignCharacterRows(left, right);

    expect(aligned.map((r) => r.character)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });
});
