# model-scorecard

A tiny, dependency-free scorecard for rating subagent models. The orchestrator rates each subagent's output vs. the EXPECTATION for that model/task (-3..+3); the score is the average per **(model × tier)** — NEVER a global rank (a simple task for a light model is not a hard task for a strong one).

Pure Node, zero dependencies. The core is a single portable CLI, so the same tool works from Claude Code, Codex, OpenCode, a plain shell, or over MCP.

## Install (Claude Code)

```
/plugin marketplace add Siynth/model-scorecard
/plugin install model-scorecard
```

This ships the scripts with the plugin; commands resolve via `${CLAUDE_PLUGIN_ROOT}`.

## Slash commands (Claude Code)
- `/score-log --model <m> [--effort <e>] --tier <t> --task "<desc>" --complexity <S|M|L> --delta <-3..3> [--cutoff <YYYY-MM>] [--dims "correctness:2,efficiency:-1"] [--tokens-in <N> --tokens-out <N>] [--cache-hits <N>] --note "<expected vs got>"` — append one rating.
- `/score [--since <date>] [--until <date>] [--depth <N>] [--min-n <k>] [--csv] [--weighted] [--stacked] [--decayed] [--dim <name>] [--efficiency] [--badges]` — per (model × tier) average Δ, n, model age, complexity mix. `--weighted` effort-weighted rollup; `--stacked` model × complexity grid; `--decayed` age-regressed; `--dim <name>` ranks by one facet; `--efficiency` ranks by token usage (with Δ/ktok); `--badges` derives ranking tags.
- `/score-compare <A> <B> [C ...] [--global] [--by-complexity] [--by-age] [--dim <name>] [--depth <N>] [--since <date>] [--until <date>]` — models side by side per tier (or per complexity / per age); `--dim <name>` compares one facet; `--global` adds a coarse overall (mixes task types, use with care).
- `/score-config [--effort-scale a,b,c] [--effort-floor <e>] [--effort-max <e>] [--effort-default <e>] [--default-depth <N>] [--min-n <k>] [--age-decay <f>] [--reset]` — view/change plugin config.

## Portable CLI (any platform)

The slash commands are thin adapters over one entrypoint. On any platform with Node, call it directly:

