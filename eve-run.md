# eve-run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a WSL-native TypeScript/Node CLI that analyzes recent EVE Online PvE gamelogs, records normalized run data in JSON/JSONL, compares matching runs, and serves a static local dashboard with optional privacy-controlled export.

**Architecture:** A deterministic `@eve-run/core` package owns schemas, parsing, run detection, metrics, archive reads/writes, and export shaping. `@eve-run/cli` handles WSL discovery and interactive confirmation; `@eve-run/dashboard` is a read-only static app consuming generated summary JSON; `packages/skill` contains only the Codex skill wrapper and never duplicates analysis logic. Local normalized events are authoritative for recalculation, while generated catalog/dashboard data are rebuildable derivatives.

**Tech Stack:** Node.js 22+, TypeScript 5.x, pnpm workspaces, Vitest, Zod, Commander, @inquirer/prompts, Vite, vanilla TypeScript/DOM, Chart.js, `serve-handler` for the local dashboard server.

**Spec:** `docs/superpowers/specs/2026-09-03-eve-run-design.md`

## Global Constraints

- Target runtime is WSL; default discovery searches `/mnt/c/Users/*/Documents/EVE/logs/Gamelogs`.
- The core package is the sole owner of parsing and metric calculations.
- Site name and fleet profile are required user-supplied metadata; never infer the site from NPC composition.
- Default candidate separation is 180 seconds with no outgoing fleet damage to an NPC.
- Default elapsed window is first to last outgoing fleet damage to an NPC; user confirmation is required before saving.
- Total elapsed time is the primary ranking metric; also calculate active combat time and idle time.
- Store local source-of-truth data as human-readable JSON/JSONL; do not introduce a database.
- Preserve normalized events and provenance; never modify original EVE gamelogs.
- Unknown or ambiguous events are excluded and counted rather than weakly inferred.
- Damage events are not deduplicated by coincident timestamp/amount/target/weapon.
- Public export omits raw events, local paths, character identity/per-character metrics, and notes by default.
- Writes must be atomic and duplicate runs must be rejected unless explicitly edited/recalculated.

---

## File Structure

```text
package.json                         # workspace scripts and toolchain
pnpm-workspace.yaml                  # workspace package discovery
tsconfig.base.json                   # shared TS compiler settings
.gitignore
packages/
  core/
    package.json
    tsconfig.json
    src/
      index.ts                       # public package exports
      schemas.ts                     # Zod schemas + shared TS types
      canonicalize.ts                # stable site/profile keys
      log-header.ts                  # character/session metadata extraction
      log-line-parser.ts             # EVE combat line -> normalized observation
      target-classifier.ts           # NPC/non-site/ambiguous classification
      normalize.ts                   # source log -> normalized events + coverage
      episodes.ts                    # candidate episode/window detection
      metrics.ts                     # fleet and character metric calculations
      fingerprint.ts                 # stable duplicate fingerprint
      archive.ts                     # atomic run/profile/catalog persistence
      comparisons.ts                 # best/previous/trailing-five comparisons
      export.ts                      # local dashboard/public export shaping
    test/
      fixtures/
      *.test.ts
  cli/
    package.json
    tsconfig.json
    src/
      index.ts                       # executable entrypoint
      paths.ts                       # WSL log/archive discovery
      analyze-command.ts             # interactive analyze flow
      dashboard-command.ts           # generation + local server
      recalculate-command.ts         # deterministic summary rebuild
      edit-command.ts                # durable metadata/window corrections
      publish-command.ts             # privacy-controlled export
      ui.ts                          # prompt/format helpers
    test/
      *.test.ts
  dashboard/
    package.json
    tsconfig.json
    index.html
    src/
      main.ts                        # app bootstrap
      data.ts                        # load dashboard JSON
      state.ts                       # selected site/profile/date/run state
      format.ts                      # durations/numbers/percent formatting
      overview.ts                    # summary cards
      trends.ts                      # Chart.js trend rendering
      history.ts                     # sortable run table
      detail.ts                      # run detail/per-character table
      compare.ts                     # two-run comparison
    test/
      *.test.ts
  skill/
    SKILL.md                         # thin natural-language wrapper instructions
```

