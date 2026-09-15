import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Archive, calculateRun, fingerprintRun, normalizeLogFile, type RunSummary } from '@sitbench/core';
import { runBackfill } from '../src/backfill-command.js';
import { runRecalculate } from '../src/recalculate-command.js';
import { runEdit } from '../src/edit-command.js';

let root: string;
let archiveDir: string;
let logs: string;
const quiet = { write: () => undefined };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'sitbench-backfill-'));
  archiveDir = path.join(root, 'archive');
  logs = path.join(root, 'logs');
  await mkdir(logs);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

function neut(time: string, amount: number): string {
  return `[ 2026.09.03 ${time} ] (combat) <color=0xffe57f7f><b>${amount} GJ</b><color=0x77ffffff><font size=10> energy neutralized </font><b><color=0xffffffff>Sleepless Keeper</b><color=0x77ffffff><font size=10> - Sleepless Keeper</font>`;
}
function text(character: string, withNeuts: boolean): string {
  return [
    'Gamelog', `Listener: ${character}`,
    ...(withNeuts ? [neut('03:59:59', 999)] : []),
    '[ 2026.09.03 04:00:00 ] (combat) 100 to Sleepless Keeper - Laser - Hits',
    ...(withNeuts ? [neut('04:00:00', 120), neut('04:00:05', 180), neut('04:00:05', 30), neut('04:00:10', 60)] : []),
    '[ 2026.09.03 04:00:20 ] (combat) 100 to Sleepless Keeper - Laser - Hits',
    ...(withNeuts ? [neut('04:00:21', 999)] : []),
    '',
  ].join('\r\n');
}
async function seed(id = 'historical-run'): Promise<{ archive: Archive; summary: RunSummary }> {
  const events = [];
  for (const character of ['Alpha', 'Beta']) {
    const sourceFile = `${character}.txt`;
    const contents = text(character, character === 'Alpha');
    await writeFile(path.join(logs, sourceFile), contents);
    // Model an archive produced before neut parsing existed.
    events.push(...normalizeLogFile({ text: contents, sourceFile }).events.filter((event) => event.kind === 'damage-dealt'));
  }
  const window = { start: '2026-09-03T04:00:00.000Z', end: '2026-09-03T04:00:20.000Z', source: 'outgoing-npc-damage', manuallyAdjusted: false };
  const calculated = calculateRun(events, window);
  const summary: RunSummary = {
    schemaVersion: 1, parserVersion: '0.2.0', metricsVersion: '0.1.0', id,
    site: { name: 'Core Citadel', key: 'core-citadel' }, fleetProfile: { id: 'duo', name: 'Duo' },
    window, participants: ['Alpha', 'Beta'], ...calculated,
    coverage: { logFiles: 2, participantsWithOutgoingDamage: 2, unparsedCombatLines: 10, ambiguousEventsExcluded: 0, repairPairing: 'none' },
    notes: 'Keep this note', fingerprint: fingerprintRun(events, window),
    createdAt: '2026-09-03T05:00:00.000Z', updatedAt: '2026-09-03T05:00:00.000Z',
  };
  const archive = new Archive(archiveDir);
  await archive.saveRun(summary, events);
  return { archive, summary };
}
async function snapshot(id = 'historical-run'): Promise<string[]> {
  return Promise.all(['run.json', 'events.jsonl'].map((name) => readFile(path.join(archiveDir, 'runs', id, name), 'utf8')));
}

