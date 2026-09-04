import { mkdir, mkdtemp, rm, stat as realStat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LOG_IO_CONCURRENCY,
  MAX_RECENT_LOG_FILES,
  RECENT_LOG_WINDOW_MS,
  mapWithConcurrency,
  readRecentLogFiles,
} from '../src/log-discovery.js';

let root: string;
const now = new Date('2026-09-03T05:00:00.000Z');

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'sitbench-log-discovery-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeLog(name: string, text: string, modifiedAt: Date): Promise<void> {
  const filePath = path.join(root, name);
  await writeFile(filePath, text, 'utf8');
  await utimes(filePath, modifiedAt, modifiedAt);
}

function minutesBefore(reference: Date, minutes: number): Date {
  return new Date(reference.getTime() - minutes * 60_000);
}

describe('readRecentLogFiles', () => {
  it('reads only direct .txt files modified inside the recent window relative to the injected clock', async () => {
    await writeLog('recent.txt', 'recent', minutesBefore(now, 60));
    await writeLog('stale.txt', 'stale', new Date(now.getTime() - RECENT_LOG_WINDOW_MS - 60_000));
    await writeLog('notes.md', 'not a log', minutesBefore(now, 60));
    await mkdir(path.join(root, 'nested.txt'), { recursive: true });
    await writeFile(path.join(root, 'nested.txt', 'inner.txt'), 'inner', 'utf8');

    const discovery = await readRecentLogFiles(root, { now });

    expect(discovery.files.map((file) => file.name)).toEqual(['recent.txt']);
    expect(discovery.files[0]?.text).toBe('recent');
    expect(discovery.skippedFiles).toBe(1);
  });

  it('keeps a file modified exactly at the window boundary and drops one just outside it', async () => {
    await writeLog('boundary.txt', 'boundary', new Date(now.getTime() - RECENT_LOG_WINDOW_MS));
    await writeLog('outside.txt', 'outside', new Date(now.getTime() - RECENT_LOG_WINDOW_MS - 1000));

    const discovery = await readRecentLogFiles(root, { now });

    expect(discovery.files.map((file) => file.name)).toEqual(['boundary.txt']);
    expect(discovery.skippedFiles).toBe(1);
  });

  it('caps the read at the newest MAX_RECENT_LOG_FILES files and counts the rest as skipped', async () => {
    const total = MAX_RECENT_LOG_FILES + 4;
    for (let index = 0; index < total; index += 1) {
      // index 0 is the newest, index total-1 the oldest.
      await writeLog(`log-${String(index).padStart(4, '0')}.txt`, `log ${String(index)}`, minutesBefore(now, index));
    }

    const discovery = await readRecentLogFiles(root, { now });

    expect(discovery.files).toHaveLength(MAX_RECENT_LOG_FILES);
    expect(discovery.skippedFiles).toBe(4);
    expect(discovery.files[0]?.name).toBe('log-0000.txt');
    expect(discovery.files.at(-1)?.name).toBe(`log-${String(MAX_RECENT_LOG_FILES - 1).padStart(4, '0')}.txt`);
    expect(discovery.files.every((file) => file.text.length > 0)).toBe(true);
  });

  it('orders newest first and breaks identical modification times by name', async () => {
    await writeLog('bravo.txt', 'bravo', minutesBefore(now, 10));
    await writeLog('alpha.txt', 'alpha', minutesBefore(now, 10));
    await writeLog('charlie.txt', 'charlie', minutesBefore(now, 5));

    const first = await readRecentLogFiles(root, { now });
    const second = await readRecentLogFiles(root, { now });

    expect(first.files.map((file) => file.name)).toEqual(['charlie.txt', 'alpha.txt', 'bravo.txt']);
    expect(second.files.map((file) => file.name)).toEqual(first.files.map((file) => file.name));
  });

  it('does not skip a file whose modification time is ahead of the injected clock', async () => {
    await writeLog('ahead.txt', 'ahead', new Date(now.getTime() + 60 * 60_000));

    const discovery = await readRecentLogFiles(root, { now });

    expect(discovery.files.map((file) => file.name)).toEqual(['ahead.txt']);
    expect(discovery.skippedFiles).toBe(0);
  });

  it('skips a candidate whose stat fails and still reads the remaining recent files', async () => {
    await writeLog('recent.txt', 'recent', minutesBefore(now, 60));
    await writeLog('raced-away.txt', 'gone', minutesBefore(now, 30));

    const discovery = await readRecentLogFiles(root, {
      now,
      stat: async (filePath) => {
        if (path.basename(filePath) === 'raced-away.txt') {
          // A file listed by readdir can be deleted (or become unreadable)
          // before it is stat'd; that must never fail the whole discovery.
          throw Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
        }
        return realStat(filePath);
      },
    });

    expect(discovery.files.map((file) => file.name)).toEqual(['recent.txt']);
    expect(discovery.files[0]?.text).toBe('recent');
    expect(discovery.skippedFiles).toBe(1);
  });
});

describe('mapWithConcurrency', () => {
  it('never runs more than the configured number of operations at once and preserves input order', async () => {
    const items = Array.from({ length: 100 }, (_, index) => index);
    let active = 0;
    let peak = 0;

    const results = await mapWithConcurrency(items, LOG_IO_CONCURRENCY, async (item) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, item % 3));
      active -= 1;
      return item * 2;
    });

    expect(results).toEqual(items.map((item) => item * 2));
    expect(peak).toBeLessThanOrEqual(LOG_IO_CONCURRENCY);
    expect(peak).toBeGreaterThan(1);
  });

  it('rejects with the first failure without leaving work unbounded', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (item) => {
        if (item === 2) throw new Error('boom');
        return item;
      }),
    ).rejects.toThrow('boom');
  });
});
