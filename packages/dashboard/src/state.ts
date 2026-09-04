import type { DashboardDataset, DashboardRun } from './data.js';
import { groupKeyOf, matchingGroupChronology } from './compare.js';

// ---------------------------------------------------------------------------
// Filter state
// ---------------------------------------------------------------------------

export interface FilterState {
  siteKey: string | null;
  fleetProfileId: string | null;
  dateFrom: string | null;
  dateTo: string | null;
}

// ---------------------------------------------------------------------------
// Dashboard state
// ---------------------------------------------------------------------------

export interface DashboardState {
  dataset: DashboardDataset;
  filter: FilterState;
  selectedRunId: string | null;
  compareRunId: string | null;
}

// ---------------------------------------------------------------------------
// Derived helpers
// ---------------------------------------------------------------------------

/** Unique site options from the dataset, in the order first encountered. */
export function siteOptions(dataset: DashboardDataset): Array<{ key: string; name: string }> {
  const seen = new Map<string, string>();
  for (const run of dataset.runs) {
    if (!seen.has(run.site.key)) {
      seen.set(run.site.key, run.site.name);
    }
  }
  return Array.from(seen.entries()).map(([key, name]) => ({ key, name }));
}

/** Unique fleet profile options from the dataset, in the order first encountered. */
export function profileOptions(dataset: DashboardDataset): Array<{ id: string; name: string }> {
  const seen = new Map<string, string>();
  for (const run of dataset.runs) {
    if (!seen.has(run.fleetProfile.id)) {
      seen.set(run.fleetProfile.id, run.fleetProfile.name);
    }
  }
  return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
}

/**
 * Returns runs matching the current filter (site, profile, date range).
 * Date range uses the run's window.start date (YYYY-MM-DD prefix).
 */
export function matchingRuns(state: DashboardState): DashboardRun[] {
  return state.dataset.runs.filter((run) => {
    if (state.filter.siteKey !== null && run.site.key !== state.filter.siteKey) return false;
    if (state.filter.fleetProfileId !== null && run.fleetProfile.id !== state.filter.fleetProfileId) return false;
    if (state.filter.dateFrom !== null) {
      const runDate = run.window.start.slice(0, 10);
      if (runDate < state.filter.dateFrom) return false;
    }
    if (state.filter.dateTo !== null) {
      const runDate = run.window.start.slice(0, 10);
      if (runDate > state.filter.dateTo) return false;
    }
    return true;
  });
}

/**
 * Partitions runs into exact `(site.key, fleetProfile.id)` groups,
 * preserving first-encounter order both across groups and within each group.
 */
function groupByExactMatch(runs: DashboardRun[]): DashboardRun[][] {
  const groups = new Map<string, DashboardRun[]>();
  for (const run of runs) {
    const key = groupKeyOf(run);
    const bucket = groups.get(key);
    if (bucket) bucket.push(run);
    else groups.set(key, [run]);
  }
  return Array.from(groups.values());
}

/**
 * Orders one-per-group representatives globally: local runs by
 * `(createdAt, id)`; public runs by `(window.start, id)` since public
 * payloads intentionally omit createdAt. Unlike `matchingGroupChronology`,
 * both of these are real total orders that don't restart per group, so
 * comparing them across groups is safe.
 */
function representativeOrder(a: DashboardRun, b: DashboardRun): number {
  if ('createdAt' in a && 'createdAt' in b) {
    const cmp = (a as { createdAt: string }).createdAt.localeCompare((b as { createdAt: string }).createdAt);
    if (cmp !== 0) return cmp;
    return a.id.localeCompare(b.id);
  }
  const cmp = a.window.start.localeCompare(b.window.start);
  if (cmp !== 0) return cmp;
  return a.id.localeCompare(b.id);
}

/**
 * The globally newest run, deterministic and transitive regardless of
 * traversal order:
 *  1. Partition `runs` into exact `(site.key, fleetProfile.id)` groups.
 *  2. Select each group's newest run using matching-group chronology --
 *     `(createdAt, id)` for local runs, `(comparisonOrder, id)` for public
 *     runs -- a real total order within a single group.
 *  3. Choose the overall newest among the one-per-group representatives by
 *     `(createdAt, id)` for local runs, or `(window.start, id)` for public
 *     runs (createdAt is intentionally omitted from public payloads).
 * Payload order is never trusted at either step. A comparator that used
 * `comparisonOrder` for same-group pairs but `window.start` for cross-group
 * pairs was not transitive across three runs, so its "newest" could vary by
 * array order; partitioning first makes the whole process a single
 * well-defined total order.
 */
export function newestRun(runs: DashboardRun[]): DashboardRun | null {
  if (runs.length === 0) return null;

  const representatives = groupByExactMatch(runs).map((group) =>
    group.reduce((newest, run) => (matchingGroupChronology(run, newest) > 0 ? run : newest)),
  );

  return representatives.reduce((newest, run) => (representativeOrder(run, newest) > 0 ? run : newest));
}

/**
 * Initializes state from a validated dataset. Selects the newest run by
 * comparison chronology, and that run's site/profile as the default filter.
 */
export function initializeState(dataset: DashboardDataset): DashboardState {
  const latest = newestRun(dataset.runs);

  const filter: FilterState = {
    siteKey: latest?.site.key ?? null,
    fleetProfileId: latest?.fleetProfile.id ?? null,
    dateFrom: null,
    dateTo: null,
  };

  const state: DashboardState = {
    dataset,
    filter,
    selectedRunId: latest?.id ?? null,
    compareRunId: null,
  };

  return state;
}

/**
 * Returns the selected run from the current matching runs, or null.
 */
export function selectedRun(state: DashboardState): DashboardRun | null {
  if (state.selectedRunId === null) return null;
  return matchingRuns(state).find((run) => run.id === state.selectedRunId) ?? null;
}

/**
 * Reconciles selectedRunId and compareRunId after filter changes.
 * If selectedRunId is no longer in the matched set, auto-selects the newest
 * matched run by comparison chronology. If compareRunId is no longer in the
 * matched set, clears it.
 */
export function reconcileSelections(state: DashboardState): void {
  const matched = matchingRuns(state);
  const matchedIds = new Set(matched.map((r) => r.id));

  if (state.selectedRunId !== null && !matchedIds.has(state.selectedRunId)) {
    state.selectedRunId = newestRun(matched)?.id ?? null;
  }

  if (state.compareRunId !== null && !matchedIds.has(state.compareRunId)) {
    state.compareRunId = null;
  }
}
