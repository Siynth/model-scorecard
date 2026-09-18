---
description: Append a subagent rating to the model scorecard
argument-hint: --model <m> --effort <medium|high> --tier <t> --task "<desc>" --complexity <S|M|L> --delta <-3..3> [--cutoff <YYYY-MM>] [--dims "correctness:2,efficiency:-1"] [--tokens-in <N> --tokens-out <N>] [--cache-hits <N>] --note "<expected vs got>"
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/scorecard.mjs log:*)
---
Append one scorecard rating: run `node ${CLAUDE_PLUGIN_ROOT}/scripts/scorecard.mjs log $ARGUMENTS`

Rate the subagent's output vs. what you EXPECTED of that model for that task (-3 far below .. +3 far above; 0 = met). `--cutoff YYYY-MM` records the model's knowledge-cutoff date (auto-detected from a date in the model name if present, e.g. `gpt-5.6-2026-01`); `show`/`compare` derive model age from it. Optional `--dims "correctness:2,efficiency:-1"` adds per-facet sub-scores (same -3..3 scale) and `--tokens-in/--tokens-out/--cache-hits` (or `--tokens <N>`) record token counts — both orthogonal to Δ. Confirm the logged line.
