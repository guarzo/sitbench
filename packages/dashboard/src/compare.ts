import type { CharacterMetrics } from '@sitbench/core/export';
import type { DashboardRun } from './data.js';

// ---------------------------------------------------------------------------
// Comparison chronology
// ---------------------------------------------------------------------------

/**
 * Returns the exact `(site.key, fleetProfile.id)` group key for a run. Used
 * to determine whether `comparisonOrder` (assigned per group by core's
 * `assignComparisonOrder`, restarting at 0 in every group) is meaningful
 * between two runs.
 */
export function groupKeyOf(run: DashboardRun): string {
  return `${run.site.key}\u0000${run.fleetProfile.id}`;
}

/** Whether two runs belong to the exact same `(site.key, fleetProfile.id)` group. */
export function sameGroup(a: DashboardRun, b: DashboardRun): boolean {
  return a.site.key === b.site.key && a.fleetProfile.id === b.fleetProfile.id;
}

/**
 * Comparison chronology within a single `(site.key, fleetProfile.id)` group:
 * `(createdAt, id)` for local runs (matching core's `compareMatchingRuns`),
 * `(comparisonOrder, id)` for public runs.
 *
 * This function may ONLY compare runs from the exact same group -- it throws
 * otherwise. Public `comparisonOrder` is assigned per group by core's
 * `assignComparisonOrder`, restarting at 0 in every group, so it is a real
 * total order ONLY within one group; a run's window.start does not respect
 * group boundaries either. A comparator that used `(comparisonOrder, id)`
 * for same-group pairs but fell back to `(window.start, id)` for cross-group
 * pairs was NOT transitive: three runs could form a cycle (A<B, B<C, but
 * C<A), so `sort`/`reduce` silently depended on array traversal order.
 * Throwing on cross-group misuse makes that mistake impossible to make
 * silently; callers must pre-partition by group first (see
 * `sameGroupChronologyRuns` below, and `newestRun` in state.ts, which does
 * exactly that for the whole-dataset case).
 */
export function matchingGroupChronology(a: DashboardRun, b: DashboardRun): number {
  if (!sameGroup(a, b)) {
    throw new Error(
      'matchingGroupChronology can only compare runs from the exact same (site.key, fleetProfile.id) group; ' +
        `got ("${a.site.key}", "${a.fleetProfile.id}") vs ("${b.site.key}", "${b.fleetProfile.id}"). ` +
        'Partition runs by group before comparing (see sameGroupChronologyRuns / newestRun).',
    );
  }
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
  // Mixed/unexpected shape (should not occur -- a dataset is exclusively
  // local or public): fall back to window.start + id.
  const cmp = a.window.start.localeCompare(b.window.start);
  if (cmp !== 0) return cmp;
  return a.id.localeCompare(b.id);
}

/**
 * Returns the runs from `runs` that share `referenceRun`'s exact
 * `(site.key, fleetProfile.id)` group, sorted oldest-to-newest by
 * matching-group chronology. Used to scope the overview's
 * previous/best/trailing-five comparisons and the default previous-run
 * comparison to a single valid chronology, even when the active filter
 * spans multiple groups ("All Sites"/"All Profiles"). Returns an empty array
 * when there is no reference run.
 */
export function sameGroupChronologyRuns(runs: DashboardRun[], referenceRun: DashboardRun | null): DashboardRun[] {
  if (referenceRun === null) return [];
  return runs.filter((run) => sameGroup(run, referenceRun)).sort(matchingGroupChronology);
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
