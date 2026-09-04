import { describe, expect, it } from 'vitest';
import { RunSummarySchema } from '../src/schemas.js';

describe('RunSummarySchema', () => {
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
