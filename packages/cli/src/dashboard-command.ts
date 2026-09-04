import { cp, mkdir, readFile, readdir } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { Archive, LocalDashboardDatasetSchema, type RunSummary } from '@sitbench/core';
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
 * relative to the archive's current run summaries. The existing file must
 * fully satisfy `LocalDashboardDatasetSchema` (mode, capabilities, and every
 * nested run field) to be trusted at all -- a malformed file, a public
 * dataset sitting at the local path, or any other schema violation is
 * always stale regardless of run count or timestamps. Given a valid
 * dataset, a differing run count is stale, and comparing the *parsed*
 * instants (`Date.parse`) of the most recent archived `updatedAt` against
 * the dataset's `generatedAt` is stale when the former is later -- never a
 * raw string/lexical comparison, which does not order ISO timestamps with
 * differing UTC offsets correctly.
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

  const result = LocalDashboardDatasetSchema.safeParse(parsed);
  if (!result.success) {
    return true;
  }
  const dataset = result.data;
  if (dataset.runs.length !== runs.length) {
    return true;
  }

  const mostRecentUpdateMs = runs.reduce((max, run) => Math.max(max, Date.parse(run.updatedAt)), 0);
  const generatedAtMs = Date.parse(dataset.generatedAt);
  if (!Number.isFinite(mostRecentUpdateMs) || !Number.isFinite(generatedAtMs)) {
    // A schema-valid timestamp is not necessarily parseable: the offset
    // pattern z.string().datetime({ offset: true }) validates against
    // (/([+-]\d{2}:?\d{2})/) does not bound hours to 00-23 or minutes to
    // 00-59 (e.g. "+99:99" passes schema validation but Date.parse returns
    // NaN). Any comparison side that cannot be trusted as a real instant
    // is treated as stale, never as "wins the comparison" by accident.
    return true;
  }
  return mostRecentUpdateMs > generatedAtMs;
}

async function regenerateIfStaleOrMissing(archive: Archive, archiveDir: string, dashboardDir: string): Promise<void> {
  const runs = await archive.listRuns();
  const dataPath = path.join(dashboardDir, 'data', 'runs.json');
  if (await isDashboardDataStale(dataPath, runs)) {
    await regenerateDashboardData(archive, archiveDir);
  }
}

/**
 * The exact requests this server will ever serve: `/` and `/index.html`
 * (the packaged dashboard shell), `/data/runs.json` (the generated local
 * dataset), and a plain filename directly under `/assets/` (no
 * subdirectories, no path traversal -- the pattern's character class never
 * includes `/`, so a decoded `..`/`/` sequence can never match it). Every
 * other request -- including a planted `events.jsonl`, an archived `runs/`
 * tree, an arbitrary file, or any directory listing -- is refused with 404
 * before `serve-handler` is ever consulted, regardless of whether the path
 * actually exists on disk.
 */
const ASSET_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

type AllowedDashboardRequest = { kind: 'shell' } | { kind: 'data' } | { kind: 'asset'; name: string };

function classifyDashboardRequest(rawUrl: string | undefined): AllowedDashboardRequest | null {
  if (rawUrl === undefined) {
    return null;
  }
  let pathname: string;
  try {
    // The WHATWG URL parser collapses raw ".." path segments during
    // construction; percent-encoded segments (e.g. "%2e%2e") are decoded
    // afterward and re-validated against the strict per-category patterns
    // below, so no encoding trick can smuggle a "/" or ".." through.
    pathname = decodeURIComponent(new URL(rawUrl, 'http://127.0.0.1').pathname);
  } catch {
    return null;
  }

  if (pathname === '/' || pathname === '/index.html' || pathname === '/index') {
    // serve-handler's default cleanUrls behavior 301-redirects an explicit
    // "/index.html" request to "/index" and then resolves that back to the
    // same file internally; both hops must stay inside the allowlist.
    return { kind: 'shell' };
  }
  if (pathname === '/data/runs.json') {
    return { kind: 'data' };
  }
  if (pathname.startsWith('/assets/')) {
    const name = pathname.slice('/assets/'.length);
    if (ASSET_NAME_PATTERN.test(name)) {
      return { kind: 'asset', name };
    }
  }
  return null;
}

/**
 * Narrow injectable seam for the static-file handler and for observing a
 * handler failure. Production always uses `serve-handler` and reports the
 * failure through the command's own `write`; tests use this to drive a
 * real rejected request through a real HTTP server.
 */
export interface DashboardServerDependencies {
  handler?: (
    request: IncomingMessage,
    response: ServerResponse,
    options: { public: string; directoryListing: boolean },
  ) => Promise<void>;
  onError?: (error: unknown) => void;
  /**
   * Narrow test seam for constructing the underlying HTTP server, so a test
   * can hold the server instance and drive a server-level failure. Production
   * always uses `node:http`'s `createServer`.
   */
  createServer?: (requestListener: (request: IncomingMessage, response: ServerResponse) => void) => Server;
}

/**
 * Completes a request whose handler rejected, without ever ending a
 * response twice or writing headers after they were already sent: an
 * already-finished response is left alone, a response that has not sent
 * headers yet gets a plain 500, and a response that already started
 * streaming is simply ended. The server itself stays listening, so a
 * single failed request never takes the dashboard down.
 */
function respondWithHandlerFailure(response: ServerResponse): void {
  if (response.writableEnded) {
    return;
  }
  if (!response.headersSent) {
    response.statusCode = 500;
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.end('Internal Server Error');
    return;
  }
  response.end();
}

/**
 * Starts a static file server bound to `127.0.0.1` only -- there is no way
 * to pass a different bind address. `port` defaults to `0` (ephemeral).
 * Requests are pre-validated against an exact allowlist (see
 * `classifyDashboardRequest`) before `serve-handler` ever sees them, and
 * directory listing is disabled as further defense in depth. The handler's
 * promise is always observed: a rejection is turned into a 500 (or a clean
 * end for an already-started response) and reported through `onError`,
 * never left floating as an unhandled rejection. The listener registered to
 * reject a failed startup is removed as soon as the server is listening, and
 * replaced (inside the same listen callback, so there is no window without
 * an error listener) by one that reports later server-level failures through
 * `onError` — otherwise the very first post-startup error would be consumed
 * by the already-settled startup promise and silently lost.
 */
export async function startDashboardServer(
  rootDir: string,
  port = 0,
  dependencies: DashboardServerDependencies = {},
): Promise<RunningDashboardServer> {
  const handler = dependencies.handler ?? ((request, response, options) => serveHandler(request, response, options));
  const createHttpServer = dependencies.createServer ?? createServer;
  const server: Server = createHttpServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.statusCode = 405;
      response.end();
      return;
    }
    if (classifyDashboardRequest(request.url) === null) {
      response.statusCode = 404;
      response.end('Not Found');
      return;
    }
    // The awaited handler runs inside a promise that can never reject, so
    // this is an observed completion rather than a floating promise.
    void (async () => {
      try {
        await handler(request, response, { public: rootDir, directoryListing: false });
      } catch (error) {
        dependencies.onError?.(error);
        respondWithHandlerFailure(response);
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    const rejectStartup = (error: Error): void => {
      reject(error);
    };
    server.once('error', rejectStartup);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', rejectStartup);
      const { onError } = dependencies;
      if (onError !== undefined) {
        server.on('error', (error) => {
          onError(error);
        });
      }
      resolve();
    });
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
    server = await startDashboardServer(dashboardDir, arguments_.port ?? 0, {
      onError: (error) => {
        write(`Warning: a dashboard request failed: ${message(error)}`);
      },
    });
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