```
node scripts/scorecard.mjs log     --model "5.6 sol" --effort high --tier orchestration --complexity L --delta 0 --cutoff 2026-01 --note "met expectations"
node scripts/scorecard.mjs log     --model "opus 5" --tier orchestration --delta 2 --dims "correctness:2,efficiency:-1" --tokens-in 12000 --tokens-out 800
node scripts/scorecard.mjs show     --since 2026-09-01 --depth 1 --min-n 3
node scripts/scorecard.mjs show     --efficiency          # rank by token usage (Δ/ktok)
node scripts/scorecard.mjs show     --badges              # derived ranking tags
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

**Naming convention — log family-first.** The identity that persists across a company's releases is the *family* (opus, sonnet, haiku, fable), not the version number — Anthropic alone runs `opus 5`, `sonnet 5`, `haiku 4.5`, `fable 5.1`, so the numbers don't line up across tiers. Log names family-first (`opus 5`, `sonnet 5.1`, `gpt-5.6 sol`) and `--depth 1` rolls a family's versions under `opus`/`sonnet`/`gpt-5.6` — a real lineage worth tracking — while keeping different families (which are different capability tiers) in their own buckets. Grouping by a bare generation number (merging `opus 5` with `sonnet 5`) mixes tiers and is intentionally not a built-in rollup; that is coarse territory like `--global`.

## Model age (knowledge cutoff)
Each rating can carry a **cutoff date** so `show`/`compare` can report how *old* a model is — all computed locally at report time against today. There is deliberately **no provider API call**: knowledge cutoffs are published as prose (model cards / overview pages), not as a queryable field — the provider APIs only expose a model *mint* timestamp, not the cutoff — so wiring per-provider auth + network would break the zero-dep, offline design and still not yield cutoffs.

Two ways the date is supplied (explicit wins):
- **`--cutoff YYYY-MM`** (or `YYYY-MM-DD`) on `log`. Malformed values are rejected with no write, like `--delta`/`--effort`.
- **Auto-detected from the model name** — a date-shaped part is parsed automatically: `gpt-5.6-2026-01` → `2026-01`, `claude-sonnet-20241022` → `2024-10-22`. Zero extra typing when the date already lives in the name.

If neither is present, a bundled, user-editable seed (`scripts/cutoffs.json`) is consulted as a last resort — matched by exact model name then hierarchical prefix (longest first), so a `gpt-5.6` entry answers for `gpt-5.6-sol`. Precedence is **`--cutoff` > name-parsed > seed**. The shipped seed values are illustrative starting points; verify/edit them against provider model cards.

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
- `age-decay` — per-year multiplier for `show --decayed` (default `0.9`; must be in `(0,1]`, `1` = no decay).

## Δ scale (vs. what you expected of that model for that task)
-3 far below · -2 well below · -1 below · 0 met · +1 above · +2 well above · +3 far above. `0 = correctly tiered, not mediocre`. Bucket avg ~0 = correctly tiered; + = beats its tier; − = underperforms. Read WITHIN a bucket only. Buckets with fewer than `--min-n` ratings (default 3) are flagged `⚠ low-n` — indicative only.

## Views
Beyond the default per-(model × tier) table, `show` offers three rollups (mutually exclusive — the first one given wins):
- **`--weighted`** — folds the `@effort` variants of a model back into one `model · tier` bucket and reports an **effort-weighted** avg Δ: each rating is weighted by its effort rank (`minimal`=1 … `high`=4 on the default scale; off-scale/empty efforts weigh 1). Use it to ask "which model is best overall, crediting wins earned at higher effort", instead of reading each effort bucket separately.
- **`--stacked`** — a grid crossing each bucket (row) with complexity S/M/L (columns) plus an `all` total, so you can read a family's standing across task sizes at a glance. Combine with `--depth` to stack whole families.
- **`--decayed`** — the same per-bucket table, but each rating's Δ is regressed *toward the neutral 0* by an age-decay factor (`age-decay`^age_years). The semantic is **staleness = less trust in the rating**, not a penalty: a `+2` and a `−2` both shrink toward 0 as they age, and unknown-age ratings are left untouched. Shows the decayed `dΔ` next to the raw avg so the discount is visible.

## Dimensions & tokens
The headline Δ stays one honest number vs expectation, but a rating can also carry **optional facets and token counts** — orthogonal axes that never touch Δ:
- **`log --dims "correctness:2,completeness:3,efficiency:-1,format:0"`** — per-facet sub-scores on the same −3..+3 vs-expectation scale. Names are **free-form** (correctness / completeness / efficiency / format-adherence are conventions, not an enum). Bad scores are rejected with no write, like `--delta`.
- **`show --dim <name>`** — ranks buckets by one facet's average instead of the overall Δ (buckets that never logged it are omitted), so you can read the field along whichever axis matters. Still per-(model × tier), still read-within-a-bucket. `compare --dim <name>` does the same in the side-by-side matrix.
- **`log --tokens-in <N> --tokens-out <N> --cache-hits <N>`** (or a plain `--tokens <N>` total) — token counts *you supply* (nothing is observed). **`show --efficiency`** reports avg in/out/cache/total per bucket, ranked by total ascending (fewer = more efficient), with a **Δ/ktok** column (avg Δ earned per 1k total tokens) — a separate efficiency axis, never folded into Δ.
- **`show --badges`** — derives per-bucket "addendum" tags purely from where each bucket *ranks* among the set (top/bottom third) on Δ (`over-tier`/`under-tier`), tokens (`token-lean`/`token-heavy`, `output-lean`/`output-heavy`), and each logged dimension (`<name>-strong`/`<name>-weak`). A metric needs ≥3 buckets carrying it to tag. Computed at read time; nothing is stored.

## Data
Append-only JSONL at `~/.claude/scorecard/model_scorecard.jsonl` (global — persists across every project and platform). Malformed lines are skipped, not fatal; a missing file is reported gracefully.

## Develop / test
```
npm test        # or: node --test
```
Pure logic lives in `scripts/lib.mjs` (no IO); `scripts/scorecard.mjs` is the CLI. 84 tests cover delta validation, effort/config resolution + effort weighting, model hierarchy/depth, model-age (cutoff parse/validate, name auto-detect, seed lookup, age tiers), aggregation (incl. weighted rollup, stacked grid, and age-decay), dimension tags + token efficiency + derived badges, compare (per-tier + per-complexity + per-age + per-dimension + `--global`), CSV, and malformed/missing-file tolerance.

## Status
v0.8.0. Self-contained plugin (commands → `${CLAUDE_PLUGIN_ROOT}`), unified portable CLI, hierarchical family-first model names with `--depth`, effort-weighted + stacked-complexity + age-decayed views, dimension tags + token-efficiency (Δ/ktok) + derived ranking badges, a −3..+3 rating scale, model age from knowledge cutoffs (with a bundled seed), customizable effort config, tested (`node --test`), git-versioned, installable via marketplace manifest.

## License
MIT — see [`LICENSE`](LICENSE).
