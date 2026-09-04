import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCombatLine } from '../src/log-line-parser.js';
import { classifyTarget } from '../src/target-classifier.js';

function fixtureLines(name: string): string[] {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8').trimEnd().split(/\r?\n/);
}

describe('parseCombatLine', () => {
  const damageLines = fixtureLines('damage-session.txt');
  const repairLines = fixtureLines('repair-session.txt');

  it('parses corp-tagged outgoing damage lines into damage-dealt events instead of leaking ticker suffixes into actor identity', () => {
    const raw = damageLines[4];
    const event = parseCombatLine(raw, {
      observedBy: 'Dah Nee',
      sourceFile: 'damage-session.txt',
      sourceLine: 5,
    });

    expect(event).toMatchObject({
      timestamp: '2026-09-03T04:51:14.000Z',
      kind: 'damage-dealt',
      actor: 'Dah Nee',
      target: 'Sleepless Guardian',
      amount: 1183,
      hitQuality: 'Hits',
      targetClassification: 'npc',
      observedBy: 'Dah Nee',
      sourceFile: 'damage-session.txt',
      sourceLine: 5,
      raw,
    });
  });

  it('parses incoming damage lines into damage-taken events instead of misattributing the target away from the observer', () => {
    const raw = damageLines[5];
    const event = parseCombatLine(raw, {
      observedBy: 'Dah Nee',
      sourceFile: 'damage-session.txt',
      sourceLine: 6,
    });

    expect(event).toMatchObject({
      timestamp: '2026-09-03T04:51:15.000Z',
      kind: 'damage-taken',
      actor: 'Sleepless Guardian',
      target: 'Dah Nee',
      amount: 341,
      hitQuality: 'Hits',
      observedBy: 'Dah Nee',
      sourceFile: 'damage-session.txt',
      sourceLine: 6,
      raw,
    });
  });

  it('parses miss lines into miss events instead of dropping outgoing misses from qualifying activity', () => {
    const raw = damageLines[6];
    const event = parseCombatLine(raw, {
      observedBy: 'Dah Nee',
      sourceFile: 'damage-session.txt',
      sourceLine: 7,
    });

    expect(event).toMatchObject({
      timestamp: '2026-09-03T04:51:16.000Z',
      kind: 'miss',
      actor: 'Dah Nee',
      target: 'Sleepless Guardian',
      targetClassification: 'npc',
      observedBy: 'Dah Nee',
      sourceFile: 'damage-session.txt',
      sourceLine: 7,
      raw,
    });
  });

  it('parses remote-repair delivered lines instead of losing outgoing logistics contributions', () => {
    const raw = repairLines[4];
    const event = parseCombatLine(raw, {
      observedBy: 'Dah Nee',
      sourceFile: 'repair-session.txt',
      sourceLine: 5,
    });

    expect(event).toMatchObject({
      timestamp: '2026-09-03T04:52:02.000Z',
      kind: 'remote-repair-delivered',
      actor: 'Dah Nee',
      target: 'Ally Pilot',
      amount: 320,
      observedBy: 'Dah Nee',
      sourceFile: 'repair-session.txt',
      sourceLine: 5,
      raw,
    });
  });

  it('parses remote-repair received lines instead of losing incoming logistics coverage', () => {
    const raw = repairLines[5];
    const event = parseCombatLine(raw, {
      observedBy: 'Dah Nee',
      sourceFile: 'repair-session.txt',
      sourceLine: 6,
    });

    expect(event).toMatchObject({
      timestamp: '2026-09-03T04:52:01.000Z',
      kind: 'remote-repair-received',
      actor: 'Ally Pilot',
      target: 'Dah Nee',
      amount: 280,
      observedBy: 'Dah Nee',
      sourceFile: 'repair-session.txt',
      sourceLine: 6,
      raw,
    });
  });
});

describe('classifyTarget', () => {
  it('classifies Sleepless NPC names as npc instead of excluding site damage', () => {
    expect(classifyTarget('Sleepless Guardian')).toBe('npc');
  });

  it('classifies Mobile Tractor Unit as non-site instead of treating player deployables as PvE targets', () => {
    expect(classifyTarget('Mobile Tractor Unit')).toBe('non-site');
  });

  it('classifies unknown targets as ambiguous instead of assuming they qualify for site damage', () => {
    expect(classifyTarget('Unknown Contact')).toBe('ambiguous');
  });
});
