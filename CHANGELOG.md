# Changelog

All notable changes to model-scorecard. Format loosely follows Keep a Changelog.

## [0.2.0] — 2026-09-18

### Changed
- **Self-contained plugin.** Slash commands now call `${CLAUDE_PLUGIN_ROOT}/scripts/…`
  instead of `~/.claude/scorecard/…`, so installing the plugin ships its own scripts.
  The data path stays global (`~/.claude/scorecard/model_scorecard.jsonl`) by design,
  so ratings persist across every project and every platform.
- **Consolidated to one portable CLI.** The three separate scripts
  (`score_log`/`model_scorecard`/`score_compare`) are folded into a single
  `scripts/scorecard.mjs` with `log` / `show` / `compare` subcommands. This is the
  cross-platform entrypoint: any agent (Claude Code, Codex, OpenCode, plain shell, MCP)
  invokes `node scorecard.mjs <sub> …`. The Claude slash commands are a thin adapter.
- Pure logic extracted into `scripts/lib.mjs` (no IO) for unit-testability.

### Added
- **Test suite** (`node --test`, zero deps): delta validation (rejects out-of-range,
  non-integer, and blank — no write), aggregation correctness, compare (per-tier +
  `--global`), malformed-line tolerance, missing-file tolerance, CSV, and CLI e2e.
- `--since` / `--until` date-range filtering on `show` and `compare`.
- `--min-n <k>` low-confidence flag: thin buckets (n < k, default 3) marked `⚠ low-n`.
- `--csv` export on `show`.
- Marketplace manifest (`.claude-plugin/marketplace.json`) + `package.json` so the
  plugin is installable and testable via standard tooling.

### Notes
- Model names remain free-form: a new model type is "defined" simply by logging a
  rating with its name — no enum, no registry.
- Ranking is always per-(model × tier). `--global` is a caveated coarse extra that
  mixes task types; it is never the headline.

## [0.1.0]

- Initial working version: `/score-log`, `/score`, `/score-compare` + scripts,
  installed globally under `~/.claude/`.
