#!/usr/bin/env node
// scorecard.mjs — platform-agnostic CLI for the model scorecard. Runs anywhere
// `node` does (Claude Code, Codex, OpenCode, plain shell, MCP). Data + config
// are global at ~/.claude/scorecard/ so they persist across projects/platforms.
// Subcommands: log | show | compare | config | help. See HELP below for usage.//
// Model names are free-form and hierarchical (no registry — a model is "defined"
// by logging it). Ranking is always per-(model x tier); --global is a caveated
// coarse extra, never the headline.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  DATA_FILE, CONFIG_FILE, DEFAULT_CONFIG, normalizeConfig,
  parseArgs, buildRow, parseLines, filterByDate,
  aggregate, scorecardRows, compareData, groupsOf, avgLabel, signed, scorecardCsv,
  aggregateWeighted, weightedRows, stackedData, aggregateDecayed, decayedRows,
} from "./lib.mjs";

const [sub, ...rest] = process.argv.slice(2);

function readRows() {
  let text;
  try {
    text = readFileSync(DATA_FILE, "utf8");
  } catch {
    return { rows: [], bad: [], missing: true };
  }
  return { ...parseLines(text), missing: false };
}

function readConfig() {
  try {
    return normalizeConfig(JSON.parse(readFileSync(CONFIG_FILE, "utf8")));
  } catch {
    return normalizeConfig({});
  }
}

