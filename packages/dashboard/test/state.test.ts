import { describe, expect, it } from 'vitest';
import type { LocalDashboardDataset, PublicDashboardDataset, PublicRunSummary } from '../src/data.js';
import { initializeState, matchingRuns, profileOptions, reconcileSelections, selectedRun, siteOptions } from '../src/state.js';
import type { RunSummary } from '@sitbench/core';

let idCounter = 0;

function buildRun(overrides: { windowStart: string; id?: string; createdAt?: string; siteKey?: string; siteName?: string; profileId?: string; profileName?: string; elapsed?: number }): RunSummary {
  idCounter += 1;
  const windowEnd = new Date(Date.parse(overrides.windowStart) + 600_000).toISOString();
  return {
    schemaVersion: 1,
    parserVersion: '0.1.0',
    metricsVersion: '0.1.0',
    id: overrides.id ?? `run-${idCounter}`,
    site: { name: overrides.siteName ?? 'Core Bastion', key: overrides.siteKey ?? 'core-bastion' },
    fleetProfile: { id: overrides.profileId ?? 'default-profile', name: overrides.profileName ?? 'Default Profile' },
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
    createdAt: overrides.createdAt ?? overrides.windowStart,
    updatedAt: overrides.createdAt ?? overrides.windowStart,
  };
}

function buildDataset(runs: RunSummary[]): LocalDashboardDataset {
  return {
    schemaVersion: 1,
    mode: 'local',
    generatedAt: new Date().toISOString(),
    capabilities: { characters: true, notes: true },
    runs,
  };
}

