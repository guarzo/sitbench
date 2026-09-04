import { describe, expect, it } from 'vitest';
import { canonicalKey } from '../src/canonicalize.js';

describe('canonicalKey', () => {
  it('normalizes case, punctuation, and whitespace', () => {
    expect(canonicalKey('  8 Kikis + 2 Deacons  ')).toBe('8-kikis-2-deacons');
    expect(canonicalKey('Core   Bastion')).toBe('core-bastion');
  });
});
