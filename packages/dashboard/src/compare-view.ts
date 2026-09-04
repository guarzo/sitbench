import type { DashboardCapabilities, DashboardRun } from './data.js';
import { alignCharacterRows } from './compare.js';
import { createDeltaElement, metricDelta, type DeltaKind, type MetricDelta } from './delta.js';
import { formatDamage, formatDps, formatElapsed, formatPercent, formatShortDate } from './format.js';

// ---------------------------------------------------------------------------
// Two-run comparison panel
// ---------------------------------------------------------------------------

function el(tag: string, cls: string, text?: string): HTMLElement {
  const element = document.createElement(tag);
  element.className = cls;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function renderCompare(
  container: HTMLElement,
  runs: DashboardRun[],
  leftRunId: string | null,
  rightRunId: string | null,
  capabilities: DashboardCapabilities,
  onLeftChange: (runId: string) => void,
  onRightChange: (runId: string) => void,
): void {
  container.innerHTML = '';
  container.setAttribute('role', 'region');
  container.setAttribute('aria-label', 'Run comparison');

  // Selectors row
  const selectorsDiv = el('div', 'compare-selectors');

  const leftField = el('div', 'compare-field compare-field-left');
  const leftLabel = document.createElement('label');
  leftLabel.textContent = 'Run A: ';
  leftLabel.htmlFor = 'compare-left-select';
  const leftSelect = document.createElement('select');
  leftSelect.id = 'compare-left-select';
  leftSelect.className = 'compare-select';

  const rightField = el('div', 'compare-field compare-field-right');
  const rightLabel = document.createElement('label');
  rightLabel.textContent = 'Run B: ';
  rightLabel.htmlFor = 'compare-right-select';
  const rightSelect = document.createElement('select');
  rightSelect.id = 'compare-right-select';
  rightSelect.className = 'compare-select';

  // Populate selects: most recent first for usability
  const reversed = runs.slice().reverse();
  for (const run of reversed) {
    const dateLabel = `${formatShortDate(run.window.start)} \u00B7 ${formatElapsed(run.metrics.elapsedSeconds)}`;

    const lo = document.createElement('option');
    lo.value = run.id;
    lo.textContent = dateLabel;
    if (run.id === leftRunId) lo.selected = true;
    leftSelect.appendChild(lo);

    const ro = document.createElement('option');
    ro.value = run.id;
    ro.textContent = dateLabel;
    if (run.id === rightRunId) ro.selected = true;
    rightSelect.appendChild(ro);
  }

  leftSelect.addEventListener('change', () => onLeftChange(leftSelect.value));
  rightSelect.addEventListener('change', () => onRightChange(rightSelect.value));

  selectorsDiv.appendChild(leftField);
  leftField.appendChild(leftLabel);
  leftField.appendChild(leftSelect);
  selectorsDiv.appendChild(rightField);
  rightField.appendChild(rightLabel);
  rightField.appendChild(rightSelect);
  container.appendChild(selectorsDiv);

  // Comparison details
  const leftRun = runs.find((r) => r.id === leftRunId) ?? null;
  const rightRun = runs.find((r) => r.id === rightRunId) ?? null;

  if (leftRun === null || rightRun === null) {
    container.appendChild(el('p', 'compare-empty', 'Select two runs to compare.'));
    return;
  }

  // Metric comparison table
  const metricsScroll = el('div', 'compare-scroll');
  metricsScroll.setAttribute('tabindex', '0');
  metricsScroll.setAttribute('role', 'group');
  metricsScroll.setAttribute('aria-label', 'Scrollable metric comparison table');

  const metricsTable = document.createElement('table');
  metricsTable.className = 'compare-table';
  const mHead = document.createElement('thead');
  const mHRow = document.createElement('tr');
  for (const heading of ['Metric', 'Run A', 'Run B', 'Delta']) {
    const th = document.createElement('th');
    th.setAttribute('scope', 'col');
    th.textContent = heading;
    mHRow.appendChild(th);
  }
  mHead.appendChild(mHRow);
  metricsTable.appendChild(mHead);

  const mBody = document.createElement('tbody');
  const rows: CompareRow[] = [
    metricRow('elapsed', 'Elapsed', leftRun.metrics.elapsedSeconds, rightRun.metrics.elapsedSeconds, formatElapsed, 'duration', true),
    metricRow('active-combat', 'Active Combat', leftRun.metrics.activeCombatSeconds, rightRun.metrics.activeCombatSeconds, formatElapsed, 'duration', true),
    metricRow('idle', 'Idle', leftRun.metrics.idleSeconds, rightRun.metrics.idleSeconds, formatElapsed, 'duration', true),
    metricRow('fleet-dps', 'Fleet DPS', leftRun.metrics.averageFleetDps, rightRun.metrics.averageFleetDps, formatDps, 'count', false),
    metricRow('active-dps', 'Active DPS', leftRun.metrics.activeFleetDps, rightRun.metrics.activeFleetDps, formatDps, 'count', false),
    metricRow('fleet-damage', 'Fleet Damage', leftRun.metrics.fleetDamageDealt, rightRun.metrics.fleetDamageDealt, formatDamage, 'count', false),
    metricRow('damage-taken', 'Damage Taken', leftRun.metrics.damageTaken, rightRun.metrics.damageTaken, formatDamage, 'count', true),
  ];

  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.dataset.metric = row.key;
    for (const text of [row.label, row.a, row.b]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }
    const deltaTd = document.createElement('td');
    deltaTd.className = 'compare-delta';
    deltaTd.appendChild(createDeltaElement(row.delta));
    tr.appendChild(deltaTd);
    mBody.appendChild(tr);
  }
  metricsTable.appendChild(mBody);
  metricsScroll.appendChild(metricsTable);
  container.appendChild(metricsScroll);

  // Character comparison — only when capabilities.characters is true
  if (capabilities.characters) {
    const leftChars = 'characterMetrics' in leftRun ? leftRun.characterMetrics : undefined;
    const rightChars = 'characterMetrics' in rightRun ? rightRun.characterMetrics : undefined;
    if (leftChars !== undefined || rightChars !== undefined) {
      const charSection = el('div', 'compare-characters');
      charSection.appendChild(el('h4', 'compare-char-heading', 'Character Comparison'));

      const charScroll = el('div', 'compare-char-scroll');
      charScroll.setAttribute('tabindex', '0');
      charScroll.setAttribute('role', 'group');
      charScroll.setAttribute('aria-label', 'Scrollable character comparison table');

      const charTable = document.createElement('table');
      charTable.className = 'compare-char-table';
      const cHead = document.createElement('thead');
      const cHRow = document.createElement('tr');
      for (const heading of ['Character', 'A Damage', 'B Damage', 'A Share', 'B Share', 'A DPS', 'B DPS']) {
        const th = document.createElement('th');
        th.setAttribute('scope', 'col');
        th.textContent = heading;
        cHRow.appendChild(th);
      }
      cHead.appendChild(cHRow);
      charTable.appendChild(cHead);

      const cBody = document.createElement('tbody');
      const aligned = alignCharacterRows(leftChars, rightChars);
      for (const row of aligned) {
        const tr = document.createElement('tr');
        const cells = [
          row.character,
          row.left !== null ? formatDamage(row.left.damageDealt) : '—',
          row.right !== null ? formatDamage(row.right.damageDealt) : '—',
          row.left !== null ? formatPercent(row.left.fleetDamageShare) : '—',
          row.right !== null ? formatPercent(row.right.fleetDamageShare) : '—',
          row.left !== null ? formatDps(row.left.averageDps) : '—',
          row.right !== null ? formatDps(row.right.averageDps) : '—',
        ];
        for (const text of cells) {
          const td = document.createElement('td');
          td.textContent = text;
          tr.appendChild(td);
        }
        cBody.appendChild(tr);
      }
      charTable.appendChild(cBody);
      charScroll.appendChild(charTable);
      charSection.appendChild(charScroll);
      container.appendChild(charSection);
    }
  }
}

interface CompareRow {
  key: string;
  label: string;
  a: string;
  b: string;
  delta: MetricDelta;
}

/**
 * Builds one comparison row. The delta is always Run A minus Run B; its
 * direction reflects metric desirability rather than the numeric sign.
 */
function metricRow(
  key: string,
  label: string,
  a: number,
  b: number,
  formatter: (n: number) => string,
  kind: DeltaKind,
  lowerIsBetter: boolean,
): CompareRow {
  return {
    key,
    label,
    a: formatter(a),
    b: formatter(b),
    delta: metricDelta(a - b, { kind, lowerIsBetter }),
  };
}
