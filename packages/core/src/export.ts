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

/**
 * Every shape a public run may legitimately take, one per capability
 * combination. Each branch is strict, so a run matches at most one of them
 * and unknown keys are always rejected. This only establishes that a run is
 * *some* valid public shape; `PublicDashboardDatasetSchema`'s `superRefine`
 * additionally requires the shape to be the exact one the dataset's
 * `capabilities` flags declare.
 */
export const PublicRunSummarySchema = z.union([
  PublicRunWithBothSchema,
  PublicRunWithCharactersSchema,
  PublicRunWithNotesSchema,
  PublicRunSummaryBaseSchema,
]);

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
 * Public dataset schema with capability-consistent run validation. Every run
 * must first be one of the four valid public shapes
 * (`PublicRunSummarySchema`), and `superRefine` then requires it to be the
 * exact shape the declared capabilities call for: characters=true requires
 * participants+characterMetrics on every run; false forbids both. notes=true
 * requires notes key (nullable) on every run; false forbids it.
 */
export const PublicDashboardDatasetSchema = z.object({
  schemaVersion: z.literal(1),
  mode: z.literal('public'),
  generatedAt: z.string().datetime({ offset: true }),
  capabilities: DashboardCapabilitiesSchema,
  runs: z.array(PublicRunSummarySchema),
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

// ---------------------------------------------------------------------------
// Public builder
// ---------------------------------------------------------------------------

export interface BuildPublicDatasetOptions {
  /** Restore participant identities and per-character metrics. Default false. */
  includeCharacters?: boolean;
  /** Restore run notes. Default false. */
  includeNotes?: boolean;
  /** Override the generatedAt timestamp (defaults to current time). */
  generatedAt?: string;
}

/** Chronological order key matching core's recorded-time comparator: `(createdAt, id)`. */
function recordedChronoCompare(a: RunSummary, b: RunSummary): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

/**
 * Assigns an opaque nonnegative `comparisonOrder` integer to every run,
 * scoped to its exact `(site.key, fleetProfile.id)` group and ordered by
 * the same recorded chronology `(createdAt, id)` that core's
 * `compareMatchingRuns` uses. This lets the public dataset preserve
 * comparison ordering without ever exporting `createdAt`/`updatedAt`.
 */
function assignComparisonOrder(runs: RunSummary[]): Map<string, number> {
  const groups = new Map<string, RunSummary[]>();
  for (const run of runs) {
    const key = `${run.site.key}\u0000${run.fleetProfile.id}`;
    const group = groups.get(key);
    if (group) {
      group.push(run);
    } else {
      groups.set(key, [run]);
    }
  }

  const comparisonOrderById = new Map<string, number>();
  for (const group of groups.values()) {
    const sortedGroup = group.slice().sort(recordedChronoCompare);
    sortedGroup.forEach((run, index) => {
      comparisonOrderById.set(run.id, index);
    });
  }
  return comparisonOrderById;
}

/**
 * Constructs a single `PublicRunSummary` field-by-field from a validated
 * `RunSummary`, never by deleting keys from the local record. The record is
 * then validated through the capability-matching strict Zod schema so an
 * accidental extra or missing field fails loudly rather than leaking.
 */
function toPublicRun(
  run: RunSummary,
  comparisonOrder: number,
  options: { includeCharacters: boolean; includeNotes: boolean },
): PublicRunSummary {
  const base = {
    id: run.id,
    comparisonOrder,
    site: run.site,
    fleetProfile: run.fleetProfile,
    window: run.window,
    calculation: run.calculation,
    metrics: run.metrics,
    coverage: run.coverage,
  };

  if (options.includeCharacters && options.includeNotes) {
    return PublicRunWithBothSchema.parse({
      ...base,
      participants: run.participants,
      characterMetrics: run.characterMetrics,
      notes: run.notes,
    }) as PublicRunSummary;
  }
  if (options.includeCharacters) {
    return PublicRunWithCharactersSchema.parse({
      ...base,
      participants: run.participants,
      characterMetrics: run.characterMetrics,
    }) as PublicRunSummary;
  }
  if (options.includeNotes) {
    return PublicRunWithNotesSchema.parse({
      ...base,
      notes: run.notes,
    }) as PublicRunSummary;
  }
  return PublicRunSummaryBaseSchema.parse(base) as PublicRunSummary;
}

/**
 * Builds a privacy-controlled public dashboard dataset from validated run
 * summaries. Identities (`participants`, `characterMetrics`) and `notes`
 * are omitted by default; each is independently restored only when its
 * matching option is `true`, and `capabilities` always reflects the
 * resolved options exactly. `comparisonOrder` is assigned per exact
 * `(site.key, fleetProfile.id)` group by recorded chronology `(createdAt,
 * id)`, then the overall `runs` array is sorted ascending by `window.start`
 * (with an `id` tiebreak), matching `buildLocalDashboardDataset`. Raw
 * events, local file paths, fingerprints, and creation/update metadata are
 * never included because every field is set explicitly rather than copied
 * wholesale from the local summary.
 */
export function buildPublicDashboardDataset(
  runs: RunSummary[],
  options?: BuildPublicDatasetOptions,
): PublicDashboardDataset {
  const includeCharacters = options?.includeCharacters ?? false;
  const includeNotes = options?.includeNotes ?? false;

  const comparisonOrderById = assignComparisonOrder(runs);
  const publicRuns = runs.map((run) =>
    toPublicRun(run, comparisonOrderById.get(run.id) ?? 0, { includeCharacters, includeNotes }),
  );

  const sorted = publicRuns.slice().sort((a, b) => {
    const cmp = a.window.start.localeCompare(b.window.start);
    if (cmp !== 0) return cmp;
    return a.id.localeCompare(b.id);
  });

  return {
    schemaVersion: 1,
    mode: 'public',
    generatedAt: options?.generatedAt ?? new Date().toISOString(),
    capabilities: { characters: includeCharacters, notes: includeNotes },
    runs: sorted,
  };
}
