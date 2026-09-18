// lib.mjs — pure logic for model-scorecard. No file IO here so it is unit-testable.
// The CLI scripts (score_log/model_scorecard/score_compare) do the IO and call these.
import { homedir } from "node:os";
import { join } from "node:path";

// Global data path — deliberately NOT plugin-local, so ratings persist across every project.
export const DATA_FILE = join(homedir(), ".claude", "scorecard", "model_scorecard.jsonl");

// Buckets with fewer than this many ratings are flagged low-confidence.
export const MIN_N = 3;

const DELTAS = new Set([-2, -1, 0, 1, 2]);

// --- argument parsing -------------------------------------------------------
// Parses `--key value` pairs and bare positionals. Flags named in booleanFlags
// consume no value (e.g. --global, --csv).
export function parseArgs(argv, booleanFlags = []) {
  const opts = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (booleanFlags.includes(key)) opts[key] = true;
      else opts[key] = argv[++i];
    } else {
      positional.push(a);
    }
  }
  return { opts, positional };
}

// --- logging ----------------------------------------------------------------
// Δ must be an integer in -2..2. Throws on anything else (no write happens).
export function validateDelta(v) {
  // Guard blank/whitespace: Number("") and Number(" ") both coerce to 0.
  if (v == null || String(v).trim() === "") {
    throw new Error("--delta must be an integer in -2..2");
  }
  const d = Number(v);
  if (!Number.isInteger(d) || !DELTAS.has(d)) {
    throw new Error("--delta must be an integer in -2..2");
  }
  return d;
}

// Builds a validated row from parsed opts. Requires model, tier, delta.
export function buildRow(o, now = new Date()) {
  for (const k of ["model", "tier", "delta"]) {
    if (o[k] == null) throw new Error(`missing --${k}`);
  }
  return {
    date: o.date || now.toISOString().slice(0, 10),
    model: o.model,
    effort: o.effort || "",
    tier: o.tier,
    task: o.task || "",
    complexity: o.complexity || "",
    delta: validateDelta(o.delta),
    note: o.note || "",
  };
}

// --- reading ----------------------------------------------------------------
// Tolerant JSONL parse: skips blank lines, unparseable JSON, and rows whose
// delta is not a finite number. Returns kept rows + 1-based bad line numbers.
export function parseLines(text) {
  const rows = [];
  const bad = [];
  text.split("\n").forEach((l, i) => {
    if (!l.trim()) return;
    let r;
    try {
      r = JSON.parse(l);
    } catch {
      bad.push(i + 1);
      return;
    }
    const d = Number(r.delta);
    if (!Number.isFinite(d)) {
      bad.push(i + 1);
      return;
    }
    r.delta = d;
    rows.push(r);
  });
  return { rows, bad };
}

// Inclusive date filter. Dates are ISO YYYY-MM-DD, so string compare is correct.
export function filterByDate(rows, { since, until } = {}) {
  if (!since && !until) return rows;
  return rows.filter((r) => {
    const d = r.date || "";
    if (since && d < since) return false;
    if (until && d > until) return false;
    return true;
  });
}

// --- aggregation ------------------------------------------------------------
export function bucketKey(r) {
  return `${r.model}${r.effort ? "@" + r.effort : ""} · ${r.tier || "?"}`;
}

// model@effort · tier -> { sum, n, comp: {S,M,L counts} }
export function aggregate(rows) {
  const buckets = new Map();
  for (const r of rows) {
    const key = bucketKey(r);
    const b = buckets.get(key) || { sum: 0, n: 0, comp: {} };
    b.sum += r.delta;
    b.n += 1;
    if (r.complexity) b.comp[r.complexity] = (b.comp[r.complexity] || 0) + 1;
    buckets.set(key, b);
  }
  return buckets;
}

// Sorted rows for rendering, highest avg first. minN flags thin buckets.
export function scorecardRows(buckets, minN = MIN_N) {
  return [...buckets.entries()]
    .map(([k, b]) => ({
      key: k,
      avg: b.sum / b.n,
      n: b.n,
      comp: b.comp,
      lowConfidence: b.n < minN,
    }))
    .sort((a, b) => b.avg - a.avg);
}

// --- compare ----------------------------------------------------------------
// model -> { tiers: {tier:{sum,n}}, all:{sum,n} }. A row matches a requested
// name by bare model, or by the model@effort form if that is what was passed.
export function compareData(rows, models) {
  const data = {};
  for (const r of rows) {
    const m = models.find((x) => x === r.model || `${r.model}@${r.effort}` === x);
    if (!m) continue;
    data[m] = data[m] || { tiers: {}, all: { sum: 0, n: 0 } };
    const t = r.tier || "?";
    data[m].tiers[t] = data[m].tiers[t] || { sum: 0, n: 0 };
    data[m].tiers[t].sum += r.delta;
    data[m].tiers[t].n++;
    data[m].all.sum += r.delta;
    data[m].all.n++;
  }
  return data;
}

export function tiersOf(data, models) {
  return [...new Set(models.flatMap((m) => Object.keys(data[m]?.tiers || {})))].sort();
}

// --- formatting helpers -----------------------------------------------------
export function avgLabel(b) {
  if (!b || !b.n) return "-";
  const a = b.sum / b.n;
  return `${a >= 0 ? "+" : ""}${a.toFixed(2)} (${b.n})`;
}

export function signed(n) {
  return (n >= 0 ? "+" : "") + n.toFixed(2);
}

export function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// CSV of the per-bucket scorecard.
export function scorecardCsv(rows) {
  const header = "bucket,avg_delta,n,low_confidence,complexity";
  const body = rows.map((r) => {
    const comp = Object.entries(r.comp).map(([c, n]) => `${c}:${n}`).join(" ");
    return [r.key, r.avg.toFixed(4), r.n, r.lowConfidence, comp].map(csvEscape).join(",");
  });
  return [header, ...body].join("\n");
}
