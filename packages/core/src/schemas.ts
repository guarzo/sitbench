import { z } from 'zod';

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

/** ISO 8601 datetime string with timezone offset. */
const IsoDateTimeString = z.string().datetime({ offset: true });

/**
 * The single persisted-timestamp contract every archived ISO field
 * (including `RunWindow.start`/`end`) is validated against. Exported so
 * command boundaries can reject a user-supplied timestamp against exactly
 * the same rule the archive will later enforce, instead of relying on
 * `Date.parse`, which accepts many non-ISO forms (`"2026-09-03 05:00"`,
 * `"September 3, 2026"`, ...) that would only fail later inside `Archive`.
 */
export const IsoDateTimeStringSchema = IsoDateTimeString;

/** True when `value` satisfies the persisted ISO-with-offset timestamp contract. */
export function isIsoDateTime(value: unknown): boolean {
  return IsoDateTimeString.safeParse(value).success;
}

/**
 * A single safe filesystem path segment: must start with a letter or digit
 * and contain only letters, digits, '-', '_', or '.' afterward. This
 * excludes '/', '\\', and NUL, and excludes '.' / '..' (which cannot start
 * with a letter or digit), so a validated id can never be used to escape
 * an archive directory via path traversal.
 */
export const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// ---------------------------------------------------------------------------
// Normalized event base (strict so unknown keys are rejected on every variant)
// ---------------------------------------------------------------------------

const NormalizedEventBase = z
  .object({
    /** Timestamp from the gamelog line header (ISO 8601). */
    timestamp: IsoDateTimeString,
    /** Character whose log file observed this event. */
    observedBy: z.string(),
    /** Source gamelog filename (basename). */
    sourceFile: z.string(),
    /** 1-based line number within the source file. */
    sourceLine: z.number().int().positive(),
    /** Original raw log line, preserved verbatim. */
    raw: z.string(),
  })
  .strict();

/**
 * Classification of the target of a damage-dealt or miss event.
 *   'npc'       – confirmed NPC target; qualifies for episode detection.
 *   'non-site'  – confirmed non-site target (e.g. player); excluded from episode.
 *   'ambiguous' – target type could not be determined conservatively.
 */
const TargetClassification = z.enum(['npc', 'non-site', 'ambiguous']);

// ---------------------------------------------------------------------------
// Five initial normalized-event kinds (discriminated union)
// ---------------------------------------------------------------------------

/**
 * Damage dealt by the observing character to any target.
 * `targetClassification` distinguishes NPC vs non-site vs ambiguous for
 * episode detection.
 */
export const DamageDealtSchema = NormalizedEventBase.extend({
  kind: z.literal('damage-dealt'),
  actor: z.string(),
  target: z.string(),
  amount: z.number().nonnegative(),
  hitQuality: z.string().nullable(),
  targetClassification: TargetClassification,
}).strict();

/** Damage received by the observing character from any source. */
export const DamageTakenSchema = NormalizedEventBase.extend({
  kind: z.literal('damage-taken'),
  actor: z.string(),
  target: z.string(),
  amount: z.number().nonnegative(),
  hitQuality: z.string().nullable(),
}).strict();

/**
 * A shot that missed its target.
 * `targetClassification` is required so episode logic can correctly treat
 * missed NPC shots as qualifying activity context.
 */
export const MissSchema = NormalizedEventBase.extend({
  kind: z.literal('miss'),
  actor: z.string(),
  target: z.string(),
  targetClassification: TargetClassification,
}).strict();

/** Remote armor/shield repair delivered by the observing character. */
export const RemoteRepairDeliveredSchema = NormalizedEventBase.extend({
  kind: z.literal('remote-repair-delivered'),
  actor: z.string(),
  target: z.string(),
  amount: z.number().nonnegative(),
}).strict();

/** Remote armor/shield repair received by the observing character. */
export const RemoteRepairReceivedSchema = NormalizedEventBase.extend({
  kind: z.literal('remote-repair-received'),
  actor: z.string(),
  target: z.string(),
  amount: z.number().nonnegative(),
}).strict();

