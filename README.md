# Sitbench

Sitbench turns local EVE Online gamelogs into confirmed, reproducible PvE run records. It preserves normalized event evidence locally, compares timing and fleet metrics, and can create a deliberately privacy-limited static dashboard export.

## WSL setup

Sitbench requires Node.js 22 or newer. Confirm that `node --version` reports version 22 or later before installing dependencies.

### Setup and usage flow

From the Sitbench checkout in WSL, first enable the pinned package-manager shim:

```bash
corepack enable
```

Before the global-link step, a first-time pnpm installation may need a configured global-bin directory. If `pnpm bin --global` already works, skip this step. Otherwise run the following once, then restart the WSL shell (or otherwise refresh its `PATH`) before continuing:

```bash
pnpm setup
```

Continue the required setup and usage flow:

```bash
pnpm install
pnpm build
pnpm --filter @sitbench/cli link --global

sitbench analyze
sitbench dashboard
sitbench recalculate --all
sitbench publish --out ./public-export
```

Sitbench uses the pinned `pnpm@10.15.0` declared in `package.json`. If a local Corepack shim is unavailable, prefix pnpm commands with `npx --yes pnpm@10.15.0` instead; this does not change the project or package-manager identity:

```bash
npx --yes pnpm@10.15.0 install --frozen-lockfile
npx --yes pnpm@10.15.0 build
npx --yes pnpm@10.15.0 --filter @sitbench/cli link --global
```

After building, you can also run the CLI directly from the checkout without a global link:

```bash
node packages/cli/dist/index.js --help
node packages/cli/dist/index.js analyze
```

## Analyze a run

`sitbench analyze` discovers EVE gamelogs at the first available WSL path:

```text
/mnt/c/Users/<WindowsUser>/Documents/EVE/logs/Gamelogs
```

Pass `--logs <path>` to choose a different directory. The resolved directory is remembered in the local archive configuration for subsequent analyses. Sitbench reads original EVE logs only; it never edits, moves, or uses them as writable test data.

A real `Gamelogs` directory accumulates years of files, so discovery is bounded and never reads the whole directory: only direct `.txt` files modified within the last **7 days** are eligible, at most the newest **256** of those are read, and file access runs in bounded batches. These bounds apply to `--logs` as well. Each analysis reports how many files it inspected and how many it skipped.

The local archive defaults to `$XDG_DATA_HOME/sitbench`, or `~/.local/share/sitbench` when `XDG_DATA_HOME` is unset. It contains each run's `run.json` summary and its local-only normalized `events.jsonl` evidence.

Analysis identifies candidate episodes from outgoing NPC damage. A gap of **180 seconds or more** (three minutes) starts a new episode. Within a confirmed run, active-combat continuity includes consecutive qualifying events separated by **30 seconds or less**. These defaults are persisted with the run so recalculation remains reproducible.

Before a run is saved, Sitbench requires you to:

1. accept, select, adjust, or cancel the detected candidate episode;
2. provide a non-empty site name and fleet profile;
3. optionally provide private notes; and
4. confirm the displayed summary.

Nothing is saved until the final confirmation. Supply the two required metadata values on the command line when convenient; candidate and save confirmation still protect the archive:

```bash
sitbench analyze --site "Core Bastion" --profile "8 Kikis + 2 Deacons"
```

To select a non-default log directory:

```bash
sitbench analyze \
  --logs "/mnt/c/Users/<WindowsUser>/Documents/EVE/logs/Gamelogs" \
  --site "Core Bastion" \
  --profile "8 Kikis + 2 Deacons"
```

After saving, Sitbench prints `Saved run <run-id>.` Keep that ID for editing or recalculating the run. If needed, archived run IDs are also the directory names under `<archive>/runs/`, such as `~/.local/share/sitbench/runs/<run-id>/` with the default archive location.

## Review, edit, recalculate, and serve locally

Edit a saved run's site, fleet profile, notes, or confirmed window interactively:

```bash
sitbench edit <run-id>
```

Changing the confirmed window recalculates its derived metrics and fingerprint from the archived normalized events. Metadata-only edits preserve those values.

Recalculate one run or every archived run from its confirmed window and archived normalized events:

```bash
sitbench recalculate <run-id>
sitbench recalculate --all
```

Recalculation preserves the durable site, profile, notes, and evidence while refreshing derived metrics. It does not re-read original logs or recover event kinds that an older parser discarded.

### Observed neut drain and historical backfill

New analyses record incoming energy-neutralizer events per character. The detail dashboard shows:

- **Total GJ:** logged capacitor drained inside the confirmed run window.
- **Avg GJ/s:** total divided by the entire run's elapsed seconds.
- **Peak 10s GJ/s:** the largest sum in a rolling `(t − 10 seconds, t]` interval divided by 10. The denominator stays 10 even for runs shorter than ten seconds.
- **Events:** logged incoming neut applications, preserving simultaneous hits.

