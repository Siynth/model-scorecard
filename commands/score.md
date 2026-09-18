---
description: Show the model scorecard (per model x tier average ratings)
argument-hint: [--since <YYYY-MM-DD>] [--until <YYYY-MM-DD>] [--depth <N>] [--min-n <k>] [--csv] [--weighted] [--stacked] [--decayed]
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/scorecard.mjs show:*)
---
Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/scorecard.mjs show $ARGUMENTS` and show its output verbatim. Read each bucket on its own (never across): ~0 = correctly tiered, + = beats tier, - = underperforms. The `age` column shows months since the model's knowledge cutoff (fresh/recent/aging/stale, `-` if unknown). `--weighted` folds effort variants into one model·tier bucket, weighting Δ by effort rank (higher effort counts more); `--stacked` renders a model × complexity (S/M/L) grid; `--decayed` regresses each Δ toward 0 by age (staleness = less trust, not a penalty). `--depth N` groups models at N name segments (e.g. `--depth 1` rolls "5.6 sol"/"5.6 terra" under "5.6"); default depth comes from config. Buckets flagged ⚠ low-n are thin — treat as indicative only.
