---
description: View or change plugin config (effort scale/floor/max/default, default depth, min-n, age-decay)
argument-hint: [--effort-scale a,b,c] [--effort-floor <e>] [--effort-max <e>] [--effort-default <e>] [--default-depth <N>] [--min-n <k>] [--age-decay <f>] [--reset]
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/scorecard.mjs config:*)
---
Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/scorecard.mjs config $ARGUMENTS` and show the output. With no args it prints the current global config. The effort scale is ordered low→high; `--effort-floor`/`--effort-max` bound what efforts `log` accepts and `--effort-default` is applied when a rating omits `--effort`. `--default-depth` sets the model-hierarchy grouping used by `show`/`compare` when `--depth` is not passed. `--age-decay` is the per-year multiplier for `show --decayed` (in `(0,1]`, `1` = no decay). Clearing the scale (`--effort-scale ""`) makes efforts free-form.
