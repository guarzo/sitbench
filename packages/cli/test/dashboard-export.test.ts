import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Archive, type RunSummary, type NormalizedEvent } from '@sitbench/core';
import { regenerateDashboardData } from '../src/dashboard-export.js';
import { runAnalyze, type AnalyzePrompts } from '../src/analyze-command.js';
import { runRecalculate } from '../src/recalculate-command.js';

let root: string;
let archiveDir: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'sitbench-dash-'));
  archiveDir = path.join(root, 'archive');
  await mkdir(archiveDir, { recursive: true });
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
    characterMetrics: [{
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
    }],
    coverage: { logFiles: 1, participantsWithOutgoingDamage: 1, unparsedCombatLines: 0, ambiguousEventsExcluded: 0, repairPairing: 'full' },
    notes: null,
    fingerprint: `fp-${id}`,
    createdAt: windowStart,
    updatedAt: windowStart,
  };
}

describe('regenerateDashboardData', () => {
  it('writes runs.json to <archive>/dashboard/data/ with mode "local"', async () => {
    const archive = new Archive(archiveDir);
    const summary = buildSummary('run-a', '2026-09-01T10:00:00.000Z');
    await archive.saveRun(summary, []);

    await regenerateDashboardData(archive, archiveDir);

    const dataPath = path.join(archiveDir, 'dashboard', 'data', 'runs.json');
    const raw = JSON.parse(await readFile(dataPath, 'utf8'));
    expect(raw.mode).toBe('local');
    expect(raw.schemaVersion).toBe(1);
    expect(raw.capabilities).toEqual({ characters: true, notes: true });
    expect(raw.runs).toHaveLength(1);
    expect(raw.runs[0].id).toBe('run-a');
  });

  it('sorts runs ascending by window start', async () => {
    const archive = new Archive(archiveDir);
    const runB = buildSummary('run-b', '2026-09-02T10:00:00.000Z');
    const runA = buildSummary('run-a', '2026-09-01T10:00:00.000Z');
    await archive.saveRun(runB, []);
    await archive.saveRun(runA, []);

    await regenerateDashboardData(archive, archiveDir);

    const dataPath = path.join(archiveDir, 'dashboard', 'data', 'runs.json');
    const raw = JSON.parse(await readFile(dataPath, 'utf8'));
    expect(raw.runs).toHaveLength(2);
    expect(raw.runs[0].id).toBe('run-a');
    expect(raw.runs[1].id).toBe('run-b');
  });

  it('writes an empty runs array when archive has no runs', async () => {
    const archive = new Archive(archiveDir);

    await regenerateDashboardData(archive, archiveDir);

    const dataPath = path.join(archiveDir, 'dashboard', 'data', 'runs.json');
    const raw = JSON.parse(await readFile(dataPath, 'utf8'));
    expect(raw.runs).toEqual([]);
  });

  it('does not include event data in the output', async () => {
    const archive = new Archive(archiveDir);
    const summary = buildSummary('run-a', '2026-09-01T10:00:00.000Z');
    // A real archived event carrying local source provenance: if the export
    // ever leaked event data, these exact keys would appear in runs.json.
    const event: NormalizedEvent = {
      kind: 'damage-dealt',
      timestamp: '2026-09-01T10:00:00.000Z',
      observedBy: 'Alpha',
      sourceFile: 'combat.txt',
      sourceLine: 42,
      raw: '[ 2026.09.01 10:00:00 ] (combat) 100 from Alpha - Hits Sleepless Guardian',
      actor: 'Alpha',
      target: 'Sleepless Guardian',
      amount: 100,
      hitQuality: null,
      targetClassification: 'npc',
    };
    await archive.saveRun(summary, [event]);

    await regenerateDashboardData(archive, archiveDir);

    const dataPath = path.join(archiveDir, 'dashboard', 'data', 'runs.json');
    const content = await readFile(dataPath, 'utf8');
    expect(content).not.toContain('"sourceFile"');
    expect(content).not.toContain('"sourceLine"');
    expect(content).not.toContain('"raw"');
    expect(content).not.toContain('combat.txt');
  });
});

