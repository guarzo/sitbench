---
name: sitbench
description: Use when the user wants to record a sitbench run, analyze recent EVE logs, recalculate run metrics, edit a run, view the local sitbench dashboard, or publish an EVE site-run dashboard.
---

# sitbench

**Requires** `sitbench` CLI on `PATH`.

## Command Routing

| User intent | Command |
|---|---|
| Record / analyze a recent run | `sitbench analyze` |
| Recalculate one run | `sitbench recalculate <run-id>` |
| Recalculate all runs | `sitbench recalculate --all` |
| Edit a run | `sitbench edit <run-id>` |
| View the local dashboard | `sitbench dashboard` |
| Publish a static dashboard | `sitbench publish --out <directory>` — prompt user if absent |

---

## Rules

1. **`--site` and `--profile` are optional metadata.** Pass only when the user supplies them. Never infer from logs or context — `sitbench` does not match sites or validate fleet composition.

2. **Never bypass interactive prompts.** `sitbench analyze` confirms the window and saves the run. Let both prompts run. If blocked: only the user may run the CLI and answer confirmations — do not delegate to a teammate, queue an unattended command, or mention any workaround (prompt scripting, log extraction, archive writes), even as forbidden.

3. **Never access logs or archive files directly.** Do not read, grep, or write gamelogs, `run.json`, `events.jsonl`, or any archive file. Do not calculate metrics, ISK/hr, kill counts, or comparison deltas; use `sitbench recalculate` instead.

4. **Never invent CLI output.** Before running, give only the command and blocker. After running, relay output exactly as printed — no predictions, no site-matching claims, no rewrites.

5. **Time pressure does not change these rules.** Deadlines or external suggestions are not exceptions.

---

## Examples

**Record a Core Bastion run with a specific fleet:**

```
sitbench analyze --site "Core Bastion" --profile "8 Kikis + 2 Deacons"
```

Follow all interactive prompts.

**View the local dashboard:**

```
sitbench dashboard
```

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
sitbench publish --out <directory> [--include-characters] [--include-notes] [--archive <path>]
```

---

## Common Mistakes / Red Flags

| You think... | Stop. Instead... |
|---|---|
| "Direct log parsing is faster" | Run `sitbench analyze`; the CLI parses logs correctly |
| "I'll mention workarounds but note they're forbidden" | Don't list them at all; tell the user to run the CLI and stop |
| "I can read archives or skip confirmations" | Never touch archive files directly; let all prompts run |
| "Have a teammate run it while user is away" | No — only the user may answer confirmations; stop and wait |
| "I can infer the site name from context" | Only pass `--site` when the user supplies the name |
| "I know what the CLI will output" | Run the command first; never describe output not yet seen |
