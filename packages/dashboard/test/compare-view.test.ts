import { describe, expect, it } from 'vitest';
import type { RunSummary } from '@sitbench/core/export';
import { renderCompare } from '../src/compare-view.js';

/**
 * Fixtures mirror the run pair captured in the live browser pass so the
 * assertions below pin the exact strings that were previously wrong
 * (`Fleet DPS +37s`, `Fleet Damage +53000s`, inverted elapsed sign).
 */
function buildRun(
  id: string,
  windowStart: string,
  metrics: Partial<RunSummary['metrics']>,
): RunSummary {
  return {
    schemaVersion: 1,
    parserVersion: '0.1.0',
    metricsVersion: '0.1.0',
    id,
    site: { name: 'Core Citadel', key: 'core-citadel' },
    fleetProfile: { id: 'kikis', name: '8 Kikis + 2 Deacons' },
    window: { start: windowStart, end: windowStart, source: 'outgoing-npc-damage', manuallyAdjusted: false },
    participants: ['Alpha'],
    calculation: { episodeThresholdSeconds: 180, activeCombatGapSeconds: 30 },
    metrics: {
      elapsedSeconds: 0,
      activeCombatSeconds: 0,
      idleSeconds: 0,
      fleetDamageDealt: 0,
      averageFleetDps: 0,
      activeFleetDps: 0,
      damageTaken: 0,
      remoteRepairDelivered: 0,
      participantCount: 1,
      ...metrics,
    },
    characterMetrics: [],
    coverage: {
      logFiles: 1,
      participantsWithOutgoingDamage: 1,
      unparsedCombatLines: 0,
      ambiguousEventsExcluded: 0,
      repairPairing: 'full',
    },
    notes: null,
    fingerprint: `fp-${id}`,
    createdAt: windowStart,
    updatedAt: windowStart,
  };
}

const runA = buildRun('run-a', '2026-08-31T16:00:00.000Z', {
  elapsedSeconds: 669,
  activeCombatSeconds: 607,
  idleSeconds: 62,
  fleetDamageDealt: 2_063_000,
  averageFleetDps: 2507,
  activeFleetDps: 2722,
  damageTaken: 214_000,
});

const runB = buildRun('run-b', '2026-08-30T16:00:00.000Z', {
  elapsedSeconds: 684,
  activeCombatSeconds: 631,
  idleSeconds: 53,
  fleetDamageDealt: 2_010_000,
  averageFleetDps: 2470,
  activeFleetDps: 2680,
  damageTaken: 220_000,
});

function render(): HTMLElement {
  const container = document.createElement('div');
  renderCompare(
    container,
    [runB, runA],
    runA.id,
    runB.id,
    { characters: true, notes: true },
    () => {},
    () => {},
  );
  return container;
}

function deltaCell(container: HTMLElement, metric: string): HTMLElement {
  const cell = container.querySelector<HTMLElement>(`tr[data-metric="${metric}"] .compare-delta`);
  if (cell === null) throw new Error(`No delta cell for metric ${metric}`);
  return cell;
}

function deltaText(container: HTMLElement, metric: string): string {
  const text = deltaCell(container, metric).querySelector<HTMLElement>('.delta-text');
  if (text === null) throw new Error(`No delta text for metric ${metric}`);
  return text.textContent ?? '';
}

function deltaDirection(container: HTMLElement, metric: string): string {
  const marker = deltaCell(container, metric).querySelector<HTMLElement>('.metric-delta');
  if (marker === null) throw new Error(`No delta marker for metric ${metric}`);
  return marker.dataset.direction ?? '';
}

describe('renderCompare metric deltas', () => {
  it('reports duration deltas as Run A minus Run B in signed seconds', () => {
    const container = render();
    expect(deltaText(container, 'elapsed')).toBe('-15s');
    expect(deltaText(container, 'active-combat')).toBe('-24s');
    expect(deltaText(container, 'idle')).toBe('+9s');
  });

  it('reports DPS and damage deltas as signed unitless grouped numbers', () => {
    const container = render();
    expect(deltaText(container, 'fleet-dps')).toBe('+37');
    expect(deltaText(container, 'active-dps')).toBe('+42');
    expect(deltaText(container, 'fleet-damage')).toBe('+53,000');
    expect(deltaText(container, 'damage-taken')).toBe('-6,000');
  });

  it('never suffixes a non-duration delta with a seconds unit', () => {
    const container = render();
    for (const metric of ['fleet-dps', 'active-dps', 'fleet-damage', 'damage-taken']) {
      expect(deltaText(container, metric)).not.toMatch(/s$/);
    }
  });

  it('colors direction by metric desirability, not by numeric sign', () => {
    const container = render();
    expect(deltaDirection(container, 'elapsed')).toBe('better');
    expect(deltaDirection(container, 'active-combat')).toBe('better');
    expect(deltaDirection(container, 'idle')).toBe('worse');
    expect(deltaDirection(container, 'fleet-dps')).toBe('better');
    expect(deltaDirection(container, 'active-dps')).toBe('better');
    expect(deltaDirection(container, 'fleet-damage')).toBe('better');
    expect(deltaDirection(container, 'damage-taken')).toBe('better');
  });

  it('exposes a text cue to assistive tech and hides the arrow glyph from it', () => {
    const container = render();
    const elapsed = deltaCell(container, 'elapsed');
    expect(elapsed.textContent).toContain('faster');
    expect(elapsed.querySelector('.delta-arrow')?.getAttribute('aria-hidden')).toBe('true');

    const fleetDps = deltaCell(container, 'fleet-dps');
    expect(fleetDps.textContent).toContain('better');
    expect(fleetDps.textContent).not.toContain('faster');

    const idle = deltaCell(container, 'idle');
    expect(idle.textContent).toContain('slower');
  });

  it('renders Run A and Run B values in their own columns', () => {
    const container = render();
    const row = container.querySelector<HTMLElement>('tr[data-metric="fleet-damage"]');
    const cells = Array.from(row?.querySelectorAll('td') ?? []).map((td) => td.textContent ?? '');
    expect(cells[0]).toBe('Fleet Damage');
    expect(cells[1]).toBe('2,063,000');
    expect(cells[2]).toBe('2,010,000');
  });

  it('keeps the metric table inside an explicit horizontal scroll wrapper', () => {
    const container = render();
    const wrapper = container.querySelector<HTMLElement>('.compare-scroll');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.querySelector('.compare-table')).not.toBeNull();
    expect(wrapper?.getAttribute('tabindex')).toBe('0');
  });

  it('pairs each run selector with its own label field and avoids em dashes', () => {
    const container = render();
    const fields = container.querySelectorAll('.compare-field');
    expect(fields.length).toBe(2);
    expect(container.querySelector('.compare-selectors')?.textContent ?? '').not.toContain('\u2014');
    const option = container.querySelector<HTMLOptionElement>('#compare-left-select option');
    expect(option?.textContent ?? '').not.toContain('\u2014');
  });
});