---

### Task 1: Workspace, Schemas, and Canonical Identity

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/schemas.ts`
- Create: `packages/core/src/canonicalize.ts`
- Create: `packages/core/src/index.ts`
- Test: `packages/core/test/schemas.test.ts`
- Test: `packages/core/test/canonicalize.test.ts`

**Interfaces:**
- Produces: `NormalizedEvent`, `RunSummary`, `FleetProfile`, `CatalogEntry`, `Coverage`, `RunWindow`, `CharacterMetrics`, `RunMetrics`, and their Zod schemas.
- Produces: `canonicalKey(value: string): string` used by site/profile identity and archive paths.

- [ ] **Step 1: Write failing schema and canonicalization tests**

```ts
// packages/core/test/canonicalize.test.ts
import { describe, expect, it } from 'vitest';
import { canonicalKey } from '../src/canonicalize.js';

describe('canonicalKey', () => {
  it('normalizes case, punctuation, and whitespace', () => {
    expect(canonicalKey('  8 Kikis + 2 Deacons  ')).toBe('8-kikis-2-deacons');
    expect(canonicalKey('Core   Bastion')).toBe('core-bastion');
  });
});
```

```ts
// packages/core/test/schemas.test.ts
import { describe, expect, it } from 'vitest';
import { RunSummarySchema } from '../src/schemas.js';

describe('RunSummarySchema', () => {
  it('accepts a minimal valid run summary', () => {
    const parsed = RunSummarySchema.parse({
      schemaVersion: 1,
      parserVersion: '0.1.0',
      metricsVersion: '0.1.0',
      id: '2026-09-03T045114Z-core-bastion',
      site: { name: 'Core Bastion', key: 'core-bastion' },
      fleetProfile: { id: '8-kikis-2-deacons', name: '8 Kikis + 2 Deacons' },
      window: {
        start: '2026-09-03T04:51:14.000Z',
        end: '2026-09-03T05:03:36.000Z',
        source: 'first-and-last-outgoing-npc-damage',
        manuallyAdjusted: false,
      },
      participants: [],
      metrics: {
        elapsedSeconds: 742,
        activeCombatSeconds: 694,
        idleSeconds: 48,
        fleetDamageDealt: 0,
        averageFleetDps: 0,
        activeFleetDps: 0,
        damageTaken: 0,
        remoteRepairDelivered: 0,
        participantCount: 0,
      },
      characterMetrics: [],
      coverage: {
        logFiles: 0,
        participantsWithOutgoingDamage: 0,
        unparsedCombatLines: 0,
        ambiguousEventsExcluded: 0,
        repairPairing: 'none',
      },
      notes: null,
      fingerprint: 'abc123',
      createdAt: '2026-09-03T05:05:12.000Z',
      updatedAt: '2026-09-03T05:05:12.000Z',
    });
    expect(parsed.site.key).toBe('core-bastion');
  });
});
```

- [ ] **Step 2: Run tests and verify they fail because the workspace/types do not exist**

Run: `pnpm vitest packages/core/test/canonicalize.test.ts packages/core/test/schemas.test.ts --run`

Expected: FAIL with unresolved imports or missing workspace configuration.

- [ ] **Step 3: Create workspace/toolchain files and minimal schemas**

Use Node ESM (`"type": "module"`), strict TypeScript, and root scripts:

```json
{
  "name": "eve-run",
  "private": true,
  "packageManager": "pnpm@10.15.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck"
  },
  "devDependencies": {
    "typescript": "^5.9.2",
    "vitest": "^3.2.4"
  }
}
```

Implement `canonicalKey` as Unicode normalization + lowercase + non-alphanumeric collapse to single `-` + trim. Define Zod discriminated unions for the five initial event kinds and explicit schemas for all run/archive structures in the spec. Export inferred TypeScript types from those schemas.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm install && pnpm --filter @eve-run/core test && pnpm --filter @eve-run/core typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore packages/core
git commit -m "feat: add core schemas and workspace"
```

