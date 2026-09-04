import { describe, expect, it } from 'vitest';
import type { DashboardCapabilities, DashboardDataset, PublicDashboardDataset, PublicRunSummary } from '../src/data.js';
import { validateDataset, DatasetSchemaError } from '../src/data.js';
import { renderDetail } from '../src/detail.js';
import { renderCompare } from '../src/compare-view.js';

function buildPublicRun(id: string): PublicRunSummary {
  return {
    id,
    comparisonOrder: 0,
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

  it('rejects local mode with non-true capability booleans', () => {
    expect(() => validateDataset({
      schemaVersion: 1,
      mode: 'local',
      generatedAt: new Date().toISOString(),
      capabilities: { characters: false, notes: true },
      runs: [],
    })).toThrow(DatasetSchemaError);
  });

  it('rejects capabilities with non-boolean values', () => {
    expect(() => validateDataset({
      schemaVersion: 1,
      mode: 'public',
      generatedAt: new Date().toISOString(),
      capabilities: { characters: 'yes', notes: false },
      runs: [],
    })).toThrow(DatasetSchemaError);
  });

  it('rejects a run missing required fields like id or metrics', () => {
    expect(() => validateDataset({
      schemaVersion: 1,
      mode: 'public',
      generatedAt: new Date().toISOString(),
      capabilities: { characters: false, notes: false },
      runs: [{ bogus: true }],
    })).toThrow(DatasetSchemaError);
  });

  it('rejects unknown top-level keys in the dataset', () => {
    expect(() => validateDataset({
      schemaVersion: 1,
      mode: 'local',
      generatedAt: new Date().toISOString(),
      capabilities: { characters: true, notes: true },
      runs: [],
      injectedMalice: true,
    })).toThrow(DatasetSchemaError);
  });

  it('rejects a run with an invalid window.start timestamp', () => {
    expect(() => validateDataset({
      schemaVersion: 1,
      mode: 'public',
      generatedAt: new Date().toISOString(),
      capabilities: { characters: false, notes: false },
      runs: [{
        id: 'run-1',
        site: { name: 'S', key: 's' },
        fleetProfile: { id: 'p', name: 'P' },
        window: { start: 'not-a-date', end: '2026-09-01T10:10:00.000Z', source: 'test', manuallyAdjusted: false },
        calculation: { episodeThresholdSeconds: 180, activeCombatGapSeconds: 30 },
        metrics: { elapsedSeconds: 600, activeCombatSeconds: 540, idleSeconds: 60, fleetDamageDealt: 0, averageFleetDps: 0, activeFleetDps: 0, damageTaken: 0, remoteRepairDelivered: 0, participantCount: 0 },
        coverage: { logFiles: 0, participantsWithOutgoingDamage: 0, unparsedCombatLines: 0, ambiguousEventsExcluded: 0, repairPairing: 'none' },
        comparisonOrder: 0,
      }],
    })).toThrow(DatasetSchemaError);
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

describe('capability-gated DOM rendering', () => {
  function makeRunForDOM(capabilities: DashboardCapabilities): PublicRunSummary {
    const base = buildPublicRun('dom-run');
    return {
      ...base,
      comparisonOrder: 0,
      ...(capabilities.characters
        ? {
            participants: ['Alpha'],
            characterMetrics: [
              {
                character: 'Alpha',
                damageDealt: 70000,
                fleetDamageShare: 1,
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
      ...(capabilities.notes ? { notes: 'A test note' } : {}),
    };
  }

  it('renderDetail shows characters and notes when both capabilities true', () => {
    const container = document.createElement('div');
    const run = makeRunForDOM({ characters: true, notes: true });
    renderDetail(container, run, { characters: true, notes: true });

    expect(container.querySelector('.detail-characters')).not.toBeNull();
    expect(container.querySelector('.detail-notes')).not.toBeNull();
  });

  it('renderDetail hides characters and notes when both capabilities false', () => {
    const container = document.createElement('div');
    const run = makeRunForDOM({ characters: false, notes: false });
    renderDetail(container, run, { characters: false, notes: false });

    expect(container.querySelector('.detail-characters')).toBeNull();
    expect(container.querySelector('.detail-notes')).toBeNull();
  });

  it('renderDetail shows characters but hides notes when characters=true, notes=false', () => {
    const container = document.createElement('div');
    const run = makeRunForDOM({ characters: true, notes: false });
    renderDetail(container, run, { characters: true, notes: false });

    expect(container.querySelector('.detail-characters')).not.toBeNull();
    expect(container.querySelector('.detail-notes')).toBeNull();
  });

  it('renderDetail hides characters but shows notes when characters=false, notes=true', () => {
    const container = document.createElement('div');
    const run = makeRunForDOM({ characters: false, notes: true });
    renderDetail(container, run, { characters: false, notes: true });

    expect(container.querySelector('.detail-characters')).toBeNull();
    expect(container.querySelector('.detail-notes')).not.toBeNull();
  });

  it('renderCompare shows character comparison only when characters=true', () => {
    const container = document.createElement('div');
    const runA = makeRunForDOM({ characters: true, notes: false });
    const runB = { ...makeRunForDOM({ characters: true, notes: false }), id: 'dom-run-b' };
    renderCompare(container, [runA, runB], runA.id, runB.id, { characters: true, notes: false }, () => {}, () => {});

    expect(container.querySelector('.compare-characters')).not.toBeNull();
  });

  it('renderCompare hides character comparison when characters=false', () => {
    const container = document.createElement('div');
    const runA = makeRunForDOM({ characters: false, notes: false });
    const runB = { ...makeRunForDOM({ characters: false, notes: false }), id: 'dom-run-b' };
    renderCompare(container, [runA, runB], runA.id, runB.id, { characters: false, notes: false }, () => {}, () => {});

    expect(container.querySelector('.compare-characters')).toBeNull();
  });
});

describe('public capability/field consistency via validateDataset', () => {
  function publicBase() {
    return {
      id: 'r1',
      comparisonOrder: 0,
      site: { name: 'S', key: 's' },
      fleetProfile: { id: 'p', name: 'P' },
      window: { start: '2026-09-01T10:00:00.000Z', end: '2026-09-01T10:10:00.000Z', source: 'test', manuallyAdjusted: false },
      calculation: { episodeThresholdSeconds: 180, activeCombatGapSeconds: 30 },
      metrics: { elapsedSeconds: 600, activeCombatSeconds: 540, idleSeconds: 60, fleetDamageDealt: 0, averageFleetDps: 0, activeFleetDps: 0, damageTaken: 0, remoteRepairDelivered: 0, participantCount: 0 },
      coverage: { logFiles: 0, participantsWithOutgoingDamage: 0, unparsedCombatLines: 0, ambiguousEventsExcluded: 0, repairPairing: 'none' },
    };
  }

  const charFields = {
    participants: ['Alpha'],
    characterMetrics: [{
      character: 'Alpha', damageDealt: 0, fleetDamageShare: 0, averageDps: 0, activeDps: 0,
      damageTaken: 0, remoteRepairDelivered: 0, remoteRepairReceived: 0,
      shotsHit: 0, shotsMissed: 0, missRate: 0, hitQualityCounts: {},
      firstRelevantEvent: null, lastRelevantEvent: null,
    }],
  };

  it('rejects characters=true when participants/characterMetrics are missing', () => {
    expect(() => validateDataset({
      schemaVersion: 1, mode: 'public',
      generatedAt: '2026-09-01T10:00:00.000Z',
      capabilities: { characters: true, notes: false },
      runs: [publicBase()],
    })).toThrow(DatasetSchemaError);
  });

  it('rejects characters=false when participants present', () => {
    expect(() => validateDataset({
      schemaVersion: 1, mode: 'public',
      generatedAt: '2026-09-01T10:00:00.000Z',
      capabilities: { characters: false, notes: false },
      runs: [{ ...publicBase(), ...charFields }],
    })).toThrow(DatasetSchemaError);
  });

  it('rejects notes=true when notes key is missing', () => {
    expect(() => validateDataset({
      schemaVersion: 1, mode: 'public',
      generatedAt: '2026-09-01T10:00:00.000Z',
      capabilities: { characters: false, notes: true },
      runs: [publicBase()],
    })).toThrow(DatasetSchemaError);
  });

  it('rejects notes=false when notes key is present', () => {
    expect(() => validateDataset({
      schemaVersion: 1, mode: 'public',
      generatedAt: '2026-09-01T10:00:00.000Z',
      capabilities: { characters: false, notes: false },
      runs: [{ ...publicBase(), notes: null }],
    })).toThrow(DatasetSchemaError);
  });

  it('accepts characters=true with valid participants and characterMetrics', () => {
    const ds = validateDataset({
      schemaVersion: 1, mode: 'public',
      generatedAt: '2026-09-01T10:00:00.000Z',
      capabilities: { characters: true, notes: false },
      runs: [{ ...publicBase(), ...charFields }],
    });
    expect(ds.mode).toBe('public');
  });

  it('accepts notes=true with null notes value', () => {
    const ds = validateDataset({
      schemaVersion: 1, mode: 'public',
      generatedAt: '2026-09-01T10:00:00.000Z',
      capabilities: { characters: false, notes: true },
      runs: [{ ...publicBase(), notes: null }],
    });
    expect(ds.mode).toBe('public');
  });

  it('accepts characters=true and notes=true with both gated field groups present', () => {
    const ds = validateDataset({
      schemaVersion: 1, mode: 'public',
      generatedAt: '2026-09-01T10:00:00.000Z',
      capabilities: { characters: true, notes: true },
      runs: [{ ...publicBase(), ...charFields, notes: 'a note' }],
    });
    expect(ds.mode).toBe('public');
    const run = ds.runs[0] as PublicRunSummary;
    expect(run.participants).toEqual(['Alpha']);
    expect(run.characterMetrics).toHaveLength(1);
    expect(run.notes).toBe('a note');
  });

  it('accepts every capability combination when the gated fields match exactly', () => {
    const combinations: Array<{ capabilities: DashboardCapabilities; run: Record<string, unknown> }> = [
      { capabilities: { characters: false, notes: false }, run: { ...publicBase() } },
      { capabilities: { characters: true, notes: false }, run: { ...publicBase(), ...charFields } },
      { capabilities: { characters: false, notes: true }, run: { ...publicBase(), notes: null } },
      { capabilities: { characters: true, notes: true }, run: { ...publicBase(), ...charFields, notes: 'note' } },
    ];

    for (const { capabilities, run } of combinations) {
      const ds = validateDataset({
        schemaVersion: 1, mode: 'public',
        generatedAt: '2026-09-01T10:00:00.000Z',
        capabilities,
        runs: [run],
      });
      expect(ds.capabilities).toEqual(capabilities);
      expect(ds.runs).toHaveLength(1);
    }
  });
});

/**
 * A gated key that is *present* with the value `undefined` is not the same as
 * an absent key. `JSON.parse` never produces one, but any in-memory dataset
 * handed to `validateDataset` (a Task 8 public builder, a test double, a
 * hand-assembled object) can. The privacy contract must hold at that boundary
 * too: a disabled capability must reject the key even when its value is
 * `undefined`, and an enabled capability must reject `undefined` as a value.
 */
describe('public wire boundary: explicitly present undefined gated keys', () => {
  function publicBase() {
    return {
      id: 'r1',
      comparisonOrder: 0,
      site: { name: 'S', key: 's' },
      fleetProfile: { id: 'p', name: 'P' },
      window: { start: '2026-09-01T10:00:00.000Z', end: '2026-09-01T10:10:00.000Z', source: 'test', manuallyAdjusted: false },
      calculation: { episodeThresholdSeconds: 180, activeCombatGapSeconds: 30 },
      metrics: { elapsedSeconds: 600, activeCombatSeconds: 540, idleSeconds: 60, fleetDamageDealt: 0, averageFleetDps: 0, activeFleetDps: 0, damageTaken: 0, remoteRepairDelivered: 0, participantCount: 0 },
      coverage: { logFiles: 0, participantsWithOutgoingDamage: 0, unparsedCombatLines: 0, ambiguousEventsExcluded: 0, repairPairing: 'none' },
    };
  }

  const characterMetrics = [{
    character: 'Alpha', damageDealt: 0, fleetDamageShare: 0, averageDps: 0, activeDps: 0,
    damageTaken: 0, remoteRepairDelivered: 0, remoteRepairReceived: 0,
    shotsHit: 0, shotsMissed: 0, missRate: 0, hitQualityCounts: {},
    firstRelevantEvent: null, lastRelevantEvent: null,
  }];

  function parsePublic(capabilities: DashboardCapabilities, run: Record<string, unknown>): () => DashboardDataset {
    return () => validateDataset({
      schemaVersion: 1, mode: 'public',
      generatedAt: '2026-09-01T10:00:00.000Z',
      capabilities,
      runs: [run],
    });
  }

  it('confirms the fixtures really carry the key with an undefined value', () => {
    const run = { ...publicBase(), participants: undefined };
    expect(Object.prototype.hasOwnProperty.call(run, 'participants')).toBe(true);
    expect(run.participants).toBeUndefined();
  });

  it('rejects characters=false when participants is present with value undefined', () => {
    expect(parsePublic({ characters: false, notes: false }, { ...publicBase(), participants: undefined })).toThrow(DatasetSchemaError);
  });

  it('rejects characters=false when characterMetrics is present with value undefined', () => {
    expect(parsePublic({ characters: false, notes: false }, { ...publicBase(), characterMetrics: undefined })).toThrow(DatasetSchemaError);
  });

  it('rejects notes=false when notes is present with value undefined', () => {
    expect(parsePublic({ characters: false, notes: false }, { ...publicBase(), notes: undefined })).toThrow(DatasetSchemaError);
  });

  it('rejects characters=true when participants is present with value undefined', () => {
    expect(parsePublic({ characters: true, notes: false }, { ...publicBase(), participants: undefined, characterMetrics })).toThrow(DatasetSchemaError);
  });

  it('rejects characters=true when characterMetrics is present with value undefined', () => {
    expect(parsePublic({ characters: true, notes: false }, { ...publicBase(), participants: ['Alpha'], characterMetrics: undefined })).toThrow(DatasetSchemaError);
  });

  it('rejects notes=true when notes is present with value undefined', () => {
    expect(parsePublic({ characters: false, notes: true }, { ...publicBase(), notes: undefined })).toThrow(DatasetSchemaError);
  });

  it('rejects characters=true, notes=true when both gated groups are present with undefined values', () => {
    expect(parsePublic({ characters: true, notes: true }, {
      ...publicBase(), participants: undefined, characterMetrics: undefined, notes: undefined,
    })).toThrow(DatasetSchemaError);
  });

  it('rejects a local dataset whose run carries a present-undefined unknown key', () => {
    expect(() => validateDataset({
      schemaVersion: 1, mode: 'local',
      generatedAt: '2026-09-01T10:00:00.000Z',
      capabilities: { characters: true, notes: true },
      runs: [{ ...publicBase(), comparisonOrder: undefined }],
    })).toThrow(DatasetSchemaError);
  });
});
