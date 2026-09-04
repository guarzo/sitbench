#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command, CommanderError, InvalidArgumentError } from 'commander';
import { runAnalyze, type AnalyzeArguments, type AnalyzeResult } from './analyze-command.js';
import { runDashboard, type DashboardArguments, type DashboardResult } from './dashboard-command.js';
import { regenerateDashboardData } from './dashboard-export.js';
import { runEdit, type EditArguments, type EditResult } from './edit-command.js';
import { defaultArchiveDir } from './paths.js';
import { runPublish, type PublishArguments, type PublishResult } from './publish-command.js';
import { runRecalculate, type RecalculateArguments, type RecalculateResult } from './recalculate-command.js';
import { createConsolePrompts, createEditPrompts } from './ui.js';

export interface ProgramDependencies {
  execute?: (arguments_: AnalyzeArguments) => Promise<AnalyzeResult>;
  executeRecalculate?: (arguments_: RecalculateArguments) => Promise<RecalculateResult>;
  executeEdit?: (arguments_: EditArguments) => Promise<EditResult>;
  executeDashboard?: (arguments_: DashboardArguments) => Promise<DashboardResult>;
  executePublish?: (arguments_: PublishArguments) => Promise<PublishResult>;
}

/** Commander option-value parser: a non-negative integer port, or throws. */
function parsePort(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new InvalidArgumentError('--port must be an integer between 0 and 65535.');
  }
  return parsed;
}

/** Builds the process-independent Commander program for the sitbench executable. */
export function createProgram(dependencies: ProgramDependencies = {}): Command {
  const execute = dependencies.execute ?? executeInteractively;
  const executeRecalculate = dependencies.executeRecalculate ?? executeRecalculateInteractively;
  const executeEdit = dependencies.executeEdit ?? executeEditInteractively;
  const executeDashboard = dependencies.executeDashboard ?? executeDashboardInteractively;
  const executePublish = dependencies.executePublish ?? executePublishInteractively;
  const program = new Command()
    .name('sitbench')
    .description('Analyze EVE Online game logs into sitbench runs.')
    .version('0.1.0')
    .exitOverride();

  program
    .command('analyze')
    .description('analyze recent game logs into one confirmed run')
    .option('--site <name>', 'site name')
    .option('--profile <name>', 'fleet profile name')
    .option('--logs <path>', 'EVE Gamelogs directory')
    .option('--archive <path>', 'sitbench archive directory')
    .action(async (options: AnalyzeArguments) => {
      await execute(options);
    });

  program
    .command('recalculate')
    .description("recalculate a run's (or every run's) metrics from archived events")
    .argument('[run-id]', 'run id to recalculate')
    .option('--all', 'recalculate every archived run')
    .option('--archive <path>', 'sitbench archive directory')
    .action(async (runId: string | undefined, options: { all?: boolean; archive?: string }) => {
      await executeRecalculate({
        ...(runId !== undefined ? { runId } : {}),
        ...(options.all !== undefined ? { all: options.all } : {}),
        ...(options.archive !== undefined ? { archive: options.archive } : {}),
      });
    });

  program
    .command('edit')
    .description("interactively edit a run's metadata or confirmed window")
    .argument('<run-id>', 'run id to edit')
    .option('--archive <path>', 'sitbench archive directory')
    .action(async (runId: string, options: { archive?: string }) => {
      await executeEdit({
        runId,
        ...(options.archive !== undefined ? { archive: options.archive } : {}),
      });
    });

  program
    .command('dashboard')
    .description('serve the local sitbench dashboard on 127.0.0.1 (loopback only; no host/bind override)')
    .option('--port <number>', 'port to listen on (0 = ephemeral)', parsePort)
    .option('--archive <path>', 'sitbench archive directory')
    .action(async (options: { port?: number; archive?: string }) => {
      await executeDashboard({
        ...(options.port !== undefined ? { port: options.port } : {}),
        ...(options.archive !== undefined ? { archive: options.archive } : {}),
      });
    });

  program
    .command('publish')
    .description('export a privacy-controlled static dashboard for hosting elsewhere')
    .requiredOption('--out <directory>', 'output directory for the published dashboard')
    .option('--include-characters', 'include participant identities and per-character metrics')
    .option('--include-notes', 'include run notes')
    .option('--archive <path>', 'sitbench archive directory')
    .action(async (options: { out: string; includeCharacters?: boolean; includeNotes?: boolean; archive?: string }) => {
      await executePublish({
        out: options.out,
        ...(options.includeCharacters !== undefined ? { includeCharacters: options.includeCharacters } : {}),
        ...(options.includeNotes !== undefined ? { includeNotes: options.includeNotes } : {}),
        ...(options.archive !== undefined ? { archive: options.archive } : {}),
      });
    });

  return program;
}

