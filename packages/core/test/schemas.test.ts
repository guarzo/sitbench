import { describe, expect, it } from 'vitest';
import {
  RunSummarySchema,
  NormalizedEventSchema,
  CharacterMetricsSchema,
  SiteIdentitySchema,
  RunWindowSchema,
  RUN_ID_PATTERN,
  isIsoDateTime,
} from '../src/schemas.js';

function minimalRunSummaryFields(id: string) {
  return {
    schemaVersion: 1 as const,
    parserVersion: '0.1.0',
    metricsVersion: '0.1.0',
    id,
    site: { name: 'Core Bastion', key: 'core-bastion' },
    fleetProfile: { id: '8-kikis-2-deacons', name: '8 Kikis + 2 Deacons' },
    window: {
      start: '2026-09-03T04:51:14.000Z',
      end: '2026-09-03T05:03:36.000Z',
      source: 'first-and-last-outgoing-npc-damage',
      manuallyAdjusted: false,
    },
    participants: [],
    calculation: { episodeThresholdSeconds: 180, activeCombatGapSeconds: 30 },
    metrics: {
      elapsedSeconds: 742,
      activeCombatSeconds: 694,
      idleSeconds: 48,
      fleetDamageDealt: 0,
      averageFleetDps: 0,
      activeFleetDps: 0,
      damageTaken: 0,
      remoteRepairDelivered: 0,
      participantCount: 0,
    },
    characterMetrics: [],
    coverage: {
      logFiles: 0,
      participantsWithOutgoingDamage: 0,
      unparsedCombatLines: 0,
      ambiguousEventsExcluded: 0,
      repairPairing: 'none' as const,
    },
    notes: null,
    fingerprint: 'abc123',
    createdAt: '2026-09-03T05:05:12.000Z',
    updatedAt: '2026-09-03T05:05:12.000Z',
  };
}

// ---------------------------------------------------------------------------
// Existing brief-mandated test (preserved verbatim)
// ---------------------------------------------------------------------------
describe('RunSummarySchema', () => {
  it('round-trips recorded neutralization coverage without changing the summary version', () => {
    const summary = minimalRunSummaryFields('recorded-neut-run');
    const recorded = { ...summary, coverage: { ...summary.coverage, neutPressure: 'recorded' } };

    expect(RunSummarySchema.parse(JSON.parse(JSON.stringify(recorded)))).toEqual(recorded);
  });

  it('accepts a minimal valid run summary', () => {
    const parsed = RunSummarySchema.parse({
      schemaVersion: 1,
      parserVersion: '0.1.0',
      metricsVersion: '0.1.0',
      id: '2026-09-03T045114Z-core-bastion',
      site: { name: 'Core Bastion', key: 'core-bastion' },
      fleetProfile: { id: '8-kikis-2-deacons', name: '8 Kikis + 2 Deacons' },
      window: {
        start: '2026-09-03T04:51:14.000Z',
        end: '2026-09-03T05:03:36.000Z',
        source: 'first-and-last-outgoing-npc-damage',
        manuallyAdjusted: false,
      },
      participants: [],
      calculation: {
        episodeThresholdSeconds: 180,
        activeCombatGapSeconds: 30,
      },
      metrics: {
        elapsedSeconds: 742,
        activeCombatSeconds: 694,
        idleSeconds: 48,
        fleetDamageDealt: 0,
        averageFleetDps: 0,
        activeFleetDps: 0,
        damageTaken: 0,
        remoteRepairDelivered: 0,
        participantCount: 0,
      },
      characterMetrics: [],
      coverage: {
        logFiles: 0,
        participantsWithOutgoingDamage: 0,
        unparsedCombatLines: 0,
        ambiguousEventsExcluded: 0,
        repairPairing: 'none',
      },
      notes: null,
      fingerprint: 'abc123',
      createdAt: '2026-09-03T05:05:12.000Z',
      updatedAt: '2026-09-03T05:05:12.000Z',
    });
    expect(parsed.site.key).toBe('core-bastion');
  });
});

