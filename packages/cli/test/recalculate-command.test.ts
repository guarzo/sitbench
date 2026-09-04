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
    // Coverage is ingestion provenance and must be preserved wholesale, not
    // recomputed from the (differently-scoped) windowed events.
    expect(reloaded?.summary.coverage).toEqual(summary.coverage);
    expect(reloaded?.summary.metricsVersion).toBe('0.1.0');
    expect(Date.parse(reloaded!.summary.updatedAt)).toBeGreaterThanOrEqual(Date.parse(summary.updatedAt));

    expect(output.join('\n')).toContain(`Recalculated run ${summary.id}.`);
  });

  it('preserves coverage wholesale as ingestion provenance rather than recomputing it from windowed events', async () => {
    const summary = buildSummary({
      coverage: {
        logFiles: 2,
        participantsWithOutgoingDamage: 3,
        unparsedCombatLines: 5,
        ambiguousEventsExcluded: 7,
        repairPairing: 'full',
      },
    });
    const archive = new Archive(archiveDir);
    await archive.saveRun(summary, [buildEvent()]);

    await runRecalculate({ runId: summary.id, archive: archiveDir }, { write: () => undefined });

    const reloaded = await archive.loadRun(summary.id);
    expect(reloaded?.summary.coverage).toEqual(summary.coverage);
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

  it('recalculates every valid run and reports a partial status for a mixed batch under --all', async () => {
    const archive = new Archive(archiveDir);
    const validSummary = buildSummary();
    await archive.saveRun(validSummary, [buildEvent()]);

    // A legacy run whose run.json itself fails the current strict
    // RunSummarySchema (an extra unknown field) — the exact case that made
    // `archive.listRuns()` throw and block enumeration of every other run.
    const legacyDir = path.join(archiveDir, 'runs', 'legacy-run');
    await mkdir(legacyDir, { recursive: true });
    const legacyRunJson = { ...buildSummary({ id: 'legacy-run', fingerprint: 'legacy-fingerprint' }), legacyExtraField: 'unsupported' };
    await writeFile(path.join(legacyDir, 'run.json'), `${JSON.stringify(legacyRunJson, null, 2)}\n`, 'utf8');
    await writeFile(path.join(legacyDir, 'events.jsonl'), `${JSON.stringify(buildEvent())}\n`, 'utf8');

    const result = await runRecalculate({ all: true, archive: archiveDir }, { write: () => undefined });

    expect(result.status).toBe('partial');
    if (result.status === 'partial') {
      expect(result.outcomes).toHaveLength(2);
      // The valid run's own recalculation succeeds and persists — the
      // legacy sibling's id/fingerprint are intact, so duplicate-fingerprint
      // enforcement can still proceed — but the legacy sibling's summary
      // still fails the current strict schema, so the derived catalog.json
      // rebuild that follows the successful write fails, surfacing as a
      // warning rather than silently omitting the legacy run from the
      // catalog or blocking the valid run's own update.
      expect(result.outcomes.find((outcome) => outcome.id === validSummary.id)).toMatchObject({
        status: 'recalculated-with-warning',
      });
      expect(result.outcomes.find((outcome) => outcome.id === 'legacy-run')).toMatchObject({ status: 'incompatible' });
    }

    // The valid run was still recalculated even though enumeration also found
    // an incompatible one; the incompatible one's run.json is untouched.
    const reloadedValid = await archive.loadRun(validSummary.id);
    expect(reloadedValid?.summary.metricsVersion).toBe('0.1.0');
  });

  it('reports a partial status when every requested run in a batch is incompatible', async () => {
    for (const id of ['legacy-one', 'legacy-two']) {
      const legacyDir = path.join(archiveDir, 'runs', id);
      await mkdir(legacyDir, { recursive: true });
      const legacyRunJson = { ...buildSummary({ id, fingerprint: `fp-${id}` }), legacyExtraField: 'unsupported' };
      await writeFile(path.join(legacyDir, 'run.json'), `${JSON.stringify(legacyRunJson, null, 2)}\n`, 'utf8');
      await writeFile(path.join(legacyDir, 'events.jsonl'), `${JSON.stringify(buildEvent())}\n`, 'utf8');
    }

    const result = await runRecalculate({ all: true, archive: archiveDir }, { write: () => undefined });

    expect(result.status).toBe('partial');
    if (result.status === 'partial') {
      expect(result.outcomes).toHaveLength(2);
      expect(result.outcomes.every((outcome) => outcome.status === 'incompatible')).toBe(true);
    }
  });

  it('reports a not-found outcome without creating anything for an unknown run id', async () => {
    const result = await runRecalculate({ runId: 'does-not-exist', archive: archiveDir }, { write: () => undefined });
    expect(result).toMatchObject({ status: 'partial', outcomes: [{ id: 'does-not-exist', status: 'not-found' }] });
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

    expect(result.status).toBe('partial');
    if (result.status === 'partial') {
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

    expect(result.status).toBe('partial');
    if (result.status === 'partial') {
      expect(result.outcomes[0]?.status).toBe('error');
    }

    const rawRunJson = await readFile(path.join(archiveDir, 'runs', summary.id, 'run.json'), 'utf8');
    expect(JSON.parse(rawRunJson)).toEqual(summary);
  });
});
