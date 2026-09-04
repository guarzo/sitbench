import { describe, expect, it } from 'vitest';
import { alignCharacterRows, bestRunUpTo, matchingGroupChronology, previousRun, sameGroupChronologyRuns, trailingFiveAverage, trailingFiveRuns } from '../src/compare.js';
import { compareMatchingRuns, type CharacterMetrics, type RunSummary } from '@sitbench/core';
import type { DashboardRun, PublicRunSummary } from '../src/data.js';

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

function buildPublicRun(overrides: {
  id: string;
  comparisonOrder: number;
  windowStart: string;
  siteKey?: string;
  profileId?: string;
}): PublicRunSummary {
  const windowEnd = new Date(Date.parse(overrides.windowStart) + 600_000).toISOString();
  return {
    id: overrides.id,
    comparisonOrder: overrides.comparisonOrder,
    site: { name: 'Core Bastion', key: overrides.siteKey ?? 'core-bastion' },
    fleetProfile: { id: overrides.profileId ?? 'default-profile', name: 'Default Profile' },
    window: { start: overrides.windowStart, end: windowEnd, source: 'outgoing-npc-damage', manuallyAdjusted: false },
    calculation: { episodeThresholdSeconds: 180, activeCombatGapSeconds: 30 },
    metrics: {
      elapsedSeconds: 600,
      activeCombatSeconds: 540,
      idleSeconds: 60,
      fleetDamageDealt: 120000,
      averageFleetDps: 200,
      activeFleetDps: 222,
      damageTaken: 30000,
      remoteRepairDelivered: 5000,
      participantCount: 1,
    },
    coverage: { logFiles: 1, participantsWithOutgoingDamage: 1, unparsedCombatLines: 0, ambiguousEventsExcluded: 0, repairPairing: 'full' },
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

describe('matchingGroupChronology for local runs', () => {
  it('sorts by createdAt then id, matching core compareMatchingRuns chronology', () => {
    // Run A was created AFTER run B but has an EARLIER window.start.
    // Core compareMatchingRuns uses createdAt for chronology; dashboard must match.
    const runA = {
      ...buildRun({ windowStart: '2026-09-01T10:00:00.000Z', elapsed: 700 }),
      createdAt: '2026-09-03T00:00:00.000Z',
      updatedAt: '2026-09-03T00:00:00.000Z',
    };
    const runB = {
      ...buildRun({ windowStart: '2026-09-02T10:00:00.000Z', elapsed: 600 }),
      createdAt: '2026-09-02T00:00:00.000Z',
      updatedAt: '2026-09-02T00:00:00.000Z',
    };

    // Core says: ordered by createdAt, B (created 09-02) is before A (created 09-03)
    const coreResult = compareMatchingRuns(runA, [runA, runB]);
    expect(coreResult.previous?.id).toBe(runB.id);

    // Dashboard matchingGroupChronology must produce the same ordering
    const ordered = [runA, runB].sort(matchingGroupChronology);
    expect(ordered[0]!.id).toBe(runB.id);
    expect(ordered[1]!.id).toBe(runA.id);

    // So previous of runA (index 1) should be runB (index 0)
    expect(previousRun(ordered, 1)?.id).toBe(runB.id);
  });
});

describe('matchingGroupChronology for public runs', () => {
  it('orders same-group public runs by comparisonOrder, matching the assignComparisonOrder chronology within a (site.key, fleetProfile.id) group', () => {
    const later = buildPublicRun({ id: 'p-later', comparisonOrder: 5, windowStart: '2026-09-01T10:00:00.000Z' });
    const earlier = buildPublicRun({ id: 'p-earlier', comparisonOrder: 1, windowStart: '2026-09-02T10:00:00.000Z' });

    const ordered = [later, earlier].sort(matchingGroupChronology);
    expect(ordered.map((r) => r.id)).toEqual(['p-earlier', 'p-later']);
  });

  it('breaks equal same-group comparisonOrder ties by id', () => {
    const runB = buildPublicRun({ id: 'p-b', comparisonOrder: 5, windowStart: '2026-09-01T10:00:00.000Z' });
    const runA = buildPublicRun({ id: 'p-a', comparisonOrder: 5, windowStart: '2026-09-01T10:00:00.000Z' });

    const ordered = [runB, runA].sort(matchingGroupChronology);
    expect(ordered.map((r) => r.id)).toEqual(['p-a', 'p-b']);
  });

  it('throws when asked to compare runs from different (site.key, fleetProfile.id) groups -- comparisonOrder restarts per group, so cross-group use must be impossible, not silently wrong', () => {
    // Mirrors the reported regression: an August group's run (comparisonOrder 9)
    // must never be compared directly against a September group's run
    // (comparisonOrder 0) using this function -- misuse must be loud, not
    // silently fall back to something that can form a non-transitive cycle.
    const augustGroupOrder9 = buildPublicRun({
      id: 'p-august-order9',
      comparisonOrder: 9,
      windowStart: '2026-08-15T10:00:00.000Z',
      siteKey: 'site-a',
      profileId: 'profile-a',
    });
    const septemberGroupOrder0 = buildPublicRun({
      id: 'p-september-order0',
      comparisonOrder: 0,
      windowStart: '2026-09-01T10:00:00.000Z',
      siteKey: 'site-b',
      profileId: 'profile-b',
    });

    expect(() => matchingGroupChronology(augustGroupOrder9, septemberGroupOrder0)).toThrow(/exact same/);
    expect(() => [augustGroupOrder9, septemberGroupOrder0].sort(matchingGroupChronology)).toThrow(/exact same/);
  });
});

describe('sameGroupChronologyRuns', () => {
  it("returns only the runs sharing the reference run's exact group, sorted by matching-group chronology, ignoring runs from other groups in the broader (e.g. All Sites/All Profiles filtered) input", () => {
    const refGroupOlder = buildPublicRun({ id: 'ref-older', comparisonOrder: 0, windowStart: '2026-09-01T10:00:00.000Z', siteKey: 'site-a', profileId: 'profile-a' });
    const refGroupNewer = buildPublicRun({ id: 'ref-newer', comparisonOrder: 1, windowStart: '2026-09-02T10:00:00.000Z', siteKey: 'site-a', profileId: 'profile-a' });
    const otherGroupRun = buildPublicRun({ id: 'other-group', comparisonOrder: 99, windowStart: '2026-09-03T10:00:00.000Z', siteKey: 'site-b', profileId: 'profile-b' });

    const result = sameGroupChronologyRuns([otherGroupRun, refGroupNewer, refGroupOlder], refGroupNewer);

    expect(result.map((r) => r.id)).toEqual(['ref-older', 'ref-newer']);
  });

  it('returns an empty array when there is no reference run', () => {
    const run = buildPublicRun({ id: 'r', comparisonOrder: 0, windowStart: '2026-09-01T10:00:00.000Z' });
    expect(sameGroupChronologyRuns([run], null)).toEqual([]);
  });

  it('never throws even when the input spans multiple groups, because it filters to the reference group before ever comparing', () => {
    const refGroupRun = buildPublicRun({ id: 'ref-run', comparisonOrder: 0, windowStart: '2026-09-01T10:00:00.000Z', siteKey: 'site-a' });
    const otherGroupRun = buildPublicRun({ id: 'other-group-run', comparisonOrder: 9, windowStart: '2026-08-01T10:00:00.000Z', siteKey: 'site-b' });

    expect(() => sameGroupChronologyRuns([otherGroupRun, refGroupRun], refGroupRun)).not.toThrow();
  });
});
