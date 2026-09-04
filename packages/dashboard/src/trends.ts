import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Filler,
  type ChartConfiguration,
} from 'chart.js';
import type { DashboardRun } from './data.js';
import { formatShortDate } from './format.js';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Filler);

export type TrendMetric = 'elapsedSeconds' | 'averageFleetDps' | 'activeFleetDps' | 'activeCombatSeconds' | 'idleSeconds';

const METRIC_LABELS: Record<TrendMetric, string> = {
  elapsedSeconds: 'Elapsed (s)',
  averageFleetDps: 'Fleet DPS',
  activeFleetDps: 'Active DPS',
  activeCombatSeconds: 'Active Combat (s)',
  idleSeconds: 'Idle (s)',
};

// OKLCH-based colors resolved to sRGB for Chart.js
const AMBER_LINE = 'oklch(0.75 0.15 85)';
const AMBER_FILL = 'oklch(0.75 0.15 85 / 0.15)';
const GRID_COLOR = 'oklch(0.35 0.005 250)';
const TEXT_COLOR = 'oklch(0.85 0.01 250)';

let chartInstance: Chart | null = null;

export function renderTrends(
  container: HTMLElement,
  runs: DashboardRun[],
  metric: TrendMetric,
  onMetricChange: (metric: TrendMetric) => void,
  selectedIndex: number | null,
): void {
  container.innerHTML = '';
  container.setAttribute('role', 'region');
  container.setAttribute('aria-label', 'Performance trends');

  // Metric selector
  const selectorDiv = document.createElement('div');
  selectorDiv.className = 'trend-selector';
  const selectorLabel = document.createElement('label');
  selectorLabel.textContent = 'Metric: ';
  selectorLabel.htmlFor = 'trend-metric-select';
  const select = document.createElement('select');
  select.id = 'trend-metric-select';
  select.className = 'trend-select';

  for (const key of Object.keys(METRIC_LABELS) as TrendMetric[]) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = METRIC_LABELS[key];
    if (key === metric) option.selected = true;
    select.appendChild(option);
  }
  select.addEventListener('change', () => {
    onMetricChange(select.value as TrendMetric);
  });
  selectorDiv.appendChild(selectorLabel);
  selectorDiv.appendChild(select);
  container.appendChild(selectorDiv);

  if (runs.length === 0) {
    if (chartInstance !== null) {
      chartInstance.destroy();
      chartInstance = null;
    }
    const msg = document.createElement('p');
    msg.className = 'trend-empty';
    msg.textContent = 'No data to chart.';
    container.appendChild(msg);
    return;
  }

  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `Trend chart showing ${METRIC_LABELS[metric]} over time`);
  container.appendChild(canvas);

  const labels = runs.map((run) => formatShortDate(run.window.start));
  const data = runs.map((run) => run.metrics[metric]);

  const pointBg = runs.map((_, i) =>
    i === selectedIndex ? AMBER_LINE : 'oklch(0.55 0.005 250)',
  );
  const pointRadius = runs.map((_, i) => (i === selectedIndex ? 6 : 3));

  // Destroy previous chart if any
  if (chartInstance !== null) {
    chartInstance.destroy();
    chartInstance = null;
  }

  const config: ChartConfiguration<'line'> = {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: METRIC_LABELS[metric],
          data,
          borderColor: AMBER_LINE,
          backgroundColor: AMBER_FILL,
          fill: true,
          tension: 0.25,
          pointBackgroundColor: pointBg,
          pointRadius,
          pointHoverRadius: 7,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 0,
      },
      scales: {
        x: {
          ticks: { color: TEXT_COLOR, maxRotation: 45 },
          grid: { color: GRID_COLOR },
        },
        y: {
          ticks: { color: TEXT_COLOR },
          grid: { color: GRID_COLOR },
        },
      },
      plugins: {
        tooltip: {
          enabled: true,
        },
      },
    },
  };

  chartInstance = new Chart(canvas, config);
}
