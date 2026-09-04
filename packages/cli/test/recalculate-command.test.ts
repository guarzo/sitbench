import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Archive, calculateRun, type NormalizedEvent, type RunSummary } from '@sitbench/core';
import { runRecalculate } from '../src/recalculate-command.js';

let root: string;
let archiveDir: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'sitbench-cli-recalc-'));
  archiveDir = path.join(root, 'archive');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function buildEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    kind: 'damage-dealt',
    timestamp: '2026-09-03T04:51:14.000Z',
    observedBy: 'Dah Nee',
    sourceFile: 'Gamelogs_20260903.txt',
    sourceLine: 1,
    raw: 'raw-line',
    actor: 'Dah Nee',
    target: 'Sleepless Guardian',
    amount: 100,
    hitQuality: 'Hits',
    targetClassification: 'npc',
    ...overrides,
  } as NormalizedEvent;
}

function buildSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    schemaVersion: 1,
    parserVersion: '0.1.0',
    metricsVersion: '0.0.9-stale',
    id: '20260903T045114Z-core-bastion',
    site: { name: 'Core Bastion', key: 'core-bastion' },
    fleetProfile: { id: '8-kikis-2-deacons', name: '8 Kikis + 2 Deacons' },
    window: {
      start: '2026-09-03T04:51:14.000Z',
      end: '2026-09-03T04:53:14.000Z',
      source: 'first-and-last-outgoing-npc-damage',
      manuallyAdjusted: false,
    },
    participants: ['Dah Nee'],
    calculation: { episodeThresholdSeconds: 180, activeCombatGapSeconds: 30 },
    metrics: {
      elapsedSeconds: 999999,
      activeCombatSeconds: 999999,
      idleSeconds: 999999,
      fleetDamageDealt: 1,
      averageFleetDps: 1,
      activeFleetDps: 1,
      damageTaken: 0,
      remoteRepairDelivered: 0,
      participantCount: 999,
    },
    characterMetrics: [],
    coverage: {
      logFiles: 1,
      participantsWithOutgoingDamage: 999,
      unparsedCombatLines: 3,
      ambiguousEventsExcluded: 0,
      repairPairing: 'none',
    },
    notes: 'clean run',
    fingerprint: 'original-fingerprint',
    createdAt: '2026-09-03T05:05:12.000Z',
    updatedAt: '2026-09-03T05:05:12.000Z',
    ...overrides,
  };
}

