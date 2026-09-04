import { describe, expect, it } from 'vitest';
import { compareMatchingRuns } from '../src/comparisons.js';
import type { RunSummary } from '../src/schemas.js';

let idCounter = 0;

function buildRun(overrides: Partial<RunSummary> & { elapsedSeconds: number; createdAt: string }): RunSummary {
  idCounter += 1;
  const { elapsedSeconds, createdAt, ...rest } = overrides;
  return {
    schemaVersion: 1,
    parserVersion: '0.1.0',
    metricsVersion: '0.1.0',
    id: `run-${idCounter}`,
    site: { name: 'Core Bastion', key: 'core-bastion' },
    fleetProfile: { id: '8-kikis-2-deacons', name: '8 Kikis + 2 Deacons' },
    window: {
      start: createdAt,
      end: createdAt,
      source: 'first-and-last-outgoing-npc-damage',
      manuallyAdjusted: false,
    },
    participants: [],
    calculation: { episodeThresholdSeconds: 180, activeCombatGapSeconds: 30 },
    metrics: {
      elapsedSeconds,
      activeCombatSeconds: elapsedSeconds,
      idleSeconds: 0,
      fleetDamageDealt: 0,
      averageFleetDps: 0,
      activeFleetDps: 0,
      damageTaken: 0,
      remoteRepairDelivered: 0,
      participantCount: 0,
    },
    characterMetrics: [],
    coverage: {
      logFiles: 0,
      participantsWithOutgoingDamage: 0,
      unparsedCombatLines: 0,
      ambiguousEventsExcluded: 0,
      repairPairing: 'none',
    },
    notes: null,
    fingerprint: `fp-${idCounter}`,
    createdAt,
    updatedAt: createdAt,
    ...rest,
  };
}