---

### Task 2: Parse and Normalize EVE Gamelogs Conservatively

**Files:**
- Create: `packages/core/src/log-header.ts`
- Create: `packages/core/src/log-line-parser.ts`
- Create: `packages/core/src/target-classifier.ts`
- Create: `packages/core/src/normalize.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/test/fixtures/damage-session.txt`
- Create: `packages/core/test/fixtures/repair-session.txt`
- Test: `packages/core/test/log-header.test.ts`
- Test: `packages/core/test/log-line-parser.test.ts`
- Test: `packages/core/test/normalize.test.ts`

**Interfaces:**
- Consumes: `NormalizedEvent` and coverage schemas from Task 1.
- Produces: `parseLogHeader(text: string): { character: string | null }`.
- Produces: `parseCombatLine(line: string, source: SourceContext): ParsedObservation | null`.
- Produces: `normalizeLogFile(input: NormalizeLogInput): NormalizeLogResult` where the result contains events plus parsed/unparsed/malformed/ambiguous counts.
- Produces: `classifyTarget(name: string): 'npc' | 'non-site' | 'ambiguous'`.

- [ ] **Step 1: Add anonymized fixture lines and failing parser tests**

Use real EVE line shapes copied from the user's logs when available; until then, seed fixtures with representative examples such as:

```text
------------------------------------------------------------
  Gamelog
  Listener: Dah Nee
------------------------------------------------------------
[ 2026.09.03 04:51:14 ] (combat) 1183 from Dah Nee[Example] - Heavy Entropic Disintegrator II - Hits Sleepless Guardian
[ 2026.09.03 04:51:15 ] (combat) 341 from Sleepless Guardian - Hits Dah Nee
[ 2026.09.03 04:51:16 ] (combat) Your Heavy Entropic Disintegrator II misses Sleepless Guardian completely
```

Write tests asserting character extraction, UTC timestamp parsing, event kind, amount, actor/target attribution, hit quality, `observedBy`, source file, source line, and preservation of `raw`.

- [ ] **Step 2: Run focused parser tests and verify failure**

Run: `pnpm --filter @eve-run/core vitest test/log-header.test.ts test/log-line-parser.test.ts test/normalize.test.ts --run`

Expected: FAIL because parser functions are missing.

- [ ] **Step 3: Implement strict line parsing and target classification**

Implement exact regex families for supported outgoing damage, incoming damage, misses, remote-repair delivered, and remote-repair received messages. Do not use a catch-all parser. Return `null` for unsupported lines and count combat-tagged unsupported lines separately.

`target-classifier.ts` must begin with explicit exclusions including `Mobile Tractor Unit`, player-owned deployables, and obvious structure terms. NPC confidence must be based only on supported parser context/known patterns; otherwise return `ambiguous` and exclude from qualifying site damage.

- [ ] **Step 4: Normalize whole log files**

`normalizeLogFile` must associate every parsed event with the header character, sort by timestamp/source line, and return:

```ts
interface NormalizeLogResult {
  character: string | null;
  events: NormalizedEvent[];
  counts: {
    lines: number;
    combatLines: number;
    parsedCombatLines: number;
    unparsedCombatLines: number;
    malformedLines: number;
    ambiguousEventsExcluded: number;
  };
}
```

Do not deduplicate damage events.

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm --filter @eve-run/core test && pnpm --filter @eve-run/core typecheck`

Expected: PASS.

- [ ] **Step 6: Replace synthetic fixture shapes with anonymized real lines before considering parser coverage complete**

Create fixture files by copying representative real lines and replacing character/corporation names only; retain punctuation and spacing exactly. Add one regression test per distinct supported real line shape.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src packages/core/test
git commit -m "feat: parse and normalize eve combat logs"
```

