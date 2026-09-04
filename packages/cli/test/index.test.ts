import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createProgram, isDirectEntryPoint, runCli } from '../src/index.js';

describe('isDirectEntryPoint', () => {
  it('matches a resolved argv entry path to its module URL, but not a different path', () => {
    const modulePath = fileURLToPath(import.meta.url);
    const equivalentArgvPath = relative(process.cwd(), modulePath);

    expect(isDirectEntryPoint(import.meta.url, equivalentArgvPath)).toBe(true);
    expect(isDirectEntryPoint(import.meta.url, `${modulePath}.other`)).toBe(false);
  });
});

describe('runCli', () => {
  it('returns a nonzero exit code when injected analyze execution reports a fatal result', async () => {
    await expect(
      runCli(['analyze'], { execute: async () => ({ status: 'fatal', reason: 'logs' }) }),
    ).resolves.toBe(1);
  });

  it('returns a nonzero exit code when injected recalculate execution reports a fatal result', async () => {
    await expect(
      runCli(['recalculate', '--all'], {
        executeRecalculate: async () => ({ status: 'fatal', reason: 'missing-target' }),
      }),
    ).resolves.toBe(1);
  });

  it('returns zero when injected recalculate execution reports per-run outcomes', async () => {
    await expect(
      runCli(['recalculate', 'run-1'], {
        executeRecalculate: async () => ({ status: 'ok', outcomes: [{ id: 'run-1', status: 'recalculated' }] }),
      }),
    ).resolves.toBe(0);
  });

  it('returns a nonzero exit code when injected edit execution reports a fatal result', async () => {
    await expect(
      runCli(['edit', 'run-1'], { executeEdit: async () => ({ status: 'fatal', reason: 'not-found' }) }),
    ).resolves.toBe(1);
  });
});

describe('createProgram', () => {
  it('uses Commander help and executes exactly the planned analyze options through an injected runner', async () => {
    let executed: unknown;
    const output: string[] = [];
    const program = createProgram({
      execute: async (arguments_) => {
        executed = arguments_;
        return { status: 'saved', id: 'run-1' };
      },
    });
    program.configureOutput({ writeOut: (line) => output.push(line), writeErr: (line) => output.push(line) });
    program.exitOverride();

    await program.parseAsync(
      ['node', 'sitbench', 'analyze', '--site', 'Core Bastion', '--profile', '8 Kikis + 2 Deacons', '--logs', '/logs', '--archive', '/archive'],
      { from: 'node' },
    );
    expect(executed).toEqual({
      site: 'Core Bastion',
      profile: '8 Kikis + 2 Deacons',
      logs: '/logs',
      archive: '/archive',
    });

    await expect(program.parseAsync(['node', 'sitbench', '--help'], { from: 'node' })).rejects.toMatchObject({ exitCode: 0 });
    expect(output.join('')).toContain('Usage: sitbench [options] [command]');
    expect(output.join('')).toContain('analyze [options]');
    expect(output.join('')).toContain('recalculate [options]');
    expect(output.join('')).toContain('edit [options]');
  });

  it('executes exactly the planned recalculate options through an injected runner', async () => {
    let executed: unknown;
    const program = createProgram({
      executeRecalculate: async (arguments_) => {
        executed = arguments_;
        return { status: 'ok', outcomes: [] };
      },
    });
    program.exitOverride();

    await program.parseAsync(['node', 'sitbench', 'recalculate', 'run-1', '--archive', '/archive'], { from: 'node' });
    expect(executed).toEqual({ runId: 'run-1', archive: '/archive' });

    await program.parseAsync(['node', 'sitbench', 'recalculate', '--all', '--archive', '/archive'], { from: 'node' });
    expect(executed).toEqual({ all: true, archive: '/archive' });
  });

  it('executes exactly the planned edit options through an injected runner', async () => {
    let executed: unknown;
    const program = createProgram({
      executeEdit: async (arguments_) => {
        executed = arguments_;
        return { status: 'updated', id: 'run-1' };
      },
    });
    program.exitOverride();

    await program.parseAsync(['node', 'sitbench', 'edit', 'run-1', '--archive', '/archive'], { from: 'node' });
    expect(executed).toEqual({ runId: 'run-1', archive: '/archive' });
  });

  it('returns a Commander missing-argument error when edit is invoked without a run id', async () => {
    const program = createProgram({ executeEdit: async () => ({ status: 'cancelled' }) });
    program.exitOverride();

    await expect(program.parseAsync(['node', 'sitbench', 'edit'], { from: 'node' })).rejects.toMatchObject({
      code: 'commander.missingArgument',
      exitCode: 1,
    });
  });

  it.each([
    [['node', 'sitbench', 'analyze', '--unexpected'], 'commander.unknownOption'],
    [['node', 'sitbench', 'analyze', '--site'], 'commander.optionMissingArgument'],
  ])('returns a nonzero Commander error for invalid argv %#', async (argv, code) => {
    const program = createProgram({ execute: async () => ({ status: 'cancelled' }) });
    program.exitOverride();

    await expect(program.parseAsync(argv, { from: 'node' })).rejects.toMatchObject({ code, exitCode: 1 });
  });
});
