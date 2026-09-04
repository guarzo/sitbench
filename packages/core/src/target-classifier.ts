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
