import { describe, expect, it } from 'vitest';
import type { RunSummary } from '@sitbench/core/export';
import { renderOverview } from '../src/overview.js';

function buildRun(id: string, createdAt: string, elapsedSeconds: number): RunSummary {
  return {
    schemaVersion: 1,
    parserVersion: '0.1.0',
    metricsVersion: '0.1.0',
    id,
    site: { name: 'Core Citadel', key: 'core-citadel' },
    fleetProfile: { id: 'kikis', name: '8 Kikis + 2 Deacons' },
    window: { start: createdAt, end: createdAt, source: 'outgoing-npc-damage', manuallyAdjusted: false },
    participants: ['Alpha'],
    calculation: { episodeThresholdSeconds: 180, activeCombatGapSeconds: 30 },
    metrics: {
      elapsedSeconds,
      activeCombatSeconds: 607,
      idleSeconds: 62,
      fleetDamageDealt: 2_063_000,
      averageFleetDps: 2507,
      activeFleetDps: 2722,
      damageTaken: 214_000,
      remoteRepairDelivered: 213_500,
      participantCount: 3,
    },
    characterMetrics: [],
    coverage: {
      logFiles: 3,
      participantsWithOutgoingDamage: 3,
      unparsedCombatLines: 0,
      ambiguousEventsExcluded: 0,
      repairPairing: 'full',
    },
    notes: null,
    fingerprint: `fp-${id}`,
    createdAt,
    updatedAt: createdAt,
  };
}

const runs = [
  buildRun('run-1', '2026-08-29T16:00:00.000Z', 700),
  buildRun('run-2', '2026-08-30T16:00:00.000Z', 684),
  buildRun('run-3', '2026-08-31T16:00:00.000Z', 669),
];

const dataset = {
  schemaVersion: 1 as const,
  mode: 'local' as const,
  generatedAt: '2026-09-01T00:00:00.000Z',
  capabilities: { characters: true as const, notes: true as const },
  runs,
};

function render(): HTMLElement {
  const container = document.createElement('div');
  renderOverview(container, runs, 2, dataset);
  return container;
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function comparison(container: HTMLElement, key: string): HTMLElement {
  const item = container.querySelector<HTMLElement>(`[data-comparison="${key}"]`);
  if (item === null) throw new Error(`No comparison item for ${key}`);
  return item;
}

describe('renderOverview hierarchy', () => {
  it('renders a single metric band instead of a grid of identical cards', () => {
    const container = render();
    expect(container.querySelectorAll('.overview-band').length).toBe(1);
    expect(container.querySelectorAll('.overview-card').length).toBe(0);
  });

  it('makes elapsed the primary value outside the delta and fleet groups', () => {
    const container = render();
    const primary = container.querySelector<HTMLElement>('.overview-primary');
    expect(primary?.textContent).toContain('11m 9s');
    expect(primary?.closest('.overview-deltas')).toBeNull();
    expect(primary?.closest('.overview-fleet')).toBeNull();
  });

  it('groups the comparison deltas together and the fleet metrics separately', () => {
    const container = render();
    const deltas = container.querySelector<HTMLElement>('.overview-deltas');
    const fleet = container.querySelector<HTMLElement>('.overview-fleet');
    expect(deltas).not.toBeNull();
    expect(fleet).not.toBeNull();
    expect(deltas?.querySelectorAll('[data-comparison]').length).toBe(3);
    expect(fleet?.querySelectorAll('[data-metric]').length).toBe(3);
    expect(fleet?.textContent).toContain('2,507');
    expect(fleet?.textContent).toContain('2,722');
  });

  it('renders each comparison delta exactly once, with no duplicated subline', () => {
    const container = render();
    expect(occurrences(comparison(container, 'previous').textContent ?? '', '-15s')).toBe(1);
    expect(occurrences(comparison(container, 'best').textContent ?? '', '0s')).toBe(1);
    expect(occurrences(comparison(container, 'trailing-five').textContent ?? '', '-23s')).toBe(1);
    const all = container.textContent ?? '';
    expect(occurrences(all, '-15s')).toBe(1);
    expect(occurrences(all, '-23s')).toBe(1);
  });

  it('exposes a text cue for each delta and hides the arrow glyph from assistive tech', () => {
    const container = render();
    const previous = comparison(container, 'previous');
    expect(previous.textContent).toContain('faster');
    expect(previous.querySelector('.delta-arrow')?.getAttribute('aria-hidden')).toBe('true');
    expect(previous.querySelector<HTMLElement>('.metric-delta')?.dataset.direction).toBe('better');

    const best = comparison(container, 'best');
    expect(best.textContent).toContain('unchanged');
    expect(best.querySelector<HTMLElement>('.metric-delta')?.dataset.direction).toBe('same');
  });

  it('labels each comparison without repeating the value in the label', () => {
    const container = render();
    expect(comparison(container, 'previous').textContent).toContain('vs Previous');
    expect(comparison(container, 'best').textContent).toContain('vs Best');
    expect(comparison(container, 'trailing-five').textContent).toContain('vs Trailing 5');
  });

  it('omits comparison items that have no baseline run', () => {
    const container = document.createElement('div');
    renderOverview(container, [runs[0]!], 0, dataset);
    expect(container.querySelector('[data-comparison="previous"]')).toBeNull();
    expect(container.querySelector('[data-comparison="trailing-five"]')).toBeNull();
    expect(container.querySelector('[data-comparison="best"]')).not.toBeNull();
    expect(container.querySelector('.overview-primary')?.textContent).toContain('11m 40s');
  });

  it('shows an empty message when nothing matches', () => {
    const container = document.createElement('div');
    renderOverview(container, [], -1, dataset);
    expect(container.querySelector('.overview-empty')?.textContent).toBe('No matching runs.');
  });
});
