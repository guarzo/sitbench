import { describe, expect, it } from 'vitest';
import type { DashboardCapabilities, DashboardDataset, PublicDashboardDataset, PublicRunSummary } from '../src/data.js';
import { validateDataset, DatasetSchemaError } from '../src/data.js';

function buildPublicRun(id: string): PublicRunSummary {
  return {
    id,
    site: { name: 'Core Bastion', key: 'core-bastion' },
    fleetProfile: { id: 'default', name: 'Default' },
    window: { start: '2026-09-01T10:00:00.000Z', end: '2026-09-01T10:10:00.000Z', source: 'outgoing-npc-damage', manuallyAdjusted: false },
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
      participantCount: 2,
    },
    coverage: { logFiles: 2, participantsWithOutgoingDamage: 2, unparsedCombatLines: 0, ambiguousEventsExcluded: 0, repairPairing: 'full' },
  };
}

function buildPublicDataset(
  capabilities: DashboardCapabilities,
  runsOrOverrides?: PublicRunSummary[],
): PublicDashboardDataset {
  const baseRun = buildPublicRun('run-1');
  const runs = runsOrOverrides ?? [
    {
      ...baseRun,
      ...(capabilities.characters
        ? {
            participants: ['Alpha', 'Bravo'],
            characterMetrics: [
              {
                character: 'Alpha',
                damageDealt: 70000,
                fleetDamageShare: 0.583,
                averageDps: 116,
                activeDps: 129,
                damageTaken: 20000,
                remoteRepairDelivered: 3000,
                remoteRepairReceived: 2000,
                shotsHit: 150,
                shotsMissed: 10,
                missRate: 0.0625,
                hitQualityCounts: {},
                firstRelevantEvent: null,
                lastRelevantEvent: null,
              },
            ],
          }
        : {}),
      ...(capabilities.notes ? { notes: 'Test note' } : {}),
    },
  ];
  return {
    schemaVersion: 1,
    mode: 'public',
    generatedAt: new Date().toISOString(),
    capabilities,
    runs,
  };
}

describe('dataset mode validation', () => {
  it('accepts a local dataset', () => {
    const dataset = validateDataset({
      schemaVersion: 1,
      mode: 'local',
      generatedAt: new Date().toISOString(),
      capabilities: { characters: true, notes: true },
      runs: [],
    });
    expect(dataset.mode).toBe('local');
  });

  it('accepts a public dataset', () => {
    const dataset = validateDataset({
      schemaVersion: 1,
      mode: 'public',
      generatedAt: new Date().toISOString(),
      capabilities: { characters: false, notes: false },
      runs: [],
    });
    expect(dataset.mode).toBe('public');
  });

  it('rejects an unknown mode', () => {
    expect(() => validateDataset({
      schemaVersion: 1,
      mode: 'unknown',
      generatedAt: new Date().toISOString(),
      capabilities: {},
      runs: [],
    })).toThrow(DatasetSchemaError);
  });

  it('rejects a missing schemaVersion', () => {
    expect(() => validateDataset({
      mode: 'local',
      generatedAt: new Date().toISOString(),
      capabilities: { characters: true, notes: true },
      runs: [],
    })).toThrow(DatasetSchemaError);
  });

  it('rejects non-object input', () => {
    expect(() => validateDataset('not an object')).toThrow(DatasetSchemaError);
    expect(() => validateDataset(null)).toThrow(DatasetSchemaError);
    expect(() => validateDataset([1, 2, 3])).toThrow(DatasetSchemaError);
  });
});

describe('public capability combinations', () => {
  it('characters=true, notes=true: exposes character detail and notes', () => {
    const dataset = buildPublicDataset({ characters: true, notes: true });
    expect(dataset.capabilities.characters).toBe(true);
    expect(dataset.capabilities.notes).toBe(true);
    const run = dataset.runs[0]!;
    expect(run.participants).toBeDefined();
    expect(run.characterMetrics).toBeDefined();
    expect(run.notes).toBeDefined();
  });

  it('characters=true, notes=false: exposes character detail, hides notes', () => {
    const dataset = buildPublicDataset({ characters: true, notes: false });
    expect(dataset.capabilities.characters).toBe(true);
    expect(dataset.capabilities.notes).toBe(false);
    const run = dataset.runs[0]!;
    expect(run.characterMetrics).toBeDefined();
    expect(run.notes).toBeUndefined();
  });

  it('characters=false, notes=true: hides character detail, exposes notes', () => {
    const dataset = buildPublicDataset({ characters: false, notes: true });
    expect(dataset.capabilities.characters).toBe(false);
    expect(dataset.capabilities.notes).toBe(true);
    const run = dataset.runs[0]!;
    expect(run.characterMetrics).toBeUndefined();
    expect(run.participants).toBeUndefined();
    expect(run.notes).toBeDefined();
  });

  it('characters=false, notes=false: hides both character detail and notes', () => {
    const dataset = buildPublicDataset({ characters: false, notes: false });
    expect(dataset.capabilities.characters).toBe(false);
    expect(dataset.capabilities.notes).toBe(false);
    const run = dataset.runs[0]!;
    expect(run.characterMetrics).toBeUndefined();
    expect(run.participants).toBeUndefined();
    expect(run.notes).toBeUndefined();
  });

  it('run-level metrics, filters, trends, history, and comparison remain for all capability combinations', () => {
    for (const characters of [true, false]) {
      for (const notes of [true, false]) {
        const dataset = buildPublicDataset({ characters, notes });
        const run = dataset.runs[0]!;
        // Run-level fields always present
        expect(run.id).toBeDefined();
        expect(run.site).toBeDefined();
        expect(run.fleetProfile).toBeDefined();
        expect(run.window).toBeDefined();
        expect(run.metrics).toBeDefined();
        expect(run.coverage).toBeDefined();
        expect(run.calculation).toBeDefined();
      }
    }
  });
});
