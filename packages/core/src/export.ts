import type { CharacterMetrics, RunSummary } from './schemas.js';

// ---------------------------------------------------------------------------
// Dashboard capabilities
// ---------------------------------------------------------------------------

export interface DashboardCapabilities {
  characters: boolean;
  notes: boolean;
}

// ---------------------------------------------------------------------------
// Local dataset — full fidelity, generated from Archive.listRuns()
// ---------------------------------------------------------------------------

export interface LocalDashboardDataset {
  schemaVersion: 1;
  mode: 'local';
  generatedAt: string;
  capabilities: { characters: true; notes: true };
  runs: RunSummary[];
}

// ---------------------------------------------------------------------------
// Public dataset — privacy-controlled subset (Task 8 builds it)
// ---------------------------------------------------------------------------

export interface PublicRunSummary {
  id: string;
  site: RunSummary['site'];
  fleetProfile: RunSummary['fleetProfile'];
  window: RunSummary['window'];
  calculation: RunSummary['calculation'];
  metrics: RunSummary['metrics'];
  coverage: RunSummary['coverage'];
  participants?: string[];
  characterMetrics?: CharacterMetrics[];
  notes?: string | null;
}

export interface PublicDashboardDataset {
  schemaVersion: 1;
  mode: 'public';
  generatedAt: string;
  capabilities: DashboardCapabilities;
  runs: PublicRunSummary[];
}

// ---------------------------------------------------------------------------
// Discriminated union consumed by dashboard
// ---------------------------------------------------------------------------

export type DashboardDataset = LocalDashboardDataset | PublicDashboardDataset;

// ---------------------------------------------------------------------------
// Local builder
// ---------------------------------------------------------------------------

/**
 * Builds a local dashboard dataset from validated run summaries. Sorts runs
 * ascending by window start timestamp for predictable charting. Accepts only
 * `RunSummary` objects (never raw events or source files).
 */
export function buildLocalDashboardDataset(runs: RunSummary[]): LocalDashboardDataset {
  const sorted = runs.slice().sort((a, b) => a.window.start.localeCompare(b.window.start));
  return {
    schemaVersion: 1,
    mode: 'local',
    generatedAt: new Date().toISOString(),
    capabilities: { characters: true, notes: true },
    runs: sorted,
  };
}
