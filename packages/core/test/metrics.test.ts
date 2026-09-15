import { describe, expect, it } from 'vitest';
import { calculateRun } from '../src/metrics.js';
import type { NeutReceived, NormalizedEvent, RunWindow } from '../src/schemas.js';

const BASE_MS = Date.parse('2026-01-01T00:00:00.000Z');

function atSeconds(seconds: number): string {
  return new Date(BASE_MS + seconds * 1000).toISOString();
}

function window(startSeconds: number, endSeconds: number): RunWindow {
  return {
    start: atSeconds(startSeconds),
    end: atSeconds(endSeconds),
    source: 'test-fixture',
    manuallyAdjusted: false,
  };
}

let lineCounter = 0;

function damageDealt(
  character: string,
  seconds: number,
  amount: number,
  overrides: Partial<Extract<NormalizedEvent, { kind: 'damage-dealt' }>> = {},
): NormalizedEvent {
  lineCounter += 1;
  return {
    kind: 'damage-dealt',
    timestamp: atSeconds(seconds),
    observedBy: character,
    sourceFile: 'metrics.txt',
    sourceLine: lineCounter,
    raw: `raw-${lineCounter}`,
    actor: character,
    target: 'Sleepless Guardian',
    amount,
    hitQuality: 'Hits',
    targetClassification: 'npc',
    ...overrides,
  };
}

function miss(
  character: string,
  seconds: number,
  overrides: Partial<Extract<NormalizedEvent, { kind: 'miss' }>> = {},
): NormalizedEvent {
  lineCounter += 1;
  return {
    kind: 'miss',
    timestamp: atSeconds(seconds),
    observedBy: character,
    sourceFile: 'metrics.txt',
    sourceLine: lineCounter,
    raw: `raw-${lineCounter}`,
    actor: character,
    target: 'Sleepless Guardian',
    targetClassification: 'npc',
    ...overrides,
  };
}

function damageTaken(character: string, seconds: number, amount: number): NormalizedEvent {
  lineCounter += 1;
  return {
    kind: 'damage-taken',
    timestamp: atSeconds(seconds),
    observedBy: character,
    sourceFile: 'metrics.txt',
    sourceLine: lineCounter,
    raw: `raw-${lineCounter}`,
    actor: 'Sleepless Guardian',
    target: character,
    amount,
    hitQuality: null,
  };
}

function repairDelivered(character: string, target: string, seconds: number, amount: number): NormalizedEvent {
  lineCounter += 1;
  return {
    kind: 'remote-repair-delivered',
    timestamp: atSeconds(seconds),
    observedBy: character,
    sourceFile: 'metrics.txt',
    sourceLine: lineCounter,
    raw: `raw-${lineCounter}`,
    actor: character,
    target,
    amount,
  };
}

function repairReceived(character: string, actor: string, seconds: number, amount: number): NormalizedEvent {
  lineCounter += 1;
  return {
    kind: 'remote-repair-received',
    timestamp: atSeconds(seconds),
    observedBy: character,
    sourceFile: 'metrics.txt',
    sourceLine: lineCounter,
    raw: `raw-${lineCounter}`,
    actor,
    target: character,
    amount,
  };
}

function neutReceived(character: string, seconds: number, amount: number): NeutReceived {
  lineCounter += 1;
  return {
    kind: 'neut-received',
    timestamp: atSeconds(seconds),
    observedBy: character,
    sourceFile: 'metrics.txt',
    sourceLine: lineCounter,
    raw: `raw-${lineCounter}`,
    actor: 'Sleepless Keeper',
    target: character,
    amount,
  };
}