function buildPublicRun(overrides: {
  id: string;
  comparisonOrder: number;
  windowStart?: string;
  siteKey?: string;
  profileId?: string;
}): PublicRunSummary {
  const windowStart = overrides.windowStart ?? '2026-09-01T10:00:00.000Z';
  const windowEnd = new Date(Date.parse(windowStart) + 600_000).toISOString();
  return {
    id: overrides.id,
    comparisonOrder: overrides.comparisonOrder,
    site: { name: 'Core Bastion', key: overrides.siteKey ?? 'core-bastion' },
    fleetProfile: { id: overrides.profileId ?? 'default-profile', name: 'Default Profile' },
    window: { start: windowStart, end: windowEnd, source: 'outgoing-npc-damage', manuallyAdjusted: false },
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

function buildPublicDataset(runs: PublicRunSummary[]): PublicDashboardDataset {
  return {
    schemaVersion: 1,
    mode: 'public',
    generatedAt: new Date().toISOString(),
    capabilities: { characters: false, notes: false },
    runs,
  };
}

describe('initializeState', () => {
  it('selects the most recent run as the default filter and selected run', () => {
    const older = buildRun({ windowStart: '2026-09-01T10:00:00.000Z' });
    const latest = buildRun({ windowStart: '2026-09-02T10:00:00.000Z' });
    const dataset = buildDataset([older, latest]);
    const state = initializeState(dataset);

    expect(state.filter.siteKey).toBe(latest.site.key);
    expect(state.filter.fleetProfileId).toBe(latest.fleetProfile.id);
    expect(state.selectedRunId).toBe(latest.id);
    expect(state.compareRunId).toBeNull();
  });

  it('handles an empty dataset gracefully', () => {
    const dataset = buildDataset([]);
    const state = initializeState(dataset);

    expect(state.filter.siteKey).toBeNull();
    expect(state.filter.fleetProfileId).toBeNull();
    expect(state.selectedRunId).toBeNull();
  });

  it('selects the newest local run by (createdAt, id) when payload order ends with an older run', () => {
    // Payload order is window.start ascending (what buildLocalDashboardDataset emits),
    // but the chronologically newest run by createdAt is the FIRST payload item.
    const newest = buildRun({
      id: 'run-newest',
      windowStart: '2026-09-01T10:00:00.000Z',
      createdAt: '2026-09-05T00:00:00.000Z',
      siteKey: 'site-newest',
      profileId: 'profile-newest',
    });
    const older = buildRun({
      id: 'run-older',
      windowStart: '2026-09-02T10:00:00.000Z',
      createdAt: '2026-09-03T00:00:00.000Z',
      siteKey: 'site-older',
      profileId: 'profile-older',
    });
    const state = initializeState(buildDataset([newest, older]));

    expect(state.selectedRunId).toBe('run-newest');
    expect(state.filter.siteKey).toBe('site-newest');
    expect(state.filter.fleetProfileId).toBe('profile-newest');
  });

  it('breaks equal local createdAt by run id, independent of payload order', () => {
    const runB = buildRun({ id: 'run-b', windowStart: '2026-09-01T10:00:00.000Z', createdAt: '2026-09-01T10:00:00.000Z', siteKey: 'site-b', profileId: 'profile-b' });
    const runA = buildRun({ id: 'run-a', windowStart: '2026-09-01T10:00:00.000Z', createdAt: '2026-09-01T10:00:00.000Z', siteKey: 'site-a', profileId: 'profile-a' });
    const state = initializeState(buildDataset([runB, runA]));

    expect(state.selectedRunId).toBe('run-b');
    expect(state.filter.siteKey).toBe('site-b');
    expect(state.filter.fleetProfileId).toBe('profile-b');
  });

  it('selects the newest public run within a single group by comparisonOrder regardless of payload order', () => {
    // All three share the same default site/profile group; only comparisonOrder
    // (and payload position) differ, proving selection ignores payload order.
    const dataset = buildPublicDataset([
      buildPublicRun({ id: 'p-mid', comparisonOrder: 1 }),
      buildPublicRun({ id: 'p-newest', comparisonOrder: 2 }),
      buildPublicRun({ id: 'p-oldest', comparisonOrder: 0 }),
    ]);
    const state = initializeState(dataset);

    expect(state.selectedRunId).toBe('p-newest');
    expect(state.filter.siteKey).toBe('core-bastion');
    expect(state.filter.fleetProfileId).toBe('default-profile');
  });

  it('selects the newest run across DIFFERENT site/profile groups by (window.start, id), not by comparisonOrder, which restarts per group', () => {
    // Mirrors the reported regression: an August group's run (comparisonOrder 9)
    // must not outrank a chronologically newer September group's run
    // (comparisonOrder 0) just because its per-group ordinal is higher.
    const dataset = buildPublicDataset([
      buildPublicRun({
        id: 'p-august-order9',
        comparisonOrder: 9,
        windowStart: '2026-08-15T10:00:00.000Z',
        siteKey: 'site-a',
        profileId: 'profile-a',
      }),
      buildPublicRun({
        id: 'p-september-order0',
        comparisonOrder: 0,
        windowStart: '2026-09-01T10:00:00.000Z',
        siteKey: 'site-b',
        profileId: 'profile-b',
      }),
    ]);
    const state = initializeState(dataset);

    expect(state.selectedRunId).toBe('p-september-order0');
    expect(state.filter.siteKey).toBe('site-b');
    expect(state.filter.fleetProfileId).toBe('profile-b');
  });

  it('breaks equal public comparisonOrder by run id, independent of payload order', () => {
    const dataset = buildPublicDataset([
      buildPublicRun({ id: 'p-b', comparisonOrder: 3, siteKey: 'site-b', profileId: 'profile-b' }),
      buildPublicRun({ id: 'p-a', comparisonOrder: 3, siteKey: 'site-a', profileId: 'profile-a' }),
    ]);
    const state = initializeState(dataset);

    expect(state.selectedRunId).toBe('p-b');
    expect(state.filter.siteKey).toBe('site-b');
  });
});

describe('matchingRuns', () => {
  it('filters by both site key and fleet profile id', () => {
    const matchA = buildRun({ windowStart: '2026-09-01T10:00:00.000Z', siteKey: 'site-a', profileId: 'profile-x' });
    const matchB = buildRun({ windowStart: '2026-09-02T10:00:00.000Z', siteKey: 'site-a', profileId: 'profile-x' });
    const differentSite = buildRun({ windowStart: '2026-09-03T10:00:00.000Z', siteKey: 'site-b', profileId: 'profile-x' });
    const differentProfile = buildRun({ windowStart: '2026-09-04T10:00:00.000Z', siteKey: 'site-a', profileId: 'profile-y' });
    const dataset = buildDataset([matchA, matchB, differentSite, differentProfile]);
    const state = initializeState(dataset);
    // Override to specific filter
    state.filter.siteKey = 'site-a';
    state.filter.fleetProfileId = 'profile-x';

    const matched = matchingRuns(state);
    expect(matched).toHaveLength(2);
    expect(matched.map((r) => r.id)).toEqual([matchA.id, matchB.id]);
  });

  it('returns all runs when both filter keys are null', () => {
    const a = buildRun({ windowStart: '2026-09-01T10:00:00.000Z', siteKey: 'site-a' });
    const b = buildRun({ windowStart: '2026-09-02T10:00:00.000Z', siteKey: 'site-b' });
    const dataset = buildDataset([a, b]);
    const state = initializeState(dataset);
    state.filter.siteKey = null;
    state.filter.fleetProfileId = null;

    expect(matchingRuns(state)).toHaveLength(2);
  });
});

describe('siteOptions / profileOptions', () => {
  it('returns unique site options in encounter order', () => {
    const a = buildRun({ windowStart: '2026-09-01T10:00:00.000Z', siteKey: 'site-a', siteName: 'Site A' });
    const b = buildRun({ windowStart: '2026-09-02T10:00:00.000Z', siteKey: 'site-b', siteName: 'Site B' });
    const c = buildRun({ windowStart: '2026-09-03T10:00:00.000Z', siteKey: 'site-a', siteName: 'Site A' });
    const dataset = buildDataset([a, b, c]);

    expect(siteOptions(dataset)).toEqual([
      { key: 'site-a', name: 'Site A' },
      { key: 'site-b', name: 'Site B' },
    ]);
  });

  it('returns unique profile options', () => {
    const a = buildRun({ windowStart: '2026-09-01T10:00:00.000Z', profileId: 'p1', profileName: 'Profile 1' });
    const b = buildRun({ windowStart: '2026-09-02T10:00:00.000Z', profileId: 'p2', profileName: 'Profile 2' });
    const dataset = buildDataset([a, b]);

    expect(profileOptions(dataset)).toEqual([
      { id: 'p1', name: 'Profile 1' },
      { id: 'p2', name: 'Profile 2' },
    ]);
  });
});

describe('selectedRun', () => {
  it('returns the selected run from matching runs', () => {
    const run = buildRun({ windowStart: '2026-09-01T10:00:00.000Z' });
    const dataset = buildDataset([run]);
    const state = initializeState(dataset);
    state.selectedRunId = run.id;

    expect(selectedRun(state)?.id).toBe(run.id);
  });

  it('returns null when no run matches the selectedRunId', () => {
    const run = buildRun({ windowStart: '2026-09-01T10:00:00.000Z' });
    const dataset = buildDataset([run]);
    const state = initializeState(dataset);
    state.selectedRunId = 'nonexistent';

    expect(selectedRun(state)).toBeNull();
  });
});

describe('date filtering', () => {
  it('includes dateFrom and dateTo in FilterState', () => {
    const run = buildRun({ windowStart: '2026-09-01T10:00:00.000Z' });
    const dataset = buildDataset([run]);
    const state = initializeState(dataset);

    expect(state.filter.dateFrom).toBeNull();
    expect(state.filter.dateTo).toBeNull();
  });

  it('filters runs by date range when dateFrom and dateTo are set', () => {
    const early = buildRun({ windowStart: '2026-09-01T10:00:00.000Z' });
    const mid = buildRun({ windowStart: '2026-09-05T10:00:00.000Z' });
    const late = buildRun({ windowStart: '2026-09-10T10:00:00.000Z' });
    const dataset = buildDataset([early, mid, late]);
    const state = initializeState(dataset);
    state.filter.siteKey = null;
    state.filter.fleetProfileId = null;
    state.filter.dateFrom = '2026-09-03';
    state.filter.dateTo = '2026-09-07';

    const matched = matchingRuns(state);
    expect(matched).toHaveLength(1);
    expect(matched[0]!.id).toBe(mid.id);
  });
});

describe('reconcileSelections', () => {
  it('clears selectedRunId and compareRunId when they leave the matched set', () => {
    const runA = buildRun({ windowStart: '2026-09-01T10:00:00.000Z', siteKey: 'site-a' });
    const runB = buildRun({ windowStart: '2026-09-02T10:00:00.000Z', siteKey: 'site-b' });
    const dataset = buildDataset([runA, runB]);
    const state = initializeState(dataset);
    state.selectedRunId = runA.id;
    state.compareRunId = runA.id;
    state.filter.siteKey = 'site-b';
    state.filter.fleetProfileId = null;

    reconcileSelections(state);

    // runA is no longer in matched set; should auto-select most recent matched
    expect(state.selectedRunId).toBe(runB.id);
    expect(state.compareRunId).toBeNull();
  });

  it('keeps selections when they remain in the matched set', () => {
    const runA = buildRun({ windowStart: '2026-09-01T10:00:00.000Z', siteKey: 'site-a' });
    const runB = buildRun({ windowStart: '2026-09-02T10:00:00.000Z', siteKey: 'site-a' });
    const dataset = buildDataset([runA, runB]);
    const state = initializeState(dataset);
    state.selectedRunId = runA.id;
    state.compareRunId = runB.id;
    state.filter.siteKey = 'site-a';
    state.filter.fleetProfileId = null;

    reconcileSelections(state);

    expect(state.selectedRunId).toBe(runA.id);
    expect(state.compareRunId).toBe(runB.id);
  });

  it('re-selects the newest matched local run by (createdAt, id), not the last matched payload item', () => {
    const dropped = buildRun({ id: 'run-dropped', windowStart: '2026-08-30T10:00:00.000Z', createdAt: '2026-08-30T10:00:00.000Z', siteKey: 'site-other' });
    // Within site-a, the newest by createdAt sits EARLIER in payload (window.start) order.
    const newest = buildRun({ id: 'run-newest', windowStart: '2026-09-01T10:00:00.000Z', createdAt: '2026-09-09T00:00:00.000Z', siteKey: 'site-a' });
    const older = buildRun({ id: 'run-older', windowStart: '2026-09-02T10:00:00.000Z', createdAt: '2026-09-03T00:00:00.000Z', siteKey: 'site-a' });
    const state = initializeState(buildDataset([dropped, newest, older]));
    state.selectedRunId = 'run-dropped';
    state.compareRunId = 'run-dropped';
    state.filter.siteKey = 'site-a';
    state.filter.fleetProfileId = null;

    reconcileSelections(state);

    expect(state.selectedRunId).toBe('run-newest');
    expect(state.compareRunId).toBeNull();
  });

  it('re-selects the newest matched public run by (comparisonOrder, id), not the last matched payload item', () => {
    const dataset = buildPublicDataset([
      buildPublicRun({ id: 'p-dropped', comparisonOrder: 9, siteKey: 'site-other' }),
      buildPublicRun({ id: 'p-newest', comparisonOrder: 5, siteKey: 'site-a' }),
      buildPublicRun({ id: 'p-older', comparisonOrder: 1, siteKey: 'site-a' }),
    ]);
    const state = initializeState(dataset);
    state.selectedRunId = 'p-dropped';
    state.compareRunId = 'p-dropped';
    state.filter.siteKey = 'site-a';
    state.filter.fleetProfileId = null;

    reconcileSelections(state);

    expect(state.selectedRunId).toBe('p-newest');
    expect(state.compareRunId).toBeNull();
  });

  it('re-selects the newest matched public run across mixed groups by (window.start, id) when the filter admits multiple groups, not by comparisonOrder', () => {
    // Filter is wide open (no site/profile selected), so the matched set spans
    // two different groups. comparisonOrder is only meaningful within a group,
    // so cross-group reconciliation must fall back to (window.start, id).
    const dataset = buildPublicDataset([
      buildPublicRun({
        id: 'p-dropped',
        comparisonOrder: 20,
        windowStart: '2026-09-10T10:00:00.000Z',
        siteKey: 'site-dropped',
        profileId: 'profile-dropped',
      }),
      buildPublicRun({
        id: 'p-august-high-ordinal',
        comparisonOrder: 9,
        windowStart: '2026-08-15T10:00:00.000Z',
        siteKey: 'site-a',
        profileId: 'profile-a',
      }),
      buildPublicRun({
        id: 'p-september-low-ordinal',
        comparisonOrder: 0,
        windowStart: '2026-09-01T10:00:00.000Z',
        siteKey: 'site-b',
        profileId: 'profile-b',
      }),
    ]);
    const state = initializeState(dataset);
    state.selectedRunId = 'p-dropped';
    state.compareRunId = 'p-dropped';
    state.filter.siteKey = null;
    state.filter.fleetProfileId = null;
    state.filter.dateFrom = '2026-08-01';
    state.filter.dateTo = '2026-09-05';

    reconcileSelections(state);

    expect(matchingRuns(state).map((run) => run.id).sort()).toEqual(['p-august-high-ordinal', 'p-september-low-ordinal']);
    expect(state.selectedRunId).toBe('p-september-low-ordinal');
    expect(state.compareRunId).toBeNull();
  });

  it('re-selects the newest run remaining after a date-range filter reconciliation', () => {
    const inRangeOlder = buildRun({ id: 'run-in-older', windowStart: '2026-09-04T10:00:00.000Z', createdAt: '2026-09-04T10:00:00.000Z', siteKey: 'site-a' });
    const inRangeNewest = buildRun({ id: 'run-in-newest', windowStart: '2026-09-05T10:00:00.000Z', createdAt: '2026-09-06T10:00:00.000Z', siteKey: 'site-a' });
    const outOfRange = buildRun({ id: 'run-out', windowStart: '2026-09-20T10:00:00.000Z', createdAt: '2026-09-20T10:00:00.000Z', siteKey: 'site-a' });
    const state = initializeState(buildDataset([inRangeOlder, inRangeNewest, outOfRange]));
    state.filter.siteKey = 'site-a';
    state.filter.fleetProfileId = null;
    state.selectedRunId = 'run-out';
    state.compareRunId = 'run-out';
    state.filter.dateFrom = '2026-09-03';
    state.filter.dateTo = '2026-09-07';

    reconcileSelections(state);

    expect(matchingRuns(state).map((run) => run.id)).toEqual(['run-in-older', 'run-in-newest']);
    expect(state.selectedRunId).toBe('run-in-newest');
    expect(state.compareRunId).toBeNull();
  });
});