function writeConfig(cfg) {
  mkdirSync(dirname(CONFIG_FILE), { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + "\n");
}

// Bundled seed of known cutoffs, shipped next to this script; a last resort when
// a rating gives neither --cutoff nor a dated model name.
function readSeed() {
  try {
    return JSON.parse(readFileSync(new URL("./cutoffs.json", import.meta.url), "utf8"));
  } catch {
    return {};
  }
}

// --- log --------------------------------------------------------------------
function cmdLog(argv) {
  const { opts } = parseArgs(argv);
  let row;
  try {
    row = buildRow(opts, readConfig(), new Date(), readSeed());
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  mkdirSync(dirname(DATA_FILE), { recursive: true });
  appendFileSync(DATA_FILE, JSON.stringify(row) + "\n");
  console.log("logged:", JSON.stringify(row));
}

// --- show -------------------------------------------------------------------
function cmdShow(argv) {
  const { opts } = parseArgs(argv, ["csv", "weighted", "stacked", "decayed"]);
  const config = readConfig();
  const minN = opts["min-n"] != null ? Number(opts["min-n"]) : config.minN;
  const depth = opts.depth != null ? Number(opts.depth) : config.defaultDepth;
  const { rows: parsed, bad, missing } = readRows();
  if (missing) {
    console.log("no scorecard data yet:", DATA_FILE);
    return;
  }
  const rows = filterByDate(parsed, { since: opts.since, until: opts.until });
  const pad = (s, n) => String(s).padEnd(n);

  if (opts.decayed) {
    const base = config.ageDecayPerYear;
    const scored = decayedRows(aggregateDecayed(rows, depth, new Date(), base), minN);
    const depthNote = depth ? `  (grouped at model depth ${depth})` : "";
    console.log(pad("model@effort · tier", 40) + pad("dΔ", 8) + pad("raw", 8) + pad("n", 4) + pad("age", 15) + "by complexity" + depthNote);
    console.log("-".repeat(90));
    for (const r of scored) {
      const comp = Object.entries(r.comp).map(([c, n]) => `${c}:${n}`).join(" ");
      const ageStr = r.ageMonths == null ? "-" : `${r.ageMonths}mo ${r.ageTier}`;
      const flag = r.lowConfidence ? "  ⚠ low-n" : "";
      console.log(pad(r.key, 40) + pad(signed(r.decayedAvg), 8) + pad(signed(r.avg), 8) + pad(r.n, 4) + pad(ageStr, 15) + comp + flag);
    }
    if (!scored.length) console.log("(no rows yet)");
    console.log(`\ndΔ = age-decayed avg Δ: each rating regressed toward 0 by ${base}^(age_years) — staleness = less trust, not a penalty.`);
    console.log(`raw = undecayed avg Δ (unknown-age ratings are not decayed). ⚠ low-n < ${minN} ratings.`);
    if (bad.length) console.error(`skipped ${bad.length} malformed line(s): ${bad.join(", ")}`);
    return;
  }

  if (opts.stacked) {
    const { rows: srows, cols } = stackedData(rows, depth);
    const depthNote = depth ? `  (grouped at model depth ${depth})` : "";
    const colw = 14;
    console.log(pad("model@effort · tier", 40) + cols.map((c) => pad(c, colw)).join("") + "all" + depthNote);
    console.log("-".repeat(40 + colw * cols.length + 12));
    for (const r of srows) {
      console.log(
        pad(r.key, 40) +
          cols.map((c) => pad(avgLabel(r.byComp[c]), colw)).join("") +
          avgLabel(r.total),
      );
    }
    if (!srows.length) console.log("(no rows yet)");
    console.log(`\nCells are avg Δ (n) per complexity. Read WITHIN a row; '-' = no ratings at that size.`);
    if (bad.length) console.error(`skipped ${bad.length} malformed line(s): ${bad.join(", ")}`);
    return;
  }

  if (opts.weighted) {
    const scored = weightedRows(aggregateWeighted(rows, depth, config), minN);
    const depthNote = depth ? `  (grouped at model depth ${depth})` : "";
    console.log(pad("model · tier", 34) + pad("wΔ", 8) + pad("n", 4) + pad("effort mix", 22) + pad("age", 15) + "by complexity" + depthNote);
    console.log("-".repeat(96));
    for (const r of scored) {
      const eff = Object.entries(r.eff).map(([e, n]) => `${e}:${n}`).join(" ");
      const comp = Object.entries(r.comp).map(([c, n]) => `${c}:${n}`).join(" ");
      const ageStr = r.ageMonths == null ? "-" : `${r.ageMonths}mo ${r.ageTier}`;
      const flag = r.lowConfidence ? "  ⚠ low-n" : "";
      console.log(pad(r.key, 34) + pad(signed(r.weightedAvg), 8) + pad(r.n, 4) + pad(eff, 22) + pad(ageStr, 15) + comp + flag);
    }
    if (!scored.length) console.log("(no rows yet)");
    console.log(`\nwΔ = effort-weighted avg Δ: each rating weighted by its effort rank (higher effort counts more).`);
    console.log(`Efforts are folded into one model·tier bucket here (not split by @effort). ⚠ low-n < ${minN} ratings.`);
    if (bad.length) console.error(`skipped ${bad.length} malformed line(s): ${bad.join(", ")}`);
    return;
  }

  const scored = scorecardRows(aggregate(rows, depth), minN);

  if (opts.csv) {
    console.log(scorecardCsv(scored));
    return;
  }
  const depthNote = depth ? `  (grouped at model depth ${depth})` : "";
  console.log(pad("model@effort · tier", 40) + pad("avg Δ", 8) + pad("n", 4) + pad("age", 15) + "by complexity" + depthNote);
  console.log("-".repeat(82));
  for (const r of scored) {
    const comp = Object.entries(r.comp).map(([c, n]) => `${c}:${n}`).join(" ");
    const flag = r.lowConfidence ? "  ⚠ low-n" : "";
    const ageStr = r.ageMonths == null ? "-" : `${r.ageMonths}mo ${r.ageTier}`;
    console.log(pad(r.key, 40) + pad(signed(r.avg), 8) + pad(r.n, 4) + pad(ageStr, 15) + comp + flag);
  }
  if (!scored.length) console.log("(no rows yet)");
  console.log(`\nRead WITHIN a bucket only. ~0 = correctly tiered; + = beats tier; - = underperforms.`);
  console.log(`age = months since the model's knowledge cutoff (fresh <3 · recent <9 · aging <18 · stale); '-' = unknown.`);
  console.log(`⚠ low-n = fewer than ${minN} ratings; treat as indicative only.`);
  if (bad.length) console.error(`skipped ${bad.length} malformed line(s): ${bad.join(", ")}`);
}

// --- compare ----------------------------------------------------------------
function cmdCompare(argv) {
  const { opts, positional: models } = parseArgs(argv, ["global", "by-complexity", "by-age"]);
  if (models.length < 2) {
    console.error("give 2+ model names to compare, optionally --global / --by-complexity / --by-age");
    process.exit(1);
  }
  const config = readConfig();
  const depth = opts.depth != null ? Number(opts.depth) : config.defaultDepth;
  const groupBy = opts["by-complexity"] ? "complexity" : opts["by-age"] ? "age" : "tier";
  const { rows: parsed, missing } = readRows();
  if (missing) {
    console.log("no scorecard data yet");
    return;
  }
  const rows = filterByDate(parsed, { since: opts.since, until: opts.until });
  const data = compareData(rows, models, { depth, groupBy });
  const groups = groupsOf(data, models);

  const pad = (s, n) => String(s).padEnd(n);
  const axis = groupBy === "complexity" ? "complexity" : groupBy === "age" ? "age" : "tier";
  console.log(pad(axis, 26) + models.map((m) => pad(m, 16)).join(""));
  console.log("-".repeat(26 + 16 * models.length));
  for (const g of groups) {
    console.log(pad(g, 26) + models.map((m) => pad(avgLabel(data[m]?.groups[g]), 16)).join(""));
  }
  if (!groups.length) console.log("(no data for these models yet)");
  console.log(`\nCompare WITHIN the same ${axis} (row). '-' = no data for that model/${axis}.`);
  if (depth) console.log(`Models matched at hierarchy depth ${depth}.`);
  if (opts.global) {
    console.log("\n-- GLOBAL (mixes task types; coarse, use with care) --");
    for (const m of models) console.log(pad(m, 16) + avgLabel(data[m]?.all));
  }
}

// --- config -----------------------------------------------------------------
const CONFIG_KEYS = {
  "effort-scale": ["effortScale", (v) => v.split(",").map((s) => s.trim()).filter(Boolean)],
  "effort-floor": ["effortFloor", (v) => v],
  "effort-max": ["effortMax", (v) => v],
  "effort-default": ["effortDefault", (v) => v],
  "default-depth": ["defaultDepth", (v) => Number(v)],
  "min-n": ["minN", (v) => Number(v)],
  "age-decay": ["ageDecayPerYear", (v) => Number(v)],
};

function cmdConfig(argv) {
  const { opts } = parseArgs(argv, ["reset"]);
  if (opts.reset) {
    writeConfig(normalizeConfig(DEFAULT_CONFIG));
    console.log("config reset to defaults:");
    console.log(JSON.stringify(readConfig(), null, 2));
    return;
  }
  const keys = Object.keys(opts);
  if (!keys.length) {
    console.log(JSON.stringify(readConfig(), null, 2));
    console.log(`\n(config file: ${CONFIG_FILE})`);
    console.log("set with e.g.: config --effort-default high --effort-floor low --default-depth 1");
    return;
  }
  const next = readConfig();
  for (const k of keys) {
    const spec = CONFIG_KEYS[k];
    if (!spec) {
      console.error(`unknown config key: --${k}`);
      console.error(`valid keys: ${Object.keys(CONFIG_KEYS).map((x) => "--" + x).join(", ")}, --reset`);
      process.exit(1);
    }
    next[spec[0]] = spec[1](opts[k]);
  }
  const normalized = normalizeConfig(next);
  writeConfig(normalized);
  console.log("config updated:");
  console.log(JSON.stringify(normalized, null, 2));
}

const HELP = `model-scorecard — rate subagent models vs. expectation, per (model x tier).

  scorecard.mjs log     --model <m> [--effort <e>] --tier <t> [--task "..."] \\
                        [--complexity <S|M|L>] --delta <-3..3> [--cutoff <YYYY-MM>] [--note "..."]
  scorecard.mjs show    [--since <YYYY-MM-DD>] [--until <YYYY-MM-DD>] [--depth <N>] [--min-n <k>] [--csv] [--weighted] [--stacked] [--decayed]
  scorecard.mjs compare <A> <B> [C ...] [--global] [--by-complexity] [--by-age] [--depth <N>] [--since D] [--until D]
  scorecard.mjs config  [--effort-scale a,b,c] [--effort-floor e] [--effort-max e] \\
                        [--effort-default e] [--default-depth N] [--min-n k] [--age-decay f] [--reset]

Δ: -3 far below .. 0 met (correctly tiered, not mediocre) .. +3 far above expectation.
Model names are free-form AND hierarchical — log family-first ("opus 5", "sonnet
5.1") so --depth 1 rolls a family's versions under "opus"/"sonnet". --depth 0
(default) = full name (most specific).
show --weighted folds effort variants into one model·tier bucket, weighting Δ by
effort rank; show --stacked is a model × complexity (S/M/L) grid; show --decayed
regresses each Δ toward 0 by age (staleness = less trust, set rate with
config --age-decay).
--cutoff (or a date-shaped part of the model name, e.g. gpt-5.6-2026-01, or the
bundled scripts/cutoffs.json seed) gives the model a knowledge-cutoff date;
show/compare derive age (fresh/recent/aging/stale) from it against today — all
local, no provider API. Effort default/floor/max are set with \`config\`, not baked in.`;

switch (sub) {
  case "log": cmdLog(rest); break;
  case "show": case "score": cmdShow(rest); break;
  case "compare": cmdCompare(rest); break;
  case "config": cmdConfig(rest); break;
  case "help": case "--help": case "-h": case undefined:
    console.log(HELP); break;
  default:
    console.error(`unknown command: ${sub}\n`);
    console.error(HELP);
    process.exit(1);
}
