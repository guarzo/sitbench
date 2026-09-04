#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command, CommanderError } from 'commander';
import { runAnalyze, type AnalyzeArguments, type AnalyzeResult } from './analyze-command.js';
import { createConsolePrompts } from './ui.js';

export interface ProgramDependencies {
  execute?: (arguments_: AnalyzeArguments) => Promise<AnalyzeResult>;
}

/** Builds the process-independent Commander program for the sitbench executable. */
export function createProgram(dependencies: ProgramDependencies = {}): Command {
  const execute = dependencies.execute ?? executeInteractively;
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

  return program;
}

/** Runs Commander without mutating process exit state, for executable and test callers. */
export async function runCli(argv: string[], dependencies: ProgramDependencies = {}): Promise<number> {
  let analysisResult: AnalyzeResult | undefined;
  const execute = dependencies.execute ?? executeInteractively;
  const program = createProgram({
    execute: async (arguments_) => {
      analysisResult = await execute(arguments_);
      return analysisResult;
    },
  });

  try {
    await program.parseAsync(argv, { from: 'user' });
    return analysisResult?.status === 'fatal' ? 1 : 0;
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

if (isDirectEntryPoint(import.meta.url, process.argv[1])) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
