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

  it('returns a nonzero exit code when injected dashboard execution reports a fatal result', async () => {
    await expect(
      runCli(['dashboard'], { executeDashboard: async () => ({ status: 'fatal', reason: 'boom' }) }),
    ).resolves.toBe(1);
  });

  it('returns zero when injected dashboard execution reports serving', async () => {
    await expect(
      runCli(['dashboard'], {
        executeDashboard: async () => ({
          status: 'serving',
          url: 'http://127.0.0.1:12345/',
          address: '127.0.0.1',
          port: 12345,
          close: async () => undefined,
        }),
      }),
    ).resolves.toBe(0);
  });

  it('returns a nonzero exit code when injected publish execution reports a fatal result', async () => {
    await expect(
      runCli(['publish', '--out', '/tmp/out'], { executePublish: async () => ({ status: 'fatal', reason: 'boom' }) }),
    ).resolves.toBe(1);
  });

  it('returns zero when injected publish execution reports published', async () => {
    await expect(
      runCli(['publish', '--out', '/tmp/out'], {
        executePublish: async () => ({ status: 'published', outDir: '/tmp/out', runCount: 0 }),
      }),
    ).resolves.toBe(0);
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

  it('registers the dashboard command with exactly a --port option and no host/bind override', async () => {
    let executed: unknown;
    const program = createProgram({
      executeDashboard: async (arguments_) => {
        executed = arguments_;
        return { status: 'serving', url: 'http://127.0.0.1:9999/', address: '127.0.0.1', port: 9999, close: async () => undefined };
      },
    });
    program.exitOverride();

    const dashboardCommand = program.commands.find((command) => command.name() === 'dashboard');
    expect(dashboardCommand).toBeDefined();
    const optionFlags = dashboardCommand?.options.map((option) => option.long) ?? [];
    expect(optionFlags).toContain('--port');
    expect(optionFlags).toContain('--archive');
    expect(optionFlags).not.toContain('--host');
    expect(optionFlags).not.toContain('--bind');
    expect(optionFlags).not.toContain('--bind-address');

    await program.parseAsync(['node', 'sitbench', 'dashboard', '--port', '4123', '--archive', '/archive'], { from: 'node' });
    expect(executed).toEqual({ port: 4123, archive: '/archive' });

    await program.parseAsync(['node', 'sitbench', 'dashboard'], { from: 'node' });
    expect(executed).toEqual({});
  });

  it('rejects a non-integer --port value with a Commander error', async () => {
    const program = createProgram({ executeDashboard: async () => ({ status: 'fatal', reason: 'unreachable' }) });
    program.exitOverride();

    await expect(
      program.parseAsync(['node', 'sitbench', 'dashboard', '--port', 'not-a-number'], { from: 'node' }),
    ).rejects.toMatchObject({ code: 'commander.invalidArgument', exitCode: 1 });
  });

  it('registers the publish command with --out, --include-characters, and --include-notes', async () => {
    let executed: unknown;
    const program = createProgram({
      executePublish: async (arguments_) => {
        executed = arguments_;
        return { status: 'published', outDir: arguments_.out, runCount: 0 };
      },
    });
    program.exitOverride();

    await program.parseAsync(
      ['node', 'sitbench', 'publish', '--out', './public', '--include-characters', '--include-notes', '--archive', '/archive'],
      { from: 'node' },
    );
    expect(executed).toEqual({
      out: './public',
      includeCharacters: true,
      includeNotes: true,
      archive: '/archive',
    });

    await program.parseAsync(['node', 'sitbench', 'publish', '--out', './public'], { from: 'node' });
    expect(executed).toEqual({ out: './public' });
  });

  it('returns a Commander missing-mandatory-option error when publish is invoked without --out', async () => {
    const program = createProgram({ executePublish: async () => ({ status: 'published', outDir: '.', runCount: 0 }) });
    program.exitOverride();

    await expect(program.parseAsync(['node', 'sitbench', 'publish'], { from: 'node' })).rejects.toMatchObject({
      code: 'commander.missingMandatoryOptionValue',
      exitCode: 1,
    });
  });

  it('documents the dashboard and publish commands in top-level help', async () => {
    const output: string[] = [];
    const program = createProgram({});
    program.configureOutput({ writeOut: (line) => output.push(line), writeErr: (line) => output.push(line) });
    program.exitOverride();

    await expect(program.parseAsync(['node', 'sitbench', '--help'], { from: 'node' })).rejects.toMatchObject({ exitCode: 0 });
    const help = output.join('');
    expect(help).toContain('dashboard [options]');
    expect(help).toContain('publish [options]');
  });
});
