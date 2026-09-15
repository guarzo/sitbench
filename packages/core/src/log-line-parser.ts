import {
  DamageDealtSchema,
  DamageTakenSchema,
  MissSchema,
  NeutReceivedSchema,
  RemoteRepairDeliveredSchema,
  RemoteRepairReceivedSchema,
  type NormalizedEvent,
} from './schemas.js';
import { classifyTarget } from './target-classifier.js';

const TIMESTAMPED_COMBAT_LINE =
  /^\[ (?<year>\d{4})\.(?<month>\d{2})\.(?<day>\d{2}) (?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2}) \] \(combat\) (?<body>.+)$/;
const HIT_QUALITY_PATTERN = 'Hits|Smashes|Penetrates|Grazes|Glances Off|Barely Scratches|Wrecks|Wrecking';
const OUTGOING_DAMAGE_LINE = new RegExp(
  `^(?<amount>\\d+) from (?<actor>.+?) - (?<weapon>.+?) - (?<hitQuality>${HIT_QUALITY_PATTERN}) (?<target>.+)$`,
);
const EVE_OUTGOING_DAMAGE_LINE = new RegExp(
  `^(?<amount>\\d+) to (?<target>.+?) - (?<weapon>.+?) - (?<hitQuality>${HIT_QUALITY_PATTERN})$`,
);
const EVE_MARKUP = /<\/?b>|<\/?font(?:\s+[^>]*)?>|<\/?color(?:=[^>]*)?>/gi;
const INCOMING_DAMAGE_LINE = new RegExp(
  `^(?<amount>\\d+) from (?<actor>.+?) - (?<hitQuality>${HIT_QUALITY_PATTERN}) (?<target>.+)$`,
);
const EVE_INCOMING_DAMAGE_LINE = new RegExp(
  `^(?<amount>\\d+) from (?<actor>.+?) - (?<weapon>.+?) - (?<hitQuality>${HIT_QUALITY_PATTERN})$`,
);
// The prose is also used for outgoing neutralization; only the verified red
// amount markup establishes that the observing character received it.
const INCOMING_NEUT_AMOUNT = /^<color=0xffe57f7f><b>\d+(?:\.\d+)? GJ<\/b>/i;
const INCOMING_NEUT_LINE = /^(?<amount>\d+(?:\.\d+)?) GJ energy neutralized (?<actor>.+?) - .+$/;
const MISS_LINE = /^Your (?<weapon>.+?) misses (?<target>.+?) completely$/;
const REMOTE_REPAIR_DELIVERED_LINE =
  /^(?<amount>\d+) remote (?<repairKind>shield boosted|armor repaired) to (?<target>.+?) by (?<actor>.+)$/;
const EVE_REMOTE_REPAIR_DELIVERED_LINE =
  /^(?<amount>\d+) remote (?<repairKind>shield boosted|armor repaired) to (?<target>.+?) - (?<module>.+)$/;
const REMOTE_REPAIR_RECEIVED_LINE =
  /^(?<amount>\d+) remote (?<repairKind>shield boosted|armor repaired) by (?<actor>.+?) to (?<target>.+)$/;
const EVE_REMOTE_REPAIR_RECEIVED_LINE =
  /^(?<amount>\d+) remote (?<repairKind>shield boosted|armor repaired) by (?<actor>.+?) - (?<module>.+)$/;

export interface SourceContext {
  observedBy: string;
  sourceFile: string;
  sourceLine: number;
}

export type ParsedObservation = NormalizedEvent;

export type CombatLineInspection =
  | { status: 'parsed'; event: ParsedObservation }
  | { status: 'unsupported' }
  | { status: 'malformed' };

interface TimestampGroups {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
}

