import { describe, expect, it } from 'vitest';
import type { PublicRunSummary } from '../src/data.js';
import { renderDetail } from '../src/detail.js';

function character(character: string) {
  return {
    character,
    damageDealt: 0,
    fleetDamageShare: 0,
    averageDps: 0,
    activeDps: 0,
    damageTaken: 0,
    remoteRepairDelivered: 0,
    remoteRepairReceived: 0,
    shotsHit: 0,
    shotsMissed: 0,
    missRate: 0,
    hitQualityCounts: {},
    firstRelevantEvent: null,
    lastRelevantEvent: null,
  };
}

function buildRun(): PublicRunSummary {
  const characterMetrics = [
    {
      ...character('Alpha'),
      neutPressure: { totalGj: 12345, averageGjPerSecond: 205.75, peak10sGjPerSecond: 987.6, eventCount: 12 },
    },
    {
      ...character('Bravo'),
      neutPressure: { totalGj: 0, averageGjPerSecond: 0, peak10sGjPerSecond: 0, eventCount: 0 },
    },
    character('Legacy'),
  ];
  return {
    id: 'neut-run',
    comparisonOrder: 0,
    site: { name: 'Core Bastion', key: 'core-bastion' },
    fleetProfile: { id: 'default', name: 'Default' },
    window: { start: '2026-09-01T10:00:00.000Z', end: '2026-09-01T10:01:00.000Z', source: 'outgoing-npc-damage', manuallyAdjusted: false },
    calculation: { episodeThresholdSeconds: 180, activeCombatGapSeconds: 30 },
    metrics: {
      elapsedSeconds: 60,
      activeCombatSeconds: 30,
      idleSeconds: 30,
      fleetDamageDealt: 0,
      averageFleetDps: 0,
      activeFleetDps: 0,
      damageTaken: 0,
      remoteRepairDelivered: 0,
      participantCount: 3,
    },
    coverage: { logFiles: 3, participantsWithOutgoingDamage: 0, unparsedCombatLines: 0, ambiguousEventsExcluded: 0, repairPairing: 'none' },
    participants: ['Alpha', 'Bravo', 'Legacy'],
    characterMetrics,
  };
}

function neutTable(container: HTMLElement): HTMLTableElement {
  const table = container.querySelector<HTMLTableElement>('table[aria-label="Observed neut drain"]');
  expect(table, 'Observed neut drain table should be rendered').not.toBeNull();
  return table!;
}

function rowValues(table: HTMLTableElement, name: string): string[] {
  const row = Array.from(table.tBodies[0]!.rows).find((row) => row.cells[0]?.textContent === name);
  expect(row, `Neut metrics should include ${name}`).toBeDefined();
  return Array.from(row!.cells).map((cell) => cell.textContent ?? '');
}

describe('run detail observed neut drain', () => {
  it('keeps the metric explanation outside the horizontally scrolling table and associates it accessibly', () => {
    const container = document.createElement('div');
    renderDetail(container, buildRun(), { characters: true, notes: false });
    const table = neutTable(container);
    const descriptionId = table.getAttribute('aria-describedby');
    expect(descriptionId).toBeTruthy();
    const description = container.querySelector(`#${descriptionId}`);
    expect(description?.textContent).toContain('backfill from original logs');
    expect(table.parentElement?.contains(description)).toBe(false);
  });

  it('shows the supplied per-character totals, rates, and event counts with explicit units', () => {
    const container = document.createElement('div');
    renderDetail(container, buildRun(), { characters: true, notes: false });

    const table = neutTable(container);
    expect(Array.from(table.querySelectorAll('thead th')).map((cell) => cell.textContent)).toEqual([
      'Character', 'Total GJ', 'Avg GJ/s', 'Peak 10s GJ/s', 'Events',
    ]);
    expect(rowValues(table, 'Alpha')).toEqual(['Alpha', '12,345', '205.75', '987.6', '12']);
    expect(table.parentElement?.getAttribute('tabindex')).toBe('0');
    expect(table.parentElement?.getAttribute('aria-label')).toBe('Scrollable observed neut drain table');
  });

  it.each([
    { total: 48.6, average: 0.81, peak: 4.86, expected: ['48.6', '0.81', '4.86'] },
    { total: 2.4, average: 0.04, peak: 0.24, expected: ['2.4', '0.04', '0.24'] },
    { total: 102, average: 1.70, peak: 10.2, expected: ['102', '1.7', '10.2'] },
    { total: 1234.567, average: 20.5761, peak: 123.4567, expected: ['1,234.57', '20.58', '123.46'] },
  ])('preserves fractional drain at average $average GJ/s with up to two decimal places', ({ total, average, peak, expected }) => {
    const container = document.createElement('div');
    const run = buildRun();
    run.characterMetrics![0]!.neutPressure = {
      totalGj: total, averageGjPerSecond: average, peak10sGjPerSecond: peak, eventCount: 1,
    };
    renderDetail(container, run, { characters: true, notes: false });

    expect(rowValues(neutTable(container), 'Alpha')).toEqual(['Alpha', ...expected, '1']);
  });

  it('shows supported zero drain as zero in every metric cell', () => {
    const container = document.createElement('div');
    renderDetail(container, buildRun(), { characters: true, notes: false });

    expect(rowValues(neutTable(container), 'Bravo')).toEqual(['Bravo', '0', '0', '0', '0']);
  });

  it('labels missing legacy metrics unavailable rather than displaying zero', () => {
    const container = document.createElement('div');
    renderDetail(container, buildRun(), { characters: true, notes: false });

    expect(rowValues(neutTable(container), 'Legacy')).toEqual([
      'Legacy', 'Unavailable', 'Unavailable', 'Unavailable', 'Unavailable',
    ]);
  });

  it('hides all character neut information when the capability is false even if the run contains it', () => {
    const container = document.createElement('div');
    renderDetail(container, buildRun(), { characters: false, notes: false });

    expect(container.querySelectorAll('table')).toHaveLength(0);
    expect(container.textContent).not.toContain('Observed neut drain');
    expect(container.textContent).not.toContain('Alpha');
    expect(container.textContent).not.toContain('12,345');
  });

  it('removes prior character neut information when switching to a restricted view', () => {
    const container = document.createElement('div');
    const run = buildRun();
    renderDetail(container, run, { characters: true, notes: false });
    expect(rowValues(neutTable(container), 'Alpha')).toContain('12,345');

    renderDetail(container, run, { characters: false, notes: false });

    expect(container.querySelectorAll('table')).toHaveLength(0);
    expect(container.textContent).not.toContain('Alpha');
    expect(container.textContent).not.toContain('12,345');
  });
});
