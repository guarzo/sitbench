import { describe, expect, it } from 'vitest';
import type { ChartConfiguration } from 'chart.js';
import { renderTrends, type ChartFactory } from '../src/trends.js';
import { formatShortDate } from '../src/format.js';
import type { RunSummary } from '@sitbench/core/export';

function buildTrendRun(overrides: { windowStart: string; id: string; elapsed: number }): RunSummary {
  const windowEnd = new Date(Date.parse(overrides.windowStart) + 600_000).toISOString();
  return {
    schemaVersion: 1,
    parserVersion: '0.1.0',
    metricsVersion: '0.1.0',
    id: overrides.id,
    site: { name: 'S', key: 's' },
    fleetProfile: { id: 'p', name: 'P' },
    window: { start: overrides.windowStart, end: windowEnd, source: 'test', manuallyAdjusted: false },
    participants: [],
    calculation: { episodeThresholdSeconds: 180, activeCombatGapSeconds: 30 },
    metrics: {
      elapsedSeconds: overrides.elapsed,
      activeCombatSeconds: overrides.elapsed - 10,
      idleSeconds: 10,
      fleetDamageDealt: 0,
      averageFleetDps: 0,
      activeFleetDps: 0,
      damageTaken: 0,
      remoteRepairDelivered: 0,
      participantCount: 0,
    },
    characterMetrics: [],
    coverage: { logFiles: 0, participantsWithOutgoingDamage: 0, unparsedCombatLines: 0, ambiguousEventsExcluded: 0, repairPairing: 'none' },
    notes: null,
    fingerprint: `fp-${overrides.id}`,
    createdAt: overrides.windowStart,
    updatedAt: overrides.windowStart,
  };
}

function makeChartFactory(): {
  factory: ChartFactory;
  instances: Array<{ destroyed: boolean }>;
  configs: Array<ChartConfiguration<'line'>>;
} {
  const instances: Array<{ destroyed: boolean }> = [];
  const configs: Array<ChartConfiguration<'line'>> = [];
  const factory: ChartFactory = (_canvas, config) => {
    configs.push(config);
    const inst = { destroyed: false, destroy() { inst.destroyed = true; } };
    instances.push(inst);
    return inst;
  };
  return { factory, instances, configs };
}

describe('renderTrends sorting', () => {
  it('charts labels and data in (window.start, id) order regardless of input order', () => {
    const container = document.createElement('div');
    const { factory, configs } = makeChartFactory();
    // Deliberately scrambled input: newest first, and an id-tiebreak pair inverted.
    const late = buildTrendRun({ windowStart: '2026-09-03T10:00:00.000Z', id: 'run-d', elapsed: 400 });
    const tieB = buildTrendRun({ windowStart: '2026-09-02T10:00:00.000Z', id: 'run-c', elapsed: 500 });
    const tieA = buildTrendRun({ windowStart: '2026-09-02T10:00:00.000Z', id: 'run-b', elapsed: 550 });
    const early = buildTrendRun({ windowStart: '2026-09-01T10:00:00.000Z', id: 'run-a', elapsed: 700 });

    renderTrends(container, [late, tieB, tieA, early], 'elapsedSeconds', () => {}, null, { createChart: factory });

    expect(configs).toHaveLength(1);
    const config = configs[0]!;
    // Elapsed values uniquely identify the runs, so the dataset proves ordering:
    // early (run-a), tieA (run-b), tieB (run-c), late (run-d).
    expect(config.data.datasets[0]!.data).toEqual([700, 550, 500, 400]);
    expect(config.data.datasets[0]!.label).toBe('Elapsed (s)');
    expect(config.data.labels).toEqual([
      formatShortDate('2026-09-01T10:00:00.000Z'),
      formatShortDate('2026-09-02T10:00:00.000Z'),
      formatShortDate('2026-09-02T10:00:00.000Z'),
      formatShortDate('2026-09-03T10:00:00.000Z'),
    ]);
  });

  it('remaps the highlighted point to the sorted position of the selected run', () => {
    const container = document.createElement('div');
    const { factory, configs } = makeChartFactory();
    const late = buildTrendRun({ windowStart: '2026-09-03T10:00:00.000Z', id: 'run-c', elapsed: 400 });
    const early = buildTrendRun({ windowStart: '2026-09-01T10:00:00.000Z', id: 'run-a', elapsed: 700 });

    // Input index 0 is `late`, which sorts last.
    renderTrends(container, [late, early], 'elapsedSeconds', () => {}, 0, { createChart: factory });

    const dataset = configs[0]!.data.datasets[0]!;
    expect(dataset.data).toEqual([700, 400]);
    expect(dataset.pointRadius).toEqual([3, 6]);
  });

  it('charts the selected secondary metric', () => {
    const container = document.createElement('div');
    const { factory, configs } = makeChartFactory();
    const run = buildTrendRun({ windowStart: '2026-09-01T10:00:00.000Z', id: 'run-a', elapsed: 700 });

    renderTrends(container, [run], 'idleSeconds', () => {}, null, { createChart: factory });

    expect(configs[0]!.data.datasets[0]!.label).toBe('Idle (s)');
    expect(configs[0]!.data.datasets[0]!.data).toEqual([10]);
  });
});

describe('renderTrends chart lifecycle', () => {
  it('destroys existing chart instance before rendering empty state', () => {
    const container = document.createElement('div');
    const { factory, instances } = makeChartFactory();

    // First render with data — creates a chart
    const run = buildTrendRun({ windowStart: '2026-09-01T10:00:00.000Z', id: 'run-1', elapsed: 600 });
    renderTrends(container, [run], 'elapsedSeconds', () => {}, null, { createChart: factory });
    expect(instances).toHaveLength(1);
    expect(instances[0]!.destroyed).toBe(false);

    // Second render with no data — must destroy previous chart and show empty
    renderTrends(container, [], 'elapsedSeconds', () => {}, null, { createChart: factory });
    expect(instances[0]!.destroyed).toBe(true);
    expect(container.querySelector('.trend-empty')).not.toBeNull();
    // No new chart instance created
    expect(instances).toHaveLength(1);
  });

  it('destroys previous chart when re-rendering with new data', () => {
    const container = document.createElement('div');
    const { factory, instances } = makeChartFactory();

    const run = buildTrendRun({ windowStart: '2026-09-01T10:00:00.000Z', id: 'run-1', elapsed: 600 });
    renderTrends(container, [run], 'elapsedSeconds', () => {}, null, { createChart: factory });
    expect(instances).toHaveLength(1);

    const run2 = buildTrendRun({ windowStart: '2026-09-02T10:00:00.000Z', id: 'run-2', elapsed: 500 });
    renderTrends(container, [run, run2], 'elapsedSeconds', () => {}, null, { createChart: factory });
    expect(instances[0]!.destroyed).toBe(true);
    expect(instances).toHaveLength(2);
    expect(instances[1]!.destroyed).toBe(false);
  });
});