export function inspectCombatLine(line: string, source: SourceContext): CombatLineInspection {
  if (!line.includes('(combat)')) {
    return { status: 'unsupported' };
  }

  const envelope = TIMESTAMPED_COMBAT_LINE.exec(line);
  if (!envelope?.groups) {
    return { status: 'malformed' };
  }

  const timestamp = parseUtcTimestamp(envelope.groups as unknown as TimestampGroups);
  if (timestamp === null) {
    return { status: 'malformed' };
  }

  const rawBody = requiredGroup(envelope.groups.body);
  const body = rawBody.replace(EVE_MARKUP, '').trim();
  const baseEvent = {
    timestamp,
    observedBy: source.observedBy,
    sourceFile: source.sourceFile,
    sourceLine: source.sourceLine,
    raw: line,
  };

  const incomingNeut = INCOMING_NEUT_AMOUNT.test(rawBody) ? INCOMING_NEUT_LINE.exec(body) : null;
  if (incomingNeut?.groups) {
    return {
      status: 'parsed',
      event: NeutReceivedSchema.parse({
        ...baseEvent,
        kind: 'neut-received',
        actor: requiredGroup(incomingNeut.groups.actor).trim(),
        target: source.observedBy,
        amount: Number(requiredGroup(incomingNeut.groups.amount)),
      }),
    };
  }

  const eveOutgoingDamage = EVE_OUTGOING_DAMAGE_LINE.exec(body);
  if (eveOutgoingDamage?.groups) {
    const target = requiredGroup(eveOutgoingDamage.groups.target).trim();

    return {
      status: 'parsed',
      event: DamageDealtSchema.parse({
        ...baseEvent,
        kind: 'damage-dealt',
        actor: source.observedBy,
        target,
        amount: Number.parseInt(requiredGroup(eveOutgoingDamage.groups.amount), 10),
        hitQuality: requiredGroup(eveOutgoingDamage.groups.hitQuality),
        targetClassification: classifyTarget(target),
      }),
    };
  }

  const outgoingDamage = OUTGOING_DAMAGE_LINE.exec(body);
  if (outgoingDamage?.groups) {
    const actor = requiredGroup(outgoingDamage.groups.actor).trim();
    const target = requiredGroup(outgoingDamage.groups.target).trim();

    if (!matchesObservedBy(actor, source.observedBy)) {
      return { status: 'unsupported' };
    }

    return {
      status: 'parsed',
      event: DamageDealtSchema.parse({
        ...baseEvent,
        kind: 'damage-dealt',
        actor: source.observedBy,
        target,
        amount: Number.parseInt(requiredGroup(outgoingDamage.groups.amount), 10),
        hitQuality: requiredGroup(outgoingDamage.groups.hitQuality),
        targetClassification: classifyTarget(target),
      }),
    };
  }

  const eveIncomingDamage = EVE_INCOMING_DAMAGE_LINE.exec(body);
  if (eveIncomingDamage?.groups) {
    return {
      status: 'parsed',
      event: DamageTakenSchema.parse({
        ...baseEvent,
        kind: 'damage-taken',
        actor: requiredGroup(eveIncomingDamage.groups.actor).trim(),
        target: source.observedBy,
        amount: Number.parseInt(requiredGroup(eveIncomingDamage.groups.amount), 10),
        hitQuality: requiredGroup(eveIncomingDamage.groups.hitQuality),
      }),
    };
  }

  const incomingDamage = INCOMING_DAMAGE_LINE.exec(body);
  if (incomingDamage?.groups) {
    const target = requiredGroup(incomingDamage.groups.target).trim();

    if (target !== source.observedBy) {
      return { status: 'unsupported' };
    }

    return {
      status: 'parsed',
      event: DamageTakenSchema.parse({
        ...baseEvent,
        kind: 'damage-taken',
        actor: requiredGroup(incomingDamage.groups.actor).trim(),
        target: source.observedBy,
        amount: Number.parseInt(requiredGroup(incomingDamage.groups.amount), 10),
        hitQuality: requiredGroup(incomingDamage.groups.hitQuality),
      }),
    };
  }

  const miss = MISS_LINE.exec(body);
  if (miss?.groups) {
    const target = requiredGroup(miss.groups.target).trim();

    return {
      status: 'parsed',
      event: MissSchema.parse({
        ...baseEvent,
        kind: 'miss',
        actor: source.observedBy,
        target,
        targetClassification: classifyTarget(target),
      }),
    };
  }

  const eveRemoteRepairDelivered = EVE_REMOTE_REPAIR_DELIVERED_LINE.exec(body);
  if (eveRemoteRepairDelivered?.groups) {
    return {
      status: 'parsed',
      event: RemoteRepairDeliveredSchema.parse({
        ...baseEvent,
        kind: 'remote-repair-delivered',
        actor: source.observedBy,
        target: requiredGroup(eveRemoteRepairDelivered.groups.target).trim(),
        amount: Number.parseInt(requiredGroup(eveRemoteRepairDelivered.groups.amount), 10),
      }),
    };
  }

  const remoteRepairDelivered = REMOTE_REPAIR_DELIVERED_LINE.exec(body);
  if (remoteRepairDelivered?.groups) {
    const actor = requiredGroup(remoteRepairDelivered.groups.actor).trim();

    if (!matchesObservedBy(actor, source.observedBy)) {
      return { status: 'unsupported' };
    }

    return {
      status: 'parsed',
      event: RemoteRepairDeliveredSchema.parse({
        ...baseEvent,
        kind: 'remote-repair-delivered',
        actor: source.observedBy,
        target: requiredGroup(remoteRepairDelivered.groups.target).trim(),
        amount: Number.parseInt(requiredGroup(remoteRepairDelivered.groups.amount), 10),
      }),
    };
  }

  const eveRemoteRepairReceived = EVE_REMOTE_REPAIR_RECEIVED_LINE.exec(body);
  if (eveRemoteRepairReceived?.groups) {
    return {
      status: 'parsed',
      event: RemoteRepairReceivedSchema.parse({
        ...baseEvent,
        kind: 'remote-repair-received',
        actor: requiredGroup(eveRemoteRepairReceived.groups.actor).trim(),
        target: source.observedBy,
        amount: Number.parseInt(requiredGroup(eveRemoteRepairReceived.groups.amount), 10),
      }),
    };
  }

  const remoteRepairReceived = REMOTE_REPAIR_RECEIVED_LINE.exec(body);
  if (remoteRepairReceived?.groups) {
    const target = requiredGroup(remoteRepairReceived.groups.target).trim();

    if (target !== source.observedBy) {
      return { status: 'unsupported' };
    }

    return {
      status: 'parsed',
      event: RemoteRepairReceivedSchema.parse({
        ...baseEvent,
        kind: 'remote-repair-received',
        actor: requiredGroup(remoteRepairReceived.groups.actor).trim(),
        target: source.observedBy,
        amount: Number.parseInt(requiredGroup(remoteRepairReceived.groups.amount), 10),
      }),
    };
  }

  return { status: 'unsupported' };
}

export function parseCombatLine(line: string, source: SourceContext): ParsedObservation | null {
  const inspection = inspectCombatLine(line, source);

  return inspection.status === 'parsed' ? inspection.event : null;
}

function parseUtcTimestamp(groups: TimestampGroups): string | null {
  const year = Number.parseInt(groups.year, 10);
  const month = Number.parseInt(groups.month, 10);
  const day = Number.parseInt(groups.day, 10);
  const hour = Number.parseInt(groups.hour, 10);
  const minute = Number.parseInt(groups.minute, 10);
  const second = Number.parseInt(groups.second, 10);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    return null;
  }

  return date.toISOString();
}

function matchesObservedBy(candidate: string, observedBy: string): boolean {
  const observedPattern = new RegExp(`^${escapeForRegExp(observedBy)}(?:\\[[^\\]]+\\])?$`);
  return observedPattern.test(candidate);
}

function requiredGroup(value: string | undefined): string {
  if (value === undefined) {
    throw new Error('Expected regex capture group to be defined');
  }

  return value;
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
