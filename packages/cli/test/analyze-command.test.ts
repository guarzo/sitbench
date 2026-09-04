import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Archive, RUN_ID_PATTERN, type RunSummary } from '@sitbench/core';
import { runAnalyze, type AnalyzePrompts } from '../src/analyze-command.js';

let root: string;
let logsDir: string;
let archiveDir: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'sitbench-cli-'));
  logsDir = path.join(root, 'logs');
  archiveDir = path.join(root, 'archive');
  await mkdir(logsDir);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const newestWindowPrompts: AnalyzePrompts = {
  confirmCandidate: async () => ({ action: 'accept' }),
  requestSite: async () => 'Core Bastion',
  requestProfile: async () => '8 Kikis + 2 Deacons',
  requestNotes: async () => 'clean second room',
  confirmSave: async () => true,
};

function gameLog(character: string, lines: string[]): string {
  return ['------------------------------------------------------------', '  Gamelog', `  Listener: ${character}`, '------------------------------------------------------------', ...lines].join('\n');
}

async function writeCandidateLog(): Promise<void> {
  const candidatePath = path.join(logsDir, 'combat.txt');
  await writeFile(
    candidatePath,
    gameLog('Dah Nee', [
      '[ 2026.09.03 04:00:00 ] (combat) 100 from Dah Nee[Example] - Heavy Entropic Disintegrator II - Hits Sleepless Guardian',
      '[ 2026.09.03 04:00:20 ] (combat) 120 from Dah Nee[Example] - Heavy Entropic Disintegrator II - Hits Sleepless Guardian',
      '[ 2026.09.03 04:04:00 ] (combat) 130 from Dah Nee[Example] - Heavy Entropic Disintegrator II - Hits Sleepless Guardian',
      '[ 2026.09.03 04:04:20 ] (combat) 140 from Dah Nee[Example] - Heavy Entropic Disintegrator II - Hits Sleepless Guardian',
    ]),
    'utf8',
  );
  // Pin the modification time to the injected clock so recency is decided by
  // the fixture, never by the real wall clock the suite happens to run at.
  await utimes(candidatePath, fixedClock(), fixedClock());
}

function fixedClock(): Date {
  return new Date('2026-09-03T05:05:12.000Z');
}

async function saveMatchingHistoricalRun(): Promise<void> {
  const archive = new Archive(archiveDir);
  const historical: RunSummary = {
    schemaVersion: 1,
    parserVersion: '0.1.0',
    metricsVersion: '0.1.0',
    id: '20260903T030000Z-core-bastion',
    site: { name: 'Core Bastion', key: 'core-bastion' },
    fleetProfile: { id: '8-kikis-2-deacons', name: '8 Kikis + 2 Deacons' },
    window: {
      start: '2026-09-03T03:00:00.000Z',
      end: '2026-09-03T03:02:00.000Z',
      source: 'manual',
      manuallyAdjusted: true,
    },
    participants: [],
    calculation: { episodeThresholdSeconds: 180, activeCombatGapSeconds: 30 },
    metrics: {
      elapsedSeconds: 120,
      activeCombatSeconds: 100,
      idleSeconds: 20,
      fleetDamageDealt: 1000,
      averageFleetDps: 8.33,
      activeFleetDps: 10,
      damageTaken: 0,
      remoteRepairDelivered: 0,
      participantCount: 1,
    },
    characterMetrics: [],
    coverage: {
      logFiles: 1,
      participantsWithOutgoingDamage: 1,
      unparsedCombatLines: 0,
      ambiguousEventsExcluded: 0,
      repairPairing: 'none',
    },
    notes: null,
    fingerprint: 'historical-fingerprint',
    createdAt: '2026-09-03T03:05:00.000Z',
    updatedAt: '2026-09-03T03:05:00.000Z',
  };
  await archive.saveRun(historical, []);
}

class CountingArchive extends Archive {
  saves = 0;
  catalogRebuilds = 0;

  override async saveRun(summary: RunSummary, events: Parameters<Archive['saveRun']>[1]): Promise<RunSummary> {
    this.saves += 1;
    return super.saveRun(summary, events);
  }