describe('runRecalculate', () => {
  it('recomputes metrics that exactly match a fresh calculateRun call while preserving durable fields', async () => {
    const summary = buildSummary();
    const events = [
      buildEvent({ sourceLine: 1, timestamp: '2026-09-03T04:51:14.000Z', amount: 100 }),
      buildEvent({ sourceLine: 2, timestamp: '2026-09-03T04:53:14.000Z', amount: 140 }),
    ];
    const archive = new Archive(archiveDir);
    await archive.saveRun(summary, events);

    const output: string[] = [];
    const result = await runRecalculate({ runId: summary.id, archive: archiveDir }, { write: (line) => output.push(line) });

    expect(result).toMatchObject({ status: 'ok', outcomes: [{ id: summary.id, status: 'recalculated' }] });

    const reloaded = await archive.loadRun(summary.id);
    expect(reloaded).not.toBeNull();
    const expected = calculateRun(events, summary.window, summary.calculation);
    expect(reloaded?.summary.metrics).toEqual(expected.metrics);
    expect(reloaded?.summary.characterMetrics).toEqual(expected.characterMetrics);
    expect(reloaded?.summary.calculation).toEqual(expected.calculation);

    // Durable fields preserved exactly.
    expect(reloaded?.summary.window).toEqual(summary.window);
    expect(reloaded?.summary.site).toEqual(summary.site);
    expect(reloaded?.summary.fleetProfile).toEqual(summary.fleetProfile);
    expect(reloaded?.summary.notes).toBe(summary.notes);
    expect(reloaded?.summary.createdAt).toBe(summary.createdAt);
    expect(reloaded?.summary.fingerprint).toBe(summary.fingerprint);
    expect(reloaded?.summary.coverage.logFiles).toBe(summary.coverage.logFiles);
    expect(reloaded?.summary.coverage.unparsedCombatLines).toBe(summary.coverage.unparsedCombatLines);
    expect(reloaded?.summary.coverage.participantsWithOutgoingDamage).toBe(1);
    expect(reloaded?.summary.metricsVersion).toBe('0.1.0');
    expect(Date.parse(reloaded!.summary.updatedAt)).toBeGreaterThanOrEqual(Date.parse(summary.updatedAt));

    expect(output.join('\n')).toContain(`Recalculated run ${summary.id}.`);
  });

  it('recalculates every archived run with --all', async () => {
    const archive = new Archive(archiveDir);
    const first = buildSummary();
    const second = buildSummary({ id: 'run-two', fingerprint: 'fp-two' });
    await archive.saveRun(first, [buildEvent()]);
    await archive.saveRun(second, [buildEvent({ timestamp: '2026-09-03T04:52:00.000Z' })]);

    const result = await runRecalculate({ all: true, archive: archiveDir }, { write: () => undefined });

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.outcomes.map((outcome) => outcome.id).sort()).toEqual([first.id, second.id].sort());
      expect(result.outcomes.every((outcome) => outcome.status === 'recalculated')).toBe(true);
    }
  });

  it('rejects providing both a run id and --all', async () => {
    const result = await runRecalculate({ runId: 'some-id', all: true, archive: archiveDir }, { write: () => undefined });
    expect(result).toMatchObject({ status: 'fatal', reason: 'conflicting-target' });
  });

  it('rejects providing neither a run id nor --all', async () => {
    const result = await runRecalculate({ archive: archiveDir }, { write: () => undefined });
    expect(result).toMatchObject({ status: 'fatal', reason: 'missing-target' });
  });

  it('reports a not-found outcome without creating anything for an unknown run id', async () => {
    const result = await runRecalculate({ runId: 'does-not-exist', archive: archiveDir }, { write: () => undefined });
    expect(result).toMatchObject({ status: 'ok', outcomes: [{ id: 'does-not-exist', status: 'not-found' }] });
  });

  it('reports an incompatible outcome and leaves the run untouched when archived events fail the current strict schema', async () => {
    const runDir = path.join(archiveDir, 'runs', 'legacy-run');
    await mkdir(runDir, { recursive: true });
    const legacySummary = buildSummary({ id: 'legacy-run', fingerprint: 'legacy-fingerprint' });
    const legacyRunJson = `${JSON.stringify(legacySummary, null, 2)}\n`;
    // Legacy event carries an unknown extra field that the current strict
    // schema rejects — simulating archived data from an older parser version.
    const legacyEventLine = `${JSON.stringify({ ...buildEvent(), legacyExtraField: 'unsupported' })}\n`;
    await writeFile(path.join(runDir, 'run.json'), legacyRunJson, 'utf8');
    await writeFile(path.join(runDir, 'events.jsonl'), legacyEventLine, 'utf8');

    const result = await runRecalculate({ runId: 'legacy-run', archive: archiveDir }, { write: () => undefined });

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.outcomes).toHaveLength(1);
      expect(result.outcomes[0]).toMatchObject({ id: 'legacy-run', status: 'incompatible' });
    }

    const rawAfter = await readFile(path.join(runDir, 'run.json'), 'utf8');
    expect(rawAfter).toBe(legacyRunJson);
  });

  it('reports an error outcome without mutating a locked archive', async () => {
    const archive = new Archive(archiveDir);
    const summary = buildSummary();
    await archive.saveRun(summary, [buildEvent()]);
    await mkdir(path.join(archiveDir, '.lock'));

    const result = await runRecalculate({ runId: summary.id, archive: archiveDir }, { write: () => undefined });

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.outcomes[0]?.status).toBe('error');
    }

    const rawRunJson = await readFile(path.join(archiveDir, 'runs', summary.id, 'run.json'), 'utf8');
    expect(JSON.parse(rawRunJson)).toEqual(summary);
  });
});
