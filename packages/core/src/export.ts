import { z } from 'zod';
import {
  CalculationSettingsSchema,
  CharacterMetricsSchema,
  CoverageSchema,
  FleetProfileSchema,
  RunMetricsSchema,
  RunSummarySchema,
  RunWindowSchema,
  SiteIdentitySchema,
  type CharacterMetrics,
  type RunSummary,
} from './schemas.js';

// Re-export schema types used by dashboard consumers
export type { CharacterMetrics, RunSummary };

// ---------------------------------------------------------------------------
// Dashboard capabilities
// ---------------------------------------------------------------------------

export const DashboardCapabilitiesSchema = z.object({
  characters: z.boolean(),
  notes: z.boolean(),
}).strict();

export interface DashboardCapabilities {
  characters: boolean;
  notes: boolean;
}

// ---------------------------------------------------------------------------
// Local dataset — full fidelity, generated from Archive.listRuns()
// ---------------------------------------------------------------------------

export const LocalDashboardDatasetSchema = z.object({
  schemaVersion: z.literal(1),
  mode: z.literal('local'),
  generatedAt: z.string().datetime({ offset: true }),
  capabilities: z.object({ characters: z.literal(true), notes: z.literal(true) }).strict(),
  runs: z.array(RunSummarySchema),
}).strict();

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

const PublicRunSummaryBaseSchema = z.object({
  id: z.string().min(1),
  comparisonOrder: z.number().int().nonnegative(),
  site: SiteIdentitySchema,
  fleetProfile: FleetProfileSchema,
  window: RunWindowSchema,
  calculation: CalculationSettingsSchema,
  metrics: RunMetricsSchema,
  coverage: CoverageSchema,
}).strict();

/** Public run with characters=true: participants + characterMetrics required. */
const PublicRunWithCharactersSchema = PublicRunSummaryBaseSchema.extend({
  participants: z.array(z.string()),
  characterMetrics: z.array(CharacterMetricsSchema),
}).strict();

/** Public run with notes=true: notes key required (nullable). */
const PublicRunWithNotesSchema = PublicRunSummaryBaseSchema.extend({
  notes: z.string().nullable(),
}).strict();

/** Public run with both characters and notes. */
const PublicRunWithBothSchema = PublicRunSummaryBaseSchema.extend({
  participants: z.array(z.string()),
  characterMetrics: z.array(CharacterMetricsSchema),
  notes: z.string().nullable(),
}).strict();

export interface PublicRunSummary {
  id: string;
  comparisonOrder: number;
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

/**
 * Public dataset schema with capability-consistent run validation via superRefine.
 * characters=true requires participants+characterMetrics on every run; false forbids both.
 * notes=true requires notes key (nullable) on every run; false forbids it.
 */
export const PublicDashboardDatasetSchema = z.object({
  schemaVersion: z.literal(1),
  mode: z.literal('public'),
  generatedAt: z.string().datetime({ offset: true }),
  capabilities: DashboardCapabilitiesSchema,
  runs: z.array(z.unknown()),
}).strict().superRefine((data, ctx) => {
  const { characters, notes } = data.capabilities;
  let runSchema: z.ZodType;
  if (characters && notes) {
    runSchema = PublicRunWithBothSchema;
  } else if (characters) {
    runSchema = PublicRunWithCharactersSchema;
  } else if (notes) {
    runSchema = PublicRunWithNotesSchema;
  } else {
    runSchema = PublicRunSummaryBaseSchema;
  }
  for (let i = 0; i < data.runs.length; i++) {
    const result = runSchema.safeParse(data.runs[i]);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({
          ...issue,
          path: ['runs', i, ...issue.path],
        });
      }
    }
  }
});

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

/**
 * Validates a raw JSON value as a DashboardDataset. Uses the mode discriminant
 * to select the correct branch schema. ZodEffects (superRefine) cannot be
 * used directly in z.discriminatedUnion, so this is a plain union with
 * manual discrimination.
 */
export const DashboardDatasetSchema = z.union([
  LocalDashboardDatasetSchema,
  PublicDashboardDatasetSchema,
]);

export type DashboardDataset = LocalDashboardDataset | PublicDashboardDataset;

// ---------------------------------------------------------------------------
// Local builder
// ---------------------------------------------------------------------------

export interface BuildLocalDatasetOptions {
  /** Override the generatedAt timestamp (defaults to current time). */
  generatedAt?: string;
}

/**
 * Builds a local dashboard dataset from validated run summaries. Sorts runs
 * ascending by window start timestamp, with run id as a stable tiebreak.
 * Accepts only `RunSummary` objects (never raw events or source files).
 */
export function buildLocalDashboardDataset(
  runs: RunSummary[],
  options?: BuildLocalDatasetOptions,
): LocalDashboardDataset {
  const sorted = runs.slice().sort((a, b) => {
    const cmp = a.window.start.localeCompare(b.window.start);
    if (cmp !== 0) return cmp;
    return a.id.localeCompare(b.id);
  });
  return {
    schemaVersion: 1,
    mode: 'local',
    generatedAt: options?.generatedAt ?? new Date().toISOString(),
    capabilities: { characters: true, notes: true },
    runs: sorted,
  };
}
