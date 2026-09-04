#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { runAnalyze, type AnalyzeArguments } from './analyze-command.js';
import { createConsolePrompts } from './ui.js';

const USAGE = 'Usage: sitbench analyze [--site <name>] [--profile <name>] [--logs <path>] [--archive <path>]';

/** Parses the executable boundary's intentionally small analyze-only argument surface. */
export function parseAnalyzeArguments(argv: string[]): AnalyzeArguments {
  if (argv[0] !== 'analyze') {
    throw new Error(USAGE);
  }

  const result: AnalyzeArguments = {};
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(`${USAGE}\nMissing value for ${flag ?? 'option'}.`);
    }
    switch (flag) {
      case '--site':
        result.site = value;
        break;
      case '--profile':
        result.profile = value;
        break;
      case '--logs':
        result.logs = value;
        break;
      case '--archive':
        result.archive = value;
        break;
      default:
        throw new Error(`${USAGE}\nUnknown option ${flag}.`);
    }
  }
  return result;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let arguments_: AnalyzeArguments;
  try {
    arguments_ = parseAnalyzeArguments(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  const consolePrompts = createConsolePrompts();
  try {
    const result = await runAnalyze(arguments_, { prompts: consolePrompts.prompts });
    return result.status === 'fatal' ? 1 : 0;
  } finally {
    consolePrompts.close();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
