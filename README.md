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

Recalculation preserves the durable site, profile, notes, and evidence while refreshing derived metrics.

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