/** Union of all five supported normalized event kinds. */
export const NormalizedEventSchema = z.discriminatedUnion('kind', [
  DamageDealtSchema,
  DamageTakenSchema,
  MissSchema,
  RemoteRepairDeliveredSchema,
  RemoteRepairReceivedSchema,
]);

export type NormalizedEvent = z.infer<typeof NormalizedEventSchema>;
export type DamageDealt = z.infer<typeof DamageDealtSchema>;
export type DamageTaken = z.infer<typeof DamageTakenSchema>;
export type Miss = z.infer<typeof MissSchema>;
export type RemoteRepairDelivered = z.infer<typeof RemoteRepairDeliveredSchema>;
export type RemoteRepairReceived = z.infer<typeof RemoteRepairReceivedSchema>;

// ---------------------------------------------------------------------------
// Site identity
// ---------------------------------------------------------------------------

export const SiteIdentitySchema = z
  .object({
    /** Human-readable display name exactly as entered by the user. */
    name: z.string().min(1),
    /** Canonical URL-safe key derived from the display name. */
    key: z.string().min(1),
  })
  .strict();

export type SiteIdentity = z.infer<typeof SiteIdentitySchema>;

// ---------------------------------------------------------------------------
// FleetProfile
// ---------------------------------------------------------------------------

export const FleetProfileSchema = z
  .object({
    /** Canonical key derived from the fleet profile name. */
    id: z.string().min(1),
    /** Human-readable display name exactly as entered by the user. */
    name: z.string().min(1),
  })
  .strict();

export type FleetProfile = z.infer<typeof FleetProfileSchema>;

// ---------------------------------------------------------------------------
// RunWindow
// ---------------------------------------------------------------------------

export const RunWindowSchema = z
  .object({
    /** Confirmed window start (ISO 8601). */
    start: IsoDateTimeString,
    /** Confirmed window end (ISO 8601). */
    end: IsoDateTimeString,
    /** How the window boundaries were determined. */
    source: z.string().min(1),
    /** Whether the user manually overrode the auto-detected window. */
    manuallyAdjusted: z.boolean(),
  })
  .strict();

export type RunWindow = z.infer<typeof RunWindowSchema>;

// ---------------------------------------------------------------------------
// CalculationSettings
// ---------------------------------------------------------------------------

export const CalculationSettingsSchema = z
  .object({
    /** Gap in seconds that separates two candidate PvE episodes. */
    episodeThresholdSeconds: z.number().positive(),
    /** Continuity gap in seconds used to separate active-combat segments. */
    activeCombatGapSeconds: z.number().positive(),
  })
  .strict();

export type CalculationSettings = z.infer<typeof CalculationSettingsSchema>;

// ---------------------------------------------------------------------------
// RunMetrics
// ---------------------------------------------------------------------------

export const RunMetricsSchema = z
  .object({
    elapsedSeconds: z.number().nonnegative(),
    activeCombatSeconds: z.number().nonnegative(),
    idleSeconds: z.number().nonnegative(),
    fleetDamageDealt: z.number().nonnegative(),
    /** Average DPS over the full elapsed window. Zero denominator → zero. */
    averageFleetDps: z.number().nonnegative(),
    /** DPS over active-combat seconds only. Zero denominator → zero. */
    activeFleetDps: z.number().nonnegative(),
    damageTaken: z.number().nonnegative(),
    remoteRepairDelivered: z.number().nonnegative(),
    participantCount: z.number().int().nonnegative(),
  })
  .strict();

export type RunMetrics = z.infer<typeof RunMetricsSchema>;

// ---------------------------------------------------------------------------
// CharacterMetrics – per-character output consumed by Task 3
// ---------------------------------------------------------------------------

