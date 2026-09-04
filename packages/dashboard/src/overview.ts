import type { DashboardDataset, DashboardRun } from './data.js';
import { bestRunUpTo, previousRun, trailingFiveAverage } from './compare.js';
import { formatDelta, formatDps, formatElapsed } from './format.js';

// ---------------------------------------------------------------------------
// Overview cards: latest elapsed, deltas, fleet metrics
// ---------------------------------------------------------------------------

function el(tag: string, cls: string, text?: string): HTMLElement {
  const element = document.createElement(tag);
  element.className = cls;
  if (text !== undefined) element.textContent = text;
  return element;
}

function card(label: string, value: string, extra?: { delta?: string; direction?: string; ariaLabel?: string }): HTMLElement {
  const wrapper = el('div', 'overview-card');
  wrapper.setAttribute('role', 'group');
  wrapper.setAttribute('aria-label', extra?.ariaLabel ?? label);

  wrapper.appendChild(el('span', 'overview-label', label));
  wrapper.appendChild(el('span', 'overview-value', value));

  if (extra?.delta !== undefined) {
    const deltaEl = el('span', `overview-delta delta-${extra.direction ?? 'same'}`, extra.delta);
    // Non-color cue: prefix arrow
    if (extra.direction === 'faster') deltaEl.dataset.cue = 'faster';
    if (extra.direction === 'slower') deltaEl.dataset.cue = 'slower';
    wrapper.appendChild(deltaEl);
  }

  return wrapper;
}

export function renderOverview(
  container: HTMLElement,
  sortedRuns: DashboardRun[],
  selectedIndex: number,
  _dataset: DashboardDataset,
): void {
  container.innerHTML = '';
  container.setAttribute('role', 'region');
  container.setAttribute('aria-label', 'Run overview');

  if (sortedRuns.length === 0 || selectedIndex < 0) {
    container.appendChild(el('p', 'overview-empty', 'No matching runs.'));
    return;
  }

  const current = sortedRuns[selectedIndex]!;
  const prev = previousRun(sortedRuns, selectedIndex);
  const best = bestRunUpTo(sortedRuns, selectedIndex);
  const trailingAvg = trailingFiveAverage(sortedRuns, selectedIndex);

  // Primary: elapsed time
  container.appendChild(card('Elapsed', formatElapsed(current.metrics.elapsedSeconds)));

  // Delta vs previous
  if (prev !== null) {
    const delta = current.metrics.elapsedSeconds - prev.metrics.elapsedSeconds;
    const formatted = formatDelta(delta);
    container.appendChild(card('vs Previous', formatted.text, {
      delta: formatted.text,
      direction: formatted.direction,
      ariaLabel: `Delta versus previous run: ${formatted.text} (${formatted.direction})`,
    }));
  }

  // Delta vs best
  if (best !== null) {
    const delta = current.metrics.elapsedSeconds - best.metrics.elapsedSeconds;
    const formatted = formatDelta(delta);
    container.appendChild(card('vs Best', formatted.text, {
      delta: formatted.text,
      direction: formatted.direction,
      ariaLabel: `Delta versus best run: ${formatted.text} (${formatted.direction})`,
    }));
  }

  // Delta vs trailing-five average
  if (trailingAvg !== null) {
    const delta = current.metrics.elapsedSeconds - trailingAvg;
    const formatted = formatDelta(delta);
    container.appendChild(card('vs Trail-5 Avg', formatted.text, {
      delta: formatted.text,
      direction: formatted.direction,
      ariaLabel: `Delta versus trailing five average: ${formatted.text} (${formatted.direction})`,
    }));
  }

  // Fleet metrics
  container.appendChild(card('Fleet DPS', formatDps(current.metrics.averageFleetDps)));
  container.appendChild(card('Active DPS', formatDps(current.metrics.activeFleetDps)));
  container.appendChild(card('Idle', formatElapsed(current.metrics.idleSeconds)));
}