describe('calculateRun neut pressure', () => {
  it('uses a half-open rolling 10-second peak while preserving simultaneous hits in unsorted input', () => {
    // At 9.999s: 120 + 120 + 60 = 300 GJ. At 10s the two 0s hits
    // expire, leaving 160 GJ; at 20s the 10s hit expires, leaving 200 GJ.
    const events = [
      neutReceived('Pilot One', 20, 200),
      neutReceived('Pilot One', 0, 120),
      neutReceived('Pilot One', 10, 100),
      neutReceived('Pilot One', 9.999, 60),
      neutReceived('Pilot One', 0, 120),
    ];
    const result = calculateRun(events, window(0, 20), undefined, { neutPressureAvailable: true });

    expect(result.characterMetrics[0]?.neutPressure).toEqual({
      totalGj: 600,
      averageGjPerSecond: 30,
      peak10sGjPerSecond: 30,
      eventCount: 5,
    });
    expect(events.map((event) => event.amount)).toEqual([200, 120, 100, 60, 120]);
  });

  it('clips inclusively and separates observers, supported zeros, and damage metrics in a short run', () => {
    // Elapsed = 5s. Alpha: 12.5 + 12.5 + 25 = 50 GJ; Bravo: 100 + 200 = 300 GJ.
    // Both peaks still divide by 10s, not elapsed time. Charlie receives no neuts.
    const events = [
      neutReceived('Bravo', 105, 200),
      neutReceived('Alpha', 99, 9000),
      neutReceived('Alpha', 100, 12.5),
      neutReceived('Bravo', 100, 100),
      neutReceived('Alpha', 100, 12.5),
      neutReceived('Alpha', 105, 25),
      neutReceived('Bravo', 106, 9000),
      neutReceived('Outside', 99, 9000),
      damageDealt('Charlie', 101, 50),
      damageDealt('Charlie', 104, 100),
      damageTaken('Alpha', 102, 400),
      repairDelivered('Bravo', 'Alpha', 103, 200),
      repairReceived('Alpha', 'Bravo', 103, 200),
    ];
    const result = calculateRun(events, window(100, 105), undefined, { neutPressureAvailable: true });

    expect(result.characterMetrics.map(({ character, neutPressure }) => ({ character, neutPressure }))).toEqual([
      { character: 'Alpha', neutPressure: { totalGj: 50, averageGjPerSecond: 10, peak10sGjPerSecond: 5, eventCount: 3 } },
      { character: 'Bravo', neutPressure: { totalGj: 300, averageGjPerSecond: 60, peak10sGjPerSecond: 30, eventCount: 2 } },
      { character: 'Charlie', neutPressure: { totalGj: 0, averageGjPerSecond: 0, peak10sGjPerSecond: 0, eventCount: 0 } },
    ]);
    expect(result.metrics).toEqual({
      elapsedSeconds: 5,
      activeCombatSeconds: 3,
      idleSeconds: 2,
      fleetDamageDealt: 150,
      averageFleetDps: 30,
      activeFleetDps: 50,
      damageTaken: 400,
      remoteRepairDelivered: 200,
      participantCount: 3,
    });
    expect(result.characterMetrics[0]).toMatchObject({
      damageTaken: 400, remoteRepairReceived: 200, shotsHit: 0,
      firstRelevantEvent: null, lastRelevantEvent: null,
    });
    expect(result.characterMetrics[2]).toMatchObject({
      damageDealt: 150, shotsHit: 2, firstRelevantEvent: atSeconds(101), lastRelevantEvent: atSeconds(104),
    });
  });

  it.each([undefined, { neutPressureAvailable: false }])('keeps pressure absent without recording support: %j', (options) => {
    const result = calculateRun([neutReceived('Alpha', 5, 120)], window(0, 20), undefined, options);

    expect(result.characterMetrics).toHaveLength(1);
    expect(result.characterMetrics[0]).not.toHaveProperty('neutPressure');
  });

  it('keeps total and peak pressure but returns a zero average for a zero-elapsed window', () => {
    const result = calculateRun([neutReceived('Alpha', 5, 120)], window(5, 5), undefined, {
      neutPressureAvailable: true,
    });

    expect(result.characterMetrics[0]?.neutPressure).toEqual({
      totalGj: 120, averageGjPerSecond: 0, peak10sGjPerSecond: 12, eventCount: 1,
    });
  });
});