  override async rebuildCatalog() {
    this.catalogRebuilds += 1;
    return super.rebuildCatalog();
  }
}

describe('runAnalyze', () => {
  it('saves the newest candidate with supplied metadata and reports a matching previous run', async () => {
    await writeCandidateLog();
    await saveMatchingHistoricalRun();
    const output: string[] = [];

    const result = await runAnalyze(
      { logs: logsDir, archive: archiveDir },
      { prompts: newestWindowPrompts, clock: fixedClock, write: (line) => output.push(line) },
    );

    expect(result.status).toBe('saved');
    const runs = await new Archive(archiveDir).listRuns();
    expect(runs).toHaveLength(2);
    const saved = runs.find((run) => run.id === '20260903T050512Z-core-bastion');
    expect(saved).toMatchObject({
      notes: 'clean second room',
      createdAt: '2026-09-03T05:05:12.000Z',
      calculation: { episodeThresholdSeconds: 180, activeCombatGapSeconds: 30 },
      window: {
        start: '2026-09-03T04:04:00.000Z',
        end: '2026-09-03T04:04:20.000Z',
        manuallyAdjusted: false,
      },
    });
    expect(output.join('\n')).toContain('Previous run: 120.0s');
  });

  it('uses an ASCII-safe run id when a site canonical key contains Unicode', async () => {
    await writeCandidateLog();

    const result = await runAnalyze(
      { logs: logsDir, archive: archiveDir, site: 'Ø Site' },
      { prompts: newestWindowPrompts, clock: fixedClock, write: () => undefined },
    );

    expect(result.status).toBe('saved');
    if (result.status === 'saved') {
      expect(result.id).toMatch(RUN_ID_PATTERN);
    }
  });

  it('does not trigger a second catalog rebuild by default, but runs an injected post-save hook', async () => {
    await writeCandidateLog();
    const defaultArchive = new CountingArchive(archiveDir);

    const defaultResult = await runAnalyze(
      { logs: logsDir, archive: archiveDir },
      { prompts: newestWindowPrompts, clock: fixedClock, write: () => undefined, createArchive: () => defaultArchive },
    );

    expect(defaultResult.status).toBe('saved');
    expect(defaultArchive.saves).toBe(1);
    expect(defaultArchive.catalogRebuilds).toBe(0);

    const hookedArchiveDir = path.join(root, 'hooked-archive');
    const hookedArchive = new CountingArchive(hookedArchiveDir);
    let injectedHookCalls = 0;
    const hookedResult = await runAnalyze(
      { logs: logsDir, archive: hookedArchiveDir },
      {
        prompts: newestWindowPrompts,
        clock: fixedClock,
        write: () => undefined,
        createArchive: () => hookedArchive,
        rebuildCatalog: async () => {
          injectedHookCalls += 1;
        },
      },
    );

    expect(hookedResult.status).toBe('saved');
    expect(hookedArchive.saves).toBe(1);
    expect(hookedArchive.catalogRebuilds).toBe(0);
    expect(injectedHookCalls).toBe(1);
  });

  it('does not report previous-run data when the archive has no matching history', async () => {
    await writeCandidateLog();
    const output: string[] = [];

    await runAnalyze(
      { logs: logsDir, archive: archiveDir },
      { prompts: newestWindowPrompts, clock: fixedClock, write: (line) => output.push(line) },
    );

    expect(output.join('\n')).not.toContain('Previous run:');
  });

  it.each([
    {
      name: 'no outgoing NPC damage',
      log: gameLog('Dah Nee', ['[ 2026.09.03 04:00:00 ] (combat) 100 from Dah Nee[Example] - Heavy Entropic Disintegrator II - Hits Mobile Tractor Unit']),
      prompts: newestWindowPrompts,
    },
    {
      name: 'empty site',
      log: null,
      prompts: { ...newestWindowPrompts, requestSite: async () => '   ' },
    },
    {
      name: 'empty profile',
      log: null,
      prompts: { ...newestWindowPrompts, requestProfile: async () => '' },
    },
    {
      name: 'invalid adjusted window',
      log: null,
      prompts: {
        ...newestWindowPrompts,
        confirmCandidate: async () => ({
          action: 'adjust',
          start: '2026-09-03T04:04:20.000Z',
          end: '2026-09-03T04:04:00.000Z',
        }),
      },
    },
  ])('does not mutate the archive for $name', async ({ log, prompts }) => {
    await writeCandidateLog();
    if (log !== null) {
      await writeFile(path.join(logsDir, 'combat.txt'), log, 'utf8');
    }

    const result = await runAnalyze(
      { logs: logsDir, archive: archiveDir },
      { prompts, clock: fixedClock, write: () => undefined },
    );

    expect(result.status).toBe('fatal');
    expect(await new Archive(archiveDir).listRuns()).toEqual([]);
  });

  it('reports coverage diagnostics and unsupported-NPC guidance when no candidate episode is found', async () => {
    // Every outgoing damage line here targets a name the conservative
    // classifier cannot confirm as an NPC, so it is preserved as
    // 'ambiguous' and never qualifies for episode detection. The
    // no-candidate path must say so explicitly instead of implying the
    // fleet dealt no damage.
    await writeFile(
      path.join(logsDir, 'combat.txt'),
      gameLog('Dah Nee', [
        '[ 2026.09.03 04:00:00 ] (combat) 100 from Dah Nee[Example] - Heavy Entropic Disintegrator II - Hits Unlisted Rogue Drone',
        '[ 2026.09.03 04:00:20 ] (combat) 120 from Dah Nee[Example] - Heavy Entropic Disintegrator II - Hits Unlisted Rogue Drone',
        '[ 2026.09.03 04:00:30 ] (combat) something entirely unrecognized',
      ]),
      'utf8',
    );
    const output: string[] = [];

    const result = await runAnalyze(
      { logs: logsDir, archive: archiveDir },
      { prompts: newestWindowPrompts, clock: fixedClock, write: (line) => output.push(line) },
    );

    expect(result).toMatchObject({ status: 'fatal', reason: 'no-outgoing-npc-damage' });
    expect(await new Archive(archiveDir).listRuns()).toEqual([]);
    const text = output.join('\n');
    expect(text).toContain('Coverage: 1 log file(s) inspected');
    expect(text).toContain('1 unparsed combat line(s)');
    expect(text).toContain('2 ambiguous event(s) excluded from qualifying analysis');
    expect(text).toContain('not yet supported by NPC classification');
  });

  it('skips log files outside the recent window even when --logs is explicit, and reports inspected/skipped counts', async () => {
    await writeCandidateLog();
    const stalePath = path.join(logsDir, 'stale.txt');
    await writeFile(
      stalePath,
      gameLog('Old Pilot', [
        '[ 2026.08.01 04:00:00 ] (combat) 999 from Old Pilot[Example] - Heavy Entropic Disintegrator II - Hits Sleepless Guardian',
      ]),
      'utf8',
    );
    // Older than the recent-log window relative to the injected clock.
    const staleMtime = new Date(fixedClock().getTime() - 30 * 24 * 60 * 60 * 1000);
    await utimes(stalePath, staleMtime, staleMtime);
    const output: string[] = [];

    const result = await runAnalyze(
      { logs: logsDir, archive: archiveDir },
      { prompts: newestWindowPrompts, clock: fixedClock, write: (line) => output.push(line) },
    );

    expect(result.status).toBe('saved');
    const text = output.join('\n');
    expect(text).toContain('Coverage: 1 log file(s) inspected');
    expect(text).toContain('1 skipped');
    const runs = await new Archive(archiveDir).listRuns();
    expect(runs[0]?.coverage.logFiles).toBe(1);
    // The stale file's episode must never appear in the candidate window.
    expect(runs[0]?.window.start).toBe('2026-09-03T04:04:00.000Z');
  });

  it('rejects an adjusted window that Date.parse accepts but the persisted ISO contract does not', async () => {
    await writeCandidateLog();
    const output: string[] = [];

    const result = await runAnalyze(
      { logs: logsDir, archive: archiveDir },
      {
        prompts: {
          ...newestWindowPrompts,
          confirmCandidate: async () => ({
            action: 'adjust',
            // Date.parse understands these; RunWindowSchema does not, so the
            // command boundary must reject them itself rather than letting
            // them reach Archive/Zod.
            start: '2026-09-03 04:00',
            end: '2026-09-03 05:00',
          }),
        },
        clock: fixedClock,
        write: (line) => output.push(line),
      },
    );

    expect(result).toMatchObject({ status: 'fatal', reason: 'invalid-window' });
    expect(await new Archive(archiveDir).listRuns()).toEqual([]);
  });

  it('does not add another run when the confirmed fingerprint already exists', async () => {
    await writeCandidateLog();
    const first = await runAnalyze(
      { logs: logsDir, archive: archiveDir },
      { prompts: newestWindowPrompts, clock: fixedClock, write: () => undefined },
    );

    const second = await runAnalyze(
      { logs: logsDir, archive: archiveDir },
      { prompts: newestWindowPrompts, clock: () => new Date('2026-09-03T05:06:12.000Z'), write: () => undefined },
    );

    expect(first.status).toBe('saved');
    expect(second).toMatchObject({ status: 'fatal', reason: 'duplicate' });
    expect(await new Archive(archiveDir).listRuns()).toHaveLength(1);
  });

  it('reports a locked archive without creating a run', async () => {
    await writeCandidateLog();
    await mkdir(archiveDir, { recursive: true });
    await mkdir(path.join(archiveDir, '.lock'));
    const output: string[] = [];

    const result = await runAnalyze(
      { logs: logsDir, archive: archiveDir },
      { prompts: newestWindowPrompts, clock: fixedClock, write: (line) => output.push(line) },
    );

    expect(result).toMatchObject({ status: 'fatal', reason: 'locked' });
    expect(output.join('\n')).toContain('archive is locked');
    expect(await new Archive(archiveDir).listRuns()).toEqual([]);
  });

  it('reports catalog generation failure after preserving the authoritative run', async () => {
    await writeCandidateLog();
    await mkdir(archiveDir, { recursive: true });
    await mkdir(path.join(archiveDir, 'catalog.json'));
    const output: string[] = [];

    const result = await runAnalyze(
      { logs: logsDir, archive: archiveDir },
      { prompts: newestWindowPrompts, clock: fixedClock, write: (line) => output.push(line) },
    );

    expect(result).toMatchObject({ status: 'saved-with-warning', reason: 'catalog' });
    expect(await new Archive(archiveDir).listRuns()).toHaveLength(1);
    expect(output.join('\n')).toContain('catalog could not be rebuilt');
  });

  it('warns for manual adjustment and partial participation while preserving the run', async () => {
    await writeCandidateLog();
    await writeFile(
      path.join(logsDir, 'repair.txt'),
      gameLog('Logistics Pilot', ['[ 2026.09.03 04:04:10 ] (combat) 280 remote armor repaired to Dah Nee by Logistics Pilot']),
      'utf8',
    );
    const output: string[] = [];
    const prompts: AnalyzePrompts = {
      ...newestWindowPrompts,
      confirmCandidate: async () => ({
        action: 'adjust',
        start: '2026-09-03T04:03:55.000Z',
        end: '2026-09-03T04:04:25.000Z',
      }),
    };

    const result = await runAnalyze(
      { logs: logsDir, archive: archiveDir },
      { prompts, clock: fixedClock, write: (line) => output.push(line) },
    );

    expect(result.status).toBe('saved');
    expect(output.join('\n')).toContain('Warning: window was manually adjusted.');
    expect(output.join('\n')).toContain('Warning: partial participation detected.');
    expect(JSON.parse(await readFile(path.join(archiveDir, 'config.json'), 'utf8'))).toMatchObject({ gameLogDir: logsDir });
  });
});
