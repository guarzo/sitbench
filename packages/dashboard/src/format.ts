// ---------------------------------------------------------------------------
// Formatting utilities for dashboard display values
// ---------------------------------------------------------------------------

/** Formats seconds as "Xm Ys" for elapsed/duration display. */
export function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (minutes === 0) return `${String(remainingSeconds)}s`;
  return `${String(minutes)}m ${String(remainingSeconds)}s`;
}

/**
 * Formats a signed duration delta, e.g. "+15s", "-15s", "0s". Only ever used
 * for metrics measured in seconds; unitless metrics use `formatSignedCount`.
 */
export function formatSignedSeconds(deltaSeconds: number): string {
  const rounded = Math.round(deltaSeconds);
  if (rounded === 0) return '0s';
  return `${rounded > 0 ? '+' : ''}${rounded.toLocaleString('en-US')}s`;
}

/**
 * Formats a signed unitless delta with locale grouping, e.g. "+37",
 * "+53,000", "-6,000", "0". Used for DPS and damage deltas, which must never
 * carry a seconds suffix.
 */
export function formatSignedCount(delta: number): string {
  const rounded = Math.round(delta);
  if (rounded === 0) return '0';
  return `${rounded > 0 ? '+' : ''}${rounded.toLocaleString('en-US')}`;
}

/** Formats DPS as a rounded integer with comma separators. */
export function formatDps(dps: number): string {
  return Math.round(dps).toLocaleString('en-US');
}

/** Formats large damage numbers with comma separators. */
export function formatDamage(damage: number): string {
  return Math.round(damage).toLocaleString('en-US');
}

/** Formats a fraction (0–1) as a percentage string, e.g. "58.3%". */
export function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

/** Formats an ISO date string as a short local date/time for table display. */
export function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** Formats coverage quality as a readable label. */
export function formatRepairPairing(pairing: 'none' | 'partial' | 'full'): string {
  switch (pairing) {
    case 'none':
      return 'No repair data';
    case 'partial':
      return 'Partial';
    case 'full':
      return 'Full';
  }
}
