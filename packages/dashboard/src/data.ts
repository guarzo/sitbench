import type {
  DashboardCapabilities,
  DashboardDataset,
  LocalDashboardDataset,
  PublicDashboardDataset,
  PublicRunSummary,
} from '@sitbench/core';
import type { RunSummary } from '@sitbench/core';

// ---------------------------------------------------------------------------
// Re-export dataset types for dashboard consumers
// ---------------------------------------------------------------------------

export type { DashboardCapabilities, DashboardDataset, LocalDashboardDataset, PublicDashboardDataset, PublicRunSummary };

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class DatasetSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatasetSchemaError';
  }
}

// ---------------------------------------------------------------------------
// Run type that works for both local and public datasets
// ---------------------------------------------------------------------------

/** The union of fields available from either a local RunSummary or a PublicRunSummary. */
export type DashboardRun = RunSummary | PublicRunSummary;

// ---------------------------------------------------------------------------
// Loader / validator
// ---------------------------------------------------------------------------

/**
 * Validates a parsed JSON object as a `DashboardDataset`. Rejects unknown
 * modes and missing required fields. Callers should catch
 * `DatasetSchemaError` and render a clear error state rather than showing
 * misleading partial metrics.
 */
export function validateDataset(raw: unknown): DashboardDataset {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new DatasetSchemaError('Dashboard dataset must be a JSON object.');
  }
  const obj = raw as Record<string, unknown>;

  if (obj.schemaVersion !== 1) {
    throw new DatasetSchemaError(
      `Unsupported schema version: ${String(obj.schemaVersion)}. Expected 1.`,
    );
  }
  if (obj.mode !== 'local' && obj.mode !== 'public') {
    throw new DatasetSchemaError(
      `Unknown dataset mode: ${String(obj.mode)}. Expected "local" or "public".`,
    );
  }
  if (typeof obj.generatedAt !== 'string') {
    throw new DatasetSchemaError('Missing or invalid generatedAt timestamp.');
  }
  if (typeof obj.capabilities !== 'object' || obj.capabilities === null) {
    throw new DatasetSchemaError('Missing or invalid capabilities object.');
  }
  if (!Array.isArray(obj.runs)) {
    throw new DatasetSchemaError('Missing or invalid runs array.');
  }
  return obj as unknown as DashboardDataset;
}

/**
 * Fetches and validates the dashboard dataset from the conventional
 * `/data/runs.json` path (relative to document root).
 */
export async function loadDataset(basePath = '/data/runs.json'): Promise<DashboardDataset> {
  const response = await fetch(basePath);
  if (!response.ok) {
    throw new DatasetSchemaError(`Failed to load dataset: HTTP ${String(response.status)}`);
  }
  const raw: unknown = await response.json();
  return validateDataset(raw);
}
