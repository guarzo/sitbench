import { describe, expect, it } from 'vitest';
import { canonicalKey } from '../src/canonicalize.js';

describe('canonicalKey', () => {
  it('normalizes case, punctuation, and whitespace', () => {
    expect(canonicalKey('  8 Kikis + 2 Deacons  ')).toBe('8-kikis-2-deacons');
    expect(canonicalKey('Core   Bastion')).toBe('core-bastion');
  });

  it('preserves Unicode letters and digits', () => {
    // Accented and non-ASCII letters must be kept, not stripped.
    expect(canonicalKey('Café Léger')).toBe('café-léger');
    expect(canonicalKey('Ñoño')).toBe('ñoño');
    // Digits mixed with Unicode letters.
    expect(canonicalKey('3é Fleet')).toBe('3é-fleet');
  });

  it('collapses multiple non-alphanumeric separators into a single dash', () => {
    expect(canonicalKey('A -- B __  C')).toBe('a-b-c');
  });

  it('trims leading and trailing dashes', () => {
    expect(canonicalKey('---Hello---')).toBe('hello');
    expect(canonicalKey('+++ Zone +++')).toBe('zone');
  });
});