---

### Task 3: Candidate Episodes, Confirmed Windows, and Metrics

**Files:**
- Create: `packages/core/src/episodes.ts`
- Create: `packages/core/src/metrics.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/episodes.test.ts`
- Test: `packages/core/test/metrics.test.ts`

**Interfaces:**
- Consumes: normalized events from Task 2.
- Produces: `detectEpisodes(events: NormalizedEvent[], options?: { idleThresholdSeconds?: number }): CandidateEpisode[]`.
- Produces: `calculateRun(events: NormalizedEvent[], window: RunWindow): CalculatedRun`.
- Defines active-combat gaps as intervals between qualifying outgoing damage events that are less than the episode idle threshold; idle time is `elapsed - activeCombat`.

- [ ] **Step 1: Write failing episode tests**

Create a hand-verifiable event set where outgoing NPC damage occurs at seconds `0, 10, 20, 210, 220`. Assert the default 180-second threshold returns two episodes: `[0,20]` and `[210,220]`. Add a test showing incoming damage between episodes does not merge them.

- [ ] **Step 2: Run episode tests and verify failure**

Run: `pnpm --filter @eve-run/core vitest test/episodes.test.ts --run`

Expected: FAIL because `detectEpisodes` is missing.

- [ ] **Step 3: Implement episode detection**

Filter only `damage-dealt` events whose target classification is NPC-qualified, sort chronologically, and split whenever the gap between qualifying events exceeds the configured threshold. Each `CandidateEpisode` returns start, end, qualifying event count, and previous/next qualifying activity timestamps for preview context.

- [ ] **Step 4: Write failing metrics tests with exact arithmetic**

Use two characters and known damage amounts. Assert:

```ts
expect(result.metrics.elapsedSeconds).toBe(100);
expect(result.metrics.fleetDamageDealt).toBe(5000);
expect(result.metrics.averageFleetDps).toBe(50);
expect(result.characterMetrics.find(x => x.character === 'Dah Nee')?.fleetDamageShare).toBeCloseTo(0.6);
```

Add tests for damage taken, repair totals, miss rate, hit-quality counts, participant first/last relevant event, and a repair-only participant.

- [ ] **Step 5: Implement deterministic metrics**

Calculate elapsed time from confirmed window, participant metrics from events inside that window, and active combat time from the union of qualifying combat intervals derived from outgoing NPC-damage activity. Clamp idle time at zero. When a denominator is zero, emit zero rather than `NaN`/`Infinity`.

- [ ] **Step 6: Run core tests and typecheck**

Run: `pnpm --filter @eve-run/core test && pnpm --filter @eve-run/core typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/episodes.ts packages/core/src/metrics.ts packages/core/src/index.ts packages/core/test/episodes.test.ts packages/core/test/metrics.test.ts
git commit -m "feat: detect site episodes and calculate run metrics"
```

---

### Task 4: Fingerprints, Atomic JSON Archive, Profiles, Catalog, and Comparisons

**Files:**
- Create: `packages/core/src/fingerprint.ts`
- Create: `packages/core/src/archive.ts`
- Create: `packages/core/src/comparisons.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/fingerprint.test.ts`
- Test: `packages/core/test/archive.test.ts`
- Test: `packages/core/test/comparisons.test.ts`

**Interfaces:**
- Produces: `fingerprintRun(events: NormalizedEvent[], window: RunWindow): string` using SHA-256 over stable event identity fields.
- Produces: `Archive` methods `saveRun`, `loadRun`, `listRuns`, `rebuildCatalog`, `loadProfiles`, `upsertProfile`, `updateRun`.
- Produces: `compareMatchingRuns(current, allRuns): RunComparison` with previous, best, and trailing-five baselines matching site key + fleet profile ID.

- [ ] **Step 1: Write failing fingerprint and archive tests**

Verify two arrays containing identical stable event data but different object-key ordering yield the same fingerprint. Verify one changed timestamp or source line changes it.