describe('runBackfill', () => {
  it('adds only in-window neut evidence from original logs and preserves the historical run', async () => {
    const { archive, summary } = await seed();
    const before = await archive.loadRun(summary.id);
    const originalLog = await readFile(path.join(logs, 'Alpha.txt'), 'utf8');
    const result = await runBackfill({ runId: summary.id, archive: archiveDir, logs }, quiet);
    expect(result).toMatchObject({ status: 'ok', outcomes: [{ status: 'backfilled', eventCount: 4 }] });
    const after = (await archive.loadRun(summary.id))!;
    expect(after.events.filter((event) => event.kind !== 'neut-received')).toEqual(before!.events);
    expect(after.events.filter((event) => event.kind === 'neut-received')).toHaveLength(4);
    expect(after.summary).toMatchObject({
      id: summary.id, createdAt: summary.createdAt, parserVersion: summary.parserVersion,
      site: summary.site, fleetProfile: summary.fleetProfile, notes: summary.notes, window: summary.window,
      metrics: summary.metrics, calculation: summary.calculation,
      coverage: { ...summary.coverage, neutPressure: 'recorded' },
    });
    expect(after.summary.characterMetrics[0]?.neutPressure).toEqual({ totalGj: 390, eventCount: 4, averageGjPerSecond: 19.5, peak10sGjPerSecond: 33 });
    expect(after.summary.characterMetrics[1]?.neutPressure).toEqual({ totalGj: 0, eventCount: 0, averageGjPerSecond: 0, peak10sGjPerSecond: 0 });
    expect(after.summary.fingerprint).not.toBe(summary.fingerprint);
    expect(await readFile(path.join(logs, 'Alpha.txt'), 'utf8')).toBe(originalLog);
    await runRecalculate({ runId: summary.id, archive: archiveDir }, quiet);
    expect((await archive.loadRun(summary.id))!.summary.characterMetrics).toEqual(after.summary.characterMetrics);
  });

  it('dry-runs without changing archive bytes, then skips already-recorded runs without changing them', async () => {
    const { summary } = await seed();
    const before = await snapshot();
    expect(await runBackfill({ all: true, dryRun: true, archive: archiveDir, logs }, quiet))
      .toMatchObject({ status: 'ok', outcomes: [{ status: 'ready', eventCount: 4 }] });
    expect(await snapshot()).toEqual(before);
    await runBackfill({ all: true, archive: archiveDir, logs }, quiet);
    const recorded = await snapshot();
    expect(await runBackfill({ runId: summary.id, archive: archiveDir, logs }, quiet))
      .toMatchObject({ status: 'ok', outcomes: [{ status: 'already-recorded' }] });
    expect(await snapshot()).toEqual(recorded);
  });

  it('skips a recorded run even when the original logs are no longer available', async () => {
    await seed();
    await runBackfill({ all: true, archive: archiveDir, logs }, quiet);
    const before = await snapshot();
    await rm(logs, { recursive: true });
    expect(await runBackfill({ all: true, archive: archiveDir, logs }, quiet))
      .toMatchObject({ status: 'ok', outcomes: [{ status: 'already-recorded' }] });
    expect(await snapshot()).toEqual(before);
  });

  it('includes a character recovered from retained source evidence after a window shrink', async () => {
    const { archive, summary } = await seed();
    const contents = [
      'Listener: Gamma',
      '[ 2026.09.03 04:00:00 ] (combat) 100 to Sleepless Keeper - Laser - Hits',
      neut('04:00:05', 120),
    ].join('\n');
    await writeFile(path.join(logs, 'Gamma.txt'), contents);
    const oldGammaEvents = normalizeLogFile({ text: contents, sourceFile: 'Gamma.txt' }).events.filter((event) => event.kind === 'damage-dealt');
    await archive.updateRun(summary.id, ({ summary: current, events }) => ({ summary: current, events: [...events, ...oldGammaEvents] }));
    await runRecalculate({ all: true, archive: archiveDir }, quiet);
    await runEdit({ runId: summary.id, archive: archiveDir }, {
      ...quiet, prompts: {
        requestSite: async (current) => current,
        requestProfile: async (_profiles, current) => current,
        requestNotes: async (current) => current,
        requestWindow: async (current) => ({ action: 'adjust', start: '2026-09-03T04:00:05.000Z', end: current.end }),
        confirmSave: async () => true,
      },
    });
    expect((await archive.loadRun(summary.id))!.summary.participants).not.toContain('Gamma');
    expect(await runBackfill({ all: true, archive: archiveDir, logs }, quiet)).toMatchObject({ status: 'ok' });
    const after = (await archive.loadRun(summary.id))!.summary;
    expect(after.characterMetrics.find((metric) => metric.character === 'Gamma')).toMatchObject({ damageDealt: 0, neutPressure: { totalGj: 120, eventCount: 1 } });
    expect(after.participants).toContain('Gamma');
    expect(after.metrics.participantCount).toBe(3);
  });

  it.each(['missing', 'changed', 'wrong-listener', 'truncated'] as const)('leaves the whole run untouched when a required log is %s', async (fault) => {
    await seed();
    const before = await snapshot();
    const file = path.join(logs, 'Beta.txt');
    const original = await readFile(file, 'utf8');
    if (fault === 'missing') await rm(file);
    if (fault === 'changed') await writeFile(file, original.replace('100 to', '999 to'));
    if (fault === 'wrong-listener') await writeFile(file, original.replace('Listener: Beta', 'Listener: Stranger'));
    if (fault === 'truncated') await writeFile(file, original.split('\r\n').slice(0, 3).join('\r\n'));
    const result = await runBackfill({ all: true, archive: archiveDir, logs }, quiet);
    expect(result).toMatchObject({ status: 'partial', outcomes: [{ status: 'error' }] });
    expect(await snapshot()).toEqual(before);
  });

  it('rejects source path traversal and symlinks outside the chosen logs directory', async () => {
    const { archive, summary } = await seed();
    const outside = path.join(root, 'outside.txt');
    await writeFile(outside, text('Beta', false));
    await rm(path.join(logs, 'Beta.txt'));
    await symlink(outside, path.join(logs, 'Beta.txt'));
    const before = await snapshot();
    expect(await runBackfill({ all: true, archive: archiveDir, logs }, quiet)).toMatchObject({ status: 'partial' });
    expect(await snapshot()).toEqual(before);
    await archive.updateRun(summary.id, ({ summary: current, events }) => ({ summary: current, events: events.map((event) => ({ ...event, sourceFile: '../outside.txt' })) }));
    const traversing = await snapshot();
    expect(await runBackfill({ all: true, archive: archiveDir, logs }, quiet)).toMatchObject({ status: 'partial' });
    expect(await snapshot()).toEqual(traversing);
  });

  it('loads the configured logs directory and does not apply recent-log discovery limits', async () => {
    await seed();
    await writeFile(path.join(archiveDir, 'config.json'), JSON.stringify({ gameLogDir: logs }));
    expect(await runBackfill({ all: true, archive: archiveDir }, quiet)).toMatchObject({ status: 'ok', outcomes: [{ status: 'backfilled' }] });
  });

  it('leaves legacy neut metrics unavailable after ordinary recalculation', async () => {
    const { archive, summary } = await seed();
    await runRecalculate({ runId: summary.id, archive: archiveDir }, quiet);
    const after = (await archive.loadRun(summary.id))!;
    expect(after.summary.coverage.neutPressure).toBeUndefined();
    expect(after.summary.characterMetrics.every((metric) => metric.neutPressure === undefined)).toBe(true);
  });

  it.each([['04:00:10.000Z', true, 390], ['04:00:21.000Z', false, undefined]] as const)(
    'preserves recorded neuts only for window edits contained in the recorded window (%s)', async (end, available, totalGj) => {
      const { archive, summary } = await seed();
      await runBackfill({ all: true, archive: archiveDir, logs }, quiet);
      const evidence = (await archive.loadRun(summary.id))!.events;
      expect(await runEdit({ runId: summary.id, archive: archiveDir }, {
        ...quiet,
        prompts: {
          requestSite: async (current) => current,
          requestProfile: async (_profiles, current) => current,
          requestNotes: async (current) => current,
          requestWindow: async (current) => ({ action: 'adjust', start: current.start, end: `2026-09-03T${end}` }),
          confirmSave: async () => true,
        },
      })).toMatchObject({ status: 'updated' });
      const after = (await archive.loadRun(summary.id))!;
      expect(after.summary.coverage.neutPressure).toBe(available ? 'recorded' : undefined);
      expect(after.summary.characterMetrics[0]?.neutPressure?.totalGj).toBe(totalGj);
      expect(after.events).toEqual(evidence);
      if (!available) {
        await runBackfill({ all: true, archive: archiveDir, logs }, quiet);
        expect((await archive.loadRun(summary.id))!.summary.characterMetrics[0]?.neutPressure?.totalGj).toBe(1389);
      }
    },
  );

  it('reports a dashboard failure as a warning after persisting the authoritative backfill', async () => {
    const { archive, summary } = await seed();
    const result = await runBackfill({ all: true, archive: archiveDir, logs }, {
      ...quiet, rebuildCatalog: async () => { throw new Error('dashboard unavailable'); },
    });
    expect(result).toMatchObject({ status: 'ok', outcomes: [{ status: 'backfilled-with-warning', reason: expect.stringContaining('dashboard unavailable') }] });
    expect((await archive.loadRun(summary.id))!.summary.coverage.neutPressure).toBe('recorded');
  });

  it('continues a mixed batch while leaving a run with missing logs untouched', async () => {
    const { archive, summary } = await seed();
    const original = (await archive.loadRun(summary.id))!;
    await archive.saveRun({ ...summary, id: 'missing-run', fingerprint: 'missing-fingerprint' },
      original.events.map((event) => ({ ...event, sourceFile: 'missing.txt' })));
    const before = await snapshot('missing-run');
    const result = await runBackfill({ all: true, archive: archiveDir, logs }, quiet);
    expect(result).toMatchObject({ status: 'partial' });
    if (result.status === 'fatal') throw new Error('Expected per-run outcomes');
    expect(result.outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: summary.id, status: 'backfilled' }),
      expect.objectContaining({ id: 'missing-run', status: 'error' }),
    ]));
    expect(await snapshot('missing-run')).toEqual(before);
  });

  it('refuses to overwrite a concurrent change made after the source snapshot was read', async () => {
    const { archive, summary } = await seed();
    class ConcurrentArchive extends Archive {
      override async updateRun(...args: Parameters<Archive['updateRun']>): Promise<RunSummary> {
        await super.updateRun(args[0], ({ summary: current, events }) => ({ summary: { ...current, notes: 'Concurrent note' }, events }));
        return super.updateRun(...args);
      }
    }
    const result = await runBackfill({ all: true, archive: archiveDir, logs }, {
      ...quiet, createArchive: (directory) => new ConcurrentArchive(directory),
    });
    expect(result).toMatchObject({ status: 'partial', outcomes: [{ status: 'error', reason: expect.stringContaining('run changed') }] });
    const after = (await archive.loadRun(summary.id))!;
    expect(after.summary.notes).toBe('Concurrent note');
    expect(after.summary.coverage.neutPressure).toBeUndefined();
    expect(after.events.every((event) => event.kind !== 'neut-received')).toBe(true);
  });

  it('reports catalog failure after a successful backfill and still attempts dashboard regeneration', async () => {
    const { archive, summary } = await seed();
    const catalog = path.join(archiveDir, 'catalog.json');
    await rm(catalog);
    await mkdir(catalog);
    const result = await runBackfill({ all: true, archive: archiveDir, logs }, {
      ...quiet, rebuildCatalog: async () => { throw new Error('dashboard also failed'); },
    });
    expect(result).toMatchObject({ status: 'ok', outcomes: [{ status: 'backfilled-with-warning', reason: expect.stringContaining('catalog:') }] });
    if (result.status === 'fatal') throw new Error('Expected per-run outcomes');
    expect(result.outcomes[0]).toMatchObject({ reason: expect.stringContaining('dashboard also failed') });
    expect((await archive.loadRun(summary.id))!.summary.coverage.neutPressure).toBe('recorded');
  });

  it('rejects ambiguous targets and reports an unknown run without creating it', async () => {
    expect(await runBackfill({ all: true, runId: 'x', archive: archiveDir, logs }, quiet)).toMatchObject({ status: 'fatal', reason: 'conflicting-target' });
    expect(await runBackfill({ archive: archiveDir, logs }, quiet)).toMatchObject({ status: 'fatal', reason: 'missing-target' });
    expect(await runBackfill({ runId: 'unknown', archive: archiveDir, logs }, quiet)).toMatchObject({ status: 'partial', outcomes: [{ status: 'not-found' }] });
  });
});
