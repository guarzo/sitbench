import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Archive, type RunSummary } from '@sitbench/core';
import { runDashboard, startDashboardServer } from '../src/dashboard-command.js';

let root: string;
let archiveDir: string;
let fakeDistDir: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'sitbench-dashboard-cmd-'));
  archiveDir = path.join(root, 'archive');
  fakeDistDir = path.join(root, 'dist');
  await mkdir(archiveDir, { recursive: true });
  await mkdir(path.join(fakeDistDir, 'assets'), { recursive: true });
  await writeFile(path.join(fakeDistDir, 'index.html'), '<html><body>sitbench dashboard</body></html>', 'utf8');
  await writeFile(path.join(fakeDistDir, 'assets', 'app.js'), 'console.log("app");', 'utf8');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function buildSummary(id: string, windowStart: string, overrides: Partial<RunSummary> = {}): RunSummary {
  const windowEnd = new Date(Date.parse(windowStart) + 600_000).toISOString();
  return {
    schemaVersion: 1,
    parserVersion: '0.1.0',
    metricsVersion: '0.1.0',
    id,
    site: { name: 'Core Bastion', key: 'core-bastion' },
    fleetProfile: { id: '8-kikis', name: '8 Kikis' },
    window: { start: windowStart, end: windowEnd, source: 'outgoing-npc-damage', manuallyAdjusted: false },
    participants: ['Alpha'],
    calculation: { episodeThresholdSeconds: 180, activeCombatGapSeconds: 30 },
    metrics: {
      elapsedSeconds: 600,
      activeCombatSeconds: 540,
      idleSeconds: 60,
      fleetDamageDealt: 120000,
      averageFleetDps: 200,
      activeFleetDps: 222,
      damageTaken: 30000,
      remoteRepairDelivered: 5000,
      participantCount: 1,
    },
    characterMetrics: [
      {
        character: 'Alpha',
        damageDealt: 120000,
        fleetDamageShare: 1,
        averageDps: 200,
        activeDps: 222,
        damageTaken: 30000,
        remoteRepairDelivered: 5000,
        remoteRepairReceived: 0,
        shotsHit: 150,
        shotsMissed: 10,
        missRate: 0.0625,
        hitQualityCounts: {},
        firstRelevantEvent: windowStart,
        lastRelevantEvent: windowEnd,
      },
    ],
    coverage: { logFiles: 1, participantsWithOutgoingDamage: 1, unparsedCombatLines: 0, ambiguousEventsExcluded: 0, repairPairing: 'full' },
    notes: null,
    fingerprint: `fp-${id}`,
    createdAt: windowStart,
    updatedAt: windowStart,
    ...overrides,
  };
}

describe('startDashboardServer', () => {
  it('binds only to 127.0.0.1 on an ephemeral port', async () => {
    const server = await startDashboardServer(fakeDistDir, 0);
    try {
      expect(server.address).toBe('127.0.0.1');
      expect(server.port).toBeGreaterThan(0);
      expect(server.url).toBe(`http://127.0.0.1:${String(server.port)}/`);
    } finally {
      await server.close();
    }
  });
});

describe('runDashboard', () => {
  it('serves the dashboard from 127.0.0.1 and exposes the generated local dataset at /data/runs.json', async () => {
    const archive = new Archive(archiveDir);
    await archive.saveRun(buildSummary('run-a', '2026-09-01T10:00:00.000Z'), []);

    const result = await runDashboard(
      { archive: archiveDir, port: 0 },
      { distDir: fakeDistDir, write: () => undefined },
    );

    expect(result.status).toBe('serving');
    if (result.status !== 'serving') return;
    try {
      expect(result.address).toBe('127.0.0.1');
      expect(result.url.startsWith('http://127.0.0.1:')).toBe(true);

      const indexResponse = await fetch(result.url);
      expect(indexResponse.status).toBe(200);
      expect(await indexResponse.text()).toContain('sitbench dashboard');

      const dataResponse = await fetch(new URL('data/runs.json', result.url));
      expect(dataResponse.status).toBe(200);
      const data = (await dataResponse.json()) as { mode: string; runs: Array<{ id: string }> };
      expect(data.mode).toBe('local');
      expect(data.runs).toHaveLength(1);
      expect(data.runs[0]?.id).toBe('run-a');
    } finally {
      await result.close();
    }
  });

  it('copies the packaged dashboard assets into <archive>/dashboard', async () => {
    const archive = new Archive(archiveDir);
    await archive.saveRun(buildSummary('run-a', '2026-09-01T10:00:00.000Z'), []);

    const result = await runDashboard(
      { archive: archiveDir, port: 0 },
      { distDir: fakeDistDir, write: () => undefined },
    );
    expect(result.status).toBe('serving');
    if (result.status !== 'serving') return;
    try {
      const html = await readFile(path.join(archiveDir, 'dashboard', 'index.html'), 'utf8');
      expect(html).toContain('sitbench dashboard');
      const js = await readFile(path.join(archiveDir, 'dashboard', 'assets', 'app.js'), 'utf8');
      expect(js).toContain('console.log');
    } finally {
      await result.close();
    }
  });

  it('regenerates local data when the archive has more runs than the existing dataset', async () => {
    const archive = new Archive(archiveDir);
    await archive.saveRun(buildSummary('run-a', '2026-09-01T10:00:00.000Z'), []);

    const first = await runDashboard({ archive: archiveDir, port: 0 }, { distDir: fakeDistDir, write: () => undefined });
    expect(first.status).toBe('serving');
    if (first.status === 'serving') await first.close();

    await archive.saveRun(buildSummary('run-b', '2026-09-02T10:00:00.000Z'), []);

    const second = await runDashboard({ archive: archiveDir, port: 0 }, { distDir: fakeDistDir, write: () => undefined });
    expect(second.status).toBe('serving');
    if (second.status !== 'serving') return;
    try {
      const response = await fetch(new URL('data/runs.json', second.url));
      const data = (await response.json()) as { runs: unknown[] };
      expect(data.runs).toHaveLength(2);
    } finally {
      await second.close();
    }
  });

  it('does not rewrite local data when it is already current', async () => {
    const archive = new Archive(archiveDir);
    await archive.saveRun(buildSummary('run-a', '2026-09-01T10:00:00.000Z'), []);

    const first = await runDashboard({ archive: archiveDir, port: 0 }, { distDir: fakeDistDir, write: () => undefined });
    expect(first.status).toBe('serving');
    if (first.status === 'serving') await first.close();

    const dataPath = path.join(archiveDir, 'dashboard', 'data', 'runs.json');
    const statBefore = await stat(dataPath);

    const second = await runDashboard({ archive: archiveDir, port: 0 }, { distDir: fakeDistDir, write: () => undefined });
    expect(second.status).toBe('serving');
    if (second.status === 'serving') await second.close();

    const statAfter = await stat(dataPath);
    expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
  });

  it('returns a fatal result and does not throw when the archive path is invalid for asset preparation', async () => {
    // Point distDir at a path that does not exist so ensureDashboardAssets fails cleanly.
    const missingDistDir = path.join(root, 'does-not-exist');
    const result = await runDashboard(
      { archive: archiveDir, port: 0 },
      { distDir: missingDistDir, write: () => undefined },
    );
    expect(result.status).toBe('fatal');
  });
});
