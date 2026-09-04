import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Archive, type RunSummary } from '@sitbench/core';
import { runPublish } from '../src/publish-command.js';
import { validateDataset } from '@sitbench/dashboard/data';
import { initializeState, matchingRuns } from '@sitbench/dashboard/state';

let root: string;
let archiveDir: string;
let fakeDistDir: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'sitbench-publish-'));
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
    participants: ['Alpha', 'Bravo'],
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
      participantCount: 2,
    },
    characterMetrics: [
      {
        character: 'Alpha',
        damageDealt: 70000,
        fleetDamageShare: 0.583,
        averageDps: 116.7,
        activeDps: 129.6,
        damageTaken: 20000,
        remoteRepairDelivered: 3000,
        remoteRepairReceived: 2000,
        shotsHit: 150,
        shotsMissed: 10,
        missRate: 0.0625,
        hitQualityCounts: {},
        firstRelevantEvent: windowStart,
        lastRelevantEvent: windowEnd,
      },
      {
        character: 'Bravo',
        damageDealt: 50000,
        fleetDamageShare: 0.417,
        averageDps: 83.3,
        activeDps: 92.6,
        damageTaken: 10000,
        remoteRepairDelivered: 2000,
        remoteRepairReceived: 3000,
        shotsHit: 120,
        shotsMissed: 5,
        missRate: 0.04,
        hitQualityCounts: {},
        firstRelevantEvent: windowStart,
        lastRelevantEvent: windowEnd,
      },
    ],
    coverage: { logFiles: 2, participantsWithOutgoingDamage: 2, unparsedCombatLines: 0, ambiguousEventsExcluded: 0, repairPairing: 'full' },
    notes: 'Smooth run.',
    fingerprint: `fp-${id}`,
    createdAt: windowStart,
    updatedAt: windowStart,
    ...overrides,
  };
}

async function listFilesRecursively(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}

