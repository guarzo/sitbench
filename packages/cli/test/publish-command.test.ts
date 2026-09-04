import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
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

  it('overwrites an existing runs.json atomically when the write succeeds', async () => {
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

  it('returns fatal and preserves the prior runs.json unchanged, with no temp artifacts, when the injected dataset writer fails', async () => {
    const archive = new Archive(archiveDir);
    await archive.saveRun(buildSummary('run-a', '2026-09-01T10:00:00.000Z'), []);
    const outDir = path.join(root, 'out-atomic-failure');
    await mkdir(path.join(outDir, 'data'), { recursive: true });
    await writeFile(path.join(outDir, 'data', 'runs.json'), 'previous-content', 'utf8');

    const result = await runPublish(
      { out: outDir, archive: archiveDir },
      {
        distDir: fakeDistDir,
        write: () => undefined,
        writeDataset: async () => {
          throw new Error('simulated disk failure');
        },
      },
    );

    expect(result.status).toBe('fatal');
    const preserved = await readFile(path.join(outDir, 'data', 'runs.json'), 'utf8');
    expect(preserved).toBe('previous-content');
    const dataDirEntries = await readdir(path.join(outDir, 'data'));
    expect(dataDirEntries).toEqual(['runs.json']);
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

  describe('privacy boundary between --out and the archive', () => {
    it('rejects publishing when --out is the exact same directory as the archive', async () => {
      const archive = new Archive(archiveDir);
      await archive.saveRun(buildSummary('run-a', '2026-09-01T10:00:00.000Z'), []);

      const result = await runPublish(
        { out: archiveDir, archive: archiveDir },
        { distDir: fakeDistDir, write: () => undefined },
      );

      expect(result.status).toBe('fatal');
      expect(await readFile(path.join(archiveDir, 'runs', 'run-a', 'run.json'), 'utf8')).toContain('run-a');
      const archiveEntries = await readdir(archiveDir);
      expect(archiveEntries).not.toContain('index.html');
    });

    it('rejects publishing when --out is an ancestor directory of the archive', async () => {
      const nestedArchiveDir = path.join(root, 'nested', 'archive');
      await mkdir(nestedArchiveDir, { recursive: true });
      const nestedArchive = new Archive(nestedArchiveDir);
      await nestedArchive.saveRun(buildSummary('run-a', '2026-09-01T10:00:00.000Z'), []);

      const result = await runPublish(
        { out: path.join(root, 'nested'), archive: nestedArchiveDir },
        { distDir: fakeDistDir, write: () => undefined },
      );

      expect(result.status).toBe('fatal');
      const nestedEntries = await readdir(path.join(root, 'nested'));
      expect(nestedEntries).toEqual(['archive']);
    });

    it('rejects publishing when --out is a descendant directory of the archive', async () => {
      const archive = new Archive(archiveDir);
      await archive.saveRun(buildSummary('run-a', '2026-09-01T10:00:00.000Z'), []);
      const nestedOutDir = path.join(archiveDir, 'public');

      const result = await runPublish(
        { out: nestedOutDir, archive: archiveDir },
        { distDir: fakeDistDir, write: () => undefined },
      );

      expect(result.status).toBe('fatal');
      const archiveEntries = await readdir(archiveDir);
      expect(archiveEntries).not.toContain('public');
    });

    it('rejects publishing when --out is a symlink whose target resolves into the archive directory', async () => {
      const archive = new Archive(archiveDir);
      await archive.saveRun(buildSummary('run-a', '2026-09-01T10:00:00.000Z'), []);
      const symlinkOutDir = path.join(root, 'out-symlink-into-archive');
      await symlink(archiveDir, symlinkOutDir, 'dir');

      const result = await runPublish(
        { out: symlinkOutDir, archive: archiveDir },
        { distDir: fakeDistDir, write: () => undefined },
      );

      expect(result.status).toBe('fatal');
      const archiveEntries = await readdir(archiveDir);
      expect(archiveEntries).not.toContain('index.html');
    });

    it('rejects publishing when --out is a symlink to an unrelated directory (root symlinks are always refused)', async () => {
      const archive = new Archive(archiveDir);
      await archive.saveRun(buildSummary('run-a', '2026-09-01T10:00:00.000Z'), []);
      const elsewhere = path.join(root, 'elsewhere');
      await mkdir(elsewhere, { recursive: true });
      const symlinkOutDir = path.join(root, 'out-symlink-elsewhere');
      await symlink(elsewhere, symlinkOutDir, 'dir');

      const result = await runPublish(
        { out: symlinkOutDir, archive: archiveDir },
        { distDir: fakeDistDir, write: () => undefined },
      );

      expect(result.status).toBe('fatal');
      const elsewhereEntries = await readdir(elsewhere);
      expect(elsewhereEntries).toEqual([]);
    });

    it('rejects publishing when an existing "data" entry inside --out is a symlink', async () => {
      const archive = new Archive(archiveDir);
      await archive.saveRun(buildSummary('run-a', '2026-09-01T10:00:00.000Z'), []);
      const outDir = path.join(root, 'out-data-symlink');
      await mkdir(outDir, { recursive: true });
      const elsewhere = path.join(root, 'elsewhere-data');
      await mkdir(elsewhere, { recursive: true });
      await symlink(elsewhere, path.join(outDir, 'data'), 'dir');

      const result = await runPublish(
        { out: outDir, archive: archiveDir },
        { distDir: fakeDistDir, write: () => undefined },
      );

      expect(result.status).toBe('fatal');
      const elsewhereEntries = await readdir(elsewhere);
      expect(elsewhereEntries).toEqual([]);
    });

    it('rejects publishing when an existing "assets" entry inside --out is a symlink', async () => {
      const archive = new Archive(archiveDir);
      await archive.saveRun(buildSummary('run-a', '2026-09-01T10:00:00.000Z'), []);
      const outDir = path.join(root, 'out-assets-symlink');
      await mkdir(outDir, { recursive: true });
      const elsewhere = path.join(root, 'elsewhere-assets');
      await mkdir(elsewhere, { recursive: true });
      await symlink(elsewhere, path.join(outDir, 'assets'), 'dir');

      const result = await runPublish(
        { out: outDir, archive: archiveDir },
        { distDir: fakeDistDir, write: () => undefined },
      );

      expect(result.status).toBe('fatal');
      const elsewhereEntries = await readdir(elsewhere);
      expect(elsewhereEntries).toEqual([]);
    });

    it('rejects publishing when an existing "data/runs.json" inside --out is a symlink', async () => {
      const archive = new Archive(archiveDir);
      await archive.saveRun(buildSummary('run-a', '2026-09-01T10:00:00.000Z'), []);
      const outDir = path.join(root, 'out-runsjson-symlink');
      await mkdir(path.join(outDir, 'data'), { recursive: true });
      const outsideTarget = path.join(root, 'outside-runs.json');
      await writeFile(outsideTarget, 'outside content', 'utf8');
      await symlink(outsideTarget, path.join(outDir, 'data', 'runs.json'));

      const result = await runPublish(
        { out: outDir, archive: archiveDir },
        { distDir: fakeDistDir, write: () => undefined },
      );

      expect(result.status).toBe('fatal');
      expect(await readFile(outsideTarget, 'utf8')).toBe('outside content');
    });

    it('publishes successfully when --out and the archive are sibling directories under a shared parent', async () => {
      const archive = new Archive(archiveDir);
      await archive.saveRun(buildSummary('run-a', '2026-09-01T10:00:00.000Z'), []);
      const siblingOutDir = path.join(root, 'sibling-out');

      const result = await runPublish(
        { out: siblingOutDir, archive: archiveDir },
        { distDir: fakeDistDir, write: () => undefined },
      );

      expect(result.status).toBe('published');
      const html = await readFile(path.join(siblingOutDir, 'index.html'), 'utf8');
      expect(html).toContain('sitbench dashboard');
    });

    it('publishes successfully when the output directory name is a prefix of the archive directory name (no naive string-prefix overlap check)', async () => {
      const prefixArchiveDir = path.join(root, 'archive-extended');
      await mkdir(prefixArchiveDir, { recursive: true });
      const prefixArchive = new Archive(prefixArchiveDir);
      await prefixArchive.saveRun(buildSummary('run-a', '2026-09-01T10:00:00.000Z'), []);
      const prefixOutDir = path.join(root, 'archive');

      const result = await runPublish(
        { out: prefixOutDir, archive: prefixArchiveDir },
        { distDir: fakeDistDir, write: () => undefined },
      );

      expect(result.status).toBe('published');
      const html = await readFile(path.join(prefixOutDir, 'index.html'), 'utf8');
      expect(html).toContain('sitbench dashboard');
    });
  });
});
