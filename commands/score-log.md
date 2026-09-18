---
description: Append a subagent rating to the model scorecard
argument-hint: --model <m> --effort <medium|high> --tier <t> --task "<desc>" --complexity <S|M|L> --delta <-2..2> --note "<expected vs got>"
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/scorecard.mjs log:*)
---
Append one scorecard rating: run `node ${CLAUDE_PLUGIN_ROOT}/scripts/scorecard.mjs log $ARGUMENTS`

Rate the subagent's output vs. what you EXPECTED of that model for that task (-2 well below .. +2 well above; 0 = met). Confirm the logged line.
