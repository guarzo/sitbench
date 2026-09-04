import type { DashboardDataset, DashboardRun } from './data.js';
import { bestRunUpTo, previousRun, trailingFiveAverage } from './compare.js';
import { createDeltaElement, metricDelta } from './delta.js';
import { formatDps, formatElapsed } from './format.js';

// ---------------------------------------------------------------------------
// Overview band: elapsed leads, elapsed comparisons follow, fleet metrics rest
// ---------------------------------------------------------------------------

function el(tag: string, cls: string, text?: string): HTMLElement {
  const element = document.createElement(tag);
  element.className = cls;
  if (text !== undefined) element.textContent = text;
  return element;
}

function group(cls: string, ariaLabel: string): HTMLElement {
  const list = document.createElement('dl');
  list.className = cls;
  list.setAttribute('aria-label', ariaLabel);
  return list;
}

function item(cls: string, label: string, value: HTMLElement): HTMLElement {
  const wrapper = el('div', `${cls}-item`);
  const term = document.createElement('dt');
  term.className = `${cls}-label`;
  term.textContent = label;
  const description = document.createElement('dd');
  description.className = `${cls}-value`;
  description.appendChild(value);
  wrapper.appendChild(term);
  wrapper.appendChild(description);
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
  const elapsed = current.metrics.elapsedSeconds;
  const band = el('div', 'overview-band');

  // Primary: the selected run's elapsed time.
  const primary = el('div', 'overview-primary');
  primary.appendChild(el('span', 'overview-primary-label', 'Elapsed'));
  primary.appendChild(el('span', 'overview-primary-value', formatElapsed(elapsed)));
  band.appendChild(primary);

  // Secondary: elapsed comparisons, each delta rendered exactly once.
  const prev = previousRun(sortedRuns, selectedIndex);
  const best = bestRunUpTo(sortedRuns, selectedIndex);
  const comparisons: Array<{ key: string; label: string; baseline: number | null }> = [
    { key: 'previous', label: 'vs Previous', baseline: prev?.metrics.elapsedSeconds ?? null },
    { key: 'best', label: 'vs Best', baseline: best?.metrics.elapsedSeconds ?? null },
    { key: 'trailing-five', label: 'vs Trailing 5', baseline: trailingFiveAverage(sortedRuns, selectedIndex) },
  ];

  const deltas = group('overview-deltas', 'Elapsed time comparisons');
  for (const comparison of comparisons) {
    if (comparison.baseline === null) continue;
    const delta = metricDelta(elapsed - comparison.baseline, { kind: 'duration', lowerIsBetter: true });
    const entry = item('overview-delta', comparison.label, createDeltaElement(delta, { showDescription: true }));
    entry.dataset.comparison = comparison.key;
    deltas.appendChild(entry);
  }
  if (deltas.childElementCount > 0) band.appendChild(deltas);

  // Tertiary: supporting fleet metrics, quieter than the timing above.
  const fleet = group('overview-fleet', 'Fleet metrics');
  const fleetMetrics: Array<{ key: string; label: string; value: string }> = [
    { key: 'fleet-dps', label: 'Fleet DPS', value: formatDps(current.metrics.averageFleetDps) },
    { key: 'active-dps', label: 'Active DPS', value: formatDps(current.metrics.activeFleetDps) },
    { key: 'idle', label: 'Idle', value: formatElapsed(current.metrics.idleSeconds) },
  ];
  for (const metric of fleetMetrics) {
    const value = el('span', 'overview-fleet-number', metric.value);
    const entry = item('overview-fleet', metric.label, value);
    entry.dataset.metric = metric.key;
    fleet.appendChild(entry);
  }
  band.appendChild(fleet);

  container.appendChild(band);
}
