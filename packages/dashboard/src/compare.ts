import type { CharacterMetrics } from '@sitbench/core/export';
import type { DashboardRun } from './data.js';

// ---------------------------------------------------------------------------
// Comparison chronology
// ---------------------------------------------------------------------------

/**
 * Comparison order for local runs: `(createdAt, id)`, matching core's
 * `compareMatchingRuns`. Local RunSummary always has createdAt. Public runs
 * have `comparisonOrder` instead — callers use that field directly.
 */
export function comparisonOrder(a: DashboardRun, b: DashboardRun): number {
  // Local runs (have createdAt)
  if ('createdAt' in a && 'createdAt' in b) {
    const cmp = (a as { createdAt: string }).createdAt.localeCompare((b as { createdAt: string }).createdAt);
    if (cmp !== 0) return cmp;
    return a.id.localeCompare(b.id);
  }
  // Public runs (have comparisonOrder)
  if ('comparisonOrder' in a && 'comparisonOrder' in b) {
    const cmp = (a as { comparisonOrder: number }).comparisonOrder - (b as { comparisonOrder: number }).comparisonOrder;
    if (cmp !== 0) return cmp;
    return a.id.localeCompare(b.id);
  }
  // Fallback: window.start + id
  const cmp = a.window.start.localeCompare(b.window.start);
  if (cmp !== 0) return cmp;
  return a.id.localeCompare(b.id);
}

// ---------------------------------------------------------------------------
// Trailing-five helper
// ---------------------------------------------------------------------------

const TRAILING_WINDOW_SIZE = 5;

/**
 * Returns the up-to-five matching runs immediately before `currentIndex`
 * in a chronologically sorted (ascending) array. The current run itself
 * is never included.
 */
export function trailingFiveRuns(sortedRuns: DashboardRun[], currentIndex: number): DashboardRun[] {
  const start = Math.max(0, currentIndex - TRAILING_WINDOW_SIZE);
  return sortedRuns.slice(start, currentIndex);
}

/**
 * Average elapsed seconds of the trailing-five runs, or null when there
 * are no prior runs.
 */
export function trailingFiveAverage(sortedRuns: DashboardRun[], currentIndex: number): number | null {
  const trailing = trailingFiveRuns(sortedRuns, currentIndex);
  if (trailing.length === 0) return null;
  return trailing.reduce((sum, run) => sum + run.metrics.elapsedSeconds, 0) / trailing.length;
}

// ---------------------------------------------------------------------------
// Best run
// ---------------------------------------------------------------------------

/**
 * Returns the run with the lowest elapsed time up to and including the
 * current index. When tied, the earlier (lower index) run wins.
 */
export function bestRunUpTo(sortedRuns: DashboardRun[], currentIndex: number): DashboardRun | null {
  const candidates = sortedRuns.slice(0, currentIndex + 1);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, run) =>
    run.metrics.elapsedSeconds < best.metrics.elapsedSeconds ? run : best,
  );
}

// ---------------------------------------------------------------------------
// Previous run
// ---------------------------------------------------------------------------

/** The run immediately before the current index, or null. */
export function previousRun(sortedRuns: DashboardRun[], currentIndex: number): DashboardRun | null {
  return currentIndex > 0 ? (sortedRuns[currentIndex - 1] ?? null) : null;
}

// ---------------------------------------------------------------------------
// Character-row alignment for two-run comparison
// ---------------------------------------------------------------------------

export interface AlignedCharacterRow {
  character: string;
  left: CharacterMetrics | null;
  right: CharacterMetrics | null;
}

/**
 * Aligns character metrics from two runs by exact character name. Characters
 * present in only one run appear with null on the other side.
 */
export function alignCharacterRows(
  leftMetrics: CharacterMetrics[] | undefined,
  rightMetrics: CharacterMetrics[] | undefined,
): AlignedCharacterRow[] {
  const left = leftMetrics ?? [];
  const right = rightMetrics ?? [];
  const allNames = new Set([...left.map((c) => c.character), ...right.map((c) => c.character)]);
  const leftMap = new Map(left.map((c) => [c.character, c]));
  const rightMap = new Map(right.map((c) => [c.character, c]));

  return Array.from(allNames)
    .sort()
    .map((character) => ({
      character,
      left: leftMap.get(character) ?? null,
      right: rightMap.get(character) ?? null,
    }));
}
