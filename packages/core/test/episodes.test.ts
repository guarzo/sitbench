import { describe, expect, it } from 'vitest';
import { detectEpisodes } from '../src/episodes.js';
import type { DamageDealt, DamageTaken } from '../src/schemas.js';

const BASE_MS = Date.parse('2026-01-01T00:00:00.000Z');

function atSeconds(seconds: number): string {
  return new Date(BASE_MS + seconds * 1000).toISOString();
}

let lineCounter = 0;

function npcDamage(seconds: number, overrides: Partial<DamageDealt> = {}): DamageDealt {
  lineCounter += 1;
  return {
    kind: 'damage-dealt',
    timestamp: atSeconds(seconds),
    observedBy: 'Dah Nee',
    sourceFile: 'episodes.txt',
    sourceLine: lineCounter,
    raw: `raw-${lineCounter}`,
    actor: 'Dah Nee',
    target: 'Sleepless Guardian',
    amount: 100,
    hitQuality: 'Hits',
    targetClassification: 'npc',
    ...overrides,
  };
}

function incomingDamage(seconds: number, overrides: Partial<DamageTaken> = {}): DamageTaken {
  lineCounter += 1;
  return {
    kind: 'damage-taken',
    timestamp: atSeconds(seconds),
    observedBy: 'Dah Nee',
    sourceFile: 'episodes.txt',
    sourceLine: lineCounter,
    raw: `raw-${lineCounter}`,
    actor: 'Sleepless Guardian',
    target: 'Dah Nee',
    amount: 50,
    hitQuality: null,
    ...overrides,
  };
}

describe('detectEpisodes', () => {
  it('keeps events 179 seconds apart in a single episode (gap below threshold)', () => {
    const episodes = detectEpisodes([npcDamage(0), npcDamage(179)]);

    expect(episodes).toHaveLength(1);
    expect(episodes[0]).toMatchObject({
      start: atSeconds(0),
      end: atSeconds(179),
      qualifyingEventCount: 2,
      previousQualifyingActivityAt: null,
      nextQualifyingActivityAt: null,
    });
  });

  it('splits events exactly 180 seconds apart into two episodes (gap equals threshold)', () => {
    const episodes = detectEpisodes([npcDamage(0), npcDamage(180)]);

    expect(episodes).toHaveLength(2);
    expect(episodes[0]).toMatchObject({
      start: atSeconds(0),
      end: atSeconds(0),
      qualifyingEventCount: 1,
      previousQualifyingActivityAt: null,
      nextQualifyingActivityAt: atSeconds(180),
    });
    expect(episodes[1]).toMatchObject({
      start: atSeconds(180),
      end: atSeconds(180),
      qualifyingEventCount: 1,
      previousQualifyingActivityAt: atSeconds(0),
      nextQualifyingActivityAt: null,
    });
  });

  it('splits events 181 seconds apart into two episodes (gap above threshold)', () => {
    const episodes = detectEpisodes([npcDamage(0), npcDamage(181)]);

    expect(episodes).toHaveLength(2);
    expect(episodes[0].end).toBe(atSeconds(0));
    expect(episodes[1].start).toBe(atSeconds(181));
  });

  it('produces [0,20] and [200,210] for a mixed sequence with one large gap', () => {
    const episodes = detectEpisodes([
      npcDamage(0),
      npcDamage(10),
      npcDamage(20),
      npcDamage(200),
      npcDamage(210),
    ]);

    expect(episodes).toHaveLength(2);
    expect(episodes[0]).toMatchObject({
      start: atSeconds(0),
      end: atSeconds(20),
      qualifyingEventCount: 3,
      previousQualifyingActivityAt: null,
      nextQualifyingActivityAt: atSeconds(200),
    });
    expect(episodes[1]).toMatchObject({
      start: atSeconds(200),
      end: atSeconds(210),
      qualifyingEventCount: 2,
      previousQualifyingActivityAt: atSeconds(20),
      nextQualifyingActivityAt: null,
    });
  });

  it('does not merge episodes across an intervening incoming-damage event', () => {
    const episodes = detectEpisodes([
      npcDamage(0),
      incomingDamage(90, { amount: 99999 }),
      npcDamage(200),
    ]);

    expect(episodes).toHaveLength(2);
    expect(episodes[0]).toMatchObject({ start: atSeconds(0), end: atSeconds(0), qualifyingEventCount: 1 });
    expect(episodes[1]).toMatchObject({ start: atSeconds(200), end: atSeconds(200), qualifyingEventCount: 1 });
  });

  it('ignores non-npc damage-dealt targets when detecting episodes', () => {
    const episodes = detectEpisodes([
      npcDamage(0),
      npcDamage(50, { targetClassification: 'non-site', target: 'Enemy Pilot' }),
      npcDamage(60, { targetClassification: 'ambiguous', target: 'Unknown Contact' }),
      npcDamage(70),
    ]);

    expect(episodes).toHaveLength(1);
    expect(episodes[0].qualifyingEventCount).toBe(2);
  });

  it('honours a custom episodeThresholdSeconds option', () => {
    const episodes = detectEpisodes([npcDamage(0), npcDamage(50)], { episodeThresholdSeconds: 40 });

    expect(episodes).toHaveLength(2);
  });

  it('returns an empty array when there are no qualifying events', () => {
    expect(detectEpisodes([incomingDamage(0)])).toEqual([]);
  });
});
