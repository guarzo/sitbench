import type { RunSummary } from './schemas.js';

/** Result of comparing a run against every other run sharing its site key and fleet profile. */
export interface RunComparison {
  /** Most recently recorded matching run strictly before the current run. */
  previous: RunSummary | null;
  /** Fastest (lowest elapsed) matching run recorded up to and including the current run. */
  best: RunSummary | null;
  /** Average elapsed seconds of the up-to-five most recently recorded prior matching runs. */
  trailingFiveAverageElapsedSeconds: number | null;
}

const TRAILING_WINDOW_SIZE = 5;

/** Chronological order key: recorded time first, run id as a deterministic tiebreak. */
function chronoCompare(a: RunSummary, b: RunSummary): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

function pickBest(candidates: RunSummary[]): RunSummary | null {
  if (candidates.length === 0) {
    return null;
  }
  return candidates.reduce((best, candidate) => {
    if (candidate.metrics.elapsedSeconds < best.metrics.elapsedSeconds) {
      return candidate;
    }
    if (candidate.metrics.elapsedSeconds === best.metrics.elapsedSeconds && chronoCompare(candidate, best) < 0) {
      return candidate;
    }
    return best;
  });
}

/**
 * Compares `current` against `allRuns`, matching only runs sharing the exact
 * `(site.key, fleetProfile.id)` pair. Matching runs are ordered chronologically
 * by `createdAt` (ties broken by `id`) relative to `current`; no run recorded
 * after `current` ever contributes to `previous`, `best`, or the trailing-five
 * average. `best` is evaluated over matching runs up to and including
 * `current` itself, so a personal-best run is its own best. Ties for `best`
 * resolve to whichever run was recorded earliest.
 */
export function compareMatchingRuns(current: RunSummary, allRuns: RunSummary[]): RunComparison {
  const matching = allRuns.filter(
    (run) => run.site.key === current.site.key && run.fleetProfile.id === current.fleetProfile.id,
  );

  const notInTheFuture = matching
    .filter((run) => chronoCompare(run, current) <= 0)
    .sort(chronoCompare);

  const priorRuns = notInTheFuture.filter((run) => run.id !== current.id);

  const best = pickBest(notInTheFuture);
  const previous = priorRuns.at(-1) ?? null;

  const trailingFive = priorRuns.slice(-TRAILING_WINDOW_SIZE);
  const trailingFiveAverageElapsedSeconds =
    trailingFive.length > 0
      ? trailingFive.reduce((sum, run) => sum + run.metrics.elapsedSeconds, 0) / trailingFive.length
      : null;

  return { previous, best, trailingFiveAverageElapsedSeconds };
}