/** Runs Commander without mutating process exit state, for executable and test callers. */
export async function runCli(argv: string[], dependencies: ProgramDependencies = {}): Promise<number> {
  let analysisResult: AnalyzeResult | undefined;
  let recalculateResult: RecalculateResult | undefined;
  let editResult: EditResult | undefined;
  let dashboardResult: DashboardResult | undefined;
  let publishResult: PublishResult | undefined;
  const execute = dependencies.execute ?? executeInteractively;
  const executeRecalculate = dependencies.executeRecalculate ?? executeRecalculateInteractively;
  const executeEdit = dependencies.executeEdit ?? executeEditInteractively;
  const executeDashboard = dependencies.executeDashboard ?? executeDashboardInteractively;
  const executePublish = dependencies.executePublish ?? executePublishInteractively;
  const program = createProgram({
    execute: async (arguments_) => {
      analysisResult = await execute(arguments_);
      return analysisResult;
    },
    executeRecalculate: async (arguments_) => {
      recalculateResult = await executeRecalculate(arguments_);
      return recalculateResult;
    },
    executeEdit: async (arguments_) => {
      editResult = await executeEdit(arguments_);
      return editResult;
    },
    executeDashboard: async (arguments_) => {
      dashboardResult = await executeDashboard(arguments_);
      return dashboardResult;
    },
    executePublish: async (arguments_) => {
      publishResult = await executePublish(arguments_);
      return publishResult;
    },
  });

  try {
    await program.parseAsync(argv, { from: 'user' });
    const isFatal =
      analysisResult?.status === 'fatal' ||
      recalculateResult?.status === 'fatal' ||
      recalculateResult?.status === 'partial' ||
      editResult?.status === 'fatal' ||
      dashboardResult?.status === 'fatal' ||
      publishResult?.status === 'fatal';
    return isFatal ? 1 : 0;
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode;
    }
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  return runCli(argv);
}

/** Returns the canonical (symlink-resolved) form of `path`, or the resolved-but-unresolved path if it does not exist on disk. */
function canonicalize(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Returns whether a module URL is the resolved path invoked by Node.
 *
 * `pnpm link --global` (and manual `npm link`/symlink installs) installs a
 * bin symlink, so `process.argv[1]` is the symlink path rather than the
 * real file the module URL points to. A lexical string compare between the
 * two therefore always misses under that workflow, silently making the CLI
 * exit 0 with no output. Canonicalizing both sides with `realpath` before
 * comparing fixes that while still working for the non-symlink case. A
 * nonexistent argv path canonicalizes to itself (via the catch above) and
 * simply fails to match, without throwing.
 */
export function isDirectEntryPoint(moduleUrl: string, argvPath: string | undefined): boolean {
  if (argvPath === undefined) return false;
  return canonicalize(fileURLToPath(moduleUrl)) === canonicalize(resolve(argvPath));
}

function makeDashboardRebuild(archiveDir: string): (archive: import('@sitbench/core').Archive) => Promise<void> {
  return async (archive) => {
    await regenerateDashboardData(archive, archiveDir);
  };
}

async function executeInteractively(arguments_: AnalyzeArguments): Promise<AnalyzeResult> {
  const archiveDir = arguments_.archive ?? defaultArchiveDir();
  return runAnalyze(arguments_, {
    prompts: createConsolePrompts(),
    rebuildCatalog: makeDashboardRebuild(archiveDir),
  });
}

async function executeRecalculateInteractively(arguments_: RecalculateArguments): Promise<RecalculateResult> {
  const archiveDir = arguments_.archive ?? defaultArchiveDir();
  return runRecalculate(arguments_, {
    rebuildCatalog: makeDashboardRebuild(archiveDir),
  });
}

async function executeEditInteractively(arguments_: EditArguments): Promise<EditResult> {
  const archiveDir = arguments_.archive ?? defaultArchiveDir();
  return runEdit(arguments_, {
    prompts: createEditPrompts(),
    rebuildCatalog: makeDashboardRebuild(archiveDir),
  });
}

/**
 * Resolves once SIGINT or SIGTERM arrives, closing the server exactly once
 * and removing BOTH signal listeners regardless of which signal actually
 * fired -- so the listener for whichever signal did not fire never leaks,
 * and a second/duplicate signal (either the same one twice, or the other
 * one arriving immediately after) can never trigger a second `close()`
 * call (closing an already-closed http.Server throws).
 */
export function waitForShutdownSignal(close: () => Promise<void>): Promise<void> {
  return new Promise<void>((resolvePromise) => {
    let closing = false;
    const shutdown = (): void => {
      if (closing) return;
      closing = true;
      process.removeListener('SIGINT', shutdown);
      process.removeListener('SIGTERM', shutdown);
      void close().then(resolvePromise, resolvePromise);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}

/**
 * Starts the dashboard server and — only for the real executable path, never
 * for injected test callers — keeps the process foregrounded until an
 * interrupt/terminate signal arrives, then closes the server before
 * resolving. Signal handlers are registered only inside this function body
 * when it actually runs, never at module import time.
 */
async function executeDashboardInteractively(arguments_: DashboardArguments): Promise<DashboardResult> {
  const result = await runDashboard(arguments_);
  if (result.status !== 'serving') {
    return result;
  }
  await waitForShutdownSignal(result.close);
  return result;
}

async function executePublishInteractively(arguments_: PublishArguments): Promise<PublishResult> {
  return runPublish(arguments_);
}

if (isDirectEntryPoint(import.meta.url, process.argv[1])) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
