# Changelog

All notable changes to model-scorecard. Format loosely follows Keep a Changelog.

## [0.6.0] — 2026-09-18

### Changed
- **Δ scale widened from -2..+2 to -3..+3** (-3 far below … 0 met … +3 far
  above). Forward-compatible — existing -2..2 rows stay valid; 0 = met unchanged.

### Added
- **`show --decayed`** — age-decayed view: each rating's Δ is regressed *toward
  the neutral 0* by a per-year factor (`age-decay`, default 0.9), so a stale
  rating is trusted less rather than penalized (a `+2` and a `-2` both shrink
  toward 0; unknown-age ratings are untouched). Shows decayed `dΔ` beside raw avg.
- **`age-decay` config key** — the per-year multiplier for `--decayed`, in
  `(0,1]` (`1` = no decay).
- **Family-first naming convention** documented: log `opus 5` / `sonnet 5.1` so
  `--depth 1` rolls a family's versions under `opus`/`sonnet`. Grouping by a bare
  generation number (which would mix capability tiers) is intentionally not a
  built-in rollup.

### Notes
- Ranking stays per-(model × tier); `--global` remains a caveated coarse extra.
- 64 tests (`node --test`), still zero runtime dependencies.

## [0.5.1] — 2026-09-18

### Changed
- Cleanup pass for public release: trimmed verbose code comments in
  `scripts/lib.mjs` and `scripts/scorecard.mjs` (behavior unchanged), fixed an
  a/an grammar slip in the `compare` footer, and added `repository` / `homepage`
  / `bugs` / `keywords` metadata to `package.json`.

### Added
- `LICENSE` file (MIT).

## [0.5.0] — 2026-09-18

### Added
- **Effort-weighted score view** — `show --weighted` folds the `@effort`
  dimension back into a single `model · tier` bucket and weights each rating's Δ
  by its effort rank (minimal=1 … high=4 by default), so a win earned at higher
  effort counts for more. Answers "which model is best overall, crediting harder
  efforts" without splitting by effort.
- **Stacked depth × complexity report** — `show --stacked` renders a grid: each
  bucket (`model@effort · tier`, at `--depth`) as a row, complexity classes
  (S/M/L, ordered) as columns, plus an `all` total. Read a family's standing
  across task sizes at a glance.
- **Seed known model cutoffs** — a bundled, user-editable `scripts/cutoffs.json`
  supplies a model's knowledge cutoff when a rating gives neither `--cutoff` nor a
  date-shaped name. Matched by exact name then hierarchical prefix (longest
  first), so `gpt-5.6` answers for `gpt-5.6-sol`. Precedence: `--cutoff` >
  name-parsed > seed. Still fully offline; malformed seed entries are skipped, not
  fatal. (Seed values are illustrative starting points — verify against provider
  model cards.)

### Notes
- Ranking stays per-(model × tier); `--global` remains a caveated coarse extra.
- 60 tests (`node --test`), still zero runtime dependencies.

## [0.4.0] — 2026-09-18

### Added
- **Model age from knowledge cutoffs.** Ratings can carry a cutoff date, stored
  as `YYYY-MM` or `YYYY-MM-DD`:
  - `log --cutoff YYYY-MM` records it explicitly (malformed values are rejected
    with no write, like `--delta` / `--effort`).
  - Otherwise a date-shaped part of the model name is auto-detected
    (`gpt-5.6-2026-01` → `2026-01`, `claude-sonnet-20241022` → `2024-10-22`);
    explicit `--cutoff` wins over the parsed one.
  - `show` gains an **age** column — months since the cutoff, tiered
    fresh (<3) / recent (<9) / aging (<18) / stale, `-` when unknown.
  - `compare --by-age` groups the matrix rows by age tier (symmetric with
    `--by-complexity`).
  - All age math is **local**, computed at report time against today. There is
    deliberately no provider API call: knowledge cutoffs are published as prose,
    not data, and wiring per-provider auth/network would break the zero-dep,
    offline design (and still only yield mint dates, not cutoffs).

### Notes
- Ranking stays per-(model × tier); `--global` remains a caveated coarse extra.
- 51 tests (`node --test`), still zero runtime dependencies.

## [0.3.0] — 2026-09-18

### Added
- **Hierarchical model names + `--depth`.** Model names decompose into ordered
  segments (split on space / `-` / `_` / `/` / `:`; dots kept, so `5.6` stays one
  segment). `show`/`compare` take `--depth N` to group at N segments: `--depth 1`
  rolls `5.6 sol`, `5.6 terra`, `5.6 luna` up under `5.6` (general), `--depth 0`
  (default) keeps every variant distinct (specific). Truncated names keep their
  original delimiters (`gpt-5.6`).
- **Customizable plugin config** (`config` subcommand / `/score-config`), stored
  globally at `~/.claude/scorecard/config.json`:
  - `--effort-scale a,b,c` — ordered low→high effort vocabulary (clear it for
    free-form efforts).
  - `--effort-floor` / `--effort-max` — bound which efforts `log` accepts.
  - `--effort-default` — effort applied when a rating omits `--effort` (the
    plugin's default, distinct from any interface default).
  - `--default-depth` — hierarchy depth `show`/`compare` use when `--depth` is
    omitted.
  - `--min-n` — default low-confidence threshold.
- **`compare --by-complexity`** — the deferred per-complexity comparison matrix:
  rows become S/M/L instead of tiers.

### Changed
- `log` now resolves effort through config: applies the default when omitted, and
  **rejects** (no write) an effort outside the configured scale/floor/max rather
  than silently coercing — consistent with the strict delta validation.

### Notes
- Ranking stays per-(model × tier); `--global` remains a caveated coarse extra.
- 39 tests (`node --test`), still zero runtime dependencies.

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
