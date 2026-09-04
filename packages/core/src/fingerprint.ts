import { createHash } from 'node:crypto';
import type { NormalizedEvent, RunWindow } from './schemas.js';

/**
 * A stable, minimal identity record extracted from a normalized event.
 * Field order is fixed regardless of the source object's own key order, so
 * two logically identical events always serialize identically.
 */
interface FingerprintRecord {
  timestamp: string;
  kind: string;
  actor: string;
  target: string;
  amount: number | null;
  observedBy: string;
  sourceFile: string;
  sourceLine: number;
}

function toRecord(event: NormalizedEvent): FingerprintRecord {
  return {
    timestamp: event.timestamp,
    kind: event.kind,
    actor: event.actor,
    target: event.target,
    amount: 'amount' in event ? event.amount : null,
    observedBy: event.observedBy,
    sourceFile: event.sourceFile,
    sourceLine: event.sourceLine,
  };
}

/** Deterministic total order for records; identical records collapse to the same key. */
function recordSortKey(record: FingerprintRecord): string {
  return JSON.stringify(record);
}

/**
 * Strict code-unit (ordinal) string comparison. Deliberately NOT
 * `String.prototype.localeCompare`: locale-aware collation depends on the
 * running process's ICU data and default locale (e.g. it conventionally
 * sorts "alpha" before "Zulu" alphabetically, while ordinal comparison sorts
 * "Zulu" first because 'Z' (U+005A) is a lower code unit than 'a' (U+0061)).
 * A fingerprint must hash identically across every environment, so sorting
 * must never depend on locale/ICU configuration.
 */
function compareCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Produces a stable content-based fingerprint for a confirmed run window.
 *
 * Only events whose timestamp falls inside `[window.start, window.end]`
 * (inclusive) contribute. Each contributing event is reduced to a fixed-order
 * identity record (timestamp, kind, actor, target, amount, observedBy,
 * sourceFile, sourceLine) so source object key ordering never affects the
 * result. Records are sorted before hashing so event array order never
 * affects the result either, while event multiplicity (duplicate records)
 * is preserved. The confirmed window bounds are included in the hashed
 * payload so a window adjustment always changes the fingerprint even when
 * the same events remain in view.
 */
export function fingerprintRun(events: NormalizedEvent[], window: RunWindow): string {
  const startMs = Date.parse(window.start);
  const endMs = Date.parse(window.end);

  const records = events
    .filter((event) => {
      const timestampMs = Date.parse(event.timestamp);
      return timestampMs >= startMs && timestampMs <= endMs;
    })
    .map(toRecord)
    .sort((a, b) => compareCodeUnits(recordSortKey(a), recordSortKey(b)));

  const payload = {
    windowStart: window.start,
    windowEnd: window.end,
    records,
  };

  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