describe('derivative warning accumulation', () => {
  const newestWindowPrompts: AnalyzePrompts = {
    confirmCandidate: async () => ({ action: 'accept' }),
    requestSite: async () => 'Core Bastion',
    requestProfile: async () => '8 Kikis + 2 Deacons',
    requestNotes: async () => null,
    confirmSave: async () => true,
  };

  function gameLog(character: string, lines: string[]): string {
    return ['------------------------------------------------------------', '  Gamelog', `  Listener: ${character}`, '------------------------------------------------------------', ...lines].join('\n');
  }

  it('reports saved-with-warning when injected dashboard hook throws', async () => {
    const logsDir = path.join(root, 'logs');
    await mkdir(logsDir);
    const candidatePath = path.join(logsDir, 'combat.txt');
    const clock = (): Date => new Date('2026-09-03T05:05:12.000Z');
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
    // Pin the modification time to the injected clock so this fixture stays
    // inside the recent-log window regardless of the real current date.
    await utimes(candidatePath, clock(), clock());
    const output: string[] = [];
    const result = await runAnalyze(
      { logs: logsDir, archive: archiveDir },
      {
        prompts: newestWindowPrompts,
        clock,
        write: (line) => output.push(line),
        rebuildCatalog: async () => { throw new Error('dashboard boom'); },
      },
    );

    expect(result.status).toBe('saved-with-warning');
    expect(output.join('\n')).toContain('dashboard');
  });

  it('recalculate reports warning when dashboard hook throws', async () => {
    const archive = new Archive(archiveDir);
    const event: NormalizedEvent = {
      kind: 'damage-dealt', timestamp: '2026-09-01T10:00:00.000Z', observedBy: 'Alpha',
      sourceFile: 'log.txt', sourceLine: 1, raw: 'raw', actor: 'Alpha', target: 'NPC',
      amount: 100, hitQuality: null, targetClassification: 'npc',
    };
    await archive.saveRun(buildSummary('run-a', '2026-09-01T10:00:00.000Z'), [event]);

    const result = await runRecalculate(
      { runId: 'run-a', archive: archiveDir },
      {
        write: () => undefined,
        rebuildCatalog: async () => { throw new Error('dashboard boom'); },
      },
    );

    expect(result.status).toBe('ok');
    const outcome = result.status === 'ok' ? result.outcomes[0] : undefined;
    expect(outcome?.status).toBe('recalculated-with-warning');
  });

  it('recalculate --all continues after one run fails and includes warnings', async () => {
    const archive = new Archive(archiveDir);
    const event: NormalizedEvent = {
      kind: 'damage-dealt', timestamp: '2026-09-01T10:00:00.000Z', observedBy: 'Alpha',
      sourceFile: 'log.txt', sourceLine: 1, raw: 'raw', actor: 'Alpha', target: 'NPC',
      amount: 100, hitQuality: null, targetClassification: 'npc',
    };
    await archive.saveRun(buildSummary('run-a', '2026-09-01T10:00:00.000Z'), [event]);
    await archive.saveRun(buildSummary('run-b', '2026-09-02T10:00:00.000Z'), [{ ...event, timestamp: '2026-09-02T10:00:00.000Z' }]);

    const output: string[] = [];
    const result = await runRecalculate(
      { all: true, archive: archiveDir },
      {
        write: (line) => output.push(line),
        rebuildCatalog: async () => { throw new Error('dashboard fail'); },
      },
    );

    // Both runs should be processed, both with warnings
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.outcomes).toHaveLength(2);
      expect(result.outcomes.every((o) => o.status === 'recalculated-with-warning')).toBe(true);
    }
  });

  it('recalculate warning message mentions dashboard, not catalog, when only dashboard fails', async () => {
    const archive = new Archive(archiveDir);
    const event: NormalizedEvent = {
      kind: 'damage-dealt', timestamp: '2026-09-01T10:00:00.000Z', observedBy: 'Alpha',
      sourceFile: 'log.txt', sourceLine: 1, raw: 'raw', actor: 'Alpha', target: 'NPC',
      amount: 100, hitQuality: null, targetClassification: 'npc',
    };
    await archive.saveRun(buildSummary('run-a', '2026-09-01T10:00:00.000Z'), [event]);

    const output: string[] = [];
    const result = await runRecalculate(
      { runId: 'run-a', archive: archiveDir },
      {
        write: (line) => output.push(line),
        rebuildCatalog: async () => { throw new Error('dashboard fail'); },
      },
    );

    expect(result.status).toBe('ok');
    const outcome = result.status === 'ok' ? result.outcomes[0] : undefined;
    expect(outcome?.status).toBe('recalculated-with-warning');
    // The output message must mention dashboard, not falsely say catalog
    const warningLine = output.find((l) => l.includes('dashboard'));
    expect(warningLine).toBeDefined();
    expect(warningLine).not.toContain('catalog could not be rebuilt');
  });
});
