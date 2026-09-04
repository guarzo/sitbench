import { createServer, type Server } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Archive, type RunSummary } from '@sitbench/core';
import { resolveDashboardDistDir, runDashboard } from '../src/dashboard-command.js';
import { runPublish } from '../src/publish-command.js';

let root: string;
let archiveDir: string;
let publicDir: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'sitbench-subpath-'));
  archiveDir = path.join(root, 'archive');
  publicDir = path.join(root, 'public-export');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function buildSummary(id: string, windowStart: string): RunSummary {
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
    characterMetrics: [],
    coverage: {
      logFiles: 1,
      participantsWithOutgoingDamage: 1,
      unparsedCombatLines: 0,
      ambiguousEventsExcluded: 0,
      repairPairing: 'full',
    },
    notes: null,
    fingerprint: `fp-${id}`,
    createdAt: windowStart,
    updatedAt: windowStart,
  };
}

/**
 * Minimal static host that serves `rootDir` under `mountPath`, imitating a
 * project-subpath deployment such as GitHub Project Pages
 * (`https://user.github.io/<project>/`). It does no path rewriting beyond
 * stripping the mount prefix, so a build that emits root-absolute asset
 * URLs will 404 here exactly as it would in production.
 */
async function serveUnderSubpath(rootDir: string, mountPath: string): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server: Server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
    if (!pathname.startsWith(mountPath)) {
      response.statusCode = 404;
      response.end('Not Found');
      return;
    }
    const relative = pathname.slice(mountPath.length) || 'index.html';
    const filePath = path.join(rootDir, relative.endsWith('/') ? `${relative}index.html` : relative);
    if (!filePath.startsWith(rootDir)) {
      response.statusCode = 403;
      response.end('Forbidden');
      return;
    }
    stat(filePath).then(
      (stats) => {
        if (!stats.isFile()) {
          response.statusCode = 404;
          response.end('Not Found');
          return;
        }
        response.statusCode = 200;
        createReadStream(filePath).pipe(response);
      },
      () => {
        response.statusCode = 404;
        response.end('Not Found');
      },
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no address');

  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}${mountPath}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

/** Extracts every `src="..."`/`href="..."` reference from the built shell. */
function referencedUrls(html: string): string[] {
  return [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1] as string);
}

describe('published dashboard under a project subpath', () => {
  it('emits no root-absolute asset URLs in the built shell', async () => {
    const html = await readFile(path.join(resolveDashboardDistDir(), 'index.html'), 'utf8');
    const urls = referencedUrls(html);

    expect(urls.length).toBeGreaterThan(0);
    expect(urls.some((url) => url.includes('assets/'))).toBe(true);
    expect(urls.filter((url) => url.startsWith('/'))).toEqual([]);
  });

  it('loads its assets and dataset over real HTTP when the export is hosted under a subpath', async () => {
    const archive = new Archive(archiveDir);
    await archive.saveRun(buildSummary('run-a', '2026-09-01T10:00:00.000Z'), []);
    const published = await runPublish({ out: publicDir, archive: archiveDir }, { write: () => undefined });
    expect(published.status).toBe('published');

    const host = await serveUnderSubpath(publicDir, '/team/sitbench/');
    try {
      const shell = await fetch(host.baseUrl);
      expect(shell.status).toBe(200);
      const html = await shell.text();

      for (const url of referencedUrls(html)) {
        const resolved = new URL(url, host.baseUrl);
        const assetResponse = await fetch(resolved);
        expect([resolved.pathname, assetResponse.status]).toEqual([resolved.pathname, 200]);
        expect(resolved.pathname.startsWith('/team/sitbench/')).toBe(true);
      }

      // The dashboard's default dataset URL must resolve under the subpath too.
      const datasetResponse = await fetch(new URL('data/runs.json', host.baseUrl));
      expect(datasetResponse.status).toBe(200);
      const dataset = (await datasetResponse.json()) as { mode: string };
      expect(dataset.mode).toBe('public');
    } finally {
      await host.close();
    }
  });

  it('still resolves every referenced asset through the loopback server allowlist at the root path', async () => {
    const archive = new Archive(archiveDir);
    await archive.saveRun(buildSummary('run-a', '2026-09-01T10:00:00.000Z'), []);

    const result = await runDashboard(
      { archive: archiveDir, port: 0 },
      { distDir: resolveDashboardDistDir(), write: () => undefined },
    );
    expect(result.status).toBe('serving');
    if (result.status !== 'serving') return;
    try {
      const shell = await fetch(result.url);
      expect(shell.status).toBe(200);
      const html = await shell.text();

      for (const url of referencedUrls(html)) {
        // Browser resolution of './assets/...' against the page URL '/'.
        const resolved = new URL(url, result.url);
        const assetResponse = await fetch(resolved);
        expect([resolved.pathname, assetResponse.status]).toEqual([resolved.pathname, 200]);
      }

      const datasetResponse = await fetch(new URL('data/runs.json', result.url));
      expect(datasetResponse.status).toBe(200);
      expect(((await datasetResponse.json()) as { mode: string }).mode).toBe('local');
    } finally {
      await result.close();
    }
  });
});
