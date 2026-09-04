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
// Strict validation helpers
// ---------------------------------------------------------------------------

function assertObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DatasetSchemaError(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function assertBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new DatasetSchemaError(`${label} must be a boolean.`);
  }
  return value;
}

/** Minimal run-shape validation: id, site, fleetProfile, window, metrics, coverage. */
function validateRunShape(run: unknown, index: number): void {
  const obj = assertObject(run, `runs[${String(index)}]`);
  if (typeof obj.id !== 'string' || obj.id.length === 0) {
    throw new DatasetSchemaError(`runs[${String(index)}].id must be a non-empty string.`);
  }
  assertObject(obj.site, `runs[${String(index)}].site`);
  assertObject(obj.fleetProfile, `runs[${String(index)}].fleetProfile`);
  assertObject(obj.window, `runs[${String(index)}].window`);
  assertObject(obj.metrics, `runs[${String(index)}].metrics`);
  assertObject(obj.coverage, `runs[${String(index)}].coverage`);
}

// ---------------------------------------------------------------------------
// Loader / validator
// ---------------------------------------------------------------------------

/**
 * Validates a parsed JSON object as a `DashboardDataset`. Rejects unknown
 * modes, non-boolean capabilities, invalid local fixed capabilities, and
 * runs missing required fields. Callers should catch `DatasetSchemaError`
 * and render a clear error state rather than showing misleading partial
 * metrics.
 */
export function validateDataset(raw: unknown): DashboardDataset {
  const obj = assertObject(raw, 'Dashboard dataset');

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

  // Validate capabilities
  const caps = assertObject(obj.capabilities, 'capabilities');
  const characters = assertBoolean(caps.characters, 'capabilities.characters');
  const notes = assertBoolean(caps.notes, 'capabilities.notes');

  // Local mode requires both capabilities true
  if (obj.mode === 'local') {
    if (characters !== true || notes !== true) {
      throw new DatasetSchemaError(
        'Local dataset must have capabilities { characters: true, notes: true }.',
      );
    }
  }

  // Validate runs array
  if (!Array.isArray(obj.runs)) {
    throw new DatasetSchemaError('Missing or invalid runs array.');
  }
  for (let i = 0; i < obj.runs.length; i++) {
    validateRunShape(obj.runs[i], i);
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
