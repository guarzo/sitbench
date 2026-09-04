# Sitbench Design

## Purpose

Sitbench is a WSL-native TypeScript/Node CLI for measuring and comparing EVE Online PvE site runs. It reads recent EVE gamelogs without modifying them, asks the user to confirm the detected run window and required metadata, stores normalized source data locally, and generates a static dashboard or privacy-controlled export.

The product name, executable, workspace packages, local data directories, skill, dashboard, and documentation use `sitbench`. EVE-specific domain terms and EVE's Windows gamelog paths remain unchanged. Because this is a greenfield project, Sitbench provides no `eve-run` compatibility aliases or migration layer. The repository's provisional `eve-run.md` plan is not implementation authority: before application work begins, it must be superseded by a Sitbench plan that references this specification and uses Sitbench identifiers throughout.

## Goals

- Discover EVE gamelogs from WSL, defaulting to `/mnt/c/Users/*/Documents/EVE/logs/Gamelogs`.
- Parse supported combat lines conservatively and preserve normalized event provenance.
- Detect candidate PvE episodes and require user confirmation before saving.
- Rank matching runs primarily by total elapsed time while also calculating active combat and idle time.
- Persist human-readable JSON/JSONL as the source of truth without a database.
- Compare runs sharing the same site key and fleet profile ID.
- Serve a read-only local dashboard and create an explicit privacy-filtered static export.
- Expose all workflows through the `sitbench` CLI and a thin agent skill that delegates to it.

## Non-goals

- Inferring site names from NPC composition.
- Modifying original EVE gamelogs.
- Weakly inferring unknown combat events.
- Adding a database, remote backend, authentication, or automatic Git publishing.
- Calculating metrics in the CLI, dashboard, or skill outside the core package.
- Preserving or aliasing the former provisional `eve-run` name.

## Architecture

The repository is a pnpm workspace targeting Node.js 22+ and TypeScript 5.x.

### `@sitbench/core`

The core package is deterministic and owns all schemas, canonical identities, log parsing, target classification, normalization, episode detection, metric calculation, fingerprints, archive persistence, run comparisons, and local/public dataset shaping. Other packages orchestrate or present these APIs but do not duplicate their logic.

### `@sitbench/cli`

The CLI exposes `sitbench analyze`, `recalculate`, `edit`, `dashboard`, and `publish`. It owns WSL path discovery, configuration resolution, prompts, confirmation, command output, and local static serving. Dependencies such as prompts and filesystem discovery are injectable where tests require deterministic behavior.

### `@sitbench/dashboard`

The dashboard is a static Vite application using vanilla TypeScript/DOM and Chart.js. It reads only generated `/data/runs.json`; it never reads normalized event archives. It provides site/profile/date filters, overview metrics, trends, run history, run detail, coverage warnings, per-character local detail, and direct two-run comparisons.

Dashboard datasets are discriminated by `mode: 'local' | 'public'`. Local datasets contain complete `RunSummary` records. Public datasets contain explicit public run records and capability flags indicating whether character data and notes are present. Dashboard components must render from the declared mode and capabilities: identity, per-character, and note UI is hidden when its data is unavailable, while run-level filters, metrics, trends, history, and comparisons continue to work in either mode.

### Sitbench skill

`packages/skill/SKILL.md` is a thin natural-language wrapper around the installed `sitbench` executable. It does not read logs, calculate metrics, edit archive JSON, or bypass CLI confirmations.

## Data flow

1. The CLI resolves an explicit/configured/discovered gamelog directory and the archive directory.
2. Core parses log headers and supported combat-line families into normalized events with source provenance and coverage counts.
3. Core classifies unsupported or ambiguous activity conservatively; excluded events are counted.
4. Core detects candidate episodes using qualifying outgoing NPC damage. A gap greater than or equal to the default 180-second episode threshold starts a new candidate.
5. The CLI presents the newest candidate, adjacent activity, and coverage, then requires confirmation or an explicit window adjustment.
6. The user supplies a site name and fleet profile; these values are never inferred.
7. Core calculates deterministic metrics and a stable duplicate fingerprint.
8. Archive persistence validates and atomically writes the summary and normalized event stream, rejecting duplicate runs unless an explicit edit/recalculation workflow applies.
9. Generated catalog and dashboard datasets are rebuilt from validated run summaries.

