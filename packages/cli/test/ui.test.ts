import { describe, expect, it } from 'vitest';
import { createEditPrompts, createInteractivePrompts } from '../src/ui.js';

const candidate = {
  start: '2026-09-03T04:04:00.000Z',
  end: '2026-09-03T04:04:20.000Z',
  qualifyingEventCount: 2,
  previousQualifyingActivityAt: '2026-09-03T04:00:20.000Z',
  nextQualifyingActivityAt: null,
};

describe('createInteractivePrompts', () => {
  it('returns an adjusted candidate window from interactive choices', async () => {
    const answers = ['adjust', '2026-09-03T04:03:55.000Z', '2026-09-03T04:04:25.000Z'];
    const prompts = createInteractivePrompts({
      select: async (configuration) =>
        (configuration.message === 'Fleet profile:' ? { kind: 'create' } : answers.shift()) as never,
      input: async () => answers.shift() as string,
      confirm: async () => true,
    });

    await expect(prompts.confirmCandidate({ candidate, candidates: [candidate] })).resolves.toEqual({
      action: 'adjust',
      start: '2026-09-03T04:03:55.000Z',
      end: '2026-09-03T04:04:25.000Z',
    });
  });

  it('offers an existing profile or creates and validates a nonblank profile name', async () => {
    const validationResults: Array<string | boolean | undefined> = [];
    const prompts = createInteractivePrompts({
      select: async () => ({ kind: 'create' }) as never,
      input: async (configuration) => {
        validationResults.push(await configuration.validate?.('   '));
        validationResults.push(await configuration.validate?.('8 Kikis + 2 Deacons'));
        return '8 Kikis + 2 Deacons';
      },
      confirm: async () => true,
    });

    await expect(
      prompts.requestProfile([{ id: 'solo', name: 'Solo Vindicator' }], undefined),
    ).resolves.toBe('8 Kikis + 2 Deacons');
    expect(validationResults).toEqual(['A fleet profile is required.', true]);
  });

  it('selects an existing profile named create instead of treating it as the new-profile sentinel', async () => {
    const prompts = createInteractivePrompts({
      select: async (configuration) => configuration.choices[0]?.value as never,
      input: async () => 'unexpected new profile',
      confirm: async () => true,
    });

    await expect(prompts.requestProfile([{ id: 'create', name: 'create' }], undefined)).resolves.toBe('create');
  });

  it('validates required site input while retaining optional notes and final confirmation', async () => {
    const validationResults: Array<string | boolean | undefined> = [];
    const inputs = ['Core Bastion', 'clean run'];
    const prompts = createInteractivePrompts({
      select: async () => 'accept',
      input: async (configuration) => {
        if (configuration.message.startsWith('Site')) {
          validationResults.push(await configuration.validate?.(''));
          validationResults.push(await configuration.validate?.('Core Bastion'));
        }
        return inputs.shift() as string;
      },
      confirm: async () => true,
    });

    await expect(prompts.requestSite(undefined)).resolves.toBe('Core Bastion');
    await expect(prompts.requestNotes()).resolves.toBe('clean run');
    await expect(prompts.confirmSave({} as never)).resolves.toBe(true);
    expect(validationResults).toEqual(['A site name is required.', true]);
  });
});

describe('createEditPrompts', () => {
  const currentWindow = {
    start: '2026-09-03T04:51:14.000Z',
    end: '2026-09-03T04:53:14.000Z',
    source: 'first-and-last-outgoing-npc-damage',
    manuallyAdjusted: false,
  };

  it('defaults site, profile-create, and notes inputs to the run current values', async () => {
    const prompts = createEditPrompts({
      select: async () => ({ kind: 'create' }) as never,
      input: async (configuration) => configuration.default ?? '',
      confirm: async () => true,
    });

    await expect(prompts.requestSite('Core Bastion')).resolves.toBe('Core Bastion');
    await expect(
      prompts.requestProfile([{ id: 'solo', name: 'Solo Vindicator' }], '8 Kikis + 2 Deacons'),
    ).resolves.toBe('8 Kikis + 2 Deacons');
    await expect(prompts.requestNotes('existing notes')).resolves.toBe('existing notes');
  });

  it('returns keep when the window select answer is not adjust, without prompting for new timestamps', async () => {
    let inputCalls = 0;
    const prompts = createEditPrompts({
      select: async () => 'keep',
      input: async () => {
        inputCalls += 1;
        return '';
      },
      confirm: async () => true,
    });

    await expect(prompts.requestWindow(currentWindow)).resolves.toEqual({ action: 'keep' });
    expect(inputCalls).toBe(0);
  });

  it('returns an adjusted window defaulted to the current bounds and validated as required', async () => {
    const validationResults: Array<string | boolean | undefined> = [];
    const prompts = createEditPrompts({
      select: async () => 'adjust',
      input: async (configuration) => {
        validationResults.push(await configuration.validate?.(''));
        return configuration.default ?? '';
      },
      confirm: async () => true,
    });

    await expect(prompts.requestWindow(currentWindow)).resolves.toEqual({
      action: 'adjust',
      start: currentWindow.start,
      end: currentWindow.end,
    });
    expect(validationResults).toEqual([
      'An adjusted start timestamp is required.',
      'An adjusted end timestamp is required.',
    ]);
  });

  it('confirms save using the pending run id', async () => {
    let confirmedMessage = '';
    const prompts = createEditPrompts({
      select: async () => 'keep',
      input: async () => '',
      confirm: async (configuration) => {
        confirmedMessage = configuration.message;
        return true;
      },
    });

    await expect(prompts.confirmSave({ id: 'run-1' } as never)).resolves.toBe(true);
    expect(confirmedMessage).toBe('Save changes to run run-1?');
  });
});
