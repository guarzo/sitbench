import { describe, expect, it } from 'vitest';
import { createProgram, runCli } from '../src/index.js';

describe('runCli', () => {
  it('returns a nonzero exit code when injected analyze execution reports a fatal result', async () => {
    await expect(
      runCli(['analyze'], { execute: async () => ({ status: 'fatal', reason: 'logs' }) }),
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
