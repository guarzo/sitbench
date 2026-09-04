import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import serveHandler from 'serve-handler';
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

  it('serves / and /index.html', async () => {
    const server = await startDashboardServer(fakeDistDir, 0);
    try {
      const rootResponse = await fetch(server.url);
      expect(rootResponse.status).toBe(200);
      expect(await rootResponse.text()).toContain('sitbench dashboard');

      const indexResponse = await fetch(new URL('index.html', server.url));
      expect(indexResponse.status).toBe(200);
    } finally {
      await server.close();
    }
  });

  it('serves a real asset file under /assets/', async () => {
    const server = await startDashboardServer(fakeDistDir, 0);
    try {
      const response = await fetch(new URL('assets/app.js', server.url));
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('console.log');
    } finally {
      await server.close();
    }
  });

  it('serves /data/runs.json when it exists', async () => {
    await mkdir(path.join(fakeDistDir, 'data'), { recursive: true });
    await writeFile(path.join(fakeDistDir, 'data', 'runs.json'), JSON.stringify({ mode: 'local' }), 'utf8');
    const server = await startDashboardServer(fakeDistDir, 0);
    try {
      const response = await fetch(new URL('data/runs.json', server.url));
      expect(response.status).toBe(200);
      const body = (await response.json()) as { mode: string };
      expect(body.mode).toBe('local');
    } finally {
      await server.close();
    }
  });

  it('returns 404 for a planted events.jsonl file even though it exists on disk', async () => {
    await writeFile(path.join(fakeDistDir, 'events.jsonl'), '{"kind":"damage-dealt"}\n', 'utf8');
    const server = await startDashboardServer(fakeDistDir, 0);
    try {
      const response = await fetch(new URL('events.jsonl', server.url));
      expect(response.status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it('returns 404 for a planted runs/ directory and its contents even though they exist on disk', async () => {
    await mkdir(path.join(fakeDistDir, 'runs', 'run-a'), { recursive: true });
    await writeFile(path.join(fakeDistDir, 'runs', 'run-a', 'run.json'), '{"id":"run-a"}', 'utf8');
    const server = await startDashboardServer(fakeDistDir, 0);
    try {
      const fileResponse = await fetch(new URL('runs/run-a/run.json', server.url));
      expect(fileResponse.status).toBe(404);
      const dirResponse = await fetch(new URL('runs/', server.url));
      expect(dirResponse.status).toBe(404);
      const dirNoSlashResponse = await fetch(new URL('runs', server.url));
      expect(dirNoSlashResponse.status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it('returns 404 for an arbitrary planted file outside the allowlist', async () => {
    await writeFile(path.join(fakeDistDir, 'secret.txt'), 'top secret', 'utf8');
    const server = await startDashboardServer(fakeDistDir, 0);
    try {
      const response = await fetch(new URL('secret.txt', server.url));
      expect(response.status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it('returns 404 for directory listing of the asset directory itself', async () => {
    const server = await startDashboardServer(fakeDistDir, 0);
    try {
      const withSlash = await fetch(new URL('assets/', server.url));
      expect(withSlash.status).toBe(404);
      const withoutSlash = await fetch(new URL('assets', server.url));
      expect(withoutSlash.status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it('returns 404 for an asset path traversal attempt, raw and percent-encoded', async () => {
    const server = await startDashboardServer(fakeDistDir, 0);
    try {
      const raw = await fetch(new URL('assets/../../etc/passwd', server.url));
      expect(raw.status).toBe(404);
      const encoded = await fetch(`${server.url}assets/%2e%2e%2f%2e%2e%2fetc%2fpasswd`);
      expect(encoded.status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it('returns 404 for a symlinked file under assets/ even though its name matches the allowlist', async () => {
    const outsideTarget = path.join(root, 'outside-secret.txt');
    await writeFile(outsideTarget, 'outside secret', 'utf8');
    await symlink(outsideTarget, path.join(fakeDistDir, 'assets', 'evil.js'));
    const server = await startDashboardServer(fakeDistDir, 0);
    try {
      const response = await fetch(new URL('assets/evil.js', server.url));
      expect(response.status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it('returns 500 for a rejected static-handler request and keeps serving subsequent requests', async () => {
    let calls = 0;
    const errors: unknown[] = [];
    const server = await startDashboardServer(fakeDistDir, 0, {
      handler: async (request, response, options) => {
        calls += 1;
        if (calls === 1) {
          throw new Error('handler exploded');
        }
        await serveHandler(request, response, options);
      },
      onError: (error) => errors.push(error),
    });
    try {
      const failed = await fetch(server.url);
      expect(failed.status).toBe(500);
      await failed.text();

      const recovered = await fetch(server.url);
      expect(recovered.status).toBe(200);
      expect(await recovered.text()).toContain('sitbench dashboard');

      expect(errors).toHaveLength(1);
      expect((errors[0] as Error).message).toBe('handler exploded');
    } finally {
      await server.close();
    }
  });

  it('does not double-end or throw when the handler rejects after the response has already started', async () => {
    let calls = 0;
    const server = await startDashboardServer(fakeDistDir, 0, {
      handler: async (request, response, options) => {
        calls += 1;
        if (calls === 1) {
          response.statusCode = 200;
          response.write('partial');
          throw new Error('exploded mid-response');
        }
        await serveHandler(request, response, options);
      },
    });
    try {
      const partial = await fetch(server.url);
      expect(partial.status).toBe(200);
      expect(await partial.text()).toBe('partial');

      const recovered = await fetch(server.url);
      expect(recovered.status).toBe(200);
      expect(await recovered.text()).toContain('sitbench dashboard');
    } finally {
      await server.close();
    }
  });

  it('forwards a server error raised after a successful listen to onError exactly once', async () => {
    const errors: unknown[] = [];
    let created: Server | null = null;
    const server = await startDashboardServer(fakeDistDir, 0, {
      createServer: (requestListener) => {
        created = createServer(requestListener);
        return created;
      },
      onError: (error) => errors.push(error),
    });
    try {
      // A server-level failure raised after startup (the startup promise has
      // long since settled) must still reach the caller's error reporter
      // instead of being swallowed by the settled startup listener.
      (created as Server | null)?.emit('error', new Error('runtime server failure'));

      expect(errors).toHaveLength(1);
      expect((errors[0] as Error).message).toBe('runtime server failure');
    } finally {
      await server.close();
    }
  });

  it('still rejects startup when the requested port is already in use', async () => {
    const first = await startDashboardServer(fakeDistDir, 0);
    try {
      await expect(startDashboardServer(fakeDistDir, first.port)).rejects.toThrow(/EADDRINUSE/);
    } finally {
      await first.close();
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

  it('regenerates when the existing dataset is well-formed but its generatedAt uses an offset that lexically outranks an actually-later update', async () => {
    const archive = new Archive(archiveDir);
    const run = buildSummary('run-a', '2026-09-01T10:00:00.000Z', { updatedAt: '2026-09-01T14:00:00.000Z' });
    await archive.saveRun(run, []);

    // Crafted so that a *lexical* string comparison of the raw ISO strings
    // would say this dataset is still fresh ("23..." > "14..."), while the
    // real UTC instant it represents (13:00Z) is actually BEFORE the run's
    // updatedAt (14:00Z) -- i.e. genuinely stale.
    const staleButLexicallyNewer = {
      schemaVersion: 1,
      mode: 'local',
      generatedAt: '2026-09-01T23:00:00+10:00',
      capabilities: { characters: true, notes: true },
      runs: [run],
    };
    await mkdir(path.join(archiveDir, 'dashboard', 'data'), { recursive: true });
    await writeFile(
      path.join(archiveDir, 'dashboard', 'data', 'runs.json'),
      JSON.stringify(staleButLexicallyNewer),
      'utf8',
    );

    const result = await runDashboard({ archive: archiveDir, port: 0 }, { distDir: fakeDistDir, write: () => undefined });
    expect(result.status).toBe('serving');
    if (result.status !== 'serving') return;
    try {
      const raw = JSON.parse(
        await readFile(path.join(archiveDir, 'dashboard', 'data', 'runs.json'), 'utf8'),
      ) as { generatedAt: string };
      expect(raw.generatedAt).not.toBe('2026-09-01T23:00:00+10:00');
    } finally {
      await result.close();
    }
  });

  it('regenerates when the existing dataset has a matching run count but fails LocalDashboardDatasetSchema (e.g. mode is not "local")', async () => {
    const archive = new Archive(archiveDir);
    const run = buildSummary('run-a', '2026-09-01T10:00:00.000Z');
    await archive.saveRun(run, []);

    // Same run count as the real archive, and a generatedAt far in the
    // future (so a naive timestamp-only check alone would call this fresh),
    // but mode is "public" -- invalid at the local data path.
    const wrongModeSameCount = {
      schemaVersion: 1,
      mode: 'public',
      generatedAt: '2099-01-01T00:00:00.000Z',
      capabilities: { characters: false, notes: false },
      runs: [{ ...run, comparisonOrder: 0 }],
    };
    await mkdir(path.join(archiveDir, 'dashboard', 'data'), { recursive: true });
    await writeFile(
      path.join(archiveDir, 'dashboard', 'data', 'runs.json'),
      JSON.stringify(wrongModeSameCount),
      'utf8',
    );

    const result = await runDashboard({ archive: archiveDir, port: 0 }, { distDir: fakeDistDir, write: () => undefined });
    expect(result.status).toBe('serving');
    if (result.status !== 'serving') return;
    try {
      const raw = JSON.parse(
        await readFile(path.join(archiveDir, 'dashboard', 'data', 'runs.json'), 'utf8'),
      ) as { mode: string; generatedAt: string };
      expect(raw.mode).toBe('local');
      expect(raw.generatedAt).not.toBe('2099-01-01T00:00:00.000Z');
    } finally {
      await result.close();
    }
  });

  it('regenerates when the run with the latest updatedAt has a schema-valid but Date.parse-unparseable offset (e.g. "+99:99")', async () => {
    // z.string().datetime({ offset: true }) validates the offset with
    // /([+-]\d{2}:?\d{2})/, which does not bound hours to 00-23 or minutes
    // to 00-59 -- so "+99:99" is schema-valid but Date.parse returns NaN.
    const archive = new Archive(archiveDir);
    const run = buildSummary('run-a', '2026-09-01T10:00:00.000Z', {
      updatedAt: '2026-09-01T10:00:00.000+99:99',
    });
    await archive.saveRun(run, []);

    // A schema-valid dataset with a plausible generatedAt that would look
    // "fresh" under any comparison that lets a NaN accidentally win.
    const datasetWithUnparseableRunUpdatedAt = {
      schemaVersion: 1,
      mode: 'local',
      generatedAt: '2099-01-01T00:00:00.000Z',
      capabilities: { characters: true, notes: true },
      runs: [run],
    };
    await mkdir(path.join(archiveDir, 'dashboard', 'data'), { recursive: true });
    await writeFile(
      path.join(archiveDir, 'dashboard', 'data', 'runs.json'),
      JSON.stringify(datasetWithUnparseableRunUpdatedAt),
      'utf8',
    );

    const result = await runDashboard({ archive: archiveDir, port: 0 }, { distDir: fakeDistDir, write: () => undefined });
    expect(result.status).toBe('serving');
    if (result.status !== 'serving') return;
    try {
      const raw = JSON.parse(
        await readFile(path.join(archiveDir, 'dashboard', 'data', 'runs.json'), 'utf8'),
      ) as { generatedAt: string };
      expect(raw.generatedAt).not.toBe('2099-01-01T00:00:00.000Z');
    } finally {
      await result.close();
    }
  });

  it('regenerates when the existing dataset generatedAt has a schema-valid but Date.parse-unparseable offset (e.g. "+99:99")', async () => {
    const archive = new Archive(archiveDir);
    const run = buildSummary('run-a', '2026-09-01T10:00:00.000Z');
    await archive.saveRun(run, []);

    const datasetWithUnparseableGeneratedAt = {
      schemaVersion: 1,
      mode: 'local',
      generatedAt: '2026-09-01T10:00:00.000+99:99',
      capabilities: { characters: true, notes: true },
      runs: [run],
    };
    await mkdir(path.join(archiveDir, 'dashboard', 'data'), { recursive: true });
    await writeFile(
      path.join(archiveDir, 'dashboard', 'data', 'runs.json'),
      JSON.stringify(datasetWithUnparseableGeneratedAt),
      'utf8',
    );

    const result = await runDashboard({ archive: archiveDir, port: 0 }, { distDir: fakeDistDir, write: () => undefined });
    expect(result.status).toBe('serving');
    if (result.status !== 'serving') return;
    try {
      const raw = JSON.parse(
        await readFile(path.join(archiveDir, 'dashboard', 'data', 'runs.json'), 'utf8'),
      ) as { generatedAt: string };
      expect(raw.generatedAt).not.toBe('2026-09-01T10:00:00.000+99:99');
    } finally {
      await result.close();
    }
  });
});