For archive tests, use a temporary directory and assert successful save creates exactly:

```text
runs/<id>/run.json
runs/<id>/events.jsonl
catalog.json
```

and that a duplicate fingerprint rejects without adding a second run.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm --filter @eve-run/core vitest test/fingerprint.test.ts test/archive.test.ts test/comparisons.test.ts --run`

Expected: FAIL because persistence functions are missing.

- [ ] **Step 3: Implement stable fingerprints**

Hash canonical JSON records containing timestamp, kind, actor, target, amount, observedBy, source filename, and source line for events inside the confirmed window plus the confirmed start/end. Sort records before hashing.

- [ ] **Step 4: Implement atomic archive persistence**

Write to `<archive>/runs/.tmp-<uuid>/`, validate `run.json` with `RunSummarySchema`, fsync/close files, then rename the directory to the final run ID. If the final directory or fingerprint already exists, abort. Rebuild `catalog.json` from validated `run.json` files after successful mutation.

- [ ] **Step 5: Implement profiles and comparisons**

`upsertProfile('8 Kikis + 2 Deacons')` must canonicalize to `8-kikis-2-deacons` and preserve the original display name. `compareMatchingRuns` must sort matching runs chronologically and return:

```ts
interface RunComparison {
  previous: RunSummary | null;
  best: RunSummary | null;
  trailingFiveAverageElapsedSeconds: number | null;
}
```

The personal best is the lowest elapsed time among matching runs; ties choose the earliest recorded run.

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm --filter @eve-run/core test && pnpm --filter @eve-run/core typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src packages/core/test
git commit -m "feat: add json archive and run comparisons"
```

---

### Task 5: WSL CLI Discovery and Interactive `analyze`

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/index.ts`
- Create: `packages/cli/src/paths.ts`
- Create: `packages/cli/src/ui.ts`
- Create: `packages/cli/src/analyze-command.ts`
- Test: `packages/cli/test/paths.test.ts`
- Test: `packages/cli/test/analyze-command.test.ts`

**Interfaces:**
- Consumes: parser, episode detector, metrics, archive, profile, and comparison APIs from Tasks 2–4.
- Produces executable: `eve-run analyze [--site <name>] [--profile <name>] [--logs <path>] [--archive <path>]`.
- Produces: `discoverGameLogDirs(): Promise<string[]>` and `defaultArchiveDir(): string`.

- [ ] **Step 1: Write failing WSL path discovery tests**

Mock a filesystem containing:

```text
/mnt/c/Users/Tom/Documents/EVE/logs/Gamelogs
/mnt/c/Users/Public/Documents
```

Assert only the first path is returned. Assert explicit `--logs` always wins over discovery/config.

- [ ] **Step 2: Run path tests and verify failure**

Run: `pnpm --filter @eve-run/cli vitest test/paths.test.ts --run`

Expected: FAIL because CLI path helpers do not exist.

- [ ] **Step 3: Implement discovery and config resolution**

Default archive: `$XDG_DATA_HOME/eve-run` when set, else `~/.local/share/eve-run`. Config: `<archive>/config.json`, storing selected `gameLogDir` and `idleThresholdSeconds` (default 180).

- [ ] **Step 4: Write failing analyze-flow test with injected prompts**

Use temporary logs containing two candidate episodes. Inject prompt answers that accept the newest window, enter `Core Bastion`, select/create `8 Kikis + 2 Deacons`, and provide a note. Assert one run is saved and the preview reports previous-best data only when a matching historical run exists.

- [ ] **Step 5: Implement `analyze` as an orchestration layer only**

The command must:

1. resolve log/archive paths;
2. inspect recently modified log files;
3. normalize and merge events;
4. detect candidate episodes using config threshold;
5. display newest candidate plus adjacent activity and coverage counts;
6. require accept/edit/select confirmation;
7. require site and fleet profile, optionally notes;
8. calculate summary and comparison preview;
9. ask final save confirmation;
10. save atomically through `Archive`;
11. rebuild generated dashboard dataset through the core export API added in Task 7.

Until Task 7 exists, call a small `rebuildCatalog()` hook only; Task 7 will extend the post-save generation without changing analysis logic.

- [ ] **Step 6: Verify fatal and warning behavior**

Add tests asserting no archive mutation for no outgoing NPC damage, empty site, empty profile, duplicate fingerprint, or invalid adjusted window. Add warning assertions for manual adjustment and partial participation.

- [ ] **Step 7: Run CLI tests and typecheck**

Run: `pnpm --filter @eve-run/cli test && pnpm --filter @eve-run/cli typecheck`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/cli package.json pnpm-lock.yaml
git commit -m "feat: add interactive wsl analyze command"
```

