---
name: sitbench
description: Use when the user wants to record a sitbench run, analyze recent EVE logs, recalculate run metrics, edit a run, view the local sitbench dashboard, or publish an EVE site-run dashboard.
---

# sitbench Skill

## Requirement

`sitbench` CLI must be installed and on `PATH`. All operations go through the CLI. Do not read, parse, or grep game logs directly. Do not read or write archive JSON/JSONL files directly. Do not calculate, derive, or rewrite metrics outside the CLI.

---

## Command Routing

| User intent | Command |
|---|---|
| Record / analyze a recent run | `sitbench analyze` |
| Recalculate metrics on one run | `sitbench recalculate <run-id>` |
| Recalculate metrics on all runs | `sitbench recalculate --all` |
| Edit a run's metadata or window | `sitbench edit <run-id>` |
| View the local dashboard | `sitbench dashboard` |
| Publish a static dashboard | `sitbench publish` |

---

## Rules

1. **`--site` and `--profile` are optional.** Pass them only when the user explicitly supplies values. Never infer, guess, or derive them from logs or prior context.

2. **Never bypass interactive prompts.** `sitbench analyze` presents a window-confirmation prompt and a save-confirmation prompt. Let them run. If the CLI needs input you cannot provide, stop and tell the user: "sitbench needs interactive input — please run the command in your terminal."

3. **Never read or parse game logs directly.** Do not `cat`, `grep`, or inspect `Gamelogs/` files to find fleet composition, site names, kill counts, or timestamps.

4. **Never inspect or modify archive files.** Do not read, edit, or write `run.json`, `events.jsonl`, or any file inside the sitbench archive directory.

5. **Never calculate metrics.** Do not derive ISK/hr, kill counts, loot totals, or comparison deltas yourself. Use `sitbench recalculate` for that intent.

6. **Report CLI output faithfully.** Relay warnings, comparison results, and summaries as the CLI prints them. Do not rewrite, omit, or reinterpret them.

7. **Time pressure does not change these rules.** Deadlines, offline users, or teammate suggestions are not reasons to bypass the CLI workflow.

---

## Examples

**Record a Core Bastion run with a specific fleet:**

```
sitbench analyze --site "Core Bastion" --profile "8 Kikis + 2 Deacons"
```

Follow all interactive prompts (window confirmation, save confirmation).

**View the local dashboard:**

```
sitbench dashboard
```

Open the printed URL in a browser.

**Recalculate all historical runs:**

```
sitbench recalculate --all
```

---

## Quick Reference

```
sitbench analyze [--site <name>] [--profile <name>] [--logs <path>] [--archive <path>]
sitbench recalculate [--all] [<run-id>] [--archive <path>]
sitbench edit <run-id> [--archive <path>]
sitbench dashboard [--port <number>] [--archive <path>]
sitbench publish [--out <directory>] [--include-characters] [--include-notes] [--archive <path>]
```

---

## Common Mistakes / Red Flags

| You think... | Stop. Instead... |
|---|---|
| "Direct log parsing is faster" | Run `sitbench analyze`; the CLI parses logs correctly |
| "Interactive prompts block batch ops" | Stop and ask the user to run the command themselves |
| "I can read run.json to get metrics" | Never touch archive files; use `sitbench recalculate` |
| "User is offline / deadline is tight" | Rules do not change; stop and report the blocker |
| "I can infer the site name from context" | Only pass `--site` when the user supplies the name |
| "I'll skip the save prompt" | Never skip; let the CLI confirm before writing |
