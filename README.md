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
- `/score-log --model <m> --effort <e> --tier <t> --task "<desc>" --complexity <S|M|L> --delta <-2..2> --note "<expected vs got>"` — append one rating.
- `/score [--since <date>] [--until <date>] [--min-n <k>] [--csv]` — per (model × tier) average Δ, n, complexity mix.
- `/score-compare <A> <B> [C ...] [--global] [--since <date>] [--until <date>]` — models side by side per tier; `--global` adds a coarse overall (mixes task types, use with care).

## Portable CLI (any platform)

The slash commands are thin adapters over one entrypoint. On any platform with Node, call it directly:

```
node scripts/scorecard.mjs log     --model opus4.8 --effort high --tier orchestration --complexity L --delta 0 --note "met expectations"
node scripts/scorecard.mjs show     --since 2026-09-01 --min-n 3
node scripts/scorecard.mjs compare  opus4.8 terra --global
node scripts/scorecard.mjs help
```

For **Codex** (or any MCP/agent that runs shell): wire a command/tool that runs `node <path>/scripts/scorecard.mjs <sub> …`. No platform-specific manifest is required for the core — only the Claude slash-command wrappers are Claude-specific.

## Model types
Model names are **free-form**. A new model is "defined" simply by logging a rating with its name — there is no enum or registry to maintain. `--effort` optionally qualifies a model as `model@effort` in its own bucket.

## Δ scale (vs. what you expected of that model for that task)
-2 well below · -1 below · 0 met · +1 above · +2 well above. `0 = correctly tiered, not mediocre`. Bucket avg ~0 = correctly tiered; + = beats its tier; − = underperforms. Read WITHIN a bucket only. Buckets with fewer than `--min-n` ratings (default 3) are flagged `⚠ low-n` — indicative only.

## Data
Append-only JSONL at `~/.claude/scorecard/model_scorecard.jsonl` (global — persists across every project and platform). Malformed lines are skipped, not fatal; a missing file is reported gracefully.

## Develop / test
```
npm test        # or: node --test
```
Pure logic lives in `scripts/lib.mjs` (no IO); `scripts/scorecard.mjs` is the CLI. Tests cover delta validation, aggregation, compare, CSV, and malformed/missing-file tolerance.

## Status
v0.2.0. Self-contained plugin (commands → `${CLAUDE_PLUGIN_ROOT}`), unified portable CLI, tested (`node --test`), git-initialized, installable via marketplace manifest.
