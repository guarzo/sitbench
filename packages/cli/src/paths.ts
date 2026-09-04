import { readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import * as path from 'node:path';

export interface GameLogDiscoveryDependencies {
  usersDirectory?: string;
  readDirectories?: (directory: string) => Promise<string[]>;
}

/**
 * Finds EVE Gamelogs folders in the standard WSL-mounted Windows user homes.
 * The Public account is excluded because it does not represent an EVE player.
 */
export async function discoverGameLogDirs(
  dependencies: GameLogDiscoveryDependencies = {},
): Promise<string[]> {
  const usersDirectory = dependencies.usersDirectory ?? '/mnt/c/Users';
  const readDirectories = dependencies.readDirectories ?? readDirectoryNames;
  let users: string[];

  try {
    users = await readDirectories(usersDirectory);
  } catch {
    return [];
  }

  const discovered = await Promise.all(
    users.filter((user) => user !== 'Public').map(async (user) => {
      const logsDirectory = path.join(usersDirectory, user, 'Documents', 'EVE', 'logs');
      try {
        const entries = await readDirectories(logsDirectory);
        return entries.includes('Gamelogs') ? path.join(logsDirectory, 'Gamelogs') : null;
      } catch {
        return null;
      }
    }),
  );

  return discovered.filter((directory): directory is string => directory !== null).sort();
}

/** Returns the per-user directory used for sitbench's local archive. */
export function defaultArchiveDir(): string {
  const dataHome = process.env.XDG_DATA_HOME;
  return path.join(dataHome && dataHome.length > 0 ? dataHome : path.join(homedir(), '.local', 'share'), 'sitbench');
}

export interface AnalyzeConfig {
  gameLogDir?: string;
  episodeThresholdSeconds: number;
  activeCombatGapSeconds: number;
}

const DEFAULT_CONFIG: AnalyzeConfig = {
  episodeThresholdSeconds: 180,
  activeCombatGapSeconds: 30,
};

/** Reads optional archive configuration, applying safe calculation defaults. */
export async function loadConfig(archiveDir: string): Promise<AnalyzeConfig> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path.join(archiveDir, 'config.json'), 'utf8'));
  } catch (error) {
    if (isMissingFile(error)) {
      return { ...DEFAULT_CONFIG };
    }
    throw error;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('config.json must contain an object.');
  }
  const config = parsed as Record<string, unknown>;
  const episodeThresholdSeconds = config.episodeThresholdSeconds ?? DEFAULT_CONFIG.episodeThresholdSeconds;
  const activeCombatGapSeconds = config.activeCombatGapSeconds ?? DEFAULT_CONFIG.activeCombatGapSeconds;
  assertPositiveFinite('episodeThresholdSeconds', episodeThresholdSeconds);
  assertPositiveFinite('activeCombatGapSeconds', activeCombatGapSeconds);
  if (config.gameLogDir !== undefined && typeof config.gameLogDir !== 'string') {
    throw new Error('gameLogDir must be a string.');
  }

  return {
    ...(typeof config.gameLogDir === 'string' ? { gameLogDir: config.gameLogDir } : {}),
    episodeThresholdSeconds,
    activeCombatGapSeconds,
  };
}

/** Persists the resolved log directory and validated calculation settings. */
export async function saveConfig(archiveDir: string, config: AnalyzeConfig): Promise<void> {
  assertPositiveFinite('episodeThresholdSeconds', config.episodeThresholdSeconds);
  assertPositiveFinite('activeCombatGapSeconds', config.activeCombatGapSeconds);
  await writeFile(path.join(archiveDir, 'config.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function assertPositiveFinite(name: string, value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number.`);
  }
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

export interface ResolveGameLogDirOptions {
  explicitLogs?: string;
  configuredLogs?: string;
  discover?: () => Promise<string[]>;
}

/** Explicit command-line input wins, then persisted config, then WSL discovery. */
export async function resolveGameLogDir(options: ResolveGameLogDirOptions): Promise<string | null> {
  if (options.explicitLogs !== undefined) {
    return options.explicitLogs;
  }
  if (options.configuredLogs !== undefined) {
    return options.configuredLogs;
  }
  return (await (options.discover ?? discoverGameLogDirs)())[0] ?? null;
}

async function readDirectoryNames(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}
