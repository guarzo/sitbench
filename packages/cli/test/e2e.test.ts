import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Archive, PublicDashboardDatasetSchema } from '@sitbench/core';
import { runAnalyze, type AnalyzePrompts } from '../src/analyze-command.js';
import { regenerateDashboardData } from '../src/dashboard-export.js';
import { runPublish } from '../src/publish-command.js';
import { runRecalculate } from '../src/recalculate-command.js';

let root: string;
let logsDir: string;
let archiveDir: string;
let publicDir: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'sitbench-e2e-'));
  logsDir = path.join(root, 'mnt', 'c', 'Users', 'Capsuleer', 'Documents', 'EVE', 'logs', 'Gamelogs');
  archiveDir = path.join(root, 'local', 'share', 'sitbench');
  publicDir = path.join(root, 'public-export');
  await mkdir(logsDir, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function gameLog(character: string, lines: string[]): string {
  return ['------------------------------------------------------------', '  Gamelog', `  Listener: ${character}`, '------------------------------------------------------------', ...lines].join('\n');
}

function eveDamageLine(timestamp: string, amount: number): string {
  return `[ ${timestamp} ] (combat) <color=0xff00ffff><b>${String(amount)}</b> <color=0x77ffffff><font size=10>to</font> <b><color=0xffffffff>Sleepless Guardian</b><font size=10><color=0x77ffffff> - Heavy Entropic Disintegrator II - Hits`;
}

const prompts: AnalyzePrompts = {
  confirmCandidate: async () => ({ action: 'accept' }),
  requestSite: async () => 'Core Bastion',
  requestProfile: async () => '2 Kikis',
  requestNotes: async () => 'Private fleet note',
  confirmSave: async () => true,
};

describe('Sitbench end-to-end workflow', () => {
  it('archives a confirmed two-character episode from real EVE markup, rejects duplicates, recalculates, and exports private data safely by default', async () => {
    const arcLines = [
      eveDamageLine('2026.09.03 04:00:00', 17),
      eveDamageLine('2026.09.03 04:04:00', 100),
      eveDamageLine('2026.09.03 04:04:20', 200),
    ];
    const boltLines = [eveDamageLine('2026.09.03 04:04:10', 300), eveDamageLine('2026.09.03 04:04:40', 400)];
    await Promise.all([
      writeFile(path.join(logsDir, 'Arc One.txt'), gameLog('Arc One', arcLines), 'utf8'),
      writeFile(path.join(logsDir, 'Bolt Two.txt'), gameLog('Bolt Two', boltLines), 'utf8'),
    ]);

    const rebuildDashboard = async (archive: Archive): Promise<void> => regenerateDashboardData(archive, archiveDir);
    const first = await runAnalyze(
      { logs: logsDir, archive: archiveDir },
      {
        prompts,
        clock: () => new Date('2026-09-03T05:00:00.000Z'),
        write: () => undefined,
        rebuildCatalog: rebuildDashboard,
      },
    );

    expect(first.status).toBe('saved');
    if (first.status !== 'saved') throw new Error('Expected confirmed analysis to save a run.');

    const archive = new Archive(archiveDir);
    const saved = await archive.loadRun(first.id);
    expect(saved).not.toBeNull();
    if (saved === null) throw new Error('Expected the saved run to be loadable from the archive.');

    expect(saved.summary.parserVersion).toBe('0.3.0');
    expect(saved.summary.metrics.elapsedSeconds).toBe(40);
    expect(saved.summary.metrics.fleetDamageDealt).toBe(1000);
    expect(saved.summary.characterMetrics.map((metric) => [metric.character, metric.damageDealt])).toEqual([
      ['Arc One', 300],
      ['Bolt Two', 700],
    ]);

    const runDir = path.join(archiveDir, 'runs', first.id);
    const [runJsonBeforeDuplicate, eventsJsonlBeforeDuplicate, dashboardDataBeforeDuplicate] = await Promise.all([
      readFile(path.join(runDir, 'run.json'), 'utf8'),
      readFile(path.join(runDir, 'events.jsonl'), 'utf8'),
      readFile(path.join(archiveDir, 'dashboard', 'data', 'runs.json'), 'utf8'),
    ]);
    const archivedEvents = eventsJsonlBeforeDuplicate
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { observedBy: string; sourceFile: string; sourceLine: number; amount: number; raw: string });
    expect(archivedEvents.map((event) => [event.observedBy, event.sourceFile, event.sourceLine, event.amount])).toEqual([
      ['Arc One', 'Arc One.txt', 6, 100],
      ['Bolt Two', 'Bolt Two.txt', 5, 300],
      ['Arc One', 'Arc One.txt', 7, 200],
      ['Bolt Two', 'Bolt Two.txt', 6, 400],
    ]);
    expect(archivedEvents.map((event) => event.raw)).toEqual([arcLines[1], boltLines[0], arcLines[2], boltLines[1]]);

    const localDataset = JSON.parse(dashboardDataBeforeDuplicate) as {
      mode: string;
      runs: Array<{ characterMetrics: Array<{ character: string; damageDealt: number }> }>;
    };
    expect(localDataset.mode).toBe('local');
    expect(localDataset.runs[0]?.characterMetrics.map((metric) => [metric.character, metric.damageDealt])).toEqual([
      ['Arc One', 300],
      ['Bolt Two', 700],
    ]);

    const originalSummary = {
      metrics: saved.summary.metrics,
      characterMetrics: saved.summary.characterMetrics,
      participants: saved.summary.participants,
      calculation: saved.summary.calculation,
      schemaVersion: saved.summary.schemaVersion,
      parserVersion: saved.summary.parserVersion,
      id: saved.summary.id,
      site: saved.summary.site,
      fleetProfile: saved.summary.fleetProfile,
      window: saved.summary.window,
      coverage: saved.summary.coverage,
      notes: saved.summary.notes,
      fingerprint: saved.summary.fingerprint,
      createdAt: saved.summary.createdAt,
    };

    const duplicate = await runAnalyze(
      { logs: logsDir, archive: archiveDir },
      {
        prompts,
        clock: () => new Date('2026-09-03T05:01:00.000Z'),
        write: () => undefined,
        rebuildCatalog: rebuildDashboard,
      },
    );
    expect(duplicate).toMatchObject({ status: 'fatal', reason: 'duplicate' });
    expect(await archive.listRuns()).toHaveLength(1);
    await expect(Promise.all([
      readFile(path.join(runDir, 'run.json'), 'utf8'),
      readFile(path.join(runDir, 'events.jsonl'), 'utf8'),
      readFile(path.join(archiveDir, 'dashboard', 'data', 'runs.json'), 'utf8'),
    ])).resolves.toEqual([runJsonBeforeDuplicate, eventsJsonlBeforeDuplicate, dashboardDataBeforeDuplicate]);

    expect(await runRecalculate(
      { all: true, archive: archiveDir },
      { write: () => undefined, rebuildCatalog: rebuildDashboard },
    )).toMatchObject({ status: 'ok', outcomes: [{ id: first.id, status: 'recalculated' }] });
    const recalculated = await archive.loadRun(first.id);
    expect(recalculated).not.toBeNull();
    if (recalculated === null) throw new Error('Expected the recalculated run to be loadable from the archive.');

    expect(recalculated.summary.metrics).toEqual(originalSummary.metrics);
    expect(recalculated.summary.characterMetrics).toEqual(originalSummary.characterMetrics);
    expect(recalculated.summary.participants).toEqual(originalSummary.participants);
    expect(recalculated.summary.calculation).toEqual(originalSummary.calculation);
    expect(recalculated.summary.metrics.elapsedSeconds).toBe(40);
    expect(recalculated.summary.metrics.fleetDamageDealt).toBe(1000);
    expect(recalculated.summary.schemaVersion).toBe(originalSummary.schemaVersion);
    expect(recalculated.summary.parserVersion).toBe(originalSummary.parserVersion);
    expect(recalculated.summary.id).toBe(originalSummary.id);
    expect(recalculated.summary.site).toEqual(originalSummary.site);
    expect(recalculated.summary.fleetProfile).toEqual(originalSummary.fleetProfile);
    expect(recalculated.summary.window).toEqual(originalSummary.window);
    expect(recalculated.summary.coverage).toEqual(originalSummary.coverage);
    expect(recalculated.summary.notes).toBe(originalSummary.notes);
    expect(recalculated.summary.fingerprint).toBe(originalSummary.fingerprint);
    expect(recalculated.summary.createdAt).toBe(originalSummary.createdAt);

    expect(await runPublish({ out: publicDir, archive: archiveDir }, { write: () => undefined })).toMatchObject({
      status: 'published',
      runCount: 1,
    });
    const publicDatasetText = await readFile(path.join(publicDir, 'data', 'runs.json'), 'utf8');
    const publicDataset = JSON.parse(publicDatasetText) as { runs: Array<Record<string, unknown>> };
    const validatedPublicDataset = PublicDashboardDatasetSchema.parse(publicDataset);
    expect(validatedPublicDataset.mode).toBe('public');
    expect(validatedPublicDataset.capabilities).toEqual({ characters: false, notes: false });
    for (const run of publicDataset.runs) {
      for (const privateField of [
        'participants',
        'characterMetrics',
        'notes',
        'fingerprint',
        'createdAt',
        'updatedAt',
        'parserVersion',
        'metricsVersion',
      ]) {
        expect(Object.hasOwn(run, privateField)).toBe(false);
      }
    }
    expect(publicDatasetText).not.toContain('Arc One');
    expect(publicDatasetText).not.toContain('Bolt Two');
    expect(publicDatasetText).not.toContain('Private fleet note');
  });
});