---

### Task 6: Recalculate and Edit Workflows

**Files:**
- Create: `packages/cli/src/recalculate-command.ts`
- Create: `packages/cli/src/edit-command.ts`
- Modify: `packages/cli/src/index.ts`
- Test: `packages/cli/test/recalculate-command.test.ts`
- Test: `packages/cli/test/edit-command.test.ts`

**Interfaces:**
- Produces executable: `eve-run recalculate [run-id|--all]`.
- Produces executable: `eve-run edit <run-id>`.
- `recalculate` must preserve confirmed boundaries/site/profile/notes and replace only compatible derived metrics/version/coverage fields.
- `edit` may change site, fleet profile, notes, and confirmed start/end, with explicit confirmation before rewriting summary.

- [ ] **Step 1: Write failing recalculation determinism test**

Save events + summary where metrics are intentionally wrong. Run recalculation and assert the resulting metrics exactly equal a fresh call to `calculateRun` while `window.start`, `window.end`, `site`, `fleetProfile`, `createdAt`, and notes remain unchanged.

- [ ] **Step 2: Implement `recalculate`**

Read `events.jsonl`, validate every event, run current metric calculation against durable confirmed metadata, bump `metricsVersion`, update `updatedAt`, atomically replace `run.json`, and rebuild catalog. If an old event schema lacks required data for a metric, preserve the run and mark that metric unavailable/partial rather than fabricating a value.

- [ ] **Step 3: Write failing edit tests**

Assert changing only notes does not change fingerprint or metrics. Assert changing the window recomputes metrics and sets `manuallyAdjusted: true`. Assert an edited window containing no qualifying outgoing NPC damage is rejected.

- [ ] **Step 4: Implement `edit`**

Load the run, prompt with current durable metadata, validate any adjusted window against archived events, recompute metrics only when the window changes, and use `Archive.updateRun` for atomic replacement.

- [ ] **Step 5: Run CLI tests and typecheck**

Run: `pnpm --filter @eve-run/cli test && pnpm --filter @eve-run/cli typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src packages/cli/test
git commit -m "feat: add run recalculation and edit workflows"
```

---

### Task 7: Dashboard Dataset and Static Dashboard

**Files:**
- Create: `packages/core/src/export.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/export.test.ts`
- Create: `packages/dashboard/package.json`
- Create: `packages/dashboard/tsconfig.json`
- Create: `packages/dashboard/index.html`
- Create: `packages/dashboard/src/main.ts`
- Create: `packages/dashboard/src/data.ts`
- Create: `packages/dashboard/src/state.ts`
- Create: `packages/dashboard/src/format.ts`
- Create: `packages/dashboard/src/overview.ts`
- Create: `packages/dashboard/src/trends.ts`
- Create: `packages/dashboard/src/history.ts`
- Create: `packages/dashboard/src/detail.ts`
- Create: `packages/dashboard/src/compare.ts`
- Test: `packages/dashboard/test/state.test.ts`
- Test: `packages/dashboard/test/compare.test.ts`

**Interfaces:**
- Produces: `buildLocalDashboardDataset(runs: RunSummary[]): DashboardDataset`.
- Dashboard reads one generated JSON file at `/data/runs.json`; it never reads archived events.
- Matching/filtering key is `(site.key, fleetProfile.id)`.

