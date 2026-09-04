import { cp, mkdir, readdir } from 'node:fs/promises';
import * as path from 'node:path';
import { Archive, buildPublicDashboardDataset, writeFileAtomic, type RunSummary } from '@sitbench/core';
import { resolveDashboardDistDir } from './dashboard-command.js';
import { defaultArchiveDir } from './paths.js';

export interface PublishArguments {
  out: string;
  includeCharacters?: boolean;
  includeNotes?: boolean;
  archive?: string;
}

export type PublishResult = { status: 'published'; outDir: string; runCount: number } | { status: 'fatal'; reason: string };

export interface PublishDependencies {
  write?: (line: string) => void;
  /** Packaged @sitbench/dashboard build directory. Defaults to its real module/package location. */
  distDir?: string;
  createArchive?: (directory: string) => Archive;
}

/**
 * Exports a privacy-controlled static dashboard: the packaged dashboard
 * build assets plus a strict public `data/runs.json`. Never copies archived
 * events or any other local-only data, never initializes Git, and never
 * touches a network or hosting provider — publishing to a host such as
 * GitHub Pages remains an explicit user-managed follow-up. An existing
 * output directory is written into (creating it if missing) but never
 * cleared: only the entries this command itself manages (the packaged
 * asset names, plus `data/runs.json`) are overwritten; any other file the
 * user already has in that directory is left untouched. The dataset write
 * is atomic (temp file + rename).
 */
export async function runPublish(
  arguments_: PublishArguments,
  dependencies: PublishDependencies = {},
): Promise<PublishResult> {
  const write = dependencies.write ?? console.log;
  const archiveDir = arguments_.archive ?? defaultArchiveDir();
  const archive = (dependencies.createArchive ?? ((directory) => new Archive(directory)))(archiveDir);
  const distDir = dependencies.distDir ?? resolveDashboardDistDir();
  const outDir = path.resolve(arguments_.out);

  let runs: RunSummary[];
  try {
    runs = await archive.listRuns();
  } catch (error) {
    return fatal(write, `Cannot read archived runs: ${message(error)}`);
  }

  const dataset = buildPublicDashboardDataset(runs, {
    includeCharacters: arguments_.includeCharacters ?? false,
    includeNotes: arguments_.includeNotes ?? false,
  });

  try {
    await mkdir(outDir, { recursive: true });
    const entries = await readdir(distDir, { withFileTypes: true });
    for (const entry of entries) {
      await cp(path.join(distDir, entry.name), path.join(outDir, entry.name), {
        recursive: true,
        force: true,
      });
    }
    await writeFileAtomic(path.join(outDir, 'data', 'runs.json'), `${JSON.stringify(dataset, null, 2)}\n`);
  } catch (error) {
    return fatal(write, `Cannot publish dashboard: ${message(error)}`);
  }

  write(`Published ${String(runs.length)} run(s) to ${outDir}.`);
  return { status: 'published', outDir, runCount: runs.length };
}

function fatal(write: (line: string) => void, text: string): PublishResult {
  write(`Error: ${text}`);
  return { status: 'fatal', reason: text };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
