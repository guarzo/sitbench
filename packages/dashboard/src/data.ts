import { DashboardDatasetSchema } from '@sitbench/core/export';
import type {
  DashboardCapabilities,
  DashboardDataset,
  LocalDashboardDataset,
  PublicDashboardDataset,
  PublicRunSummary,
} from '@sitbench/core/export';
import type { RunSummary } from '@sitbench/core/export';

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
 * Validates a parsed JSON value as a `DashboardDataset` using the strict Zod
 * schemas defined in `@sitbench/core/export`. Rejects unknown keys, invalid
 * nested timestamps, non-boolean capabilities, and capability/field
 * inconsistencies. Callers should catch `DatasetSchemaError` and render a
 * clear error state rather than showing misleading partial metrics.
 */
export function validateDataset(raw: unknown): DashboardDataset {
  const result = DashboardDatasetSchema.safeParse(raw);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    const path = firstIssue?.path.join('.') ?? '';
    const message = firstIssue?.message ?? 'Unknown validation error';
    throw new DatasetSchemaError(
      `Invalid dashboard dataset${path.length > 0 ? ` at ${path}` : ''}: ${message}`,
    );
  }
  return result.data;
}

/**
 * Fetches and validates the dashboard dataset from the conventional
 * `data/runs.json` path, relative to the current document URL. The path is
 * deliberately relative (no leading slash) so the same build works both at
 * a loopback root and under a project subpath such as
 * `https://user.github.io/<project>/`. A non-OK response is reported before
 * the body is ever read; a body that is not parseable JSON is reported as a
 * `DatasetSchemaError` carrying the parse failure, so callers only ever have
 * to handle one error type. A `DatasetSchemaError` raised by schema
 * validation itself is never rewrapped, so its precise field path survives.
 */
export async function loadDataset(basePath = 'data/runs.json'): Promise<DashboardDataset> {
  const response = await fetch(basePath);
  if (!response.ok) {
    throw new DatasetSchemaError(`Failed to load dataset: HTTP ${String(response.status)}`);
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch (error) {
    throw new DatasetSchemaError(
      `Failed to parse dashboard dataset as JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return validateDataset(raw);
}
