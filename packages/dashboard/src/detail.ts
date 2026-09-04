import type { DashboardCapabilities, DashboardRun } from './data.js';
import { formatDamage, formatDps, formatElapsed, formatPercent, formatRepairPairing, formatShortDate } from './format.js';

// ---------------------------------------------------------------------------
// Selected-run detail panel
// ---------------------------------------------------------------------------

function el(tag: string, cls: string, text?: string): HTMLElement {
  const element = document.createElement(tag);
  element.className = cls;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function renderDetail(
  container: HTMLElement,
  run: DashboardRun | null,
  capabilities: DashboardCapabilities,
): void {
  container.innerHTML = '';
  container.setAttribute('role', 'region');
  container.setAttribute('aria-label', 'Selected run detail');

  if (run === null) {
    container.appendChild(el('p', 'detail-empty', 'Select a run to view details.'));
    return;
  }

  // Header
  const header = el('div', 'detail-header');
  header.appendChild(el('h3', 'detail-title', `${run.site.name} — ${run.fleetProfile.name}`));
  header.appendChild(el('span', 'detail-date', formatShortDate(run.window.start)));
  header.appendChild(el('span', 'detail-elapsed', formatElapsed(run.metrics.elapsedSeconds)));
  container.appendChild(header);

  // Metrics summary
  const metricsDiv = el('div', 'detail-metrics');
  const metricPairs: Array<[string, string]> = [
    ['Elapsed', formatElapsed(run.metrics.elapsedSeconds)],
    ['Active Combat', formatElapsed(run.metrics.activeCombatSeconds)],
    ['Idle', formatElapsed(run.metrics.idleSeconds)],
    ['Fleet Damage', formatDamage(run.metrics.fleetDamageDealt)],
    ['Fleet DPS', formatDps(run.metrics.averageFleetDps)],
    ['Active DPS', formatDps(run.metrics.activeFleetDps)],
    ['Damage Taken', formatDamage(run.metrics.damageTaken)],
    ['Repair Delivered', formatDamage(run.metrics.remoteRepairDelivered)],
    ['Participants', String(run.metrics.participantCount)],
  ];
  for (const [label, value] of metricPairs) {
    const row = el('div', 'detail-metric-row');
    row.appendChild(el('span', 'detail-metric-label', label));
    row.appendChild(el('span', 'detail-metric-value', value));
    metricsDiv.appendChild(row);
  }
  container.appendChild(metricsDiv);

  // Coverage warnings
  const coverageDiv = el('div', 'detail-coverage');
  coverageDiv.appendChild(el('h4', 'detail-coverage-heading', 'Coverage'));
  const coverageItems: Array<[string, string]> = [
    ['Log Files', String(run.coverage.logFiles)],
    ['Outgoing Damage Observed', String(run.coverage.participantsWithOutgoingDamage)],
    ['Unparsed Lines', String(run.coverage.unparsedCombatLines)],
    ['Ambiguous Excluded', String(run.coverage.ambiguousEventsExcluded)],
    ['Repair Pairing', formatRepairPairing(run.coverage.repairPairing)],
  ];
  for (const [label, value] of coverageItems) {
    const row = el('div', 'detail-coverage-row');
    row.appendChild(el('span', 'detail-coverage-label', label));
    row.appendChild(el('span', 'detail-coverage-value', value));
    coverageDiv.appendChild(row);
  }

  // Coverage warnings
  if (run.coverage.unparsedCombatLines > 0) {
    const warn = el('p', 'detail-warning', `${String(run.coverage.unparsedCombatLines)} combat line(s) could not be parsed.`);
    warn.setAttribute('role', 'alert');
    coverageDiv.appendChild(warn);
  }
  if (run.coverage.ambiguousEventsExcluded > 0) {
    const warn = el('p', 'detail-warning', `${String(run.coverage.ambiguousEventsExcluded)} ambiguous event(s) excluded from qualifying analysis.`);
    warn.setAttribute('role', 'alert');
    coverageDiv.appendChild(warn);
  }
  container.appendChild(coverageDiv);

  // Character table — only when capability is true
  if (capabilities.characters && 'characterMetrics' in run && Array.isArray(run.characterMetrics) && run.characterMetrics.length > 0) {
    const charSection = el('div', 'detail-characters');
    charSection.appendChild(el('h4', 'detail-characters-heading', 'Characters'));

    const scrollWrapper = el('div', 'detail-char-scroll');
    scrollWrapper.setAttribute('tabindex', '0');
    scrollWrapper.setAttribute('role', 'group');
    scrollWrapper.setAttribute('aria-label', 'Scrollable character metrics table');

    const table = document.createElement('table');
    table.className = 'detail-char-table';
    const thead = document.createElement('thead');
    const hRow = document.createElement('tr');
    for (const heading of ['Character', 'Damage', 'Share', 'Avg DPS', 'Act DPS', 'Taken', 'Miss%', 'Hits', 'Misses']) {
      const th = document.createElement('th');
      th.setAttribute('scope', 'col');
      th.textContent = heading;
      hRow.appendChild(th);
    }
    thead.appendChild(hRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const cm of run.characterMetrics) {
      const tr = document.createElement('tr');
      const cells = [
        cm.character,
        formatDamage(cm.damageDealt),
        formatPercent(cm.fleetDamageShare),
        formatDps(cm.averageDps),
        formatDps(cm.activeDps),
        formatDamage(cm.damageTaken),
        formatPercent(cm.missRate),
        String(cm.shotsHit),
        String(cm.shotsMissed),
      ];
      for (const text of cells) {
        const td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    scrollWrapper.appendChild(table);
    charSection.appendChild(scrollWrapper);
    container.appendChild(charSection);
  }

  // Notes — only when capability is true
  if (capabilities.notes && 'notes' in run && run.notes !== null && run.notes !== undefined) {
    const notesDiv = el('div', 'detail-notes');
    notesDiv.appendChild(el('h4', 'detail-notes-heading', 'Notes'));
    notesDiv.appendChild(el('p', 'detail-notes-text', run.notes as string));
    container.appendChild(notesDiv);
  }
}