This measures **observed drain**, not theoretical neut strength, capacitor percentage, or time capped out. Only the verified incoming EVE line shape with red amount markup is recognized; unmarked or other-direction variants are not guessed. A character's own log must be supplied. As with other incoming metrics, the confirmed run window determines what counts; neuts do not change episode detection or active-combat time.

Runs created before neut support show **Unavailable**, not zero. Ordinary recalculation preserves this distinction. To recover historical data, first build/use the updated CLI and make a backup of your archive, then preview the backfill:

```bash
sitbench backfill-neuts --all --dry-run
sitbench backfill-neuts --all
```

Or target one run and specify the original log directory:

```bash
sitbench backfill-neuts <run-id> --logs /path/to/Gamelogs --dry-run
sitbench backfill-neuts <run-id> --logs /path/to/Gamelogs
```

`--archive <path>` is supported for testing on a copy. Without `--logs`, backfill uses the archive's configured log directory. It reads only filenames referenced by archived evidence, without the normal seven-day/file-count discovery limits. Every referenced file must be present, have the matching listener, and match the archived raw lines at their recorded positions. Missing or unsafe source paths, listener mismatches, and changes/truncation affecting those archived positions leave that run untouched; other runs in `--all` can still succeed, and an incomplete batch exits nonzero.

**Historical coverage is source-limited:** old archives did not retain discarded lines or a complete source-file inventory. Backfill cannot detect edits to formerly unsupported lines, truncation after the last archived observation, or an additional session file that contributed no archived events. Totals and recorded zeros describe the referenced logs as supplied, not proof of complete fleet coverage. Keep the original session logs intact.

Backfill supplements normalized evidence with in-window neuts and updates neut metrics, their availability marker, the content fingerprint, metrics version, and update timestamp. It preserves run IDs, site/profile/notes, confirmed windows, creation timestamps, existing non-neut observations, and other metric values. Original parser-version and coverage counts remain the provenance of the initial ingestion, rather than being relabelled as a full reparse. A recovered neut-only character from retained source evidence is added to the character list and participant count. Already-recorded runs are skipped without needing the original logs, so repeats do not duplicate events. Original EVE logs are never written.

Shrinking a confirmed window recalculates neut metrics from retained evidence. Expanding it clears neut availability until `backfill-neuts` is run for the expanded window. Per-character neut metrics remain private in default public exports and are included only with `--include-characters`.

**Compatibility:** the updated CLI reads legacy archives, but older builds reject the added fields. Use the updated build for analysis, editing, recalculation, dashboard serving, and publishing after backfill. Archive updates use the existing archive lock and per-file atomic writes, not a crash-safe multi-file transaction; retain your pre-backfill backup.

`sitbench dashboard` prepares local dashboard assets and serves them on `127.0.0.1` only. It has no host/bind override, so the dashboard is reachable from the same machine at the printed loopback URL and is not exposed to the network. Local dashboard data includes private participant metrics and notes from the archive. Press `Ctrl+C` to stop it.

Use an ephemeral port by default, or select a fixed port:

```bash
sitbench dashboard
sitbench dashboard --port 8080
```

## Export public data deliberately

`sitbench publish --out ./public-export` copies dashboard assets and writes a static public dataset. By default it omits participant names, per-character metrics, notes, archived events, raw log text, source-file paths, fingerprints, and record timestamps. The command refuses output paths that overlap the archive.

Use `--include-characters` and/or `--include-notes` only after reviewing the output and deciding that disclosure is appropriate:

```bash
sitbench publish \
  --out ./public-export \
  --include-characters \
  --include-notes
```

Public export is a static file bundle: Sitbench does not initialize a repository, deploy it, configure hosting, or guarantee that a chosen host will preserve the same access controls. Treat the output directory as data intended for sharing.

To inspect the export locally, serve the directory over HTTP rather than opening `index.html` directly:

```bash
python3 -m http.server 8000 --directory ./public-export
```

Then open `http://127.0.0.1:8000/` and stop the server with `Ctrl+C` when finished.

## Validation status

Synthetic end-to-end verification uses representative EVE line shapes and temporary copied fixture files. It covers analysis, archiving, duplicate rejection, recalculation, local dashboard data, and the default privacy-safe public export. It does not establish complete parser coverage for live client logs.

NPC target confidence is deliberately narrow. Sitbench only confirms a target as an NPC when its name matches the currently supported Sleeper-family patterns (`Sleepless…`, `Awakened…`, `Emergent…`), and it only confirms a target as non-site when the name matches the known player-owned deployable and structure exclusions. Every other target name is recorded as `ambiguous` and is excluded from qualifying episode detection and metrics, so PvE content outside those supported patterns can produce "no confirmed outgoing NPC damage" even though damage was dealt. `sitbench analyze` reports the ambiguous count on both the candidate and no-candidate paths so this is visible rather than silent. Expanding classification beyond the supported patterns requires anonymized real gamelog fixtures as evidence; no NPC names are added speculatively.

Manual real-log smoke test: outstanding

Real-log parser coverage: outstanding
