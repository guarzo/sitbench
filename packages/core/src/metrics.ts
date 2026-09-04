import type {
  CalculationSettings,
  CharacterMetrics,
  DamageDealt,
  NormalizedEvent,
  RunMetrics,
  RunWindow,
} from './schemas.js';

/** Full result of calculating a confirmed run window's fleet and per-character metrics. */
export interface CalculatedRun {
  /** Resolved calculation thresholds actually used (defaults merged with overrides). */
  calculation: CalculationSettings;
  metrics: RunMetrics;
  characterMetrics: CharacterMetrics[];
}

const DEFAULT_CALCULATION_SETTINGS: CalculationSettings = {
  episodeThresholdSeconds: 180,
  activeCombatGapSeconds: 30,
};

function resolveSettings(settings?: Partial<CalculationSettings>): CalculationSettings {
  return {
    episodeThresholdSeconds: settings?.episodeThresholdSeconds ?? DEFAULT_CALCULATION_SETTINGS.episodeThresholdSeconds,
    activeCombatGapSeconds: settings?.activeCombatGapSeconds ?? DEFAULT_CALCULATION_SETTINGS.activeCombatGapSeconds,
  };
}

/** Zero-denominator-safe division: returns 0 instead of NaN/Infinity. */
function safeDivide(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function isWithinWindow(event: NormalizedEvent, startMs: number, endMs: number): boolean {
  const timestampMs = Date.parse(event.timestamp);
  return timestampMs >= startMs && timestampMs <= endMs;
}

function isQualifyingNpcDamage(event: NormalizedEvent): event is DamageDealt {
  return event.kind === 'damage-dealt' && event.targetClassification === 'npc';
}

function sumAmount(events: NormalizedEvent[]): number {
  return events.reduce((total, event) => (('amount' in event ? total + event.amount : total)), 0);
}

function computeActiveCombatSeconds(sortedQualifying: DamageDealt[], activeCombatGapSeconds: number): number {
  let active = 0;
  let previousEvent: DamageDealt | undefined;

  for (const event of sortedQualifying) {
    if (previousEvent !== undefined) {
      const gapSeconds = (Date.parse(event.timestamp) - Date.parse(previousEvent.timestamp)) / 1000;
      if (gapSeconds <= activeCombatGapSeconds) {
        active += gapSeconds;
      }
    }
    previousEvent = event;
  }

  return active;
}

interface FleetContext {
  fleetDamageDealt: number;
  elapsedSeconds: number;
  activeCombatSeconds: number;
}

function buildCharacterMetrics(character: string, windowEvents: NormalizedEvent[], fleet: FleetContext): CharacterMetrics {
  const own = windowEvents.filter((event) => event.observedBy === character);
  const qualifyingDamage = own.filter(isQualifyingNpcDamage);
  const damageDealt = sumAmount(qualifyingDamage);

  const damageTaken = sumAmount(own.filter((event) => event.kind === 'damage-taken'));
  const remoteRepairDelivered = sumAmount(own.filter((event) => event.kind === 'remote-repair-delivered'));
  const remoteRepairReceived = sumAmount(own.filter((event) => event.kind === 'remote-repair-received'));

  const shotsHit = qualifyingDamage.length;
  const shotsMissed = own.filter((event) => event.kind === 'miss' && event.targetClassification === 'npc').length;
  const missRate = safeDivide(shotsMissed, shotsHit + shotsMissed);

  const hitQualityCounts: Record<string, number> = {};
  for (const event of qualifyingDamage) {
    if (event.hitQuality !== null) {
      hitQualityCounts[event.hitQuality] = (hitQualityCounts[event.hitQuality] ?? 0) + 1;
    }
  }

  const sortedQualifying = qualifyingDamage
    .slice()
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  const firstRelevantEvent = sortedQualifying.at(0)?.timestamp ?? null;
  const lastRelevantEvent = sortedQualifying.at(-1)?.timestamp ?? null;

  return {
    character,
    damageDealt,
    fleetDamageShare: safeDivide(damageDealt, fleet.fleetDamageDealt),
    averageDps: safeDivide(damageDealt, fleet.elapsedSeconds),
    activeDps: safeDivide(damageDealt, fleet.activeCombatSeconds),
    damageTaken,
    remoteRepairDelivered,
    remoteRepairReceived,
    shotsHit,
    shotsMissed,
    missRate,
    hitQualityCounts,
    firstRelevantEvent,
    lastRelevantEvent,
  };
}

/**
 * Calculates fleet and per-character metrics for a confirmed run window.
 *
 * Elapsed time comes from the confirmed window, not from the events
 * themselves. Only events with a timestamp inside `[window.start,
 * window.end]` (inclusive) contribute. Active-combat time is derived from
 * consecutive qualifying (`damage-dealt` + `targetClassification: 'npc'`)
 * events: gaps less than or equal to `activeCombatGapSeconds` add their full
 * duration; larger gaps add nothing. Every ratio metric returns 0 instead of
 * NaN/Infinity when its denominator is zero.
 */
export function calculateRun(
  events: NormalizedEvent[],
  window: RunWindow,
  settings?: Partial<CalculationSettings>,
): CalculatedRun {
  const calculation = resolveSettings(settings);
  const startMs = Date.parse(window.start);
  const endMs = Date.parse(window.end);
  const elapsedSeconds = Math.max(0, (endMs - startMs) / 1000);

  const windowEvents = events.filter((event) => isWithinWindow(event, startMs, endMs));

  const sortedQualifying = windowEvents
    .filter(isQualifyingNpcDamage)
    .slice()
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));

  const activeCombatSeconds = computeActiveCombatSeconds(sortedQualifying, calculation.activeCombatGapSeconds);
  const idleSeconds = Math.max(0, elapsedSeconds - activeCombatSeconds);

  const fleetDamageDealt = sumAmount(sortedQualifying);
  const damageTaken = sumAmount(windowEvents.filter((event) => event.kind === 'damage-taken'));
  const remoteRepairDelivered = sumAmount(windowEvents.filter((event) => event.kind === 'remote-repair-delivered'));

  const characters = Array.from(new Set(windowEvents.map((event) => event.observedBy))).sort();

  const fleetContext: FleetContext = { fleetDamageDealt, elapsedSeconds, activeCombatSeconds };
  const characterMetrics = characters.map((character) => buildCharacterMetrics(character, windowEvents, fleetContext));

  const metrics: RunMetrics = {
    elapsedSeconds,
    activeCombatSeconds,
    idleSeconds,
    fleetDamageDealt,
    averageFleetDps: safeDivide(fleetDamageDealt, elapsedSeconds),
    activeFleetDps: safeDivide(fleetDamageDealt, activeCombatSeconds),
    damageTaken,
    remoteRepairDelivered,
    participantCount: characters.length,
  };

  return { calculation, metrics, characterMetrics };
}
