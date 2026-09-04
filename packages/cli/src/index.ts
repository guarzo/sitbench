#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command, CommanderError } from 'commander';
import { runAnalyze, type AnalyzeArguments, type AnalyzeResult } from './analyze-command.js';
import { runEdit, type EditArguments, type EditResult } from './edit-command.js';
import { runRecalculate, type RecalculateArguments, type RecalculateResult } from './recalculate-command.js';
import { createConsolePrompts, createEditPrompts } from './ui.js';

export interface ProgramDependencies {
  execute?: (arguments_: AnalyzeArguments) => Promise<AnalyzeResult>;
  executeRecalculate?: (arguments_: RecalculateArguments) => Promise<RecalculateResult>;
  executeEdit?: (arguments_: EditArguments) => Promise<EditResult>;
}

/** Builds the process-independent Commander program for the sitbench executable. */
export function createProgram(dependencies: ProgramDependencies = {}): Command {
  const execute = dependencies.execute ?? executeInteractively;
  const executeRecalculate = dependencies.executeRecalculate ?? executeRecalculateInteractively;
  const executeEdit = dependencies.executeEdit ?? executeEditInteractively;
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

  return program;
}

/** Runs Commander without mutating process exit state, for executable and test callers. */
export async function runCli(argv: string[], dependencies: ProgramDependencies = {}): Promise<number> {
  let analysisResult: AnalyzeResult | undefined;
  let recalculateResult: RecalculateResult | undefined;
  let editResult: EditResult | undefined;
  const execute = dependencies.execute ?? executeInteractively;
  const executeRecalculate = dependencies.executeRecalculate ?? executeRecalculateInteractively;
  const executeEdit = dependencies.executeEdit ?? executeEditInteractively;
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
  });

  try {
    await program.parseAsync(argv, { from: 'user' });
    const isFatal =
      analysisResult?.status === 'fatal' ||
      recalculateResult?.status === 'fatal' ||
      recalculateResult?.status === 'partial' ||
      editResult?.status === 'fatal';
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

/** Returns whether a module URL is the resolved path invoked by Node. */
export function isDirectEntryPoint(moduleUrl: string, argvPath: string | undefined): boolean {
  return argvPath !== undefined && fileURLToPath(moduleUrl) === resolve(argvPath);
}

async function executeInteractively(arguments_: AnalyzeArguments): Promise<AnalyzeResult> {
  return runAnalyze(arguments_, { prompts: createConsolePrompts() });
}

async function executeRecalculateInteractively(arguments_: RecalculateArguments): Promise<RecalculateResult> {
  return runRecalculate(arguments_, {});
}

async function executeEditInteractively(arguments_: EditArguments): Promise<EditResult> {
  return runEdit(arguments_, { prompts: createEditPrompts() });
}

if (isDirectEntryPoint(import.meta.url, process.argv[1])) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