- [ ] **Step 1: Write failing export tests**

Given multiple runs, assert local dashboard data contains complete run summaries needed for filters, per-character detail, notes, best/previous/trailing-five calculations, and direct comparison. Assert no source-file or raw-event fields can appear because only `RunSummary` objects are accepted.

- [ ] **Step 2: Implement local dataset shaping**

Return a schema-versioned object:

```ts
interface DashboardDataset {
  schemaVersion: 1;
  generatedAt: string;
  runs: RunSummary[];
}
```

Sort runs by start timestamp ascending for predictable charting.

- [ ] **Step 3: Create failing dashboard state/comparison tests**

Test default selection chooses the most recent run's site/profile; filtering requires both keys by default; trailing-five uses the five matching runs before/current as defined by the comparison helper; direct comparison aligns character rows by exact character name.

- [ ] **Step 4: Implement static dashboard components**

Use plain DOM rendering and Chart.js. The page must provide:

- site/profile/date filters;
- overview cards for latest, personal best, trailing-five average, previous delta, fleet DPS, active DPS, idle;
- elapsed-time primary trend and selectable secondary metrics;
- sortable run history;
- selected-run detail with coverage warnings and per-character table;
- two-run comparison selector and aligned character rows.

Do not add authentication, a backend API, editable forms, or a synthetic performance score.

- [ ] **Step 5: Build and test dashboard**

Run: `pnpm --filter @eve-run/dashboard test && pnpm --filter @eve-run/dashboard build && pnpm --filter @eve-run/dashboard typecheck`

Expected: PASS and generated static files under `packages/dashboard/dist/`.

- [ ] **Step 6: Wire dataset generation into successful archive mutations**

After `analyze`, `recalculate`, or `edit`, regenerate `<archive>/dashboard/data/runs.json` from validated run summaries. Do not copy `events.jsonl` into the dashboard directory.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/export.ts packages/core/test/export.test.ts packages/dashboard packages/cli/src
git commit -m "feat: add static performance dashboard"
```

---

### Task 8: Local Dashboard Command and Privacy-Controlled Publish

**Files:**
- Create: `packages/cli/src/dashboard-command.ts`
- Create: `packages/cli/src/publish-command.ts`
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/core/src/export.ts`
- Test: `packages/cli/test/dashboard-command.test.ts`
- Test: `packages/cli/test/publish-command.test.ts`
- Modify: `packages/core/test/export.test.ts`

**Interfaces:**
- Produces executable: `eve-run dashboard [--port <number>]`.
- Produces executable: `eve-run publish --out <directory> [--include-characters] [--include-notes]`.
- Produces: `buildPublicDashboardDataset(runs, options)` with privacy defaults off for identities/notes.

- [ ] **Step 1: Write failing privacy export tests**

Assert default public output excludes `characterMetrics`, participant names, and notes while retaining run-level site/profile/date/performance metrics. Assert `includeCharacters: true` restores participant/per-character data and `includeNotes: true` restores notes independently.

- [ ] **Step 2: Implement public dataset shaping**

Use an explicit public schema rather than deleting keys from local summaries. This prevents future local-only fields from leaking automatically.

- [ ] **Step 3: Write failing dashboard server test**

Using a temporary dashboard build/data directory and ephemeral port, assert `GET /` returns `200` and `GET /data/runs.json` returns the generated local dataset.

- [ ] **Step 4: Implement `eve-run dashboard`**

Ensure dashboard assets are available, regenerate local data if stale/missing, serve the static directory on `127.0.0.1`, print the local URL, and keep the process foregrounded until interrupted.

- [ ] **Step 5: Write failing publish command test**

Run publish into a temporary directory and assert it contains static dashboard assets plus privacy-filtered `data/runs.json`, and contains no archived `events.jsonl` files.

- [ ] **Step 6: Implement `eve-run publish`**

Copy only the built static dashboard assets and generated public dataset. Never initialize Git, commit, push, or require GitHub; publishing to GitHub Pages remains an explicit user-managed follow-up.

