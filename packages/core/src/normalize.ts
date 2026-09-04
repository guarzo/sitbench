import type { NormalizedEvent } from './schemas.js';
import { inspectCombatLine } from './log-line-parser.js';
import { parseLogHeader } from './log-header.js';

export interface NormalizeLogInput {
  text: string;
  sourceFile: string;
}

/**
 * Coverage counts emitted while normalizing a single log file.
 *
 * `ambiguousEventsExcluded` counts parsed ambiguous damage-dealt/miss
 * observations that remain preserved in `events` with
 * `targetClassification: 'ambiguous'`. Downstream qualifying site analysis must
 * filter those preserved events out rather than assuming they were removed from
 * the normalized event stream.
 */
export interface NormalizeCounts {
  lines: number;
  combatLines: number;
  parsedCombatLines: number;
  unparsedCombatLines: number;
  malformedLines: number;
  ambiguousEventsExcluded: number;
}

/**
 * Normalized output for one log file.
 *
 * `events` preserves every parsed supported observation with full provenance,
 * including ambiguous observations. Use `counts.ambiguousEventsExcluded` and an
 * event's `targetClassification` when downstream logic needs to exclude
 * ambiguous observations from qualifying site analysis.
 */
export interface NormalizeLogResult {
  character: string | null;
  events: NormalizedEvent[];
  counts: NormalizeCounts;
}

export function normalizeLogFile(input: NormalizeLogInput): NormalizeLogResult {
  const lines = splitLines(input.text);
  const { character } = parseLogHeader(input.text);
  const events: NormalizedEvent[] = [];
  const counts: NormalizeCounts = {
    lines: lines.length,
    combatLines: 0,
    parsedCombatLines: 0,
    unparsedCombatLines: 0,
    malformedLines: 0,
    ambiguousEventsExcluded: 0,
  };

  for (const [index, line] of lines.entries()) {
    if (!line.includes('(combat)')) {
      continue;
    }

    counts.combatLines += 1;

    if (character === null) {
      counts.malformedLines += 1;
      continue;
    }

    const inspection = inspectCombatLine(line, {
      observedBy: character,
      sourceFile: input.sourceFile,
      sourceLine: index + 1,
    });

    if (inspection.status === 'parsed') {
      events.push(inspection.event);
      counts.parsedCombatLines += 1;

      if (
        (inspection.event.kind === 'damage-dealt' || inspection.event.kind === 'miss') &&
        inspection.event.targetClassification === 'ambiguous'
      ) {
        counts.ambiguousEventsExcluded += 1;
      }

      continue;
    }

    if (inspection.status === 'malformed') {
      counts.malformedLines += 1;
      continue;
    }

    counts.unparsedCombatLines += 1;
  }

  events.sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.sourceLine - right.sourceLine);

  return {
    character,
    events,
    counts,
  };
}

function splitLines(text: string): string[] {
  if (text.length === 0) {
    return [];
  }

  const lines = text.split(/\r?\n/);

  if (lines.at(-1) === '') {
    lines.pop();
  }

  return lines;
}
