---
description: Compare 2+ models by per-tier average rating (optional --global overall)
argument-hint: <modelA> <modelB> [modelC ...] [--global] [--since <YYYY-MM-DD>] [--until <YYYY-MM-DD>]
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/scorecard.mjs compare:*)
---
Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/scorecard.mjs compare $ARGUMENTS`. Compare WITHIN a tier (same row); `--global` adds a coarse overall that mixes task types (use with care). Higher avg Δ = beats its tier more.
