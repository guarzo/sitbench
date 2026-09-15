import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fingerprintRun } from '../src/fingerprint.js';
import { normalizeLogFile } from '../src/normalize.js';
import { NormalizedEventSchema } from '../src/schemas.js';

function readFixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

describe('normalizeLogFile', () => {
  it('retains neutralization evidence and duplicate hits in normalization and the run fingerprint', () => {
    const raw =
      '[ 2026.09.15 01:09:25 ] (combat) <color=0xffe57f7f><b>120 GJ</b><color=0x77ffffff><font size=10> energy neutralized </font><b><color=0xffffffff>Sleepless Keeper</b><color=0x77ffffff><font size=10> - Sleepless Keeper</font>';
    const damage = '[ 2026.09.15 01:09:24 ] (combat) 100 to Sleepless Guardian - Heavy Entropic Disintegrator II - Hits';
    const outgoing = raw.replace('0xffe57f7f', '0xff7fffff');
    const result = normalizeLogFile({
      text: ['Listener: Pilot One', raw, damage, raw, outgoing].join('\r\n'),
      sourceFile: 'neut-session.txt',
    });

    expect(result.character).toBe('Pilot One');
    expect(result.counts).toEqual({
      lines: 5, combatLines: 4, parsedCombatLines: 3, unparsedCombatLines: 1,
      malformedLines: 0, ambiguousEventsExcluded: 0,
    });
    expect(result.events.map(({ kind, sourceLine }) => [kind, sourceLine])).toEqual([
      ['damage-dealt', 3], ['neut-received', 2], ['neut-received', 4],
    ]);
    expect(result.events[1]).toEqual({
      kind: 'neut-received', timestamp: '2026-09-15T01:09:25.000Z',
      observedBy: 'Pilot One', actor: 'Sleepless Keeper', target: 'Pilot One', amount: 120,
      sourceFile: 'neut-session.txt', sourceLine: 2, raw,
    });
    expect(result.events[2]?.raw).toBe(raw);

    const restored = result.events.map((event) => NormalizedEventSchema.parse(JSON.parse(JSON.stringify(event))));
    const window = {
      start: '2026-09-15T01:09:24.000Z', end: '2026-09-15T01:09:25.000Z',
      source: 'test-fixture', manuallyAdjusted: false,
    };
    const fingerprint = fingerprintRun(result.events, window);
    expect(fingerprintRun(restored.reverse(), window)).toBe(fingerprint);
    expect(fingerprintRun(result.events.filter((event) => event.kind === 'damage-dealt'), window)).not.toBe(fingerprint);
    expect(fingerprintRun(result.events.slice(0, 2), window)).not.toBe(fingerprint);
  });

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

  it('keeps ambiguous parsed observations in events while counting them as excluded from qualifying site analysis instead of deleting them from the normalized stream', () => {
    const result = normalizeLogFile({
      text: readFixture('damage-session.txt'),
      sourceFile: 'damage-session.txt',
    });

    const ambiguousEvents = result.events.filter(
      (event) => (event.kind === 'damage-dealt' || event.kind === 'miss') && event.targetClassification === 'ambiguous',
    );

    expect(ambiguousEvents).toHaveLength(2);
    expect(ambiguousEvents.map((event) => [event.kind, event.target, event.sourceLine])).toEqual([
      ['damage-dealt', 'Unknown Capsuleer', 9],
      ['damage-dealt', 'Unknown Contact', 11],
    ]);
    expect(result.counts.ambiguousEventsExcluded).toBe(2);
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