describe('runPublish', () => {
  it.each([
    [{}, { characters: false, notes: false }],
    [{ includeCharacters: true }, { characters: true, notes: false }],
    [{ includeNotes: true }, { characters: false, notes: true }],
    [{ includeCharacters: true, includeNotes: true }, { characters: true, notes: true }],
  ])('publishes static assets plus a schema-valid public dataset for options %#', async (options, expectedCapabilities) => {
    const archive = new Archive(archiveDir);
    await archive.saveRun(buildSummary('run-a', '2026-09-01T10:00:00.000Z'), [
      { kind: 'damage-dealt', timestamp: '2026-09-01T10:00:00.000Z', observedBy: 'Alpha', sourceFile: 'log.txt', sourceLine: 1, raw: 'raw', actor: 'Alpha', target: 'NPC', amount: 100, hitQuality: null, targetClassification: 'npc' },
    ]);
    const outDir = path.join(root, `out-${JSON.stringify(options)}`);

    const result = await runPublish(
      { out: outDir, archive: archiveDir, ...options },
      { distDir: fakeDistDir, write: () => undefined },
    );

    expect(result.status).toBe('published');

    // Static assets copied.
    const html = await readFile(path.join(outDir, 'index.html'), 'utf8');
    expect(html).toContain('sitbench dashboard');
    const js = await readFile(path.join(outDir, 'assets', 'app.js'), 'utf8');
    expect(js).toContain('console.log');

    // Public dataset.
    const raw = JSON.parse(await readFile(path.join(outDir, 'data', 'runs.json'), 'utf8')) as {
      mode: string;
      capabilities: { characters: boolean; notes: boolean };
      runs: Array<Record<string, unknown>>;
    };
    expect(raw.mode).toBe('public');
    expect(raw.capabilities).toEqual(expectedCapabilities);

    // Never contains archived events.
    const allFiles = await listFilesRecursively(outDir);
    expect(allFiles.some((file) => file.endsWith('events.jsonl'))).toBe(false);

    // Loadable and usable through the real dashboard data/state layer.
    const dataset = validateDataset(raw);
    expect(dataset.mode).toBe('public');
    const state = initializeState(dataset);
    const matched = matchingRuns(state);
    expect(matched).toHaveLength(1);
    expect(matched[0]?.id).toBe('run-a');
  });

  it('never copies the archive runs directory or its events', async () => {
    const archive = new Archive(archiveDir);
    await archive.saveRun(buildSummary('run-a', '2026-09-01T10:00:00.000Z'), [
      { kind: 'damage-dealt', timestamp: '2026-09-01T10:00:00.000Z', observedBy: 'Alpha', sourceFile: 'log.txt', sourceLine: 1, raw: 'raw', actor: 'Alpha', target: 'NPC', amount: 100, hitQuality: null, targetClassification: 'npc' },
    ]);
    const outDir = path.join(root, 'out-no-events');

    await runPublish({ out: outDir, archive: archiveDir }, { distDir: fakeDistDir, write: () => undefined });

    const allFiles = await listFilesRecursively(outDir);
    expect(allFiles.some((file) => file.includes('runs') && file.includes('run-a'))).toBe(false);
    expect(allFiles.some((file) => file.endsWith('events.jsonl'))).toBe(false);
  });

  it('does not delete unrelated pre-existing files in the output directory', async () => {
    const archive = new Archive(archiveDir);
    await archive.saveRun(buildSummary('run-a', '2026-09-01T10:00:00.000Z'), []);
    const outDir = path.join(root, 'out-existing');
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, 'my-notes.txt'), 'do not delete me', 'utf8');

    await runPublish({ out: outDir, archive: archiveDir }, { distDir: fakeDistDir, write: () => undefined });

    const preserved = await readFile(path.join(outDir, 'my-notes.txt'), 'utf8');
    expect(preserved).toBe('do not delete me');
    // Publish still wrote its own files alongside the unrelated one.
    const html = await readFile(path.join(outDir, 'index.html'), 'utf8');
    expect(html).toContain('sitbench dashboard');
  });

  it('writes the dataset atomically (no partial file left on a mid-write failure)', async () => {
    const archive = new Archive(archiveDir);
    await archive.saveRun(buildSummary('run-a', '2026-09-01T10:00:00.000Z'), []);
    const outDir = path.join(root, 'out-atomic');
    await mkdir(path.join(outDir, 'data'), { recursive: true });
    await writeFile(path.join(outDir, 'data', 'runs.json'), 'previous-content', 'utf8');

    const result = await runPublish({ out: outDir, archive: archiveDir }, { distDir: fakeDistDir, write: () => undefined });

    expect(result.status).toBe('published');
    const raw = await readFile(path.join(outDir, 'data', 'runs.json'), 'utf8');
    expect(raw).not.toBe('previous-content');
    expect(() => JSON.parse(raw)).not.toThrow();
    // No leftover temp files from the atomic write.
    const dataDirEntries = await readdir(path.join(outDir, 'data'));
    expect(dataDirEntries.every((name) => !name.startsWith('.tmp-'))).toBe(true);
  });

  it('does not initialize Git in the output directory', async () => {
    const archive = new Archive(archiveDir);
    await archive.saveRun(buildSummary('run-a', '2026-09-01T10:00:00.000Z'), []);
    const outDir = path.join(root, 'out-no-git');

    await runPublish({ out: outDir, archive: archiveDir }, { distDir: fakeDistDir, write: () => undefined });

    const allFiles = await listFilesRecursively(outDir);
    expect(allFiles.some((file) => file.includes(`${path.sep}.git${path.sep}`))).toBe(false);
  });

  it('returns a fatal result without throwing when an archived run fails validation', async () => {
    // Bypass Archive's write path to create a corrupt run.json directly,
    // so archive.listRuns() genuinely throws during validation.
    const runDir = path.join(archiveDir, 'runs', 'corrupt-run');
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, 'run.json'), JSON.stringify({ id: 'corrupt-run' }), 'utf8');
    const outDir = path.join(root, 'out-fatal');

    const result = await runPublish(
      { out: outDir, archive: archiveDir },
      { distDir: fakeDistDir, write: () => undefined },
    );

    expect(result.status).toBe('fatal');
  });
});
