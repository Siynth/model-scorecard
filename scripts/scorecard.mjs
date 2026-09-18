#!/usr/bin/env node
// scorecard.mjs — single, platform-agnostic CLI for the model scorecard.
// Works anywhere `node` runs (Claude Code, Codex, OpenCode, plain shell, MCP).
// Data is global at ~/.claude/scorecard/model_scorecard.jsonl so ratings persist
// across every project and every platform.
//
//   scorecard.mjs log     --model <m> [--effort <e>] --tier <t> [--task "..."] \
//                         [--complexity <S|M|L>] --delta <-2..2> [--note "..."]
//   scorecard.mjs show    [--since D] [--until D] [--min-n k] [--csv]
//   scorecard.mjs compare <A> <B> [C ...] [--global] [--since D] [--until D]
//
// Model names are FREE-FORM: a new model type is "defined" simply by logging a
// rating with its name — no enum, no registry to maintain. Ranking is always
// per-(model x tier); --global is a caveated coarse extra, never the headline.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  DATA_FILE, MIN_N, parseArgs, buildRow, parseLines, filterByDate,
  aggregate, scorecardRows, compareData, tiersOf, avgLabel, signed, scorecardCsv,
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

function cmdLog(argv) {
  const { opts } = parseArgs(argv);
  let row;
  try {
    row = buildRow(opts);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  mkdirSync(dirname(DATA_FILE), { recursive: true });
  appendFileSync(DATA_FILE, JSON.stringify(row) + "\n");
  console.log("logged:", JSON.stringify(row));
}

function cmdShow(argv) {
  const { opts } = parseArgs(argv, ["csv"]);
  const minN = opts["min-n"] != null ? Number(opts["min-n"]) : MIN_N;
  const { rows: parsed, bad, missing } = readRows();
  if (missing) {
    console.log("no scorecard data yet:", DATA_FILE);
    return;
  }
  const rows = filterByDate(parsed, { since: opts.since, until: opts.until });
  const scored = scorecardRows(aggregate(rows), minN);

  if (opts.csv) {
    console.log(scorecardCsv(scored));
    return;
  }
  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad("model@effort · tier", 40) + "avg Δ    n   by complexity");
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

function cmdCompare(argv) {
  const { opts, positional: models } = parseArgs(argv, ["global"]);
  if (models.length < 2) {
    console.error("give 2+ model names to compare, optionally --global");
    process.exit(1);
  }
  const { rows: parsed, missing } = readRows();
  if (missing) {
    console.log("no scorecard data yet");
    return;
  }
  const rows = filterByDate(parsed, { since: opts.since, until: opts.until });
  const data = compareData(rows, models);
  const tiers = tiersOf(data, models);

  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad("tier", 26) + models.map((m) => pad(m, 16)).join(""));
  console.log("-".repeat(26 + 16 * models.length));
  for (const t of tiers) {
    console.log(pad(t, 26) + models.map((m) => pad(avgLabel(data[m]?.tiers[t]), 16)).join(""));
  }
  if (!tiers.length) console.log("(no data for these models yet)");
  console.log("\nCompare WITHIN a tier (same row). '-' = no data for that model/tier.");
  if (opts.global) {
    console.log("\n-- GLOBAL (mixes task types; coarse, use with care) --");
    for (const m of models) console.log(pad(m, 16) + avgLabel(data[m]?.all));
  }
}

const HELP = `model-scorecard — rate subagent models vs. expectation, per (model x tier).

  scorecard.mjs log     --model <m> [--effort <e>] --tier <t> [--task "..."] \\
                        [--complexity <S|M|L>] --delta <-2..2> [--note "..."]
  scorecard.mjs show    [--since <YYYY-MM-DD>] [--until <YYYY-MM-DD>] [--min-n <k>] [--csv]
  scorecard.mjs compare <A> <B> [C ...] [--global] [--since D] [--until D]

Δ: -2 well below .. +2 well above expectation; 0 = met (correctly tiered, not mediocre).
Model names are free-form; log any new model and it appears on its own.`;

switch (sub) {
  case "log": cmdLog(rest); break;
  case "show": case "score": cmdShow(rest); break;
  case "compare": cmdCompare(rest); break;
  case "help": case "--help": case "-h": case undefined:
    console.log(HELP); break;
  default:
    console.error(`unknown command: ${sub}\n`);
    console.error(HELP);
    process.exit(1);
}
