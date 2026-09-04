import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fingerprintRun } from '../src/fingerprint.js';
import type { NormalizedEvent, RunWindow } from '../src/schemas.js';

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

function damageDealt(
  seconds: number,
  overrides: Partial<Extract<NormalizedEvent, { kind: 'damage-dealt' }>> = {},
): NormalizedEvent {
  return {
    kind: 'damage-dealt',
    timestamp: atSeconds(seconds),
    observedBy: 'Dah Nee',
    sourceFile: 'fingerprint.txt',
    sourceLine: 1,
    raw: 'raw-line',
    actor: 'Dah Nee',
    target: 'Sleepless Guardian',
    amount: 100,
    hitQuality: 'Hits',
    targetClassification: 'npc',
    ...overrides,
  };
}

describe('fingerprintRun', () => {
  it('is insensitive to source object-key ordering of identical stable event data', () => {
    const eventA: NormalizedEvent = {
      kind: 'damage-dealt',
      timestamp: atSeconds(5),
      observedBy: 'Dah Nee',
      sourceFile: 'a.txt',
      sourceLine: 10,
      raw: 'raw-a',
      actor: 'Dah Nee',
      target: 'Sleepless Guardian',
      amount: 250,
      hitQuality: 'Wrecking',
      targetClassification: 'npc',
    };

    // Same data, but constructed with keys in a different order.
    const eventB: NormalizedEvent = {
      targetClassification: 'npc',
      hitQuality: 'Wrecking',
      amount: 250,
      target: 'Sleepless Guardian',
      actor: 'Dah Nee',
      raw: 'raw-a',
      sourceLine: 10,
      sourceFile: 'a.txt',
      observedBy: 'Dah Nee',
      timestamp: atSeconds(5),
      kind: 'damage-dealt',
    };

    const win = window(0, 50);
    expect(fingerprintRun([eventA], win)).toBe(fingerprintRun([eventB], win));
  });

  it('changes when a source timestamp changes', () => {
    const win = window(0, 50);
    const base = fingerprintRun([damageDealt(5)], win);
    const changed = fingerprintRun([damageDealt(6)], win);
    expect(changed).not.toBe(base);
  });

  it('changes when a source line changes', () => {
    const win = window(0, 50);
    const base = fingerprintRun([damageDealt(5, { sourceLine: 1 })], win);
    const changed = fingerprintRun([damageDealt(5, { sourceLine: 2 })], win);
    expect(changed).not.toBe(base);
  });

  it('changes when the confirmed window start or end changes, even with identical events', () => {
    const events = [damageDealt(5)];
    const base = fingerprintRun(events, window(0, 50));
    const changedStart = fingerprintRun(events, window(1, 50));
    const changedEnd = fingerprintRun(events, window(0, 51));
    expect(changedStart).not.toBe(base);
    expect(changedEnd).not.toBe(base);
  });

  it('excludes events outside the confirmed window (inclusive boundaries only)', () => {
    const inWindow = damageDealt(10);
    const beforeWindow = damageDealt(-1, { sourceLine: 2 });
    const afterWindow = damageDealt(51, { sourceLine: 3 });

    const win = window(0, 50);
    const withOnlyInWindow = fingerprintRun([inWindow], win);
    const withAllThree = fingerprintRun([inWindow, beforeWindow, afterWindow], win);

    expect(withAllThree).toBe(withOnlyInWindow);
  });

  it('includes events exactly at the inclusive window boundaries', () => {
    const win = window(0, 50);
    const atStart = damageDealt(0, { sourceLine: 1 });
    const atEnd = damageDealt(50, { sourceLine: 2 });

    const withBoundaries = fingerprintRun([atStart, atEnd], win);
    const withoutBoundaries = fingerprintRun([], win);

    expect(withBoundaries).not.toBe(withoutBoundaries);
  });

  it('preserves event multiplicity: two identical qualifying events change the fingerprint versus one', () => {
    const win = window(0, 50);
    const single = fingerprintRun([damageDealt(5, { sourceLine: 1 })], win);
    const doubled = fingerprintRun(
      [damageDealt(5, { sourceLine: 1 }), damageDealt(5, { sourceLine: 1 })],
      win,
    );
    expect(doubled).not.toBe(single);
  });

  it('is order-independent for the same set of events', () => {
    const win = window(0, 50);
    const eventOne = damageDealt(5, { sourceLine: 1 });
    const eventTwo = damageDealt(10, { sourceLine: 2 });

    expect(fingerprintRun([eventOne, eventTwo], win)).toBe(fingerprintRun([eventTwo, eventOne], win));
  });

  it('returns a 64-character lowercase hex SHA-256 digest', () => {
    const result = fingerprintRun([damageDealt(5)], window(0, 50));
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces a stable fingerprint for an empty event list', () => {
    const win = window(0, 0);
    expect(fingerprintRun([], win)).toBe(fingerprintRun([], win));
  });

  it('sorts by strict code-unit comparison, not locale-aware collation (environment-independent digest)', () => {
    // `String.prototype.localeCompare` alphabetizes case-insensitively-ish,
    // so "alpha" conventionally sorts before "Zulu". Strict code-unit
    // comparison sorts the other way: 'Z' is U+005A (90) and 'a' is U+0061
    // (97), so "Zulu" sorts first. A fingerprint must hash identically on
    // every machine regardless of its default locale/ICU data, so it must
    // use code-unit comparison. This test hand-derives the expected sha256
    // digest assuming code-unit ordering (the "Zulu" record first) without
    // ever calling `localeCompare` to compute the expectation.
    const win = window(0, 50);
    const eventZulu = damageDealt(5, { actor: 'Zulu', sourceLine: 1 });
    const eventAlpha = damageDealt(5, { actor: 'alpha', sourceLine: 1 });

    const expectedPayload = {
      windowStart: win.start,
      windowEnd: win.end,
      records: [
        {
          timestamp: atSeconds(5),
          kind: 'damage-dealt',
          actor: 'Zulu',
          target: 'Sleepless Guardian',
          amount: 100,
          observedBy: 'Dah Nee',
          sourceFile: 'fingerprint.txt',
          sourceLine: 1,
        },
        {
          timestamp: atSeconds(5),
          kind: 'damage-dealt',
          actor: 'alpha',
          target: 'Sleepless Guardian',
          amount: 100,
          observedBy: 'Dah Nee',
          sourceFile: 'fingerprint.txt',
          sourceLine: 1,
        },
      ],
    };
    const expectedDigest = createHash('sha256').update(JSON.stringify(expectedPayload)).digest('hex');

    // Feed the events in the opposite (alpha, then Zulu) order to prove the
    // sort itself — not incidental input order — produces this result.
    expect(fingerprintRun([eventAlpha, eventZulu], win)).toBe(expectedDigest);

    // Sanity check: this scenario genuinely distinguishes code-unit order
    // from this environment's locale-aware collation (if it didn't, the
    // test above would be unable to detect a regression back to
    // `localeCompare`).
    expect('Zulu'.localeCompare('alpha')).toBeGreaterThan(0);
  });
});
