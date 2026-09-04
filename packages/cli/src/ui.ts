import { confirm, input, select } from '@inquirer/prompts';
import { isIsoDateTime } from '@sitbench/core';
import type { AnalyzePrompts, CandidateChoice } from './analyze-command.js';
import type { EditPrompts, WindowEditChoice } from './edit-command.js';

interface InputConfiguration {
  message: string;
  default?: string;
  validate?: (value: string) => boolean | string | Promise<boolean | string>;
}

interface SelectChoice<Value> {
  name: string;
  value: Value;
}

interface SelectConfiguration<Value> {
  message: string;
  choices: readonly SelectChoice<Value>[];
}

interface ConfirmConfiguration {
  message: string;
  default?: boolean;
}

export interface InteractivePromptDependencies {
  input: (configuration: InputConfiguration) => Promise<string>;
  select: <Value>(configuration: SelectConfiguration<Value>) => Promise<Value>;
  confirm: (configuration: ConfirmConfiguration) => Promise<boolean>;
}

const defaultDependencies: InteractivePromptDependencies = { input, select, confirm };
interface ExistingProfileSelection {
  kind: 'existing';
  name: string;
}

type ProfileSelection = ExistingProfileSelection | { kind: 'create' };

/**
 * Adapts the injected prompt contract used by orchestration to Inquirer's
 * concrete terminal prompts. Tests can provide deterministic prompt functions
 * without replacing analysis or archive behavior.
 */
export function createInteractivePrompts(
  dependencies: InteractivePromptDependencies = defaultDependencies,
): AnalyzePrompts {
  return {
    async confirmCandidate({ candidate, candidates }): Promise<CandidateChoice> {
      const action = await dependencies.select({
        message: `Use ${candidate.start} to ${candidate.end}?`,
        choices: [
          { name: 'Accept this candidate', value: 'accept' },
          { name: 'Adjust the window', value: 'adjust' },
          { name: 'Select another candidate', value: 'select' },
          { name: 'Cancel analysis', value: 'cancel' },
        ],
      });
      if (action === 'adjust') {
        const start = await dependencies.input({
          message: 'Adjusted start (ISO timestamp):',
          validate: isoTimestamp('An adjusted start timestamp is required.'),
        });
        const end = await dependencies.input({
          message: 'Adjusted end (ISO timestamp):',
          validate: isoTimestamp('An adjusted end timestamp is required.'),
        });
        return { action, start: start.trim(), end: end.trim() };
      }
      if (action === 'select') {
        const index = await dependencies.select({
          message: 'Choose a candidate window:',
          choices: candidates.map((window, candidateIndex) => ({
            name: `${window.start} to ${window.end} (${window.qualifyingEventCount} qualifying events)`,
            value: candidateIndex,
          })),
        });
        return { action, index };
      }
      return action === 'accept' ? { action } : { action: 'cancel' };
    },
    async requestSite(initial): Promise<string> {
      const site = await dependencies.input({
        message: 'Site:',
        ...(initial === undefined ? {} : { default: initial }),
        validate: required('A site name is required.'),
      });
      return site.trim();
    },
    async requestProfile(profiles, initial): Promise<string> {
      if (profiles.length === 0) {
        return requiredProfile(dependencies, initial);
      }
      const selected = await dependencies.select<ProfileSelection>({
        message: 'Fleet profile:',
        choices: [
          ...profiles.map((profile) => ({
            name: profile.name,
            value: { kind: 'existing' as const, name: profile.name },
          })),
          { name: 'Create a new fleet profile', value: { kind: 'create' as const } },
        ],
      });
      return selected.kind === 'create' ? requiredProfile(dependencies, initial) : selected.name;
    },
    async requestNotes(): Promise<string | null> {
      const notes = await dependencies.input({ message: 'Notes (optional):' });
      return notes.trim() || null;
    },
    confirmSave: async () => dependencies.confirm({ message: 'Save this run?', default: false }),
  };
}

/** Backwards-compatible name for the executable's interactive prompt adapter. */
export function createConsolePrompts(): AnalyzePrompts {
  return createInteractivePrompts();
}

/**
 * Adapts the `edit` command's injected prompt contract to Inquirer's
 * concrete terminal prompts, mirroring `createInteractivePrompts`.
 */
export function createEditPrompts(dependencies: InteractivePromptDependencies = defaultDependencies): EditPrompts {
  return {
    async requestSite(current): Promise<string> {
      const site = await dependencies.input({
        message: 'Site:',
        default: current,
        validate: required('A site name is required.'),
      });
      return site.trim();
    },
    async requestProfile(profiles, current): Promise<string> {
      if (profiles.length === 0) {
        return requiredProfile(dependencies, current);
      }
      const selected = await dependencies.select<ProfileSelection>({
        message: 'Fleet profile:',
        choices: [
          ...profiles.map((profile) => ({
            name: profile.name,
            value: { kind: 'existing' as const, name: profile.name },
          })),
          { name: 'Create a new fleet profile', value: { kind: 'create' as const } },
        ],
      });
      return selected.kind === 'create' ? requiredProfile(dependencies, current) : selected.name;
    },
    async requestNotes(current): Promise<string | null> {
      const notes = await dependencies.input({
        message: 'Notes (optional):',
        ...(current === null ? {} : { default: current }),
      });
      return notes.trim() || null;
    },
    async requestWindow(current): Promise<WindowEditChoice> {
      const action = await dependencies.select({
        message: `Confirmed window is ${current.start} to ${current.end}. Change it?`,
        choices: [
          { name: 'Keep the current window', value: 'keep' },
          { name: 'Adjust the window', value: 'adjust' },
        ],
      });
      if (action !== 'adjust') {
        return { action: 'keep' };
      }
      const start = await dependencies.input({
        message: 'Adjusted start (ISO timestamp):',
        default: current.start,
        validate: isoTimestamp('An adjusted start timestamp is required.'),
      });
      const end = await dependencies.input({
        message: 'Adjusted end (ISO timestamp):',
        default: current.end,
        validate: isoTimestamp('An adjusted end timestamp is required.'),
      });
      return { action: 'adjust', start: start.trim(), end: end.trim() };
    },
    confirmSave: async (pending) => dependencies.confirm({ message: `Save changes to run ${pending.id}?`, default: false }),
  };
}

async function requiredProfile(dependencies: InteractivePromptDependencies, initial: string | undefined): Promise<string> {
  const profile = await dependencies.input({
    message: 'New fleet profile:',
    ...(initial === undefined ? {} : { default: initial }),
    validate: required('A fleet profile is required.'),
  });
  return profile.trim();
}

function required(message: string): (value: string) => boolean | string {
  return (value) => (value.trim().length > 0 ? true : message);
}

/**
 * Rejects an adjusted-window timestamp that does not satisfy the persisted
 * ISO-with-offset contract, in the terminal, before the command boundary
 * sees it. `Date.parse` would accept forms such as "2026-09-03 05:00" that
 * the archive can never store, so this uses the same `isIsoDateTime` rule
 * the command boundary re-checks. Prompt validation is a convenience only:
 * `runAnalyze`/`runEdit` validate independently, so an injected prompt
 * cannot bypass it.
 */
function isoTimestamp(emptyMessage: string): (value: string) => boolean | string {
  return (value) => {
    const trimmed = value.trim();
    if (trimmed.length === 0) return emptyMessage;
    return isIsoDateTime(trimmed)
      ? true
      : 'Enter an ISO 8601 timestamp with a UTC offset, for example 2026-09-03T05:00:00Z.';
  };
}
