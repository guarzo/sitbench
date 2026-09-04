import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Archive, type FleetProfile, type NormalizedEvent, type RunSummary } from '@sitbench/core';
import { runAnalyze, type AnalyzePrompts } from '../src/analyze-command.js';
import { runEdit, type EditPrompts, type WindowEditChoice } from '../src/edit-command.js';
import { runRecalculate } from '../src/recalculate-command.js';

/**
 * Behavioural proof matrix for derivative (non-authoritative) generation.
 *
 * Every case here drives a real command against a real temp archive. Catalog
 * failures are induced the same way the archive itself would hit them in
 * production (an unwritable `catalog.json`), profile failures via a real
 * `Archive` subclass, config failures via a real unwritable `config.json`
 * path, and only the dashboard hook — an existing injection seam — is faked.
 * Assertions are on user-visible results, statuses, reasons, printed output,
 * and durable archive contents; never on the mere existence of a mock.
 */

let root: string;
let logsDir: string;
let archiveDir: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'sitbench-derivative-'));
  logsDir = path.join(root, 'logs');
  archiveDir = path.join(root, 'archive');
  await mkdir(logsDir, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const analyzePrompts: AnalyzePrompts = {
  confirmCandidate: async () => ({ action: 'accept' }),
  requestSite: async () => 'Core Bastion',
  requestProfile: async () => '8 Kikis + 2 Deacons',
  requestNotes: async () => null,
  confirmSave: async () => true,
};

function editPrompts(overrides: Partial<EditPrompts> = {}): EditPrompts {
  return {
    requestSite: async (current) => current,
    requestProfile: async (_profiles: FleetProfile[], current) => current,
    requestNotes: async (current) => current,
    requestWindow: async (): Promise<WindowEditChoice> => ({ action: 'keep' }),
    confirmSave: async () => true,
    ...overrides,
  };
}

function fixedClock(): Date {
  return new Date('2026-09-03T05:05:12.000Z');
}

async function writeCandidateLog(): Promise<void> {
  const header = [
    '------------------------------------------------------------',
    '  Gamelog',
    '  Listener: Dah Nee',
    '------------------------------------------------------------',
  ];
  await writeFile(
    path.join(logsDir, 'combat.txt'),
    [
      ...header,
      '[ 2026.09.03 04:00:00 ] (combat) 100 from Dah Nee[Example] - Heavy Entropic Disintegrator II - Hits Sleepless Guardian',
      '[ 2026.09.03 04:00:20 ] (combat) 120 from Dah Nee[Example] - Heavy Entropic Disintegrator II - Hits Sleepless Guardian',
      '[ 2026.09.03 04:04:00 ] (combat) 130 from Dah Nee[Example] - Heavy Entropic Disintegrator II - Hits Sleepless Guardian',
      '[ 2026.09.03 04:04:20 ] (combat) 140 from Dah Nee[Example] - Heavy Entropic Disintegrator II - Hits Sleepless Guardian',
    ].join('\n'),
    'utf8',
  );
}

function buildEvent(timestamp: string, sourceLine: number): NormalizedEvent {
  return {
    kind: 'damage-dealt',
    timestamp,
    observedBy: 'Alpha',
    sourceFile: 'log.txt',
    sourceLine,
    raw: 'raw',
    actor: 'Alpha',
    target: 'Sleepless Guardian',
    amount: 100,
    hitQuality: 'Hits',
    targetClassification: 'npc',
  };
}

function buildSummary(id: string, windowStart: string): RunSummary {
  const windowEnd = new Date(Date.parse(windowStart) + 600_000).toISOString();
  return {
    schemaVersion: 1,
    parserVersion: '0.1.0',
    metricsVersion: '0.0.9',
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
    characterMetrics: [],
    coverage: { logFiles: 1, participantsWithOutgoingDamage: 1, unparsedCombatLines: 0, ambiguousEventsExcluded: 0, repairPairing: 'none' },
    notes: null,
    fingerprint: `fp-${id}`,
    createdAt: windowStart,
    updatedAt: windowStart,
  };
}

/** Real archive whose profile upsert fails, leaving every other operation intact. */
class ProfileFailingArchive extends Archive {
  override async upsertProfile(): Promise<FleetProfile> {
    throw new Error('profile store unwritable');
  }
}

/** Replaces `catalog.json` with a directory so the real rebuild write fails. */
async function breakCatalog(): Promise<void> {
  const catalogPath = path.join(archiveDir, 'catalog.json');
  await mkdir(archiveDir, { recursive: true });
  await rm(catalogPath, { recursive: true, force: true });
  await mkdir(catalogPath);
}

/** Points `config.json` at a directory that does not exist, so writes fail but reads look absent. */
async function breakConfigWrites(): Promise<void> {
  await mkdir(archiveDir, { recursive: true });
  await symlink(path.join(root, 'no-such-dir', 'config.json'), path.join(archiveDir, 'config.json'));
}

// ---------------------------------------------------------------------------
// analyze
// ---------------------------------------------------------------------------

describe('analyze derivative generation', () => {
  it('still invokes the dashboard hook after a real CatalogRebuildError', async () => {
    await writeCandidateLog();
    await breakCatalog();
    const output: string[] = [];
    let dashboardInvocations = 0;

    const result = await runAnalyze(
      { logs: logsDir, archive: archiveDir },
      {
        prompts: analyzePrompts,
        clock: fixedClock,
        write: (line) => output.push(line),
        rebuildCatalog: async () => {
          dashboardInvocations += 1;
        },
      },
    );

    expect(result).toMatchObject({ status: 'saved-with-warning', reason: 'catalog' });
    expect(dashboardInvocations).toBe(1);
    // The authoritative run survives the catalog failure.
    expect(await new Archive(archiveDir).listRunIds()).toHaveLength(1);
    expect(output.join('\n')).toContain('catalog could not be rebuilt');
  });

  it('exposes both catalog and dashboard reasons when both derivatives fail', async () => {
    await writeCandidateLog();
    await breakCatalog();
    const output: string[] = [];

    const result = await runAnalyze(
      { logs: logsDir, archive: archiveDir },
      {
        prompts: analyzePrompts,
        clock: fixedClock,
        write: (line) => output.push(line),
        rebuildCatalog: async () => {
          throw new Error('dashboard write failed');
        },
      },
    );

    expect(result).toMatchObject({ status: 'saved-with-warning', reason: 'post-save' });
    const message = output.join('\n');
    expect(message).toContain('catalog: ');
    expect(message).toContain('dashboard: dashboard write failed');
    expect(await new Archive(archiveDir).listRunIds()).toHaveLength(1);
  });

  it('accumulates profile, dashboard, and config failures into one post-save warning', async () => {
    await writeCandidateLog();
    await breakConfigWrites();
    const output: string[] = [];
    const archive = new ProfileFailingArchive(archiveDir);

    const result = await runAnalyze(
      { logs: logsDir, archive: archiveDir },
      {
        prompts: analyzePrompts,
        clock: fixedClock,
        write: (line) => output.push(line),
        createArchive: () => archive,
        rebuildCatalog: async () => {
          throw new Error('dashboard write failed');
        },
      },
    );

    expect(result).toMatchObject({ status: 'saved-with-warning', reason: 'post-save' });
    const message = output.join('\n');
    expect(message).toContain('profile: profile store unwritable');
    expect(message).toContain('dashboard: dashboard write failed');
    expect(message).toContain('config: ');
    // Catalog succeeded, so it must not be blamed.
    expect(message).not.toContain('catalog: ');
    // The run itself is authoritative and fully readable.
    expect(await new Archive(archiveDir).listRuns()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// edit
// ---------------------------------------------------------------------------

describe('edit derivative generation', () => {
  it('accumulates profile and dashboard failures while persisting the edit', async () => {
    const summary = buildSummary('20260901T100000Z-core-bastion', '2026-09-01T10:00:00.000Z');
    await new Archive(archiveDir).saveRun(summary, [buildEvent('2026-09-01T10:00:00.000Z', 1)]);
    const output: string[] = [];
    const archive = new ProfileFailingArchive(archiveDir);

    const result = await runEdit(
      { runId: summary.id, archive: archiveDir },
      {
        prompts: editPrompts({ requestNotes: async () => 'edited notes' }),
        write: (line) => output.push(line),
        createArchive: () => archive,
        rebuildCatalog: async () => {
          throw new Error('dashboard write failed');
        },
      },
    );

    expect(result).toMatchObject({ status: 'updated-with-warning', reason: 'post-save' });
    const message = output.join('\n');
    expect(message).toContain('profile: profile store unwritable');
    expect(message).toContain('dashboard: dashboard write failed');
    expect(message).not.toContain('catalog: ');
    // The authoritative edit was persisted despite both derivative failures.
    const reloaded = await new Archive(archiveDir).loadRun(summary.id);
    expect(reloaded?.summary.notes).toBe('edited notes');
  });

  it('still invokes the dashboard hook after a real CatalogRebuildError', async () => {
    const summary = buildSummary('20260901T100000Z-core-bastion', '2026-09-01T10:00:00.000Z');
    await new Archive(archiveDir).saveRun(summary, [buildEvent('2026-09-01T10:00:00.000Z', 1)]);
    await breakCatalog();
    const output: string[] = [];
    let dashboardInvocations = 0;

    const result = await runEdit(
      { runId: summary.id, archive: archiveDir },
      {
        prompts: editPrompts({ requestNotes: async () => 'edited notes' }),
        write: (line) => output.push(line),
        rebuildCatalog: async () => {
          dashboardInvocations += 1;
        },
      },
    );

    expect(result).toMatchObject({ status: 'updated-with-warning', reason: 'catalog' });
    expect(dashboardInvocations).toBe(1);
    expect(output.join('\n')).toContain('catalog could not be rebuilt');
  });
});

// ---------------------------------------------------------------------------
// recalculate
// ---------------------------------------------------------------------------

describe('recalculate derivative generation', () => {
  it('still invokes the dashboard hook after a real CatalogRebuildError and keeps the recalculation', async () => {
    const summary = buildSummary('20260901T100000Z-core-bastion', '2026-09-01T10:00:00.000Z');
    await new Archive(archiveDir).saveRun(summary, [buildEvent('2026-09-01T10:00:00.000Z', 1)]);
    await breakCatalog();
    const output: string[] = [];
    let dashboardInvocations = 0;

    const result = await runRecalculate(
      { runId: summary.id, archive: archiveDir },
      {
        write: (line) => output.push(line),
        rebuildCatalog: async () => {
          dashboardInvocations += 1;
        },
      },
    );

    expect(result.status).toBe('ok');
    expect(dashboardInvocations).toBe(1);
    const outcome = result.status === 'ok' ? result.outcomes[0] : undefined;
    expect(outcome).toMatchObject({ status: 'recalculated-with-warning' });
    expect(outcome?.status === 'recalculated-with-warning' ? outcome.reason : '').toContain('catalog: ');
    // The recalculation itself was durably applied.
    const reloaded = await new Archive(archiveDir).loadRun(summary.id);
    expect(reloaded?.summary.metricsVersion).toBe('0.1.0');
  });

  it('exposes both catalog and dashboard reasons when both derivatives fail', async () => {
    const summary = buildSummary('20260901T100000Z-core-bastion', '2026-09-01T10:00:00.000Z');
    await new Archive(archiveDir).saveRun(summary, [buildEvent('2026-09-01T10:00:00.000Z', 1)]);
    await breakCatalog();
    const output: string[] = [];

    const result = await runRecalculate(
      { runId: summary.id, archive: archiveDir },
      {
        write: (line) => output.push(line),
        rebuildCatalog: async () => {
          throw new Error('dashboard write failed');
        },
      },
    );

    const outcome = result.status === 'ok' ? result.outcomes[0] : undefined;
    expect(outcome?.status).toBe('recalculated-with-warning');
    const reason = outcome?.status === 'recalculated-with-warning' ? outcome.reason : '';
    expect(reason).toContain('catalog: ');
    expect(reason).toContain('dashboard: dashboard write failed');
    expect(output.join('\n')).toContain('follow-up generation failed');
  });

  it('continues through every run under --all when derivatives fail for each one', async () => {
    const archive = new Archive(archiveDir);
    const first = buildSummary('20260901T100000Z-core-bastion', '2026-09-01T10:00:00.000Z');
    const second = buildSummary('20260902T100000Z-core-bastion', '2026-09-02T10:00:00.000Z');
    await archive.saveRun(first, [buildEvent('2026-09-01T10:00:00.000Z', 1)]);
    await archive.saveRun(second, [buildEvent('2026-09-02T10:00:00.000Z', 1)]);
    await breakCatalog();
    const output: string[] = [];
    let dashboardInvocations = 0;

    const result = await runRecalculate(
      { all: true, archive: archiveDir },
      {
        write: (line) => output.push(line),
        rebuildCatalog: async () => {
          dashboardInvocations += 1;
          throw new Error('dashboard write failed');
        },
      },
    );

    expect(result.status).toBe('ok');
    const outcomes = result.status === 'ok' ? result.outcomes : [];
    expect(outcomes.map((outcome) => outcome.id)).toEqual([first.id, second.id]);
    expect(outcomes.every((outcome) => outcome.status === 'recalculated-with-warning')).toBe(true);
    expect(dashboardInvocations).toBe(2);
    // Both runs were durably recalculated despite both derivatives failing twice.
    const reloadedFirst = await new Archive(archiveDir).loadRun(first.id);
    const reloadedSecond = await new Archive(archiveDir).loadRun(second.id);
    expect(reloadedFirst?.summary.metricsVersion).toBe('0.1.0');
    expect(reloadedSecond?.summary.metricsVersion).toBe('0.1.0');
    expect(output.filter((line) => line.includes('follow-up generation failed'))).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Guard: the induced failures are real, not vacuous
// ---------------------------------------------------------------------------

describe('failure induction is genuine', () => {
  it('a broken catalog path really fails a rebuild, and a broken config path really fails a write', async () => {
    await breakCatalog();
    await expect(new Archive(archiveDir).rebuildCatalog()).rejects.toThrow();

    const otherArchiveDir = path.join(root, 'config-archive');
    archiveDir = otherArchiveDir;
    await breakConfigWrites();
    // Reads see an absent config (dangling symlink -> ENOENT) ...
    await expect(readFile(path.join(otherArchiveDir, 'config.json'), 'utf8')).rejects.toThrow();
    // ... and writes fail, which is what makes the analyze config warning real.
    await expect(writeFile(path.join(otherArchiveDir, 'config.json'), 'x', 'utf8')).rejects.toThrow();
  });
});
