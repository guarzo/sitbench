import type { DashboardRun } from './data.js';
import { matchingGroupChronology, sameGroup } from './compare.js';
import { formatDps, formatElapsed, formatShortDate } from './format.js';

// ---------------------------------------------------------------------------
// Sortable run history table
// ---------------------------------------------------------------------------

export type SortField = 'date' | 'elapsed' | 'fleetDps' | 'activeDps' | 'idle' | 'participants';
export type SortDir = 'asc' | 'desc';

interface HistorySort {
  field: SortField;
  dir: SortDir;
}

const COLUMNS: Array<{ field: SortField; label: string; ariaLabel: string }> = [
  { field: 'date', label: 'Date', ariaLabel: 'Sort by date' },
  { field: 'elapsed', label: 'Elapsed', ariaLabel: 'Sort by elapsed time' },
  { field: 'fleetDps', label: 'Fleet DPS', ariaLabel: 'Sort by fleet DPS' },
  { field: 'activeDps', label: 'Active DPS', ariaLabel: 'Sort by active DPS' },
  { field: 'idle', label: 'Idle', ariaLabel: 'Sort by idle time' },
  { field: 'participants', label: 'Pilots', ariaLabel: 'Sort by participant count' },
];

/**
 * Deterministic, transitive tie-break for equal `window.start` dates. Two
 * runs from the exact same `(site.key, fleetProfile.id)` group use their real
 * matching-group chronology (`comparisonOrder`/`createdAt` + id). Runs from
 * different groups have no comparable per-group ordinal (`comparisonOrder`
 * restarts at 0 in every group, and public runs omit `createdAt`), so they're
 * ordered by group key instead -- deterministic, and independent of any
 * chronology field, so it can never cycle with the same-group comparisons
 * above.
 */
function equalDateTiebreak(a: DashboardRun, b: DashboardRun): number {
  if (sameGroup(a, b)) return matchingGroupChronology(a, b);
  const siteCmp = a.site.key.localeCompare(b.site.key);
  if (siteCmp !== 0) return siteCmp;
  return a.fleetProfile.id.localeCompare(b.fleetProfile.id);
}

function sortRuns(runs: DashboardRun[], sort: HistorySort): DashboardRun[] {
  const sorted = runs.slice();
  const dir = sort.dir === 'asc' ? 1 : -1;
  sorted.sort((a, b) => {
    let cmp = 0;
    switch (sort.field) {
      case 'date':
        cmp = a.window.start.localeCompare(b.window.start);
        if (cmp === 0) {
          // Payload order is never a stable chronology: break equal-date
          // ties using the same comparison chronology the rest of the
          // dashboard uses within a group -- (createdAt, id) for local
          // runs, (comparisonOrder, id) for public runs -- and fall back
          // to group key across different groups.
          cmp = equalDateTiebreak(a, b);
        }
        break;
      case 'elapsed':
        cmp = a.metrics.elapsedSeconds - b.metrics.elapsedSeconds;
        break;
      case 'fleetDps':
        cmp = a.metrics.averageFleetDps - b.metrics.averageFleetDps;
        break;
      case 'activeDps':
        cmp = a.metrics.activeFleetDps - b.metrics.activeFleetDps;
        break;
      case 'idle':
        cmp = a.metrics.idleSeconds - b.metrics.idleSeconds;
        break;
      case 'participants':
        cmp = a.metrics.participantCount - b.metrics.participantCount;
        break;
    }
    return cmp * dir;
  });
  return sorted;
}

export function renderHistory(
  container: HTMLElement,
  runs: DashboardRun[],
  selectedRunId: string | null,
  onSelect: (runId: string) => void,
  sort: HistorySort,
  onSort: (field: SortField) => void,
): void {
  container.innerHTML = '';
  container.setAttribute('role', 'region');
  container.setAttribute('aria-label', 'Run history');

  if (runs.length === 0) {
    const msg = document.createElement('p');
    msg.className = 'history-empty';
    msg.textContent = 'No matching runs.';
    container.appendChild(msg);
    return;
  }

  const scrollWrapper = document.createElement('div');
  scrollWrapper.className = 'history-scroll';
  scrollWrapper.setAttribute('tabindex', '0');
  scrollWrapper.setAttribute('role', 'group');
  scrollWrapper.setAttribute('aria-label', 'Scrollable run history table');

  const table = document.createElement('table');
  table.className = 'history-table';

  // Header
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  for (const col of COLUMNS) {
    const th = document.createElement('th');
    th.setAttribute('scope', 'col');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sort-btn';
    btn.setAttribute('aria-label', col.ariaLabel);
    const arrow = sort.field === col.field ? (sort.dir === 'asc' ? ' \u25B2' : ' \u25BC') : '';
    btn.textContent = `${col.label}${arrow}`;
    btn.addEventListener('click', () => onSort(col.field));
    th.appendChild(btn);
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Body
  const tbody = document.createElement('tbody');
  const sorted = sortRuns(runs, sort);
  for (const run of sorted) {
    const tr = document.createElement('tr');
    tr.className = run.id === selectedRunId ? 'history-row selected' : 'history-row';
    tr.setAttribute('tabindex', '0');
    tr.setAttribute('role', 'row');
    tr.setAttribute('aria-selected', run.id === selectedRunId ? 'true' : 'false');
    tr.dataset.runId = run.id;

    const selectHandler = (): void => onSelect(run.id);
    tr.addEventListener('click', selectHandler);
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectHandler();
      }
    });

    const cells = [
      formatShortDate(run.window.start),
      formatElapsed(run.metrics.elapsedSeconds),
      formatDps(run.metrics.averageFleetDps),
      formatDps(run.metrics.activeFleetDps),
      formatElapsed(run.metrics.idleSeconds),
      String(run.metrics.participantCount),
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
  container.appendChild(scrollWrapper);
}
