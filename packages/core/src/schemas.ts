import { z } from 'zod';

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

/** ISO 8601 datetime string (validated as a non-empty string; calendar arithmetic
 *  is intentionally left to callers). */
const IsoDateTimeString = z.string().datetime({ offset: true });

// ---------------------------------------------------------------------------
// Five initial normalized-event kinds (discriminated union)
// ---------------------------------------------------------------------------

const NormalizedEventBase = z.object({
  /** Timestamp from the gamelog line header (ISO 8601). */
  timestamp: IsoDateTimeString,
  /** Character whose log file observed this event. */
  observingCharacter: z.string(),
  /** Source gamelog filename (basename). */
  sourceFile: z.string(),
  /** 1-based line number within the source file. */
  sourceLine: z.number().int().positive(),
  /** Original raw log line, preserved verbatim. */
  raw: z.string(),
});

/** Damage dealt by the observing character to an NPC target. */
export const OutgoingNpcDamageSchema = NormalizedEventBase.extend({
  kind: z.literal('outgoing-npc-damage'),
  actor: z.string(),
  target: z.string(),
  amount: z.number().nonnegative(),
  hitQuality: z.string().nullable(),
});

/** Damage dealt by the observing character to a player/pod target. */
export const OutgoingPlayerDamageSchema = NormalizedEventBase.extend({
  kind: z.literal('outgoing-player-damage'),
  actor: z.string(),
  target: z.string(),
  amount: z.number().nonnegative(),
  hitQuality: z.string().nullable(),
});

/** Damage received by the observing character from any source. */
export const IncomingDamageSchema = NormalizedEventBase.extend({
  kind: z.literal('incoming-damage'),
  actor: z.string(),
  target: z.string(),
  amount: z.number().nonnegative(),
  hitQuality: z.string().nullable(),
});

/** Remote armor/shield repair delivered by the observing character. */
export const RemoteRepairDeliveredSchema = NormalizedEventBase.extend({
  kind: z.literal('remote-repair-delivered'),
  actor: z.string(),
  target: z.string(),
  amount: z.number().nonnegative(),
});

/** Remote armor/shield repair received by the observing character. */
export const RemoteRepairReceivedSchema = NormalizedEventBase.extend({
  kind: z.literal('remote-repair-received'),
  actor: z.string(),
  target: z.string(),
  amount: z.number().nonnegative(),
});

/** Union of all supported normalized event kinds. */
export const NormalizedEventSchema = z.discriminatedUnion('kind', [
  OutgoingNpcDamageSchema,
  OutgoingPlayerDamageSchema,
  IncomingDamageSchema,
  RemoteRepairDeliveredSchema,
  RemoteRepairReceivedSchema,
]);

export type NormalizedEvent = z.infer<typeof NormalizedEventSchema>;
export type OutgoingNpcDamage = z.infer<typeof OutgoingNpcDamageSchema>;
export type OutgoingPlayerDamage = z.infer<typeof OutgoingPlayerDamageSchema>;
export type IncomingDamage = z.infer<typeof IncomingDamageSchema>;
export type RemoteRepairDelivered = z.infer<typeof RemoteRepairDeliveredSchema>;
export type RemoteRepairReceived = z.infer<typeof RemoteRepairReceivedSchema>;

// ---------------------------------------------------------------------------
// Site identity
// ---------------------------------------------------------------------------

export const SiteIdentitySchema = z.object({
  /** Human-readable display name exactly as entered by the user. */
  name: z.string().min(1),
  /** Canonical URL-safe key derived from the display name. */
  key: z.string().min(1),
});

export type SiteIdentity = z.infer<typeof SiteIdentitySchema>;

// ---------------------------------------------------------------------------
// FleetProfile
// ---------------------------------------------------------------------------

export const FleetProfileSchema = z.object({
  /** Canonical key derived from the fleet profile name. */
  id: z.string().min(1),
  /** Human-readable display name exactly as entered by the user. */
  name: z.string().min(1),
});

export type FleetProfile = z.infer<typeof FleetProfileSchema>;

// ---------------------------------------------------------------------------
// RunWindow
// ---------------------------------------------------------------------------

export const RunWindowSchema = z.object({
  /** Confirmed window start (ISO 8601). */
  start: IsoDateTimeString,
  /** Confirmed window end (ISO 8601). */
  end: IsoDateTimeString,
  /** How the window boundaries were determined. */
  source: z.string().min(1),
  /** Whether the user manually overrode the auto-detected window. */
  manuallyAdjusted: z.boolean(),
});

export type RunWindow = z.infer<typeof RunWindowSchema>;

// ---------------------------------------------------------------------------
// CalculationSettings
// ---------------------------------------------------------------------------

export const CalculationSettingsSchema = z.object({
  /** Gap in seconds that separates two candidate PvE episodes. */
  episodeThresholdSeconds: z.number().positive(),
  /** Continuity gap in seconds used to separate active-combat segments. */
  activeCombatGapSeconds: z.number().positive(),
});

export type CalculationSettings = z.infer<typeof CalculationSettingsSchema>;

// ---------------------------------------------------------------------------
// RunMetrics
// ---------------------------------------------------------------------------

export const RunMetricsSchema = z.object({
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
});

export type RunMetrics = z.infer<typeof RunMetricsSchema>;

// ---------------------------------------------------------------------------
// CharacterMetrics
// ---------------------------------------------------------------------------

export const CharacterMetricsSchema = z.object({
  characterName: z.string().min(1),
  damageDealt: z.number().nonnegative(),
  damageTaken: z.number().nonnegative(),
  remoteRepairDelivered: z.number().nonnegative(),
  remoteRepairReceived: z.number().nonnegative(),
  activeCombatSeconds: z.number().nonnegative(),
  logFiles: z.number().int().nonnegative(),
});

export type CharacterMetrics = z.infer<typeof CharacterMetricsSchema>;

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

export const CoverageSchema = z.object({
  logFiles: z.number().int().nonnegative(),
  participantsWithOutgoingDamage: z.number().int().nonnegative(),
  unparsedCombatLines: z.number().int().nonnegative(),
  ambiguousEventsExcluded: z.number().int().nonnegative(),
  /**
   * Quality of remote-repair pairing:
   *   'none'     – no repair data at all
   *   'partial'  – some pairings are ambiguous
   *   'full'     – every repair event has a confirmed counterpart
   */
  repairPairing: z.enum(['none', 'partial', 'full']),
});

export type Coverage = z.infer<typeof CoverageSchema>;

// ---------------------------------------------------------------------------
// RunSummary
// ---------------------------------------------------------------------------

export const RunSummarySchema = z.object({
  schemaVersion: z.literal(1),
  parserVersion: z.string().min(1),
  metricsVersion: z.string().min(1),
  /** Unique run identifier: `<datetime>-<site-key>`. */
  id: z.string().min(1),
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
});

export type RunSummary = z.infer<typeof RunSummarySchema>;

// ---------------------------------------------------------------------------
// CatalogEntry – lightweight index record rebuilt from RunSummary files
// ---------------------------------------------------------------------------

export const CatalogEntrySchema = z.object({
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
});

export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;
