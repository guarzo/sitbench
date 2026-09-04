import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Archive, type RunSummary } from '@sitbench/core';
import { regenerateDashboardData } from '../src/dashboard-export.js';

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
    await archive.saveRun(summary, []);

    await regenerateDashboardData(archive, archiveDir);

    const dataPath = path.join(archiveDir, 'dashboard', 'data', 'runs.json');
    const content = await readFile(dataPath, 'utf8');
    expect(content).not.toContain('"sourceFile"');
    expect(content).not.toContain('"sourceLine"');
    expect(content).not.toContain('"raw"');
  });
});
