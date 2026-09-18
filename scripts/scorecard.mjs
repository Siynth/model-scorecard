#!/usr/bin/env node
// scorecard.mjs — single, platform-agnostic CLI for the model scorecard.
// Works anywhere `node` runs (Claude Code, Codex, OpenCode, plain shell, MCP).
// Data + config are global at ~/.claude/scorecard/ so ratings and preferences
// persist across every project and every platform.
//
//   scorecard.mjs log     --model <m> [--effort <e>] --tier <t> [--task "..."] \
//                         [--complexity <S|M|L>] --delta <-2..2> [--note "..."]
//   scorecard.mjs show    [--since D] [--until D] [--depth N] [--min-n k] [--csv]
//   scorecard.mjs compare <A> <B> [C ...] [--global] [--by-complexity] \
//                         [--depth N] [--since D] [--until D]
//   scorecard.mjs config  [--effort-scale a,b,c] [--effort-floor e] [--effort-max e] \
//                         [--effort-default e] [--default-depth N] [--min-n k] [--reset]
//
// Model names are FREE-FORM and HIERARCHICAL: a new model is "defined" simply by
// logging a rating with its name (no enum, no registry), and its name decomposes
// into ordered segments so "5.6 sol"/"5.6 terra" can roll up under "5.6" at a
// shallower --depth. Ranking is always per-(model x tier); --global is a caveated
// coarse extra, never the headline.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  DATA_FILE, CONFIG_FILE, DEFAULT_CONFIG, normalizeConfig,
  parseArgs, buildRow, parseLines, filterByDate,
  aggregate, scorecardRows, compareData, groupsOf, avgLabel, signed, scorecardCsv,
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

// --- log --------------------------------------------------------------------
function cmdLog(argv) {
  const { opts } = parseArgs(argv);
  let row;
  try {
    row = buildRow(opts, readConfig());
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
  const { opts } = parseArgs(argv, ["csv"]);
  const config = readConfig();
  const minN = opts["min-n"] != null ? Number(opts["min-n"]) : config.minN;
  const depth = opts.depth != null ? Number(opts.depth) : config.defaultDepth;
  const { rows: parsed, bad, missing } = readRows();
  if (missing) {
    console.log("no scorecard data yet:", DATA_FILE);
    return;
  }
  const rows = filterByDate(parsed, { since: opts.since, until: opts.until });
  const scored = scorecardRows(aggregate(rows, depth), minN);

  if (opts.csv) {
    console.log(scorecardCsv(scored));
    return;
  }
  const pad = (s, n) => String(s).padEnd(n);
  const depthNote = depth ? `  (grouped at model depth ${depth})` : "";
  console.log(pad("model@effort · tier", 40) + "avg Δ    n   by complexity" + depthNote);
  console.log("-".repeat(74));
  for (const r of scored) {
    const comp = Object.entries(r.comp).map(([c, n]) => `${c}:${n}`).join(" ");
    const flag = r.lowConfidence ? "  ⚠ low-n" : "";
    console.log(pad(r.key, 40) + pad(signed(r.avg), 8) + pad(r.n, 4) + comp + flag);
  }
  if (!scored.length) console.log("(no rows yet)");
  console.log(`\nRead WITHIN a bucket only. ~0 = correctly tiered; + = beats tier; - = underperforms.`);
  console.log(`⚠ low-n = fewer than ${minN} ratings; treat as indicative only.`);
  if (bad.length) console.error(`skipped ${bad.length} malformed line(s): ${bad.join(", ")}`);
}

// --- compare ----------------------------------------------------------------
function cmdCompare(argv) {
  const { opts, positional: models } = parseArgs(argv, ["global", "by-complexity"]);
  if (models.length < 2) {
    console.error("give 2+ model names to compare, optionally --global / --by-complexity");
    process.exit(1);
  }
  const config = readConfig();
  const depth = opts.depth != null ? Number(opts.depth) : config.defaultDepth;
  const groupBy = opts["by-complexity"] ? "complexity" : "tier";
  const { rows: parsed, missing } = readRows();
  if (missing) {
    console.log("no scorecard data yet");
    return;
  }
  const rows = filterByDate(parsed, { since: opts.since, until: opts.until });
  const data = compareData(rows, models, { depth, groupBy });
  const groups = groupsOf(data, models);

  const pad = (s, n) => String(s).padEnd(n);
  const axis = groupBy === "complexity" ? "complexity" : "tier";
  console.log(pad(axis, 26) + models.map((m) => pad(m, 16)).join(""));
  console.log("-".repeat(26 + 16 * models.length));
  for (const g of groups) {
    console.log(pad(g, 26) + models.map((m) => pad(avgLabel(data[m]?.groups[g]), 16)).join(""));
  }
  if (!groups.length) console.log("(no data for these models yet)");
  console.log(`\nCompare WITHIN a ${axis} (same row). '-' = no data for that model/${axis}.`);
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
                        [--complexity <S|M|L>] --delta <-2..2> [--note "..."]
  scorecard.mjs show    [--since <YYYY-MM-DD>] [--until <YYYY-MM-DD>] [--depth <N>] [--min-n <k>] [--csv]
  scorecard.mjs compare <A> <B> [C ...] [--global] [--by-complexity] [--depth <N>] [--since D] [--until D]
  scorecard.mjs config  [--effort-scale a,b,c] [--effort-floor e] [--effort-max e] \\
                        [--effort-default e] [--default-depth N] [--min-n k] [--reset]

Δ: -2 well below .. +2 well above expectation; 0 = met (correctly tiered, not mediocre).
Model names are free-form AND hierarchical — "5.6 sol"/"5.6 terra" roll up under
"5.6" at a shallower --depth. --depth 0 (default) = full name (most specific).
Effort default/floor/max are set with \`config\`, not baked in.`;

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