describe('compareMatchingRuns', () => {
  it('returns all-null when no other runs match the site key and fleet profile id', () => {
    const current = buildRun({ elapsedSeconds: 700, createdAt: '2026-09-03T00:00:00.000Z' });
    const result = compareMatchingRuns(current, [current]);

    expect(result.previous).toBeNull();
    expect(result.trailingFiveAverageElapsedSeconds).toBeNull();
    // The current run itself is still "up through current", so best is itself.
    expect(result.best).toEqual(current);
  });

  it('excludes runs with a different site key even when the fleet profile id matches', () => {
    const current = buildRun({ elapsedSeconds: 700, createdAt: '2026-09-03T01:00:00.000Z' });
    const otherSite = buildRun({
      elapsedSeconds: 100,
      createdAt: '2026-09-02T00:00:00.000Z',
      site: { name: 'Different Site', key: 'different-site' },
    });

    const result = compareMatchingRuns(current, [otherSite, current]);
    expect(result.previous).toBeNull();
    expect(result.best).toEqual(current);
  });

  it('excludes runs with a different fleet profile id even when the site key matches', () => {
    const current = buildRun({ elapsedSeconds: 700, createdAt: '2026-09-03T01:00:00.000Z' });
    const otherProfile = buildRun({
      elapsedSeconds: 100,
      createdAt: '2026-09-02T00:00:00.000Z',
      fleetProfile: { id: 'solo-vindicator', name: 'Solo Vindicator' },
    });

    const result = compareMatchingRuns(current, [otherProfile, current]);
    expect(result.previous).toBeNull();
    expect(result.best).toEqual(current);
  });

  it('sets previous to the most recently recorded matching run before the current run', () => {
    const older = buildRun({ elapsedSeconds: 800, createdAt: '2026-09-01T00:00:00.000Z' });
    const mostRecentPrior = buildRun({ elapsedSeconds: 750, createdAt: '2026-09-02T00:00:00.000Z' });
    const current = buildRun({ elapsedSeconds: 700, createdAt: '2026-09-03T00:00:00.000Z' });

    const result = compareMatchingRuns(current, [older, mostRecentPrior, current]);
    expect(result.previous).toEqual(mostRecentPrior);
  });

  it('does not leak a future run (recorded after current) into previous, best, or trailing-five', () => {
    const current = buildRun({ elapsedSeconds: 700, createdAt: '2026-09-03T00:00:00.000Z' });
    const future = buildRun({ elapsedSeconds: 1, createdAt: '2026-09-10T00:00:00.000Z' });

    const result = compareMatchingRuns(current, [current, future]);
    expect(result.previous).toBeNull();
    expect(result.best).toEqual(current);
    expect(result.trailingFiveAverageElapsedSeconds).toBeNull();
  });

  it('picks the lowest elapsed time among runs up through current as best, tie-breaking to the earliest recorded', () => {
    const bestTiedEarlier = buildRun({ elapsedSeconds: 500, createdAt: '2026-09-01T00:00:00.000Z' });
    const bestTiedLater = buildRun({ elapsedSeconds: 500, createdAt: '2026-09-02T00:00:00.000Z' });
    const current = buildRun({ elapsedSeconds: 700, createdAt: '2026-09-03T00:00:00.000Z' });

    const result = compareMatchingRuns(current, [bestTiedEarlier, bestTiedLater, current]);
    expect(result.best).toEqual(bestTiedEarlier);
  });

  it('lets the current run itself be the best when it is faster than all prior matching runs', () => {
    const slowerPrior = buildRun({ elapsedSeconds: 900, createdAt: '2026-09-01T00:00:00.000Z' });
    const current = buildRun({ elapsedSeconds: 500, createdAt: '2026-09-02T00:00:00.000Z' });

    const result = compareMatchingRuns(current, [slowerPrior, current]);
    expect(result.best).toEqual(current);
  });

  it('averages exactly the prior matching runs when there are fewer than five', () => {
    const runOne = buildRun({ elapsedSeconds: 600, createdAt: '2026-09-01T00:00:00.000Z' });
    const runTwo = buildRun({ elapsedSeconds: 800, createdAt: '2026-09-02T00:00:00.000Z' });
    const current = buildRun({ elapsedSeconds: 700, createdAt: '2026-09-03T00:00:00.000Z' });

    const result = compareMatchingRuns(current, [runOne, runTwo, current]);
    expect(result.trailingFiveAverageElapsedSeconds).toBeCloseTo(700); // (600 + 800) / 2
  });

  it('averages only the five most recent prior matching runs, excluding older ones and the current run', () => {
    const runs = [100, 200, 300, 400, 500, 600, 700].map((elapsedSeconds, index) =>
      buildRun({ elapsedSeconds, createdAt: `2026-09-0${index + 1}T00:00:00.000Z` }),
    );
    const current = buildRun({ elapsedSeconds: 999, createdAt: '2026-09-08T00:00:00.000Z' });

    const result = compareMatchingRuns(current, [...runs, current]);
    // Most recent five prior runs by createdAt: 300, 400, 500, 600, 700 => average 500.
    expect(result.trailingFiveAverageElapsedSeconds).toBeCloseTo(500);
  });

  it('reports a single prior matching run as both previous and the trailing-five average', () => {
    const onlyPrior = buildRun({ elapsedSeconds: 640, createdAt: '2026-09-01T00:00:00.000Z' });
    const current = buildRun({ elapsedSeconds: 700, createdAt: '2026-09-02T00:00:00.000Z' });

    const result = compareMatchingRuns(current, [onlyPrior, current]);
    expect(result.previous).toEqual(onlyPrior);
    expect(result.trailingFiveAverageElapsedSeconds).toBeCloseTo(640);
  });

  it('still counts the current run itself when allRuns does not contain it', () => {
    const slowerPrior = buildRun({ elapsedSeconds: 900, createdAt: '2026-09-01T00:00:00.000Z' });
    const current = buildRun({ elapsedSeconds: 500, createdAt: '2026-09-02T00:00:00.000Z' });

    const result = compareMatchingRuns(current, [slowerPrior]);

    expect(result.previous).toEqual(slowerPrior);
    expect(result.best).toEqual(current);
    expect(result.trailingFiveAverageElapsedSeconds).toBeCloseTo(900);
  });

  it('prefers the supplied current run over a stale same-id copy in allRuns and never counts it twice', () => {
    const prior = buildRun({ elapsedSeconds: 800, createdAt: '2026-09-01T00:00:00.000Z' });
    const current = buildRun({ elapsedSeconds: 500, createdAt: '2026-09-02T00:00:00.000Z' });
    // A stale copy of the same run (same id) that a caller's list has not
    // caught up with yet: it must never win `best` over the supplied
    // current object, nor appear in the trailing-five window.
    const staleSameId = buildRun({
      elapsedSeconds: 10,
      createdAt: '2026-09-02T00:00:00.000Z',
      id: current.id,
    });

    const result = compareMatchingRuns(current, [prior, staleSameId]);

    expect(result.best).toEqual(current);
    expect(result.previous).toEqual(prior);
    expect(result.trailingFiveAverageElapsedSeconds).toBeCloseTo(800);
  });
});
