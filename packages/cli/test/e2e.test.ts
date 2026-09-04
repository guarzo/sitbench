import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Archive } from '@sitbench/core';
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

const prompts: AnalyzePrompts = {
  confirmCandidate: async () => ({ action: 'accept' }),
  requestSite: async () => 'Core Bastion',
  requestProfile: async () => '2 Kikis',
  requestNotes: async () => 'Private fleet note',
  confirmSave: async () => true,
};

describe('Sitbench end-to-end workflow', () => {
  it('archives a confirmed two-character episode, rejects duplicates, recalculates, and exports private data safely by default', async () => {
    const arcLines = [
      '[ 2026.09.03 04:00:00 ] (combat) 17 from Arc One[Example] - Heavy Entropic Disintegrator II - Hits Sleepless Guardian',
      '[ 2026.09.03 04:04:00 ] (combat) 100 from Arc One[Example] - Heavy Entropic Disintegrator II - Hits Sleepless Guardian',
      '[ 2026.09.03 04:04:20 ] (combat) 200 from Arc One[Example] - Heavy Entropic Disintegrator II - Hits Sleepless Guardian',
    ];
    const boltLines = [
      '[ 2026.09.03 04:04:10 ] (combat) 300 from Bolt Two[Example] - Heavy Entropic Disintegrator II - Hits Sleepless Guardian',
      '[ 2026.09.03 04:04:40 ] (combat) 400 from Bolt Two[Example] - Heavy Entropic Disintegrator II - Hits Sleepless Guardian',
    ];
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
    expect(saved?.summary.metrics.elapsedSeconds).toBe(40);
    expect(saved?.summary.metrics.fleetDamageDealt).toBe(1000);
    expect(saved?.summary.characterMetrics.map((metric) => [metric.character, metric.damageDealt])).toEqual([
      ['Arc One', 300],
      ['Bolt Two', 700],
    ]);
    const archivedEvents = (await readFile(path.join(archiveDir, 'runs', first.id, 'events.jsonl'), 'utf8'))
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

    const localDataset = JSON.parse(await readFile(path.join(archiveDir, 'dashboard', 'data', 'runs.json'), 'utf8')) as {
      mode: string;
      runs: Array<{ characterMetrics: Array<{ character: string; damageDealt: number }> }>;
    };
    expect(localDataset.mode).toBe('local');
    expect(localDataset.runs[0]?.characterMetrics.map((metric) => [metric.character, metric.damageDealt])).toEqual([
      ['Arc One', 300],
      ['Bolt Two', 700],
    ]);

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

    expect(await runRecalculate(
      { all: true, archive: archiveDir },
      { write: () => undefined, rebuildCatalog: rebuildDashboard },
    )).toMatchObject({ status: 'ok', outcomes: [{ id: first.id, status: 'recalculated' }] });
    const recalculated = await archive.loadRun(first.id);
    expect(recalculated?.summary.metrics.elapsedSeconds).toBe(40);
    expect(recalculated?.summary.characterMetrics.map((metric) => [metric.character, metric.damageDealt])).toEqual([
      ['Arc One', 300],
      ['Bolt Two', 700],
    ]);

    expect(await runPublish({ out: publicDir, archive: archiveDir }, { write: () => undefined })).toMatchObject({
      status: 'published',
      runCount: 1,
    });
    const publicDataset = await readFile(path.join(publicDir, 'data', 'runs.json'), 'utf8');
    expect(publicDataset).not.toContain('Arc One');
    expect(publicDataset).not.toContain('Bolt Two');
    expect(publicDataset).not.toContain('Private fleet note');
  });
});