describe('calculateRun', () => {
  it('computes elapsed time, fleet damage, average DPS, and per-character damage share (hand-derived)', () => {
    // Window: 0s..100s => elapsedSeconds = 100.
    // Dah Nee deals 3000, Other Pilot deals 2000 => fleetDamageDealt = 5000.
    // averageFleetDps = 5000 / 100 = 50.
    // Dah Nee fleetDamageShare = 3000 / 5000 = 0.6.
    const events = [damageDealt('Dah Nee', 10, 3000), damageDealt('Other Pilot', 50, 2000)];

    const result = calculateRun(events, window(0, 100));

    expect(result.metrics.elapsedSeconds).toBe(100);
    expect(result.metrics.fleetDamageDealt).toBe(5000);
    expect(result.metrics.averageFleetDps).toBe(50);
    expect(result.characterMetrics.find((x) => x.character === 'Dah Nee')?.fleetDamageShare).toBeCloseTo(0.6);
  });

  it('sums damage taken at the fleet and per-character level', () => {
    // Dah Nee takes 700 + 300 = 1000; Other Pilot takes 500. Fleet total = 1500.
    const events = [
      damageTaken('Dah Nee', 10, 700),
      damageTaken('Dah Nee', 20, 300),
      damageTaken('Other Pilot', 15, 500),
    ];

    const result = calculateRun(events, window(0, 50));

    expect(result.metrics.damageTaken).toBe(1500);
    expect(result.characterMetrics.find((x) => x.character === 'Dah Nee')?.damageTaken).toBe(1000);
    expect(result.characterMetrics.find((x) => x.character === 'Other Pilot')?.damageTaken).toBe(500);
  });

  it('sums remote repair delivered at the fleet level and tracks delivered/received per character', () => {
    // Dah Nee delivers 400 to Other Pilot (recorded from both logs); Dah Nee separately
    // receives 150 from an untracked logi pilot only visible in Dah Nee's own log.
    const events = [
      repairDelivered('Dah Nee', 'Other Pilot', 5, 400),
      repairReceived('Other Pilot', 'Dah Nee', 5, 400),
      repairReceived('Dah Nee', 'Logi Pilot', 20, 150),
    ];

    const result = calculateRun(events, window(0, 50));

    expect(result.metrics.remoteRepairDelivered).toBe(400);
    const dahNee = result.characterMetrics.find((x) => x.character === 'Dah Nee');
    expect(dahNee?.remoteRepairDelivered).toBe(400);
    expect(dahNee?.remoteRepairReceived).toBe(150);
    const otherPilot = result.characterMetrics.find((x) => x.character === 'Other Pilot');
    expect(otherPilot?.remoteRepairReceived).toBe(400);
    expect(otherPilot?.remoteRepairDelivered).toBe(0);
  });

  it('computes miss rate and hit-quality counts from qualifying NPC hits only', () => {
    // Dah Nee: 3 qualifying hits (Wrecking, Wrecking, Good) + 1 qualifying miss => missRate = 1/4 = 0.25.
    // A non-site miss must not count toward shotsMissed.
    const events = [
      damageDealt('Dah Nee', 5, 100, { hitQuality: 'Wrecking' }),
      damageDealt('Dah Nee', 10, 100, { hitQuality: 'Wrecking' }),
      damageDealt('Dah Nee', 15, 100, { hitQuality: 'Good' }),
      miss('Dah Nee', 20),
      miss('Dah Nee', 25, { targetClassification: 'non-site', target: 'Enemy Pilot' }),
    ];

    const result = calculateRun(events, window(0, 50));

    const dahNee = result.characterMetrics.find((x) => x.character === 'Dah Nee');
    expect(dahNee?.shotsHit).toBe(3);
    expect(dahNee?.shotsMissed).toBe(1);
    expect(dahNee?.missRate).toBeCloseTo(0.25);
    expect(dahNee?.hitQualityCounts).toEqual({ Wrecking: 2, Good: 1 });
  });

  it('reports first/last qualifying event timestamps per character, ignoring non-qualifying events', () => {
    const events = [
      damageTaken('Dah Nee', 5, 10),
      damageDealt('Dah Nee', 10, 100),
      damageDealt('Dah Nee', 80, 100),
      damageTaken('Dah Nee', 95, 10),
    ];

    const result = calculateRun(events, window(0, 100));

    const dahNee = result.characterMetrics.find((x) => x.character === 'Dah Nee');
    expect(dahNee?.firstRelevantEvent).toBe(atSeconds(10));
    expect(dahNee?.lastRelevantEvent).toBe(atSeconds(80));
  });

  it('reports zeroed damage metrics and null relevant-event timestamps for a repair-only participant', () => {
    const events = [repairDelivered('Logi Nee', 'Dah Nee', 10, 300)];

    const result = calculateRun(events, window(0, 50));

    expect(result.metrics.fleetDamageDealt).toBe(0);
    expect(result.metrics.averageFleetDps).toBe(0);
    expect(result.metrics.activeFleetDps).toBe(0);
    expect(result.metrics.participantCount).toBe(1);

    const logiNee = result.characterMetrics.find((x) => x.character === 'Logi Nee');
    expect(logiNee).toMatchObject({
      damageDealt: 0,
      fleetDamageShare: 0,
      averageDps: 0,
      activeDps: 0,
      shotsHit: 0,
      shotsMissed: 0,
      missRate: 0,
      hitQualityCounts: {},
      firstRelevantEvent: null,
      lastRelevantEvent: null,
      remoteRepairDelivered: 300,
    });
  });

  it('adds the full gap to active combat when <= threshold and zero when > threshold (0, 30, 61)', () => {
    // Gaps: 30 (<=30 => +30), 31 (>30 => +0). activeCombatSeconds = 30.
    // elapsedSeconds = 61 (window matches last event). idleSeconds = 61 - 30 = 31.
    const events = [damageDealt('Dah Nee', 0, 10), damageDealt('Dah Nee', 30, 10), damageDealt('Dah Nee', 61, 10)];

    const result = calculateRun(events, window(0, 61));

    expect(result.metrics.activeCombatSeconds).toBe(30);
    expect(result.metrics.idleSeconds).toBe(31);
  });

  it('yields zero active-combat seconds for a lone qualifying event', () => {
    const events = [damageDealt('Dah Nee', 0, 10)];

    const result = calculateRun(events, window(0, 10));

    expect(result.metrics.activeCombatSeconds).toBe(0);
    expect(result.metrics.idleSeconds).toBe(10);
  });

  it('returns default calculation settings unchanged when none are supplied', () => {
    const result = calculateRun([], window(0, 0));

    expect(result.calculation).toEqual({ episodeThresholdSeconds: 180, activeCombatGapSeconds: 30 });
  });

  it('returns custom calculation settings unchanged when supplied', () => {
    const result = calculateRun([], window(0, 0), { episodeThresholdSeconds: 60, activeCombatGapSeconds: 15 });

    expect(result.calculation).toEqual({ episodeThresholdSeconds: 60, activeCombatGapSeconds: 15 });
  });

  it('emits zero instead of NaN/Infinity for every zero-denominator metric on an empty run', () => {
    const result = calculateRun([], window(0, 0));

    expect(result.metrics).toMatchObject({
      elapsedSeconds: 0,
      activeCombatSeconds: 0,
      idleSeconds: 0,
      fleetDamageDealt: 0,
      averageFleetDps: 0,
      activeFleetDps: 0,
      damageTaken: 0,
      remoteRepairDelivered: 0,
      participantCount: 0,
    });
    expect(result.characterMetrics).toEqual([]);
  });
});
