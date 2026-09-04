import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeLogFile } from '../src/normalize.js';

function readFixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

describe('normalizeLogFile', () => {
  it('normalizes a damage session instead of dropping raw lines, deduplicating repeated hits, or hiding unsupported combat coverage gaps', () => {
    const result = normalizeLogFile({
      text: readFixture('damage-session.txt'),
      sourceFile: 'damage-session.txt',
    });

    expect(result.character).toBe('Dah Nee');
    expect(result.events).toHaveLength(7);
    expect(result.events[0]).toMatchObject({
      timestamp: '2026-09-03T04:51:14.000Z',
      kind: 'damage-dealt',
      actor: 'Dah Nee',
      target: 'Sleepless Guardian',
      amount: 1183,
      hitQuality: 'Hits',
      targetClassification: 'npc',
      sourceLine: 5,
      raw: '[ 2026.09.03 04:51:14 ] (combat) 1183 from Dah Nee[Example] - Heavy Entropic Disintegrator II - Hits Sleepless Guardian',
    });
    expect(result.events[1]).toMatchObject({
      timestamp: '2026-09-03T04:51:14.000Z',
      kind: 'damage-dealt',
      sourceLine: 10,
    });
    expect(
      result.events.filter(
        (event) => event.kind === 'damage-dealt' && event.timestamp === '2026-09-03T04:51:14.000Z' && event.target === 'Sleepless Guardian',
      ),
    ).toHaveLength(2);
    expect(result.counts).toEqual({
      lines: 14,
      combatLines: 9,
      parsedCombatLines: 7,
      unparsedCombatLines: 1,
      malformedLines: 1,
      ambiguousEventsExcluded: 2,
    });
  });

  it('sorts parsed repair events by timestamp then source line instead of preserving out-of-order file order', () => {
    const result = normalizeLogFile({
      text: readFixture('repair-session.txt'),
      sourceFile: 'repair-session.txt',
    });

    expect(result.character).toBe('Dah Nee');
    expect(result.events.map((event) => [event.kind, event.timestamp, event.sourceLine])).toEqual([
      ['remote-repair-received', '2026-09-03T04:52:01.000Z', 6],
      ['remote-repair-delivered', '2026-09-03T04:52:02.000Z', 5],
    ]);
    expect(result.counts).toEqual({
      lines: 6,
      combatLines: 2,
      parsedCombatLines: 2,
      unparsedCombatLines: 0,
      malformedLines: 0,
      ambiguousEventsExcluded: 0,
    });
  });
});
