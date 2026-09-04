import { formatSignedCount, formatSignedSeconds } from './format.js';

// ---------------------------------------------------------------------------
// Metric deltas: value, desirability direction, and their shared presentation
// ---------------------------------------------------------------------------

/**
 * Whether a delta is an improvement. Derived from metric desirability, not
 * from the numeric sign: less elapsed time is better, more fleet DPS is
 * better, less damage taken is better.
 */
export type DeltaDirection = 'better' | 'worse' | 'same';

/** Duration metrics carry a seconds unit; count metrics are unitless. */
export type DeltaKind = 'duration' | 'count';

export interface MetricDeltaSpec {
  kind: DeltaKind;
  lowerIsBetter: boolean;
}

export interface MetricDelta {
  /** Signed, formatted value, e.g. "-15s" or "+53,000". */
  text: string;
  direction: DeltaDirection;
  /**
   * Wording for assistive tech. Durations state the factual change
   * ("faster"/"slower"); unitless metrics use the neutral desirability
   * wording ("better"/"worse").
   */
  description: string;
  /** Numeric sign of the rounded delta, used for the arrow glyph. */
  sign: -1 | 0 | 1;
}

/**
 * Builds the display form of a delta. Callers are responsible for computing
 * the delta itself; every comparison in the dashboard uses
 * `current - baseline` (in the two-run comparison: Run A minus Run B).
 */
export function metricDelta(delta: number, spec: MetricDeltaSpec): MetricDelta {
  const rounded = Math.round(delta);
  const sign: -1 | 0 | 1 = rounded > 0 ? 1 : rounded < 0 ? -1 : 0;
  const text = spec.kind === 'duration' ? formatSignedSeconds(delta) : formatSignedCount(delta);

  if (sign === 0) {
    return { text, direction: 'same', description: 'unchanged', sign };
  }

  const improved = spec.lowerIsBetter ? sign < 0 : sign > 0;
  const direction: DeltaDirection = improved ? 'better' : 'worse';
  const description =
    spec.kind === 'duration' ? (sign < 0 ? 'faster' : 'slower') : improved ? 'better' : 'worse';

  return { text, direction, description, sign };
}

const ARROWS: Record<'-1' | '0' | '1', string> = {
  '-1': '\u25BC',
  '0': '=',
  '1': '\u25B2',
};

export interface DeltaElementOptions {
  /**
   * When true the direction wording is visible next to the value; otherwise
   * it stays in the accessibility tree only (dense table cells).
   */
  showDescription?: boolean;
}

/**
 * Renders a delta exactly once: an arrow glyph for the numeric direction
 * (hidden from assistive tech), the signed value, and a text cue for the
 * desirability direction that assistive tech always reads.
 */
export function createDeltaElement(delta: MetricDelta, options?: DeltaElementOptions): HTMLElement {
  const wrapper = document.createElement('span');
  wrapper.className = `metric-delta delta-${delta.direction}`;
  wrapper.dataset.direction = delta.direction;

  const arrow = document.createElement('span');
  arrow.className = 'delta-arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = ARROWS[String(delta.sign) as '-1' | '0' | '1'];
  wrapper.appendChild(arrow);

  const text = document.createElement('span');
  text.className = 'delta-text';
  text.textContent = delta.text;
  wrapper.appendChild(text);

  const word = document.createElement('span');
  word.className = options?.showDescription === true ? 'delta-word' : 'delta-word visually-hidden';
  word.textContent = delta.description;
  wrapper.appendChild(word);

  return wrapper;
}
