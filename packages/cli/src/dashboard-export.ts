import * as path from 'node:path';
import { Archive, buildLocalDashboardDataset, writeFileAtomic } from '@sitbench/core';

/**
 * Regenerates `<archive>/dashboard/data/runs.json` from validated run
 * summaries. Uses atomic writes so a partial file is never left behind.
 * Failures are returned as warnings — they never roll back the
 * authoritative mutation that preceded them.
 */
export async function regenerateDashboardData(archive: Archive, archiveDir: string): Promise<void> {
  const runs = await archive.listRuns();
  const dataset = buildLocalDashboardDataset(runs);
  const dataDir = path.join(archiveDir, 'dashboard', 'data');
  await writeFileAtomic(path.join(dataDir, 'runs.json'), `${JSON.stringify(dataset, null, 2)}\n`);
}
