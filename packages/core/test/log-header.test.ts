import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseLogHeader } from '../src/log-header.js';

describe('parseLogHeader', () => {
  it('extracts the Listener character from a representative gamelog header instead of returning null for valid headers', () => {
    const text = readFileSync(new URL('./fixtures/damage-session.txt', import.meta.url), 'utf8');

    expect(parseLogHeader(text)).toEqual({ character: 'Dah Nee' });
  });

  it('returns null when the Listener header is absent instead of inventing an observer', () => {
    const text = ['------------------------------------------------------------', '  Gamelog', '------------------------------------------------------------'].join('\n');

    expect(parseLogHeader(text)).toEqual({ character: null });
  });
});
