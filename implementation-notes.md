# Observed neut drain: implementation notes

## What changed and how it works

- Core parses the verified incoming red-amount EVE neutralization line into a `neut-received` event, preserving raw text and observer/source provenance. Unmarked or other-direction variants remain unsupported.
- Per-character `neutPressure` contains total GJ, average GJ/s, peak rolling 10-second GJ/s, and event count. Calculation explicitly opts into recorded evidence; absent legacy data is not silently converted to zero.
- New analysis records availability. Recalculation carries it forward. Window shrink recalculates from retained evidence; expansion clears availability until backfill is run again.
- `backfill-neuts [run-id]` / `--all`, with optional `--dry-run`, `--logs`, and `--archive`, reads referenced source files without the recent-log discovery cutoff. It validates safe paths, listeners, and archived raw-line positions, then supplements only neut evidence inside the confirmed window.
- Backfill preserves existing non-neut metrics and observations, site/profile/notes, run ID, creation time, and window. A newly recovered neut-only participant is added to character metrics and participant count. The fingerprint, metrics version, update time, and availability are refreshed. Original parser version and ingestion coverage counts are retained.
- The run-detail dashboard adds a capability-gated table, preserving fractional GJ rates. The description stays outside its keyboard-focusable horizontal scroll region. Public exports still exclude character metrics unless explicitly enabled.

## Decisions and discoveries

- Rates describe observed capacitor drain, not theoretical neutralizer strength or continuous capacitor state. Average uses the full run duration. Peak uses `(t - 10s, t]` and always divides by 10, including short runs. Simultaneous hits remain separate events.
- Old archives preserve neither discarded raw lines nor a complete source-file inventory. Historical backfill is explicitly limited to referenced files as supplied. It cannot detect edits to formerly discarded lines, truncation after the last archived anchor, or an unreferenced neut-only session. This limitation is surfaced in command output and README rather than guessing completeness.
- Backfill checks recorded status before resolving logs, so a completed run can be skipped even after the originals are unavailable.
- The update callback compares both summary and events against the loaded snapshot under the existing archive lock, refusing concurrent changes.
- Polish exposed an evidence-write failure that could commit recorded availability prematurely. `Archive.updateRun` now writes evidence before the summary. This is still not a multi-file transaction: a failed summary write can retain newer evidence with the old summary. Keep a backup and retry after resolving the storage failure.
- Catalog/dashboard failures after an authoritative update remain explicit warnings. Missing or incompatible runs produce a partial batch/nonzero exit while other runs continue.
- Updated builds read legacy records; older strict-schema builds cannot read the new fields. Live archive mutation and installed-CLI activation are deliberately deferred until integration is chosen.

## Verification actually performed

From the feature worktree:

- `pnpm test`: 517 passing tests (192 core, 146 dashboard, 179 CLI).
- `pnpm typecheck`: all packages passed.
- `pnpm build`: all packages passed.
- `git diff --check`: passed.
- Test-first regressions exercised incoming parsing, metrics, analysis availability, CLI registration, window editing, newly recovered participants, missing-log retries, evidence-write failure, and accessible description placement.
- Additional coverage includes same-second hits, inclusive run boundaries, fixed/half-open peak windows, short and zero-duration calculations, legacy archive loading, privacy exports, source mismatch/path rejection, dry-run immutability, repeated backfill, concurrency conflicts, mixed batches, and derivative warnings.
- Real-log rehearsal on disposable archive copies: CLI dry-run, backfill, repeated backfill, and recalculation succeeded for all nine available runs. Independent raw-log calculations matched per-character totals/counts/averages/peaks. Existing non-neut values and durable metadata were checked for preservation. Live records and original logs were not modified.
- Chrome smoke check at desktop and 390px mobile widths: table data rendered, fractional rates preserved, no page overflow, explanation visible outside horizontal scrolling, table keyboard-focusable, no observed runtime errors. Screenshots inspected.
- Four scoped polish reviews covered general correctness, failure paths, type contracts, and documentation. Verified task bugs were corrected and re-tested; remaining source-completeness and multi-file persistence limitations are documented above.

Not verified: other EVE locales/neutralization formats, full historical source completeness, or crash recovery across both archive files. No live backfill, install switch, merge, push, or deployment was performed.

## Reviewer focus / knowledge check

1. How is incoming direction established without treating outgoing or unmarked neutralization as received drain?
2. Why must recorded availability survive recalculation separately from the existence of neut events?
3. Which interval and denominator define the rolling peak, and how are simultaneous hits handled?
4. Which historical source gaps cannot be established from archived evidence, even when every referenced file matches?
5. Why does evidence precede summary persistence, and what partial-failure limitation remains?
