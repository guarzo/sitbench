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

  it('does not depend on String.prototype.localeCompare for its sort order (mutation check)', () => {
    // Hand-derived expected payload: both events are identical except for
    // `actor` ("Zulu" vs "alpha"), so the JSON.stringify'd records differ
    // first, and only, at that field. Under strict code-unit ("ordinal")
    // comparison, 'Z' is U+005A (90) and 'a' is U+0061 (97), so the "Zulu"
    // record sorts first. This expectation is derived independently of
    // `localeCompare` — it is never called anywhere to compute it.
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

    // Mutation check: temporarily replace `String.prototype.localeCompare`
    // with an intentionally wrong collation (every comparison reports
    // "equal"). If `fingerprintRun` still depended on `localeCompare`
    // anywhere, `Array#sort`'s stability guarantee (ES2019+) would turn this
    // into a no-op sort, so the two input orderings below would then
    // produce two *different* digests (each equal to its own input order)
    // instead of both still matching the hand-derived expectation. This
    // proves the real digest behavior is unaffected by `localeCompare`,
    // regardless of how any particular environment's `localeCompare` itself
    // behaves — no assertion here depends on that behavior.
    const originalLocaleCompare = String.prototype.localeCompare;
    try {
      String.prototype.localeCompare = function intentionallyWrongCollation(): number {
        return 0;
      };

      const afterMutationSameOrder = fingerprintRun([eventAlpha, eventZulu], win);
      const afterMutationSwappedOrder = fingerprintRun([eventZulu, eventAlpha], win);

      expect(afterMutationSameOrder).toBe(expectedDigest);
      expect(afterMutationSwappedOrder).toBe(expectedDigest);
    } finally {
      String.prototype.localeCompare = originalLocaleCompare;
    }
  });
});
