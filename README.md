# model-scorecard

A tiny, dependency-free scorecard for rating subagent models. The orchestrator rates each subagent's output vs. the EXPECTATION for that model/task (-2..+2); the score is the average per **(model × tier)** — NEVER a global rank (a simple task for a light model is not a hard task for a strong one).

Pure Node, zero dependencies. The core is a single portable CLI, so the same tool works from Claude Code, Codex, OpenCode, a plain shell, or over MCP.

## Install (Claude Code)

```
/plugin marketplace add <this-repo-or-path>
/plugin install model-scorecard
```

This ships the scripts with the plugin; commands resolve via `${CLAUDE_PLUGIN_ROOT}`.

## Slash commands (Claude Code)
- `/score-log --model <m> [--effort <e>] --tier <t> --task "<desc>" --complexity <S|M|L> --delta <-2..2> [--cutoff <YYYY-MM>] --note "<expected vs got>"` — append one rating.
- `/score [--since <date>] [--until <date>] [--depth <N>] [--min-n <k>] [--csv]` — per (model × tier) average Δ, n, model age, complexity mix.
- `/score-compare <A> <B> [C ...] [--global] [--by-complexity] [--by-age] [--depth <N>] [--since <date>] [--until <date>]` — models side by side per tier (or per complexity / per age); `--global` adds a coarse overall (mixes task types, use with care).
- `/score-config [--effort-scale a,b,c] [--effort-floor <e>] [--effort-max <e>] [--effort-default <e>] [--default-depth <N>] [--min-n <k>] [--reset]` — view/change plugin config.

## Portable CLI (any platform)

The slash commands are thin adapters over one entrypoint. On any platform with Node, call it directly:

```
node scripts/scorecard.mjs log     --model "5.6 sol" --effort high --tier orchestration --complexity L --delta 0 --cutoff 2026-01 --note "met expectations"
node scripts/scorecard.mjs show     --since 2026-09-01 --depth 1 --min-n 3
node scripts/scorecard.mjs compare  opus4.8 terra --global --by-complexity
node scripts/scorecard.mjs config   --effort-default high --effort-floor low --default-depth 1
node scripts/scorecard.mjs help
```

For **Codex** (or any MCP/agent that runs shell): wire a command/tool that runs `node <path>/scripts/scorecard.mjs <sub> …`. No platform-specific manifest is required for the core — only the Claude slash-command wrappers are Claude-specific. Example `~/.codex/config.toml` custom command:

```toml
[commands.score-log]
description = "Log a subagent model rating"
command = ["node", "/abs/path/to/model-scorecard/scripts/scorecard.mjs", "log"]
```

Invoke as `codex score-log --model "5.6 sol" --tier orchestration --delta 1` (args pass through). `show`/`compare`/`config` wire the same way.

## Model types & hierarchy
Model names are **free-form**. A new model is "defined" simply by logging a rating with its name — there is no enum or registry to maintain. `--effort` optionally qualifies a model as `model@effort` in its own bucket.

Names are also **hierarchical**: they split into ordered segments on space / `-` / `_` / `/` / `:` (dots stay put, so `5.6` is one segment). `--depth N` groups at N segments, letting you read results more **generally** or **specifically**:

| logged | `--depth 0` (default) | `--depth 1` |
|---|---|---|
| `5.6 sol` | `5.6 sol` | `5.6` |
| `5.6 terra` | `5.6 terra` | `5.6` |
| `5.6 luna` | `5.6 luna` | `5.6` |

So depth 0 rates each variant on its own; depth 1 rolls the whole `5.6` family into one bucket. Truncated names keep their original punctuation (`gpt-5.6-sol` → `gpt-5.6`). The default depth is configurable (`config --default-depth`).

## Model age (knowledge cutoff)
Each rating can carry a **cutoff date** so `show`/`compare` can report how *old* a model is — all computed locally at report time against today. There is deliberately **no provider API call**: knowledge cutoffs are published as prose (model cards / overview pages), not as a queryable field — the provider APIs only expose a model *mint* timestamp, not the cutoff — so wiring per-provider auth + network would break the zero-dep, offline design and still not yield cutoffs.

Two ways the date is supplied (explicit wins):
- **`--cutoff YYYY-MM`** (or `YYYY-MM-DD`) on `log`. Malformed values are rejected with no write, like `--delta`/`--effort`.
- **Auto-detected from the model name** — a date-shaped part is parsed automatically: `gpt-5.6-2026-01` → `2026-01`, `claude-sonnet-20241022` → `2024-10-22`. Zero extra typing when the date already lives in the name.

`show` then adds an **age** column (months since the cutoff), tiered:

| tier | age |
|---|---|
| `fresh` | < 3 months |
| `recent` | < 9 months |
| `aging` | < 18 months |
| `stale` | ≥ 18 months |

`-` means no cutoff is known for that bucket. `compare --by-age` groups the matrix rows by these tiers (symmetric with `--by-complexity`).

## Config
Global config at `~/.claude/scorecard/config.json` (same directory as the data — persists across projects/platforms). `config` with no args prints it. Keys:

- `effort-scale` — ordered low→high effort vocabulary (default `minimal,low,medium,high`). Clear it (`--effort-scale ""`) for free-form efforts.
- `effort-floor` / `effort-max` — bound which efforts `log` accepts. An effort outside the range (or not in the scale) is **rejected**, not silently coerced — nothing is written.
- `effort-default` — the effort `log` applies when `--effort` is omitted. This is the **plugin's** default, independent of any interface/agent default.
- `default-depth` — hierarchy depth used by `show`/`compare` when `--depth` is not passed.
- `min-n` — default low-confidence threshold.

## Δ scale (vs. what you expected of that model for that task)
-2 well below · -1 below · 0 met · +1 above · +2 well above. `0 = correctly tiered, not mediocre`. Bucket avg ~0 = correctly tiered; + = beats its tier; − = underperforms. Read WITHIN a bucket only. Buckets with fewer than `--min-n` ratings (default 3) are flagged `⚠ low-n` — indicative only.

## Data
Append-only JSONL at `~/.claude/scorecard/model_scorecard.jsonl` (global — persists across every project and platform). Malformed lines are skipped, not fatal; a missing file is reported gracefully.

## Develop / test
```
npm test        # or: node --test
```
Pure logic lives in `scripts/lib.mjs` (no IO); `scripts/scorecard.mjs` is the CLI. 51 tests cover delta validation, effort/config resolution, model hierarchy/depth, model-age (cutoff parse/validate, name auto-detect, age tiers), aggregation, compare (per-tier + per-complexity + per-age + `--global`), CSV, and malformed/missing-file tolerance.

## Status
v0.4.0. Self-contained plugin (commands → `${CLAUDE_PLUGIN_ROOT}`), unified portable CLI, hierarchical model names with `--depth`, model age from knowledge cutoffs, customizable effort config, tested (`node --test`), git-versioned, installable via marketplace manifest.
