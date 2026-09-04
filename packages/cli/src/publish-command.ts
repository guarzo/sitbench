import { cp, lstat, mkdir, readdir, realpath } from 'node:fs/promises';
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
  /** Injectable atomic dataset writer, for tests to simulate a write failure. Defaults to `writeFileAtomic`. */
  writeDataset?: (targetPath: string, content: string) => Promise<void>;
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/**
 * Resolves `targetPath` to a canonical real path for privacy-boundary
 * comparison, even when it (or a trailing portion of it) does not exist
 * yet: the nearest existing ancestor is resolved through `realpath`
 * (collapsing any symlinks in that existing portion), and any remaining,
 * not-yet-existing path segments are re-appended literally -- they cannot
 * be symlinks because they do not exist.
 */
async function resolveCanonicalPath(targetPath: string): Promise<string> {
  let current = path.resolve(targetPath);
  const pendingSegments: string[] = [];
  for (;;) {
    try {
      const real = await realpath(current);
      return pendingSegments.length > 0 ? path.join(real, ...pendingSegments.slice().reverse()) : real;
    } catch (error) {
      if (isMissingFileError(error) && current !== path.dirname(current)) {
        pendingSegments.push(path.basename(current));
        current = path.dirname(current);
        continue;
      }
      throw error;
    }
  }
}

/** True when `a` and `b` are the same canonical path, or either is an ancestor of the other. */
function pathsOverlap(a: string, b: string): boolean {
  const isAncestorOrSame = (relative: string): boolean =>
    relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  return isAncestorOrSame(path.relative(a, b)) || isAncestorOrSame(path.relative(b, a));
}

/** Refuses to proceed if `targetPath` already exists as a symlink (of any kind), so a managed write can never be redirected through it. */
async function assertNoSymlinkAt(targetPath: string): Promise<void> {
  let stats;
  try {
    stats = await lstat(targetPath);
  } catch (error) {
    if (isMissingFileError(error)) return;
    throw error;
  }
  if (stats.isSymbolicLink()) {
    throw new Error(`Refusing to write through an existing symlink at "${targetPath}".`);
  }
}

/**
 * Exports a privacy-controlled static dashboard: the packaged dashboard
 * build assets plus a strict public `data/runs.json`. Never copies archived
 * events or any other local-only data, never initializes Git, and never
 * touches a network or hosting provider -- publishing to a host such as
 * GitHub Pages remains an explicit user-managed follow-up. An existing
 * output directory is written into (creating it if missing) but never
 * cleared: only the entries this command itself manages (the packaged
 * asset names, plus `data/runs.json`) are overwritten; any other file the
 * user already has in that directory is left untouched. The dataset write
 * is atomic (temp file + rename).
 *
 * Before any write happens, the output directory is checked against two
 * conservative safety rules so it can never be used to read back archived
 * data or redirect a managed write elsewhere:
 *  - `--out` must not be the same as, nor an ancestor or descendant of,
 *    the archive directory, comparing canonical (symlink-resolved) paths.
 *  - `--out` itself, and each managed destination inside it (every
 *    packaged asset entry, `data`, and `data/runs.json`), must not already
 *    exist as a symlink.
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
  const writeDataset = dependencies.writeDataset ?? writeFileAtomic;

  try {
    await assertNoSymlinkAt(outDir);
    const archiveReal = await resolveCanonicalPath(archiveDir);
    const outputReal = await resolveCanonicalPath(outDir);
    if (pathsOverlap(archiveReal, outputReal)) {
      throw new Error(
        `Output directory ("${outDir}") must not be the same as, nor an ancestor or descendant of, the archive directory ("${archiveDir}").`,
      );
    }
  } catch (error) {
    return fatal(write, `Refusing to publish: ${message(error)}`);
  }

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
      const destination = path.join(outDir, entry.name);
      await assertNoSymlinkAt(destination);
      await cp(path.join(distDir, entry.name), destination, {
        recursive: true,
        force: true,
      });
    }
    const dataDir = path.join(outDir, 'data');
    await assertNoSymlinkAt(dataDir);
    const datasetPath = path.join(dataDir, 'runs.json');
    await assertNoSymlinkAt(datasetPath);
    await writeDataset(datasetPath, `${JSON.stringify(dataset, null, 2)}\n`);
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
