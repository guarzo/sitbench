import type { DamageDealt, NormalizedEvent } from './schemas.js';

/**
 * A candidate PvE site episode detected purely from qualifying (outgoing
 * NPC-targeted damage-dealt) activity. Incoming damage and non-NPC or
 * ambiguous outgoing damage never contribute to boundary detection.
 */
export interface CandidateEpisode {
  /** ISO 8601 timestamp of this episode's first qualifying event. */
  start: string;
  /** ISO 8601 timestamp of this episode's last qualifying event. */
  end: string;
  /** Count of qualifying events contained in this episode. */
  qualifyingEventCount: number;
  /**
   * ISO 8601 timestamp of the previous episode's last qualifying event, kept
   * for preview context (e.g. showing the gap before this episode). Null for
   * the first episode.
   */
  previousQualifyingActivityAt: string | null;
  /**
   * ISO 8601 timestamp of the next episode's first qualifying event, kept for
   * preview context (e.g. showing the gap after this episode). Null for the
   * last episode.
   */
  nextQualifyingActivityAt: string | null;
}

export interface DetectEpisodesOptions {
  /** Gap in seconds that separates two candidate episodes. Default 180. */
  episodeThresholdSeconds?: number;
}

const DEFAULT_EPISODE_THRESHOLD_SECONDS = 180;

function isQualifyingNpcDamage(event: NormalizedEvent): event is DamageDealt {
  return event.kind === 'damage-dealt' && event.targetClassification === 'npc';
}

/**
 * Detects candidate PvE site episodes from normalized events.
 *
 * Only `damage-dealt` events with `targetClassification: 'npc'` qualify as
 * boundary/activity signal. A gap between two consecutive qualifying events
 * that is greater than or equal to `episodeThresholdSeconds` splits the
 * episode; smaller gaps keep the events in the same episode. Incoming damage
 * and non-qualifying outgoing damage are ignored entirely and never merge or
 * split episodes.
 */
export function detectEpisodes(
  events: NormalizedEvent[],
  options: DetectEpisodesOptions = {},
): CandidateEpisode[] {
  const thresholdSeconds = options.episodeThresholdSeconds ?? DEFAULT_EPISODE_THRESHOLD_SECONDS;

  const qualifying = events
    .filter(isQualifyingNpcDamage)
    .slice()
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));

  const groups: DamageDealt[][] = [];
  let current: DamageDealt[] = [];
  let previousEvent: DamageDealt | undefined;

  for (const event of qualifying) {
    if (previousEvent !== undefined) {
      const gapSeconds = (Date.parse(event.timestamp) - Date.parse(previousEvent.timestamp)) / 1000;
      if (gapSeconds >= thresholdSeconds) {
        groups.push(current);
        current = [];
      }
    }
    current.push(event);
    previousEvent = event;
  }
  if (current.length > 0) {
    groups.push(current);
  }

  return groups.map((group, index) => {
    const boundaries = episodeBoundaries(group);
    const previousGroup = index > 0 ? groups[index - 1] : undefined;
    const nextGroup = index < groups.length - 1 ? groups[index + 1] : undefined;

    return {
      start: boundaries.start,
      end: boundaries.end,
      qualifyingEventCount: group.length,
      previousQualifyingActivityAt: previousGroup !== undefined ? episodeBoundaries(previousGroup).end : null,
      nextQualifyingActivityAt: nextGroup !== undefined ? episodeBoundaries(nextGroup).start : null,
    };
  });
}

/** Group is always non-empty by construction; this guards that invariant. */
function episodeBoundaries(group: DamageDealt[]): { start: string; end: string } {
  const first = group[0];
  const last = group[group.length - 1];

  if (first === undefined || last === undefined) {
    throw new Error('Episode group must not be empty');
  }

  return { start: first.timestamp, end: last.timestamp };
}
