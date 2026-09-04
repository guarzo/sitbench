import { DatasetSchemaError, loadDataset, type DashboardDataset, type DashboardRun } from './data.js';
import { renderCompare } from './compare-view.js';
import { renderDetail } from './detail.js';
import { renderHistory, type SortDir, type SortField } from './history.js';
import { renderOverview } from './overview.js';
import { initializeState, matchingRuns, profileOptions, selectedRun, siteOptions, type DashboardState } from './state.js';
import { renderTrends, type TrendMetric } from './trends.js';
import './style.css';

// ---------------------------------------------------------------------------
// Application state
// ---------------------------------------------------------------------------

let state: DashboardState | null = null;
let currentTrendMetric: TrendMetric = 'elapsedSeconds';
let historySort: { field: SortField; dir: SortDir } = { field: 'date', dir: 'desc' };
let compareRightId: string | null = null;

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

function qs(selector: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(selector);
  if (el === null) throw new Error(`Missing element: ${selector}`);
  return el;
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

  siteSelect.addEventListener('change', () => {
    if (state === null) return;
    state.filter.siteKey = siteSelect.value || null;
    update();
  });
  profileSelect.addEventListener('change', () => {
    if (state === null) return;
    state.filter.fleetProfileId = profileSelect.value || null;
    update();
  });

  filtersEl.appendChild(siteLabel);
  filtersEl.appendChild(siteSelect);
  filtersEl.appendChild(profileLabel);
  filtersEl.appendChild(profileSelect);
}

function update(): void {
  if (state === null) return;

  const matched = matchingRuns(state);

  // Auto-select the most recent matching run if selected is no longer in filtered set
  const sel = selectedRun(state);
  if (sel === null && matched.length > 0) {
    state.selectedRunId = matched[matched.length - 1]!.id;
  }

  const currentSel = selectedRun(state);
  const selIndex = currentSel !== null ? matched.findIndex((r) => r.id === currentSel.id) : -1;

  renderFilters(state.dataset, state);
  renderOverview(qs('#overview'), matched, selIndex, state.dataset);
  renderTrends(qs('#trends'), matched, currentTrendMetric, (metric) => {
    currentTrendMetric = metric;
    update();
  }, selIndex >= 0 ? selIndex : null);
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

  // Compare: default right to previous if not set
  if (compareRightId === null && selIndex > 0) {
    compareRightId = matched[selIndex - 1]!.id;
  }
  renderCompare(
    qs('#compare'),
    matched,
    state.selectedRunId,
    compareRightId,
    state.dataset.capabilities,
    (runId) => {
      if (state === null) return;
      state.selectedRunId = runId;
      update();
    },
    (runId) => {
      compareRightId = runId;
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
