import type { DashboardDataset, DashboardRun } from './data.js';

// ---------------------------------------------------------------------------
// Filter state
// ---------------------------------------------------------------------------

export interface FilterState {
  siteKey: string | null;
  fleetProfileId: string | null;
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

/** Returns runs matching the current filter (both keys). */
export function matchingRuns(state: DashboardState): DashboardRun[] {
  return state.dataset.runs.filter(
    (run) =>
      (state.filter.siteKey === null || run.site.key === state.filter.siteKey) &&
      (state.filter.fleetProfileId === null || run.fleetProfile.id === state.filter.fleetProfileId),
  );
}

/**
 * Initializes state from a validated dataset. Selects the most recent run's
 * site/profile as the default filter, and that run as the selected run.
 * "Most recent" means last by window.start (dataset is sorted ascending).
 */
export function initializeState(dataset: DashboardDataset): DashboardState {
  const runs = dataset.runs;
  const latest = runs.length > 0 ? runs[runs.length - 1]! : null;

  const filter: FilterState = {
    siteKey: latest?.site.key ?? null,
    fleetProfileId: latest?.fleetProfile.id ?? null,
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
