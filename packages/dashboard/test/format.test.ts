import { describe, expect, it } from 'vitest';
import { formatSignedCount, formatSignedSeconds } from '../src/format.js';
import { metricDelta } from '../src/delta.js';

describe('formatSignedSeconds', () => {
  it('prefixes a positive duration delta with a plus and a seconds unit', () => {
    expect(formatSignedSeconds(15)).toBe('+15s');
  });

  it('keeps the minus sign for a negative duration delta', () => {
    expect(formatSignedSeconds(-15)).toBe('-15s');
  });

  it('renders an unchanged duration delta without a sign', () => {
    expect(formatSignedSeconds(0)).toBe('0s');
    expect(formatSignedSeconds(-0.2)).toBe('0s');
  });

  it('rounds fractional seconds', () => {
    expect(formatSignedSeconds(14.6)).toBe('+15s');
    expect(formatSignedSeconds(-14.6)).toBe('-15s');
  });

  it('groups large second counts', () => {
    expect(formatSignedSeconds(3605)).toBe('+3,605s');
  });
});

describe('formatSignedCount', () => {
  it('formats a small positive count delta without a unit suffix', () => {
    expect(formatSignedCount(37)).toBe('+37');
    // Guards the defect where DPS deltas were rendered through the seconds formatter.
    expect(formatSignedCount(37)).not.toBe('+37s');
  });

  it('groups large positive count deltas', () => {
    expect(formatSignedCount(53000)).toBe('+53,000');
    expect(formatSignedCount(53000)).not.toBe('+53000s');
  });

  it('groups large negative count deltas', () => {
    expect(formatSignedCount(-6000)).toBe('-6,000');
    expect(formatSignedCount(-6000)).not.toBe('-6000s');
  });

  it('renders an unchanged count delta without a sign', () => {
    expect(formatSignedCount(0)).toBe('0');
    expect(formatSignedCount(-0.2)).toBe('0');
  });

  it('rounds fractional counts', () => {
    expect(formatSignedCount(1234.6)).toBe('+1,235');
  });
});

describe('metricDelta', () => {
  it('treats a shorter duration as better and describes it as faster', () => {
    expect(metricDelta(-15, { kind: 'duration', lowerIsBetter: true })).toEqual({
      text: '-15s',
      direction: 'better',
      description: 'faster',
      sign: -1,
    });
  });

  it('treats a longer duration as worse and describes it as slower', () => {
    expect(metricDelta(9, { kind: 'duration', lowerIsBetter: true })).toEqual({
      text: '+9s',
      direction: 'worse',
      description: 'slower',
      sign: 1,
    });
  });

  it('treats more fleet DPS as better without calling it faster', () => {
    const delta = metricDelta(37, { kind: 'count', lowerIsBetter: false });
    expect(delta.text).toBe('+37');
    expect(delta.direction).toBe('better');
    expect(delta.description).toBe('better');
    expect(delta.sign).toBe(1);
  });

  it('treats less fleet damage as worse', () => {
    const delta = metricDelta(-53000, { kind: 'count', lowerIsBetter: false });
    expect(delta.text).toBe('-53,000');
    expect(delta.direction).toBe('worse');
    expect(delta.description).toBe('worse');
    expect(delta.sign).toBe(-1);
  });

  it('treats less damage taken as better', () => {
    const delta = metricDelta(-6000, { kind: 'count', lowerIsBetter: true });
    expect(delta.text).toBe('-6,000');
    expect(delta.direction).toBe('better');
    expect(delta.description).toBe('better');
    expect(delta.sign).toBe(-1);
  });

  it('reports an unchanged metric neutrally', () => {
    expect(metricDelta(0, { kind: 'count', lowerIsBetter: false })).toEqual({
      text: '0',
      direction: 'same',
      description: 'unchanged',
      sign: 0,
    });
    expect(metricDelta(0, { kind: 'duration', lowerIsBetter: true })).toEqual({
      text: '0s',
      direction: 'same',
      description: 'unchanged',
      sign: 0,
    });
  });
});
