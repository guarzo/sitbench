import { describe, expect, it } from 'vitest';
import { renderHistory, type SortDir, type SortField } from '../src/history.js';
import type { RunSummary } from '@sitbench/core';
import type { PublicRunSummary } from '../src/data.js';

let idCounter = 0;

function buildLocalRun(overrides: { id: string; windowStart: string; createdAt: string }): RunSummary {
  idCounter += 1;
  const windowEnd = new Date(Date.parse(overrides.windowStart) + 600_000).toISOString();
  return {
    schemaVersion: 1,
    parserVersion: '0.1.0',
    metricsVersion: '0.1.0',
    id: overrides.id,
    site: { name: 'Core Bastion', key: 'core-bastion' },
    fleetProfile: { id: 'default-profile', name: 'Default Profile' },
    window: { start: overrides.windowStart, end: windowEnd, source: 'outgoing-npc-damage', manuallyAdjusted: false },
    participants: ['Alpha'],
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
    createdAt: overrides.createdAt,
    updatedAt: overrides.createdAt,
  };
}

function buildPublicRun(overrides: { id: string; windowStart: string; comparisonOrder: number; siteKey?: string; profileId?: string }): PublicRunSummary {
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

function rowOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('tr[data-run-id]')).map((row) => (row as HTMLElement).dataset.runId!);
}

function sortDate(dir: SortDir): { field: SortField; dir: SortDir } {
  return { field: 'date', dir };
}

describe('renderHistory date sort tie-break', () => {
  it('breaks equal window.start ties for local runs by (createdAt, id) ascending, not payload order', () => {
    const container = document.createElement('div');
    // Payload order deliberately reversed relative to createdAt chronology.
    const newest = buildLocalRun({ id: 'run-newest', windowStart: '2026-09-01T10:00:00.000Z', createdAt: '2026-09-03T00:00:00.000Z' });
    const middle = buildLocalRun({ id: 'run-middle', windowStart: '2026-09-01T10:00:00.000Z', createdAt: '2026-09-02T00:00:00.000Z' });
    const oldest = buildLocalRun({ id: 'run-oldest', windowStart: '2026-09-01T10:00:00.000Z', createdAt: '2026-09-01T00:00:00.000Z' });

    renderHistory(container, [newest, middle, oldest], null, () => undefined, sortDate('asc'), () => undefined);

    expect(rowOrder(container)).toEqual(['run-oldest', 'run-middle', 'run-newest']);
  });

  it('breaks equal window.start ties for local runs by (createdAt, id) descending when sort direction is desc', () => {
    const container = document.createElement('div');
    const newest = buildLocalRun({ id: 'run-newest', windowStart: '2026-09-01T10:00:00.000Z', createdAt: '2026-09-03T00:00:00.000Z' });
    const middle = buildLocalRun({ id: 'run-middle', windowStart: '2026-09-01T10:00:00.000Z', createdAt: '2026-09-02T00:00:00.000Z' });
    const oldest = buildLocalRun({ id: 'run-oldest', windowStart: '2026-09-01T10:00:00.000Z', createdAt: '2026-09-01T00:00:00.000Z' });

    renderHistory(container, [oldest, middle, newest], null, () => undefined, sortDate('desc'), () => undefined);

    expect(rowOrder(container)).toEqual(['run-newest', 'run-middle', 'run-oldest']);
  });

  it('breaks equal local createdAt ties by run id, independent of payload order', () => {
    const container = document.createElement('div');
    const runB = buildLocalRun({ id: 'run-b', windowStart: '2026-09-01T10:00:00.000Z', createdAt: '2026-09-01T10:00:00.000Z' });
    const runA = buildLocalRun({ id: 'run-a', windowStart: '2026-09-01T10:00:00.000Z', createdAt: '2026-09-01T10:00:00.000Z' });

    renderHistory(container, [runB, runA], null, () => undefined, sortDate('asc'), () => undefined);

    expect(rowOrder(container)).toEqual(['run-a', 'run-b']);
  });

  it('breaks equal window.start ties for public runs by (comparisonOrder, id) ascending, not payload order', () => {
    const container = document.createElement('div');
    const newest = buildPublicRun({ id: 'p-newest', windowStart: '2026-09-01T10:00:00.000Z', comparisonOrder: 2 });
    const middle = buildPublicRun({ id: 'p-middle', windowStart: '2026-09-01T10:00:00.000Z', comparisonOrder: 1 });
    const oldest = buildPublicRun({ id: 'p-oldest', windowStart: '2026-09-01T10:00:00.000Z', comparisonOrder: 0 });

    renderHistory(container, [newest, middle, oldest], null, () => undefined, sortDate('asc'), () => undefined);

    expect(rowOrder(container)).toEqual(['p-oldest', 'p-middle', 'p-newest']);
  });

  it('breaks equal public comparisonOrder ties by run id, independent of payload order', () => {
    const container = document.createElement('div');
    const runB = buildPublicRun({ id: 'p-b', windowStart: '2026-09-01T10:00:00.000Z', comparisonOrder: 5 });
    const runA = buildPublicRun({ id: 'p-a', windowStart: '2026-09-01T10:00:00.000Z', comparisonOrder: 5 });

    renderHistory(container, [runB, runA], null, () => undefined, sortDate('asc'), () => undefined);

    expect(rowOrder(container)).toEqual(['p-a', 'p-b']);
  });

  it('breaks equal window.start ties across DIFFERENT (site.key, fleetProfile.id) groups by group key, not by id and never by cross-group comparisonOrder', () => {
    const container = document.createElement('div');
    // Ids are deliberately the OPPOSITE alphabetical order from the site keys,
    // so a fallback to (window.start, id) alone -- ignoring group key -- would
    // produce the wrong order. comparisonOrder is also deliberately opposite
    // (higher in the group that should sort first) to prove it's never used
    // across groups either.
    const lateGroupEarlyId = buildPublicRun({ id: 'aaa-run', windowStart: '2026-09-01T10:00:00.000Z', comparisonOrder: 0, siteKey: 'site-late' });
    const earlyGroupLateId = buildPublicRun({ id: 'zzz-run', windowStart: '2026-09-01T10:00:00.000Z', comparisonOrder: 99, siteKey: 'site-early' });

    renderHistory(container, [lateGroupEarlyId, earlyGroupLateId], null, () => undefined, sortDate('asc'), () => undefined);

    expect(rowOrder(container)).toEqual(['zzz-run', 'aaa-run']);
  });

  it('orders by distinct window.start first, only using the chronology tie-break when dates are equal', () => {
    const container = document.createElement('div');
    // window.start dominates; createdAt is intentionally inverted to prove
    // the tie-break is not applied when dates already differ.
    const earlierWindow = buildLocalRun({ id: 'run-earlier-window', windowStart: '2026-09-01T10:00:00.000Z', createdAt: '2026-09-09T00:00:00.000Z' });
    const laterWindow = buildLocalRun({ id: 'run-later-window', windowStart: '2026-09-02T10:00:00.000Z', createdAt: '2026-09-01T00:00:00.000Z' });

    renderHistory(container, [laterWindow, earlierWindow], null, () => undefined, sortDate('asc'), () => undefined);

    expect(rowOrder(container)).toEqual(['run-earlier-window', 'run-later-window']);
  });
});
