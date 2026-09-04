import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Archive, calculateRun, type FleetProfile, type NormalizedEvent, type RunSummary } from '@sitbench/core';
import { runEdit, type EditPrompts, type WindowEditChoice } from '../src/edit-command.js';

let root: string;
let archiveDir: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'sitbench-cli-edit-'));
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
    metricsVersion: '0.1.0',
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
      elapsedSeconds: 120,
      activeCombatSeconds: 100,
      idleSeconds: 20,
      fleetDamageDealt: 240,
      averageFleetDps: 2,
      activeFleetDps: 2.4,
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
    notes: 'original notes',
    fingerprint: 'original-fingerprint',
    createdAt: '2026-09-03T05:05:12.000Z',
    updatedAt: '2026-09-03T05:05:12.000Z',
    ...overrides,
  };
}

function keepWindowPrompts(overrides: Partial<EditPrompts> = {}): EditPrompts {
  return {
    requestSite: async (current) => current,
    requestProfile: async (_profiles: FleetProfile[], current) => current,
    requestNotes: async (current) => current,
    requestWindow: async (): Promise<WindowEditChoice> => ({ action: 'keep' }),
    confirmSave: async () => true,
    ...overrides,
  };
}

describe('runEdit', () => {
  it('changing only notes leaves metrics, coverage, and the fingerprint exactly unchanged', async () => {
    const summary = buildSummary();
    const events = [
      buildEvent({ sourceLine: 1, timestamp: '2026-09-03T04:51:14.000Z', amount: 100 }),
      buildEvent({ sourceLine: 2, timestamp: '2026-09-03T04:53:14.000Z', amount: 140 }),
    ];
    const archive = new Archive(archiveDir);
    await archive.saveRun(summary, events);

    const result = await runEdit(
      { runId: summary.id, archive: archiveDir },
      { prompts: keepWindowPrompts({ requestNotes: async () => 'updated notes' }) },
    );

    expect(result).toEqual({ status: 'updated', id: summary.id });

    const reloaded = await archive.loadRun(summary.id);
    expect(reloaded?.summary.notes).toBe('updated notes');
    expect(reloaded?.summary.fingerprint).toBe(summary.fingerprint);
    expect(reloaded?.summary.metrics).toEqual(summary.metrics);
    expect(reloaded?.summary.characterMetrics).toEqual(summary.characterMetrics);
    expect(reloaded?.summary.coverage).toEqual(summary.coverage);
    expect(reloaded?.summary.metricsVersion).toBe(summary.metricsVersion);
    expect(reloaded?.summary.window).toEqual(summary.window);
    expect(reloaded?.summary.createdAt).toBe(summary.createdAt);
  });

  it('changing the window recomputes metrics from the full archived event stream but never deletes archived events', async () => {
    const summary = buildSummary({
      coverage: {
        logFiles: 2,
        participantsWithOutgoingDamage: 3,
        unparsedCombatLines: 5,
        ambiguousEventsExcluded: 7,
        repairPairing: 'full',
      },
    });
    const events = [
      buildEvent({ sourceLine: 1, timestamp: '2026-09-03T04:51:14.000Z', amount: 100 }),
      buildEvent({ sourceLine: 2, timestamp: '2026-09-03T04:53:14.000Z', amount: 140 }),
    ];
    const archive = new Archive(archiveDir);
    await archive.saveRun(summary, events);

    const narrowerWindow = { start: '2026-09-03T04:51:00.000Z', end: '2026-09-03T04:51:30.000Z' };
    const result = await runEdit(
      { runId: summary.id, archive: archiveDir },
      { prompts: keepWindowPrompts({ requestWindow: async () => ({ action: 'adjust', ...narrowerWindow }) }) },
    );

    expect(result).toEqual({ status: 'updated', id: summary.id });

    const reloaded = await archive.loadRun(summary.id);
    expect(reloaded?.summary.window).toMatchObject({
      start: narrowerWindow.start,
      end: narrowerWindow.end,
      manuallyAdjusted: true,
    });
    // Metrics are derived by handing the full archived event stream to core
    // together with the new window; core itself filters by window.
    const expected = calculateRun(
      events,
      { ...narrowerWindow, source: 'manually-adjusted', manuallyAdjusted: true },
      summary.calculation,
    );
    expect(reloaded?.summary.metrics).toEqual(expected.metrics);
    expect(reloaded?.summary.characterMetrics).toEqual(expected.characterMetrics);
    expect(reloaded?.summary.fingerprint).not.toBe(summary.fingerprint);
    // Coverage is ingestion provenance and is preserved wholesale even though
    // the window changed.
    expect(reloaded?.summary.coverage).toEqual(summary.coverage);
    // The full archived event stream must never be narrowed/deleted, even
    // though the confirmed window shrank to a subset of it.
    expect(reloaded?.events).toEqual(events);
  });

  it('rejects an edited window with no qualifying outgoing NPC damage and leaves the run untouched', async () => {
    const summary = buildSummary();
    const events = [buildEvent({ sourceLine: 1, timestamp: '2026-09-03T04:51:14.000Z', amount: 100 })];
    const archive = new Archive(archiveDir);
    await archive.saveRun(summary, events);

    const noDamageWindow = { start: '2026-09-03T04:52:00.000Z', end: '2026-09-03T04:53:00.000Z' };
    const result = await runEdit(
      { runId: summary.id, archive: archiveDir },
      { prompts: keepWindowPrompts({ requestWindow: async () => ({ action: 'adjust', ...noDamageWindow }) }) },
    );

    expect(result).toMatchObject({ status: 'fatal', reason: 'no-qualifying-damage' });

    const reloaded = await archive.loadRun(summary.id);
    expect(reloaded?.summary).toEqual(summary);
    expect(reloaded?.events).toEqual(events);
  });

  it('does not persist a change when the final confirmation is declined', async () => {
    const summary = buildSummary();
    const archive = new Archive(archiveDir);
    await archive.saveRun(summary, [buildEvent()]);

    const result = await runEdit(
      { runId: summary.id, archive: archiveDir },
      { prompts: keepWindowPrompts({ requestNotes: async () => 'should not be saved', confirmSave: async () => false }) },
    );

    expect(result).toEqual({ status: 'cancelled' });
    const reloaded = await archive.loadRun(summary.id);
    expect(reloaded?.summary.notes).toBe(summary.notes);
  });

  it('rejects an empty site without mutating the archive', async () => {
    const summary = buildSummary();
    const archive = new Archive(archiveDir);
    await archive.saveRun(summary, [buildEvent()]);

    const result = await runEdit(
      { runId: summary.id, archive: archiveDir },
      { prompts: keepWindowPrompts({ requestSite: async () => '   ' }) },
    );

    expect(result).toMatchObject({ status: 'fatal', reason: 'site' });
    const reloaded = await archive.loadRun(summary.id);
    expect(reloaded?.summary).toEqual(summary);
  });

  it('reports not-found for an unknown run id without prompting', async () => {
    let promptsCalled = false;
    const result = await runEdit(
      { runId: 'does-not-exist', archive: archiveDir },
      {
        prompts: keepWindowPrompts({
          requestSite: async (current) => {
            promptsCalled = true;
            return current;
          },
        }),
      },
    );

    expect(result).toMatchObject({ status: 'fatal', reason: 'not-found' });
    expect(promptsCalled).toBe(false);
  });

  it('rejects an invalid adjusted window without mutating the archive', async () => {
    const summary = buildSummary();
    const archive = new Archive(archiveDir);
    await archive.saveRun(summary, [buildEvent()]);

    const result = await runEdit(
      { runId: summary.id, archive: archiveDir },
      {
        prompts: keepWindowPrompts({
          requestWindow: async () => ({
            action: 'adjust',
            start: '2026-09-03T04:53:14.000Z',
            end: '2026-09-03T04:51:14.000Z',
          }),
        }),
      },
    );

    expect(result).toMatchObject({ status: 'fatal', reason: 'invalid-window' });
    const reloaded = await archive.loadRun(summary.id);
    expect(reloaded?.summary).toEqual(summary);
  });

  it('reports an incompatible result and leaves the run untouched when archived events fail the current strict schema', async () => {
    const runDir = path.join(archiveDir, 'runs', 'legacy-run');
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(runDir, { recursive: true });
    const legacySummary = buildSummary({ id: 'legacy-run', fingerprint: 'legacy-fingerprint' });
    const legacyRunJson = `${JSON.stringify(legacySummary, null, 2)}\n`;
    const legacyEventLine = `${JSON.stringify({ ...buildEvent(), legacyExtraField: 'unsupported' })}\n`;
    await writeFile(path.join(runDir, 'run.json'), legacyRunJson, 'utf8');
    await writeFile(path.join(runDir, 'events.jsonl'), legacyEventLine, 'utf8');

    const result = await runEdit({ runId: 'legacy-run', archive: archiveDir }, { prompts: keepWindowPrompts() });

    expect(result).toMatchObject({ status: 'fatal', reason: 'incompatible' });
    const rawAfter = await readFile(path.join(runDir, 'run.json'), 'utf8');
    expect(rawAfter).toBe(legacyRunJson);
  });

  it('detects a concurrent update between load and confirmation and reports a conflict without overwriting it', async () => {
    const summary = buildSummary();
    const archive = new Archive(archiveDir);
    await archive.saveRun(summary, [buildEvent()]);

    const result = await runEdit(
      { runId: summary.id, archive: archiveDir },
      {
        prompts: keepWindowPrompts({
          requestNotes: async () => 'edited notes',
          confirmSave: async () => {
            // Simulate a concurrent process (e.g. another `edit` or
            // `recalculate`) mutating this exact run after this edit loaded
            // it but before it confirms/persists its own change.
            await archive.updateRun(summary.id, ({ summary: current, events }) => ({
              summary: { ...current, notes: 'concurrent notes' },
              events,
            }));
            return true;
          },
        }),
      },
    );

    expect(result).toMatchObject({ status: 'fatal', reason: 'conflict' });
    const reloaded = await archive.loadRun(summary.id);
    expect(reloaded?.summary.notes).toBe('concurrent notes');
  });

  it('persists a newly entered fleet profile through Archive.upsertProfile only after confirmation', async () => {
    const summary = buildSummary();
    const archive = new Archive(archiveDir);
    await archive.saveRun(summary, [buildEvent()]);

    const result = await runEdit(
      { runId: summary.id, archive: archiveDir },
      { prompts: keepWindowPrompts({ requestProfile: async () => 'Brand New Profile' }) },
    );

    expect(result).toEqual({ status: 'updated', id: summary.id });
    const profiles = await archive.loadProfiles();
    expect(profiles.map((profile) => profile.name)).toContain('Brand New Profile');
  });

  it('does not persist a newly entered fleet profile when the edit is declined', async () => {
    const summary = buildSummary();
    const archive = new Archive(archiveDir);
    await archive.saveRun(summary, [buildEvent()]);

    await runEdit(
      { runId: summary.id, archive: archiveDir },
      {
        prompts: keepWindowPrompts({
          requestProfile: async () => 'Should Not Persist',
          confirmSave: async () => false,
        }),
      },
    );

    const profiles = await archive.loadProfiles();
    expect(profiles.map((profile) => profile.name)).not.toContain('Should Not Persist');
  });
});
