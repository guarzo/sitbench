import { DatasetSchemaError, loadDataset, type DashboardDataset, type DashboardRun } from './data.js';
import { comparisonOrder } from './compare.js';
import { renderCompare } from './compare-view.js';
import { renderDetail } from './detail.js';
import { renderHistory, type SortDir, type SortField } from './history.js';
import { renderOverview } from './overview.js';
import {
  initializeState,
  matchingRuns,
  profileOptions,
  reconcileSelections,
  selectedRun,
  siteOptions,
  type DashboardState,
} from './state.js';
import { renderTrends, type TrendMetric } from './trends.js';
import './style.css';

// ---------------------------------------------------------------------------
// Application state
// ---------------------------------------------------------------------------

let state: DashboardState | null = null;
let currentTrendMetric: TrendMetric = 'elapsedSeconds';
let historySort: { field: SortField; dir: SortDir } = { field: 'date', dir: 'desc' };

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

function qs(selector: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(selector);
  if (el === null) throw new Error(`Missing element: ${selector}`);
  return el;
}

/** Pairs a control with its label so narrow viewports keep them together. */
function filterField(modifier: string, label: HTMLLabelElement, control: HTMLElement): HTMLElement {
  const field = document.createElement('div');
  field.className = `filter-field filter-field-${modifier}`;
  field.appendChild(label);
  field.appendChild(control);
  return field;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderFilters(dataset: DashboardDataset, current: DashboardState): void {
  const filtersEl = qs('#filters');
  filtersEl.innerHTML = '';
  filtersEl.setAttribute('role', 'search');
  filtersEl.setAttribute('aria-label', 'Run filters');

  // Site filter
  const siteLabel = document.createElement('label');
  siteLabel.textContent = 'Site: ';
  siteLabel.htmlFor = 'filter-site';
  const siteSelect = document.createElement('select');
  siteSelect.id = 'filter-site';
  siteSelect.className = 'filter-select';

  const allSiteOpt = document.createElement('option');
  allSiteOpt.value = '';
  allSiteOpt.textContent = 'All Sites';
  if (current.filter.siteKey === null) allSiteOpt.selected = true;
  siteSelect.appendChild(allSiteOpt);

  for (const site of siteOptions(dataset)) {
    const opt = document.createElement('option');
    opt.value = site.key;
    opt.textContent = site.name;
    if (site.key === current.filter.siteKey) opt.selected = true;
    siteSelect.appendChild(opt);
  }

  // Profile filter
  const profileLabel = document.createElement('label');
  profileLabel.textContent = 'Profile: ';
  profileLabel.htmlFor = 'filter-profile';
  const profileSelect = document.createElement('select');
  profileSelect.id = 'filter-profile';
  profileSelect.className = 'filter-select';

  const allProfileOpt = document.createElement('option');
  allProfileOpt.value = '';
  allProfileOpt.textContent = 'All Profiles';
  if (current.filter.fleetProfileId === null) allProfileOpt.selected = true;
  profileSelect.appendChild(allProfileOpt);

  for (const profile of profileOptions(dataset)) {
    const opt = document.createElement('option');
    opt.value = profile.id;
    opt.textContent = profile.name;
    if (profile.id === current.filter.fleetProfileId) opt.selected = true;
    profileSelect.appendChild(opt);
  }

  // Date range filters
  const dateFromLabel = document.createElement('label');
  dateFromLabel.textContent = 'From: ';
  dateFromLabel.htmlFor = 'filter-date-from';
  const dateFromInput = document.createElement('input');
  dateFromInput.type = 'date';
  dateFromInput.id = 'filter-date-from';
  dateFromInput.className = 'filter-date';
  if (current.filter.dateFrom !== null) dateFromInput.value = current.filter.dateFrom;

  const dateToLabel = document.createElement('label');
  dateToLabel.textContent = 'To: ';
  dateToLabel.htmlFor = 'filter-date-to';
  const dateToInput = document.createElement('input');
  dateToInput.type = 'date';
  dateToInput.id = 'filter-date-to';
  dateToInput.className = 'filter-date';
  if (current.filter.dateTo !== null) dateToInput.value = current.filter.dateTo;

  siteSelect.addEventListener('change', () => {
    if (state === null) return;
    state.filter.siteKey = siteSelect.value || null;
    reconcileSelections(state);
    update();
  });
  profileSelect.addEventListener('change', () => {
    if (state === null) return;
    state.filter.fleetProfileId = profileSelect.value || null;
    reconcileSelections(state);
    update();
  });
  dateFromInput.addEventListener('change', () => {
    if (state === null) return;
    state.filter.dateFrom = dateFromInput.value || null;
    reconcileSelections(state);
    update();
  });
  dateToInput.addEventListener('change', () => {
    if (state === null) return;
    state.filter.dateTo = dateToInput.value || null;
    reconcileSelections(state);
    update();
  });

  filtersEl.appendChild(filterField('site', siteLabel, siteSelect));
  filtersEl.appendChild(filterField('profile', profileLabel, profileSelect));
  filtersEl.appendChild(filterField('from', dateFromLabel, dateFromInput));
  filtersEl.appendChild(filterField('to', dateToLabel, dateToInput));
}

function update(): void {
  if (state === null) return;

  const matched = matchingRuns(state);

  // Reconcile selections with matched set
  reconcileSelections(state);

  // Comparison-ordered runs: (createdAt, id) for local, (comparisonOrder, id) for public
  const comparisonSorted = matched.slice().sort(comparisonOrder);

  const currentSel = selectedRun(state);
  const selCompIdx = currentSel !== null ? comparisonSorted.findIndex((r) => r.id === currentSel.id) : -1;
  // Trend chart uses dataset natural order (window.start)
  const selTrendIdx = currentSel !== null ? matched.findIndex((r) => r.id === currentSel.id) : -1;

  renderFilters(state.dataset, state);
  renderOverview(qs('#overview'), comparisonSorted, selCompIdx, state.dataset);
  renderTrends(qs('#trends'), matched, currentTrendMetric, (metric) => {
    currentTrendMetric = metric;
    update();
  }, selTrendIdx >= 0 ? selTrendIdx : null);
  renderHistory(qs('#history'), matched, state.selectedRunId, (runId) => {
    if (state === null) return;
    state.selectedRunId = runId;
    update();
  }, historySort, (field) => {
    if (historySort.field === field) {
      historySort.dir = historySort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      historySort = { field, dir: field === 'date' ? 'desc' : 'asc' };
    }
    update();
  });
  renderDetail(qs('#detail'), currentSel, state.dataset.capabilities);

  // Compare: default right to previous if not set and in matched set
  if (state.compareRunId === null && selCompIdx > 0) {
    state.compareRunId = comparisonSorted[selCompIdx - 1]!.id;
  }
  renderCompare(
    qs('#compare'),
    matched,
    state.selectedRunId,
    state.compareRunId,
    state.dataset.capabilities,
    (runId) => {
      if (state === null) return;
      state.selectedRunId = runId;
      update();
    },
    (runId) => {
      if (state === null) return;
      state.compareRunId = runId;
      update();
    },
  );
}

// ---------------------------------------------------------------------------
// Error states
// ---------------------------------------------------------------------------

function renderEmpty(): void {
  const app = qs('#app');
  app.innerHTML = '';
  const msg = document.createElement('div');
  msg.className = 'empty-state';
  msg.setAttribute('role', 'status');
  msg.innerHTML = `
    <h2>No Dashboard Data</h2>
    <p>Run <code>sitbench analyze</code> to generate your first run, then reload this page.</p>
  `;
  app.appendChild(msg);
}

function renderError(error: unknown): void {
  const app = qs('#app');
  app.innerHTML = '';
  const msg = document.createElement('div');
  msg.className = 'error-state';
  msg.setAttribute('role', 'alert');
  const heading = document.createElement('h2');
  heading.textContent = 'Dashboard Error';
  msg.appendChild(heading);
  const detail = document.createElement('p');
  if (error instanceof DatasetSchemaError) {
    detail.textContent = `Schema error: ${error.message}. The data file may be corrupted or from an incompatible version.`;
  } else {
    detail.textContent = `Failed to load dashboard data. Run sitbench analyze to generate data.`;
  }
  msg.appendChild(detail);
  app.appendChild(msg);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init(): Promise<void> {
  try {
    const dataset = await loadDataset();
    if (dataset.runs.length === 0) {
      renderEmpty();
      return;
    }
    state = initializeState(dataset);
    update();
  } catch (error) {
    if (error instanceof DatasetSchemaError) {
      renderError(error);
    } else {
      // Network error or 404 — show empty state directing user to analyze
      renderEmpty();
    }
  }
}

// Respect reduced motion
if (typeof window !== 'undefined') {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (mq.matches) {
    document.documentElement.classList.add('reduced-motion');
  }
}

void init();
