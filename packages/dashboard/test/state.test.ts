import { describe, expect, it } from 'vitest';
import type { LocalDashboardDataset } from '../src/data.js';
import { initializeState, matchingRuns, profileOptions, selectedRun, siteOptions } from '../src/state.js';
import type { RunSummary } from '@sitbench/core';

let idCounter = 0;

function buildRun(overrides: { windowStart: string; siteKey?: string; siteName?: string; profileId?: string; profileName?: string; elapsed?: number }): RunSummary {
  idCounter += 1;
  const windowEnd = new Date(Date.parse(overrides.windowStart) + 600_000).toISOString();
  return {
    schemaVersion: 1,
    parserVersion: '0.1.0',
    metricsVersion: '0.1.0',
    id: `run-${idCounter}`,
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
    createdAt: overrides.windowStart,
    updatedAt: overrides.windowStart,
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