export const CharacterMetricsSchema = z
  .object({
    /** Character name, matches the display name from EVE gamelogs. */
    character: z.string().min(1),
    damageDealt: z.number().nonnegative(),
    /** This character's damage as a fraction of total fleet damage dealt.
     *  Zero fleet damage → zero. */
    fleetDamageShare: z.number().nonnegative(),
    /** Average DPS over the run's elapsed window. Zero denominator → zero. */
    averageDps: z.number().nonnegative(),
    /** DPS over active-combat seconds. Zero denominator → zero. */
    activeDps: z.number().nonnegative(),
    damageTaken: z.number().nonnegative(),
    remoteRepairDelivered: z.number().nonnegative(),
    remoteRepairReceived: z.number().nonnegative(),
    shotsHit: z.number().int().nonnegative(),
    shotsMissed: z.number().int().nonnegative(),
    /** missRate = shotsMissed / (shotsHit + shotsMissed). Zero total → zero. */
    missRate: z.number().nonnegative(),
    /** Map of hit-quality label (e.g. "Wrecking") to count. */
    hitQualityCounts: z.record(z.string(), z.number().int().nonnegative()),
    /** ISO 8601 timestamp of the character's first qualifying event in window. */
    firstRelevantEvent: IsoDateTimeString.nullable(),
    /** ISO 8601 timestamp of the character's last qualifying event in window. */
    lastRelevantEvent: IsoDateTimeString.nullable(),
  })
  .strict();

export type CharacterMetrics = z.infer<typeof CharacterMetricsSchema>;

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

export const CoverageSchema = z
  .object({
    logFiles: z.number().int().nonnegative(),
    participantsWithOutgoingDamage: z.number().int().nonnegative(),
    unparsedCombatLines: z.number().int().nonnegative(),
    ambiguousEventsExcluded: z.number().int().nonnegative(),
    /**
     * Quality of remote-repair pairing:
     *   'none'    – no repair data at all
     *   'partial' – some pairings are ambiguous
     *   'full'    – every repair event has a confirmed counterpart
     */
    repairPairing: z.enum(['none', 'partial', 'full']),
  })
  .strict();

export type Coverage = z.infer<typeof CoverageSchema>;

// ---------------------------------------------------------------------------
// RunSummary
// ---------------------------------------------------------------------------

export const RunSummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    parserVersion: z.string().min(1),
    metricsVersion: z.string().min(1),
    /** Unique run identifier: `<datetime>-<site-key>`. Must be a single safe path segment. */
    id: z.string().min(1).regex(RUN_ID_PATTERN, 'id must be a single safe path segment'),
    site: SiteIdentitySchema,
    fleetProfile: FleetProfileSchema,
    window: RunWindowSchema,
    /** Canonical character names of all participants observed in the log window. */
    participants: z.array(z.string()),
    calculation: CalculationSettingsSchema,
    metrics: RunMetricsSchema,
    characterMetrics: z.array(CharacterMetricsSchema),
    coverage: CoverageSchema,
    notes: z.string().nullable(),
    /** Stable content-based fingerprint to detect duplicate submissions. */
    fingerprint: z.string().min(1),
    createdAt: IsoDateTimeString,
    updatedAt: IsoDateTimeString,
  })
  .strict();

export type RunSummary = z.infer<typeof RunSummarySchema>;

// ---------------------------------------------------------------------------
// CatalogEntry – lightweight index record rebuilt from RunSummary files
// ---------------------------------------------------------------------------

export const CatalogEntrySchema = z
  .object({
    id: z.string().min(1),
    siteKey: z.string().min(1),
    siteName: z.string().min(1),
    fleetProfileId: z.string().min(1),
    fleetProfileName: z.string().min(1),
    windowStart: IsoDateTimeString,
    windowEnd: IsoDateTimeString,
    elapsedSeconds: z.number().nonnegative(),
    activeCombatSeconds: z.number().nonnegative(),
    participantCount: z.number().int().nonnegative(),
    fingerprint: z.string().min(1),
    createdAt: IsoDateTimeString,
  })
  .strict();

export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;
