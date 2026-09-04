/**
 * Produces a stable, URL-safe key from a user-provided name.
 *
 * Algorithm:
 *   1. Unicode NFC normalization.
 *   2. Lowercase.
 *   3. Collapse every run of non-alphanumeric characters to a single '-'.
 *   4. Trim leading and trailing '-'.
 */
export function canonicalKey(value: string): string {
  return value
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