// ---------------------------------------------------------------------------
// Strict unknown-key rejection
// ---------------------------------------------------------------------------
describe('strict schema rejection', () => {
  it('rejects an unknown key on SiteIdentitySchema', () => {
    expect(() =>
      SiteIdentitySchema.parse({ name: 'Core Bastion', key: 'core-bastion', extra: true }),
    ).toThrow();
  });

  it('rejects an unknown key on a RunSummary coverage sub-object', () => {
    expect(() =>
      RunSummarySchema.parse({
        schemaVersion: 1,
        parserVersion: '0.1.0',
        metricsVersion: '0.1.0',
        id: 'x',
        site: { name: 'S', key: 's' },
        fleetProfile: { id: 'f', name: 'F' },
        window: {
          start: '2026-01-01T00:00:00.000Z',
          end: '2026-01-01T01:00:00.000Z',
          source: 'auto',
          manuallyAdjusted: false,
        },
        participants: [],
        calculation: { episodeThresholdSeconds: 180, activeCombatGapSeconds: 30 },
        metrics: {
          elapsedSeconds: 0,
          activeCombatSeconds: 0,
          idleSeconds: 0,
          fleetDamageDealt: 0,
          averageFleetDps: 0,
          activeFleetDps: 0,
          damageTaken: 0,
          remoteRepairDelivered: 0,
          participantCount: 0,
        },
        characterMetrics: [],
        coverage: {
          logFiles: 0,
          participantsWithOutgoingDamage: 0,
          unparsedCombatLines: 0,
          ambiguousEventsExcluded: 0,
          repairPairing: 'none',
          unknownExtra: 'oops', // must be rejected
        },
        notes: null,
        fingerprint: 'x',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// NormalizedEvent – five kinds (Task 3 / Task 2 contract)
// ---------------------------------------------------------------------------
describe('NormalizedEventSchema', () => {
  const base = {
    timestamp: '2026-09-03T04:51:14.000Z',
    observedBy: 'Pilot One',
    sourceFile: 'Gamelogs_20260903_045114.txt',
    sourceLine: 42,
    raw: '[ 2026.09.03 04:51:14 ] (combat) 487 to Sansha Slave Soldier...',
  };

  it('accepts a damage-dealt event with npc targetClassification', () => {
    const evt = NormalizedEventSchema.parse({
      ...base,
      kind: 'damage-dealt',
      actor: 'Pilot One',
      target: 'Sansha Slave Soldier',
      amount: 487,
      hitQuality: 'Wrecking',
      targetClassification: 'npc',
    });
    expect(evt.kind).toBe('damage-dealt');
  });

  it('accepts a damage-taken event', () => {
    const evt = NormalizedEventSchema.parse({
      ...base,
      kind: 'damage-taken',
      actor: 'Sansha Slave Soldier',
      target: 'Pilot One',
      amount: 120,
      hitQuality: null,
    });
    expect(evt.kind).toBe('damage-taken');
  });

  it('accepts a miss event with targetClassification', () => {
    const evt = NormalizedEventSchema.parse({
      ...base,
      kind: 'miss',
      actor: 'Pilot One',
      target: 'Sansha Slave Soldier',
      targetClassification: 'npc',
    });
    expect(evt.kind).toBe('miss');
  });

  it('accepts a remote-repair-delivered event', () => {
    const evt = NormalizedEventSchema.parse({
      ...base,
      kind: 'remote-repair-delivered',
      actor: 'Pilot One',
      target: 'Pilot Two',
      amount: 300,
    });
    expect(evt.kind).toBe('remote-repair-delivered');
  });

  it('accepts a remote-repair-received event', () => {
    const evt = NormalizedEventSchema.parse({
      ...base,
      kind: 'remote-repair-received',
      actor: 'Pilot Two',
      target: 'Pilot One',
      amount: 300,
    });
    expect(evt.kind).toBe('remote-repair-received');
  });

  it('rejects an unknown event kind', () => {
    expect(() =>
      NormalizedEventSchema.parse({ ...base, kind: 'outgoing-npc-damage', actor: 'x', target: 'y', amount: 0 }),
    ).toThrow();
  });

  it('rejects damage-dealt with an unknown key', () => {
    expect(() =>
      NormalizedEventSchema.parse({
        ...base,
        kind: 'damage-dealt',
        actor: 'Pilot One',
        target: 'Sansha',
        amount: 100,
        hitQuality: null,
        targetClassification: 'npc',
        extraField: true,
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// CharacterMetrics – Task 3 contract fields
// ---------------------------------------------------------------------------
describe('CharacterMetricsSchema', () => {
  it('accepts a full character metrics record', () => {
    const cm = CharacterMetricsSchema.parse({
      character: 'Pilot One',
      damageDealt: 124500,
      fleetDamageShare: 0.42,
      averageDps: 167.9,
      activeDps: 179.4,
      damageTaken: 8200,
      remoteRepairDelivered: 0,
      remoteRepairReceived: 1500,
      shotsHit: 88,
      shotsMissed: 4,
      missRate: 0.0435,
      hitQualityCounts: { Wrecking: 12, Excellent: 30, Good: 46 },
      firstRelevantEvent: '2026-09-03T04:51:14.000Z',
      lastRelevantEvent: '2026-09-03T05:03:36.000Z',
    });
    expect(cm.character).toBe('Pilot One');
    expect(cm.hitQualityCounts['Wrecking']).toBe(12);
  });

  it('accepts null firstRelevantEvent and lastRelevantEvent', () => {
    const cm = CharacterMetricsSchema.parse({
      character: 'Pilot Two',
      damageDealt: 0,
      fleetDamageShare: 0,
      averageDps: 0,
      activeDps: 0,
      damageTaken: 0,
      remoteRepairDelivered: 0,
      remoteRepairReceived: 0,
      shotsHit: 0,
      shotsMissed: 0,
      missRate: 0,
      hitQualityCounts: {},
      firstRelevantEvent: null,
      lastRelevantEvent: null,
    });
    expect(cm.firstRelevantEvent).toBeNull();
  });

  it('rejects an unknown key on CharacterMetrics', () => {
    expect(() =>
      CharacterMetricsSchema.parse({
        character: 'x',
        damageDealt: 0,
        fleetDamageShare: 0,
        averageDps: 0,
        activeDps: 0,
        damageTaken: 0,
        remoteRepairDelivered: 0,
        remoteRepairReceived: 0,
        shotsHit: 0,
        shotsMissed: 0,
        missRate: 0,
        hitQualityCounts: {},
        firstRelevantEvent: null,
        lastRelevantEvent: null,
        legacyField: 'oops',
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// RunSummary.id — must be a single safe path segment (no traversal)
// ---------------------------------------------------------------------------
describe('RunSummarySchema.id path-segment safety', () => {
  it('accepts a normally-generated id (datetime + site key)', () => {
    const parsed = RunSummarySchema.parse(minimalRunSummaryFields('2026-09-03T045114Z-core-bastion'));
    expect(parsed.id).toBe('2026-09-03T045114Z-core-bastion');
  });

  it('rejects an id containing a path-traversal segment', () => {
    expect(() => RunSummarySchema.parse(minimalRunSummaryFields('../../outside-archive'))).toThrow();
  });

  it('rejects an id containing a path separator', () => {
    expect(() => RunSummarySchema.parse(minimalRunSummaryFields('sub/dir'))).toThrow();
  });

  it('rejects an id that is exactly "." or ".."', () => {
    expect(() => RunSummarySchema.parse(minimalRunSummaryFields('.'))).toThrow();
    expect(() => RunSummarySchema.parse(minimalRunSummaryFields('..'))).toThrow();
  });

  it('rejects an id starting with a dot (would collide with reserved/hidden archive entries)', () => {
    expect(() => RunSummarySchema.parse(minimalRunSummaryFields('.hidden-id'))).toThrow();
  });

  it('RUN_ID_PATTERN agrees with the schema for both an accepted and a rejected id', () => {
    expect(RUN_ID_PATTERN.test('2026-09-03T045114Z-core-bastion')).toBe(true);
    expect(RUN_ID_PATTERN.test('../../outside-archive')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isIsoDateTime — the shared persisted-timestamp contract
// ---------------------------------------------------------------------------
describe('isIsoDateTime', () => {
  it.each([
    '2026-09-03T05:00:00.000Z',
    '2026-09-03T05:00:00Z',
    '2026-09-03T05:00:00+02:00',
  ])('accepts the persisted ISO form %s', (value) => {
    expect(isIsoDateTime(value)).toBe(true);
    expect(RunWindowSchema.safeParse({ start: value, end: value, source: 'manual', manuallyAdjusted: true }).success).toBe(true);
  });

  it.each([
    // Date.parse accepts these, RunWindowSchema does not.
    '2026-09-03 05:00',
    '2026-09-03',
    'September 3, 2026 05:00:00',
    '2026-09-03T05:00:00',
    '',
    'not a timestamp',
  ])('rejects the non-schema input %s', (value) => {
    expect(isIsoDateTime(value)).toBe(false);
    expect(RunWindowSchema.safeParse({ start: value, end: value, source: 'manual', manuallyAdjusted: true }).success).toBe(false);
  });

  it('rejects a non-string value', () => {
    expect(isIsoDateTime(undefined)).toBe(false);
    expect(isIsoDateTime(Date.parse('2026-09-03T05:00:00.000Z'))).toBe(false);
  });
});
