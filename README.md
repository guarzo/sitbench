# Sitbench

Sitbench turns local EVE Online gamelogs into confirmed, reproducible PvE run records. It preserves normalized event evidence locally, compares timing and fleet metrics, and can create a deliberately privacy-limited static dashboard export.

## WSL setup

Sitbench requires Node.js 22 or newer. Confirm that `node --version` reports version 22 or later before installing dependencies.

For a first-time global CLI link, pnpm needs a configured global-bin directory. If `pnpm bin --global` already works, no setup is needed. Otherwise run the following once, then restart the WSL shell (or otherwise refresh its `PATH`) before running the global-link command below:

```bash
pnpm setup
```

Run these commands from the Sitbench checkout in WSL:

```bash
corepack enable
pnpm install
pnpm build
pnpm --filter @sitbench/cli link --global

sitbench analyze
sitbench dashboard
sitbench recalculate --all
sitbench publish --out ./public-export
```

Sitbench uses the pinned `pnpm@10.15.0` declared in `package.json`. If a local Corepack shim is unavailable, use this environment-safe troubleshooting fallback for an individual command; it does not change the project or package-manager identity:

```bash
npx --yes pnpm@10.15.0 test
```

## Analyze a run

`sitbench analyze` discovers EVE gamelogs at the first available WSL path:

```text
/mnt/c/Users/<WindowsUser>/Documents/EVE/logs/Gamelogs
```

Pass `--logs <path>` to choose a different directory. The resolved directory is remembered in the local archive configuration for subsequent analyses. Sitbench reads original EVE logs only; it never edits, moves, or uses them as writable test data.

The local archive defaults to `$XDG_DATA_HOME/sitbench`, or `~/.local/share/sitbench` when `XDG_DATA_HOME` is unset. It contains each run's `run.json` summary and its local-only normalized `events.jsonl` evidence.

Analysis identifies candidate episodes from outgoing NPC damage. A gap of **180 seconds or more** (three minutes) starts a new episode. Within a confirmed run, active-combat continuity includes consecutive qualifying events separated by **30 seconds or less**. These defaults are persisted with the run so recalculation remains reproducible.

Before a run is saved, Sitbench requires you to:

1. accept, select, adjust, or cancel the detected candidate episode;
2. provide a non-empty site name and fleet profile;
3. optionally provide private notes; and
4. confirm the displayed summary.

Nothing is saved until the final confirmation. Use `sitbench analyze --site <name> --profile <name>` to supply the two required metadata values on the command line; candidate and save confirmation still protect the archive.

## Review, recalculate, and serve locally

Use `sitbench recalculate --all` to recompute every archived run from its confirmed window and archived normalized events. It preserves the durable site, profile, notes, and evidence while refreshing derived metrics.

`sitbench dashboard` prepares local dashboard assets and serves them on `127.0.0.1` only. It has no host/bind override, so the dashboard is reachable from the same machine at the printed loopback URL and is not exposed to the network. Local dashboard data includes private participant metrics and notes from the archive.

## Export public data deliberately

`sitbench publish --out ./public-export` copies dashboard assets and writes a static public dataset. By default it omits participant names, per-character metrics, notes, archived events, raw log text, source-file paths, fingerprints, and record timestamps. The command refuses output paths that overlap the archive.

Use `--include-characters` and/or `--include-notes` only after reviewing the output and deciding that disclosure is appropriate. Public export is a static file bundle: Sitbench does not initialize a repository, deploy it, configure hosting, or guarantee that a chosen host will preserve the same access controls. Treat the output directory as data intended for sharing.

## Validation status

Synthetic end-to-end verification uses representative EVE line shapes and temporary copied fixture files. It covers analysis, archiving, duplicate rejection, recalculation, local dashboard data, and the default privacy-safe public export. It does not establish complete parser coverage for live client logs.

Manual real-log smoke test: outstanding

Real-log parser coverage: outstanding