## Data model and identity

Zod schemas define normalized events, coverage, windows, fleet profiles, character metrics, run metrics, run summaries, and catalog entries. Schema, parser, and metrics versions are stored explicitly.

`canonicalKey` performs Unicode normalization, lowercase conversion, non-alphanumeric collapse to `-`, and edge trimming. Site and profile matching uses canonical keys; display names preserve user input.

Normalized events retain timestamp, kind, actor, target, amount where applicable, hit quality where applicable, observing character, source filename, source line, and raw input. Coincident damage events are not deduplicated.

## Episode and metric semantics

Only outgoing damage to NPC-qualified targets defines candidate episodes and qualifying combat activity. Incoming damage does not bridge episodes. The default episode threshold is 180 seconds: a gap greater than or equal to 180 seconds between consecutive qualifying events starts a new candidate, while a smaller gap remains in the same candidate.

The confirmed elapsed window defaults to the first and last qualifying outgoing NPC-damage events. Total elapsed time is the primary ranking metric. Active combat uses a separate default continuity threshold of 30 seconds. For consecutive qualifying events inside the confirmed window, a gap less than or equal to 30 seconds contributes its full duration to active combat; a larger gap contributes zero. A lone qualifying event therefore contributes zero active seconds. Idle time is confirmed elapsed time minus active combat, clamped at zero. Episode and active thresholds are explicit calculation inputs recorded with the run so recalculation preserves semantics across version changes. Zero denominators produce zero rather than non-finite values.

## Persistence and recalculation

The default archive is `$XDG_DATA_HOME/sitbench` when set, otherwise `~/.local/share/sitbench`. Configuration lives at `<archive>/config.json`.

Each run stores:

- `runs/<id>/run.json`: validated durable metadata and derived summary;
- `runs/<id>/events.jsonl`: validated normalized source events;
- `catalog.json`: rebuildable run index.

Writes use a temporary sibling directory or file, flush and close content, then rename atomically. A final run ID or fingerprint collision aborts without partial mutation.

Recalculation preserves confirmed boundaries, site, fleet profile, notes, and creation time while rebuilding compatible derived fields from archived normalized events. Editing metadata does not alter fingerprints or metrics unless the confirmed window changes; changed windows require qualifying outgoing NPC damage and trigger recalculation.

## Privacy

Local dashboard data may contain complete run summaries, participant identities, per-character metrics, and notes. Public export uses an explicit public schema rather than deleting keys from local summaries. By default it excludes raw events, local paths, participant identities, per-character metrics, and notes. Character data and notes are restored only through independent explicit flags. Public dataset capability flags must agree with the selected export options, and schema tests must cover the default and every independently enabled private field group.

Publishing copies static dashboard assets plus the generated public dataset to a user-selected directory. It never initializes Git, commits, pushes, or invokes a hosting provider. The local dashboard server binds explicitly to `127.0.0.1` by default and does not expose an option to bind private local data to non-loopback interfaces.

## Errors and warnings

Fatal validation errors prevent archive mutation, including missing site/profile metadata, invalid windows, no qualifying outgoing NPC damage, malformed durable records, and duplicate fingerprints. Manual window adjustments, incomplete parser coverage, ambiguous exclusions, and partial participation are surfaced as warnings. Unsupported combat lines remain unparsed and counted rather than guessed.

## Testing and verification

Development follows test-first steps. Core tests cover schemas, canonicalization, real-shape anonymized parser fixtures when available, normalization, episodes, exact metric arithmetic, fingerprints, atomic archive behavior, comparisons, and privacy shaping. CLI tests use temporary filesystems and injected prompts. Dashboard tests cover selection/filter state and comparison alignment. An end-to-end test runs fixture logs through archive creation, duplicate rejection, recalculation, and local/public dataset generation. Dashboard tests exercise both dataset modes, every public capability combination, and suppression of unavailable identity, character-detail, and note features.

Release verification runs:

```bash
pnpm test
pnpm typecheck
pnpm build
```

A manual smoke test must use copied or anonymized real logs, never writable originals. If real logs are unavailable, this validation remains explicitly outstanding and synthetic fixtures must not be described as complete parser coverage.