- [ ] **Step 7: Run CLI/core tests and typecheck**

Run: `pnpm --filter @eve-run/core test && pnpm --filter @eve-run/cli test && pnpm --filter @eve-run/cli typecheck`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core packages/cli
git commit -m "feat: add local dashboard serving and private export"
```

---

### Task 9: Thin Codex Skill

**Files:**
- Create: `packages/skill/SKILL.md`
- Test: manual skill contract review against CLI `--help`

**Interfaces:**
- Consumes only the installed `eve-run` CLI.
- The skill may translate natural language to `eve-run analyze --site ... --profile ...` and summarize CLI output.
- The skill must not read/parse gamelogs itself, calculate metrics, edit archive JSON directly, bypass window confirmation, or bypass save confirmation.

- [ ] **Step 1: Write the skill contract**

The skill must explicitly instruct the agent to:

```text
1. Use `eve-run analyze` for recording a run.
2. Pass --site and --profile only when supplied by the user.
3. Let the CLI present/confirm the detected window.
4. Never calculate or alter metrics outside the CLI.
5. Use `eve-run recalculate`, `edit`, `dashboard`, or `publish` for those explicit intents.
6. Report CLI warnings and comparison results without rewriting their meaning.
```

Include examples for:

```text
"Record my latest Core Bastion run using 8 Kikis + 2 Deacons."
"Show me my eve-run dashboard."
"Recalculate all my historical runs."
```

- [ ] **Step 2: Verify CLI command/flag names exactly match the skill**

Run: `pnpm --filter @eve-run/cli build && node packages/cli/dist/index.js --help`

Expected: documented commands and flags match `SKILL.md` exactly.

- [ ] **Step 3: Commit**

```bash
git add packages/skill/SKILL.md
git commit -m "docs: add eve-run codex skill"
```

---

### Task 10: End-to-End Verification and Release Readiness

**Files:**
- Create: `packages/cli/test/e2e.test.ts`
- Create: `README.md`
- Modify: root `package.json` scripts if required for a single verification command

**Interfaces:**
- Validates the entire workflow from fixture gamelogs to archived run to dashboard/public export.

- [ ] **Step 1: Write an end-to-end fixture test**

The test must create two character gamelogs in a temporary WSL-like directory, run analysis with injected prompt answers, and assert:

- one confirmed run is saved;
- `events.jsonl` contains normalized events from both characters;
- `run.json` has the expected elapsed time and per-character damage totals;
- a second identical analysis is rejected as duplicate;
- recalculation reproduces the same metrics;
- local dashboard data contains per-character metrics;
- default public export does not contain character names or notes.

- [ ] **Step 2: Run the end-to-end test and fix only defects exposed by it**

Run: `pnpm --filter @eve-run/cli vitest test/e2e.test.ts --run`

Expected: PASS.

- [ ] **Step 3: Add README with exact WSL setup and usage**

Document:

```bash
corepack enable
pnpm install
pnpm build
pnpm --filter @eve-run/cli link --global

eve-run analyze
eve-run dashboard
eve-run recalculate --all
eve-run publish --out ./public-export
```

Explain the default gamelog discovery path, local archive path, three-minute episode threshold, required site/profile prompts, privacy defaults, and that original EVE logs are read-only.

- [ ] **Step 4: Run full verification**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Expected: all workspace tests pass, all packages typecheck, and all build artifacts are produced without warnings treated as errors.

- [ ] **Step 5: Manually smoke-test against a copy of real EVE logs**

Use copied/anonymized logs, never the originals as writable test data. Verify the CLI detects the expected latest episode, shows sensible parser coverage, saves only after confirmation, and the dashboard comparison matches hand-calculated elapsed time and damage totals for at least one run.

- [ ] **Step 6: Commit**

```bash
git add README.md package.json packages/cli/test/e2e.test.ts
git commit -m "test: verify eve-run end to end"
```

