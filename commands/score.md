---
description: Show the model scorecard (per model x tier average ratings)
argument-hint: [--since <YYYY-MM-DD>] [--until <YYYY-MM-DD>] [--min-n <k>] [--csv]
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/scorecard.mjs show:*)
---
Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/scorecard.mjs show $ARGUMENTS` and show its output verbatim. Read each bucket on its own (never across): ~0 = correctly tiered, + = beats tier, - = underperforms. Buckets flagged ⚠ low-n are thin — treat as indicative only.
