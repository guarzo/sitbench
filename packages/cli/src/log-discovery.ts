import { readdir, readFile, stat } from 'node:fs/promises';
import * as path from 'node:path';

/** A single gamelog file that was actually read for analysis. */
export interface LogFile {
  name: string;
  text: string;
  modifiedAt: number;
}

/**
 * The bounded result of inspecting a gamelog directory: the files that were
 * read, plus how many candidate `.txt` files were deliberately left unread
 * because they fell outside the recent window or beyond the file cap.
 */
export interface LogDiscovery {
  files: LogFile[];
  skippedFiles: number;
}

/**
 * How far back a gamelog file's modification time may be and still be read.
 * A real EVE `Gamelogs` directory accumulates years of files; analysis only
 * ever confirms a recent session, so anything older is skipped rather than
 * read into memory. This is a lower bound only: a file whose modification
 * time is ahead of the clock (clock skew, a mounted Windows filesystem) is
 * still considered recent.
 */
export const RECENT_LOG_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Hard cap on how many recent files are read, newest first. */
export const MAX_RECENT_LOG_FILES = 256;

/** Maximum simultaneous stat/read operations, so discovery never opens an unbounded number of file handles. */
export const LOG_IO_CONCURRENCY = 16;

/**
 * Maps `items` through `operation` with at most `limit` operations in
 * flight at any moment, preserving input order in the returned results.
 * The first rejection propagates to the caller; the remaining workers are
 * not cancelled and may keep processing further items until they finish, so
 * what is guaranteed here is bounded concurrency, never a hard stop on
 * failure. Callers that must tolerate individual failures should handle
 * them inside `operation`.
 */
export async function mapWithConcurrency<Item, Result>(
  items: readonly Item[],
  limit: number,
  operation: (item: Item, index: number) => Promise<Result>,
): Promise<Result[]> {
  const results = new Array<Result>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await operation(items[index] as Item, index);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

/**
 * Reads the recent EVE gamelogs in `directory`, bounded on every axis so a
 * large real `Gamelogs` directory can never be read in full:
 *   - only direct `.txt` files are considered (never subdirectories,
 *     symlinked entries, or other extensions);
 *   - only files modified within `RECENT_LOG_WINDOW_MS` of `options.now`
 *     (defaulting to the current clock) are eligible;
 *   - at most `MAX_RECENT_LOG_FILES` eligible files are read, newest first;
 *   - stat and read operations run in bounded batches of
 *     `LOG_IO_CONCURRENCY`.
 *
 * These bounds always apply, including when the log directory was chosen
 * explicitly with `--logs`. Ordering is deterministic: newest modification
 * time first, with identical times broken by file name. A candidate whose
 * `stat` fails — it was deleted between the directory listing and the stat,
 * or is otherwise unreadable — is skipped rather than failing the whole
 * discovery, and is counted in `skippedFiles` like any other unread
 * candidate. A *read* failure on a selected file is still fatal, since that
 * file was already confirmed to exist and was chosen for analysis.
 * `skippedFiles` reports how many candidate `.txt` files were left unread,
 * so callers can tell the user what was not inspected.
 *
 * `stat` is a narrow injectable seam (defaulting to `node:fs/promises`'
 * `stat`) so the raced-away/unreadable candidate path can be exercised
 * deterministically; production callers never override it.
 */
export async function readRecentLogFiles(
  directory: string,
  options: { now?: Date; stat?: (filePath: string) => Promise<{ mtimeMs: number }> } = {},
): Promise<LogDiscovery> {
  const statFile = options.stat ?? stat;
  const entries = await readdir(directory, { withFileTypes: true });
  const candidateNames = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.txt'))
    .map((entry) => entry.name);

  const stats = await mapWithConcurrency(candidateNames, LOG_IO_CONCURRENCY, async (name) => {
    try {
      const fileStat = await statFile(path.join(directory, name));
      return { name, modifiedAt: fileStat.mtimeMs };
    } catch {
      return null;
    }
  });

  const cutoff = (options.now ?? new Date()).getTime() - RECENT_LOG_WINDOW_MS;
  const recent = stats
    .filter((entry): entry is { name: string; modifiedAt: number } => entry !== null)
    .filter((entry) => entry.modifiedAt >= cutoff)
    .sort((left, right) => right.modifiedAt - left.modifiedAt || left.name.localeCompare(right.name));
  const selected = recent.slice(0, MAX_RECENT_LOG_FILES);

  const files = await mapWithConcurrency(selected, LOG_IO_CONCURRENCY, async (entry) => ({
    name: entry.name,
    text: await readFile(path.join(directory, entry.name), 'utf8'),
    modifiedAt: entry.modifiedAt,
  }));

  return { files, skippedFiles: candidateNames.length - selected.length };
}
