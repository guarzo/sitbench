import { cp, mkdir, readFile, readdir } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { Archive, type RunSummary } from '@sitbench/core';
import serveHandler from 'serve-handler';
import { regenerateDashboardData } from './dashboard-export.js';
import { defaultArchiveDir } from './paths.js';

export interface DashboardArguments {
  /** Port to listen on. 0 (default) picks an ephemeral free port. Never a host/bind override. */
  port?: number;
  archive?: string;
}

export interface RunningDashboardServer {
  /** Loopback-only URL the dashboard is reachable at. */
  url: string;
  /** The bound listener address; always '127.0.0.1'. */
  address: string;
  port: number;
  close: () => Promise<void>;
}

export type DashboardResult = ({ status: 'serving' } & RunningDashboardServer) | { status: 'fatal'; reason: string };

export interface DashboardDependencies {
  write?: (line: string) => void;
  /** Packaged @sitbench/dashboard build directory. Defaults to its real module/package location. */
  distDir?: string;
  createArchive?: (directory: string) => Archive;
}

/**
 * Resolves the packaged `@sitbench/dashboard` build directory by its module
 * (package) location, never by the current working directory. This is what
 * lets a globally linked `sitbench` executable serve the dashboard from
 * anywhere.
 */
export function resolveDashboardDistDir(): string {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve('@sitbench/dashboard/package.json');
  return path.join(path.dirname(packageJsonPath), 'dist');
}

/**
 * Copies every entry from the packaged dashboard build into `<archive>/dashboard`,
 * overwriting only the entries the build itself contains (e.g. `index.html`,
 * `assets/`). The `data/` directory — which holds the generated local
 * dataset — is never part of the packaged build, so it is never touched by
 * this copy.
 */
async function ensureDashboardAssets(distDir: string, targetDir: string): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  const entries = await readdir(distDir, { withFileTypes: true });
  for (const entry of entries) {
    await cp(path.join(distDir, entry.name), path.join(targetDir, entry.name), {
      recursive: true,
      force: true,
    });
  }
}

/**
 * Returns whether `<archive>/dashboard/data/runs.json` is missing or stale
 * relative to the archive's current run summaries: missing/unreadable/
 * malformed data is stale, a differing run count is stale, and a most-recent
 * `updatedAt` newer than the dataset's `generatedAt` is stale (a run was
 * edited or recalculated after the dataset was last written).
 */
async function isDashboardDataStale(dataPath: string, runs: RunSummary[]): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(dataPath, 'utf8');
  } catch {
    return true;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return true;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return true;
  }
  const dataset = parsed as { runs?: unknown[]; generatedAt?: unknown };
  if (!Array.isArray(dataset.runs) || dataset.runs.length !== runs.length) {
    return true;
  }
  if (typeof dataset.generatedAt !== 'string') {
    return true;
  }
  const mostRecentUpdate = runs.reduce((max, run) => (run.updatedAt > max ? run.updatedAt : max), '');
  return mostRecentUpdate > dataset.generatedAt;
}

async function regenerateIfStaleOrMissing(archive: Archive, archiveDir: string, dashboardDir: string): Promise<void> {
  const runs = await archive.listRuns();
  const dataPath = path.join(dashboardDir, 'data', 'runs.json');
  if (await isDashboardDataStale(dataPath, runs)) {
    await regenerateDashboardData(archive, archiveDir);
  }
}

/**
 * Starts a static file server bound to `127.0.0.1` only — there is no way
 * to pass a different bind address. `port` defaults to `0` (ephemeral).
 */
export async function startDashboardServer(rootDir: string, port = 0): Promise<RunningDashboardServer> {
  const server: Server = createServer((request, response) => {
    void serveHandler(request, response, { public: rootDir });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Failed to determine the dashboard server address.');
  }

  return {
    url: `http://127.0.0.1:${String(address.port)}/`,
    address: '127.0.0.1',
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

/**
 * Ensures the packaged dashboard assets are present under
 * `<archive>/dashboard`, regenerates local data if missing/stale, and serves
 * the directory on `127.0.0.1`. Returns immediately once the server is
 * listening; callers running interactively are responsible for keeping the
 * process foregrounded (e.g. waiting on a shutdown signal) and calling
 * `close()`.
 */
export async function runDashboard(
  arguments_: DashboardArguments,
  dependencies: DashboardDependencies = {},
): Promise<DashboardResult> {
  const write = dependencies.write ?? console.log;
  const archiveDir = arguments_.archive ?? defaultArchiveDir();
  const archive = (dependencies.createArchive ?? ((directory) => new Archive(directory)))(archiveDir);
  const distDir = dependencies.distDir ?? resolveDashboardDistDir();
  const dashboardDir = path.join(archiveDir, 'dashboard');

  try {
    await ensureDashboardAssets(distDir, dashboardDir);
  } catch (error) {
    return fatal(write, `Cannot prepare dashboard assets: ${message(error)}`);
  }

  try {
    await regenerateIfStaleOrMissing(archive, archiveDir, dashboardDir);
  } catch (error) {
    return fatal(write, `Cannot generate dashboard data: ${message(error)}`);
  }

  let server: RunningDashboardServer;
  try {
    server = await startDashboardServer(dashboardDir, arguments_.port ?? 0);
  } catch (error) {
    return fatal(write, `Cannot start the dashboard server: ${message(error)}`);
  }

  write(`Dashboard running at ${server.url}`);
  return { status: 'serving', ...server };
}

function fatal(write: (line: string) => void, text: string): DashboardResult {
  write(`Error: ${text}`);
  return { status: 'fatal', reason: text };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
