import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const probeScriptPath = path.join(testDirectory, '.tmp-dashboard-artifact-smoke.mjs');

afterEach(async () => {
  await rm(probeScriptPath, { force: true });
});

describe('packaged dashboard artifact resolution (packed/global-link smoke)', () => {
  it('resolves @sitbench/dashboard package.json and dist files from a child process whose cwd is unrelated to the package', async () => {
    // The probe script is written to a real file *inside* packages/cli/test/,
    // so Node's module resolution walks up through the real
    // packages/cli/node_modules tree exactly like the built
    // dashboard-command.js does. The CHILD PROCESS's cwd is deliberately an
    // unrelated temp directory, so a pass here proves resolution depends
    // only on the probe script's own module location, never on the caller's
    // working directory -- the same guarantee a globally linked `sitbench`
    // executable relies on when invoked from an arbitrary directory.
    await writeFile(
      probeScriptPath,
      `
      import { createRequire } from 'node:module';
      import * as path from 'node:path';
      import { readdir, readFile } from 'node:fs/promises';
      const require = createRequire(import.meta.url);
      const packageJsonPath = require.resolve('@sitbench/dashboard/package.json');
      const distDir = path.join(path.dirname(packageJsonPath), 'dist');
      const entries = await readdir(distDir);
      const html = await readFile(path.join(distDir, 'index.html'), 'utf8');
      console.log(JSON.stringify({ distDir, entries, htmlLength: html.length, cwd: process.cwd() }));
      `,
      'utf8',
    );

    const unrelatedCwd = await mkdtemp(path.join(tmpdir(), 'sitbench-cwd-unrelated-'));
    try {
      const { stdout } = await execFileAsync(process.execPath, [probeScriptPath], { cwd: unrelatedCwd });
      const result = JSON.parse(stdout.trim()) as {
        distDir: string;
        entries: string[];
        htmlLength: number;
        cwd: string;
      };

      expect(result.cwd).toBe(unrelatedCwd);
      expect(result.distDir.endsWith(path.join('dashboard', 'dist'))).toBe(true);
      expect(result.entries).toContain('index.html');
      expect(result.entries).toContain('assets');
      expect(result.htmlLength).toBeGreaterThan(0);
    } finally {
      await rm(unrelatedCwd, { recursive: true, force: true });
    }
  });

  it('resolves and loads the browser-safe ./data and ./state subpaths from the same unrelated cwd', async () => {
    await writeFile(
      probeScriptPath,
      `
      const dataModule = await import('@sitbench/dashboard/data');
      const stateModule = await import('@sitbench/dashboard/state');
      console.log(JSON.stringify({
        cwd: process.cwd(),
        hasValidateDataset: typeof dataModule.validateDataset === 'function',
        hasInitializeState: typeof stateModule.initializeState === 'function',
      }));
      `,
      'utf8',
    );

    const unrelatedCwd = await mkdtemp(path.join(tmpdir(), 'sitbench-cwd-unrelated-'));
    try {
      const { stdout } = await execFileAsync(process.execPath, [probeScriptPath], { cwd: unrelatedCwd });
      const result = JSON.parse(stdout.trim()) as {
        cwd: string;
        hasValidateDataset: boolean;
        hasInitializeState: boolean;
      };

      expect(result.cwd).toBe(unrelatedCwd);
      expect(result.hasValidateDataset).toBe(true);
      expect(result.hasInitializeState).toBe(true);
    } finally {
      await rm(unrelatedCwd, { recursive: true, force: true });
    }
  });
});
