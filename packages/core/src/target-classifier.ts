import type { DamageDealt } from './schemas.js';

const NON_SITE_EXACT_NAMES = [
  'Mobile Tractor Unit',
  'Mobile Depot',
  'Mobile Cynosural Beacon',
  'Mobile Scan Inhibitor',
  'Mobile Micro Jump Unit',
  'Warp Disrupt Probe',
  'Heavy Warp Disrupt Probe',
] as const;

const PLAYER_OWNED_DEPLOYABLE_PATTERNS = [/^Mobile\b/i, /\bWarp Disrupt Probe\b/i];
const OBVIOUS_STRUCTURE_PATTERNS = [
  /\bStructure\b/i,
  /\bStation\b/i,
  /\bStargate\b/i,
  /\bCitadel\b/i,
  /\bTower\b/i,
  /\bBattery\b/i,
  /\bBunker\b/i,
  /\bSilo\b/i,
  /\bArray\b/i,
  /\bCustoms Office\b/i,
  /\bInfrastructure Hub\b/i,
];

/**
 * Names that can currently be confirmed as NPCs. This list is deliberately
 * limited to the Sleeper-family prefixes that synthetic fixtures and the
 * design spec actually cover; every other PvE target name stays 'ambiguous'
 * and is excluded from qualifying episode detection rather than guessed at.
 * Do not extend this list without anonymized real gamelog evidence for the
 * added names -- a wrong confirmation silently changes run windows and
 * metrics, while an ambiguous classification is reported to the user.
 */
const KNOWN_NPC_PATTERNS = [/^Sleepless\b/, /^Awakened\b/, /^Emergent\b/];

export type TargetClassification = DamageDealt['targetClassification'];

export function classifyTarget(name: string): TargetClassification {
  const trimmed = name.trim();

  if (trimmed.length === 0) {
    return 'ambiguous';
  }

  if (NON_SITE_EXACT_NAMES.includes(trimmed as (typeof NON_SITE_EXACT_NAMES)[number])) {
    return 'non-site';
  }

  if (PLAYER_OWNED_DEPLOYABLE_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return 'non-site';
  }

  if (OBVIOUS_STRUCTURE_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return 'non-site';
  }

  if (KNOWN_NPC_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return 'npc';
  }

  return 'ambiguous';
}
