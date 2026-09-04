import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverGameLogDirs, loadConfig, resolveGameLogDir, saveConfig } from '../src/paths.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('discoverGameLogDirs', () => {
  it('returns WSL user Gamelogs directories but excludes Public Documents', async () => {
    const directories = new Map<string, string[]>([
      ['/mnt/c/Users', ['Tom', 'Public']],
      ['/mnt/c/Users/Tom/Documents/EVE/logs', ['Gamelogs']],
      ['/mnt/c/Users/Public/Documents', []],
    ]);

    await expect(
      discoverGameLogDirs({
        usersDirectory: '/mnt/c/Users',
        readDirectories: async (directory) => directories.get(directory) ?? [],
      }),
    ).resolves.toEqual(['/mnt/c/Users/Tom/Documents/EVE/logs/Gamelogs']);
  });
});

describe('loadConfig', () => {
  it('rejects non-positive thresholds instead of using invalid calculation settings', async () => {
    const archiveDir = await mkdtemp(path.join(tmpdir(), 'sitbench-config-'));
    temporaryDirectories.push(archiveDir);
    await writeFile(
      path.join(archiveDir, 'config.json'),
      JSON.stringify({ gameLogDir: '/logs', episodeThresholdSeconds: 0, activeCombatGapSeconds: 30 }),
      'utf8',
    );

    await expect(loadConfig(archiveDir)).rejects.toThrow('episodeThresholdSeconds');
  });

  it('defaults absent thresholds while retaining the configured log directory', async () => {
    const archiveDir = await mkdtemp(path.join(tmpdir(), 'sitbench-config-'));
    temporaryDirectories.push(archiveDir);
    await writeFile(path.join(archiveDir, 'config.json'), JSON.stringify({ gameLogDir: '/logs' }), 'utf8');

    await expect(loadConfig(archiveDir)).resolves.toEqual({
      gameLogDir: '/logs',
      episodeThresholdSeconds: 180,
      activeCombatGapSeconds: 30,
    });
  });
});

describe('saveConfig', () => {
  it('creates a deferred archive directory before writing config', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sitbench-config-'));
    temporaryDirectories.push(root);
    const archiveDir = path.join(root, 'deferred', 'archive');

    await saveConfig(archiveDir, {
      gameLogDir: '/logs',
      episodeThresholdSeconds: 180,
      activeCombatGapSeconds: 30,
    });

    await expect(readFile(path.join(archiveDir, 'config.json'), 'utf8')).resolves.toContain('"gameLogDir": "/logs"');
  });
});

describe('resolveGameLogDir', () => {
  it('prefers an explicit --logs path over configured and discovered paths', async () => {
    await expect(
      resolveGameLogDir({
        explicitLogs: '/explicit/logs',
        configuredLogs: '/configured/logs',
        discover: async () => ['/discovered/logs'],
      }),
    ).resolves.toBe('/explicit/logs');
  });
});
