---
description: Compare 2+ models by per-tier (or per-complexity / per-age) average rating
argument-hint: <modelA> <modelB> [modelC ...] [--global] [--by-complexity] [--by-age] [--dim <name>] [--depth <N>] [--since <YYYY-MM-DD>] [--until <YYYY-MM-DD>]
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/scorecard.mjs compare:*)
---
Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/scorecard.mjs compare $ARGUMENTS`. Compare WITHIN a row (same tier, or same complexity with `--by-complexity`, or same age tier with `--by-age`); `--dim <name>` makes the cells compare one dimension tag's average instead of Δ. `--global` adds a coarse overall that mixes task types (use with care). `--depth N` matches models at N name segments so you can compare general families (e.g. `5.6`) rather than every variant. Higher avg Δ = beats its tier more.
