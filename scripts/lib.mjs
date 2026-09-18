// Pure logic for model-scorecard — no file IO, so it stays unit-testable.
// The CLI (scorecard.mjs) does the IO and calls into here.
import { homedir } from "node:os";
import { join } from "node:path";

// Global paths — deliberately not plugin-local, so ratings + config persist across projects.
export const DATA_FILE = join(homedir(), ".claude", "scorecard", "model_scorecard.jsonl");
export const CONFIG_FILE = join(homedir(), ".claude", "scorecard", "config.json");

// Buckets with fewer than this many ratings are flagged low-confidence.
export const MIN_N = 3;

const DELTAS = new Set([-3, -2, -1, 0, 1, 2, 3]);

// --- config -----------------------------------------------------------------
// Plugin-level defaults (customizable via `config`). effortScale is ordered
// low→high; floor/max bound loggable efforts; effortDefault applies when
// --effort is omitted.
export const DEFAULT_CONFIG = {
  effortScale: ["minimal", "low", "medium", "high"],
  effortFloor: "minimal",
  effortMax: "high",
  effortDefault: "medium",
  defaultDepth: 0, // 0 = full model name; N = group at N segments
  minN: MIN_N,
  ageDecayPerYear: 0.9, // multiplier per year of age for the `show --decayed` view
};

// Coerce a raw config into a coherent one; an empty scale means free-form
// efforts. Never throws.
export function normalizeConfig(raw = {}) {
  const c = { ...DEFAULT_CONFIG, ...(raw || {}) };
  c.effortScale = Array.isArray(c.effortScale)
    ? c.effortScale.map((s) => String(s).trim()).filter(Boolean)
    : [...DEFAULT_CONFIG.effortScale];
  const scale = c.effortScale;
  const inScale = (v) => typeof v === "string" && scale.includes(v);

  if (scale.length) {
    c.effortFloor = inScale(c.effortFloor) ? c.effortFloor : scale[0];
    c.effortMax = inScale(c.effortMax) ? c.effortMax : scale[scale.length - 1];
    if (scale.indexOf(c.effortFloor) > scale.indexOf(c.effortMax)) {
      [c.effortFloor, c.effortMax] = [c.effortMax, c.effortFloor];
    }
    const lo = scale.indexOf(c.effortFloor);
    const hi = scale.indexOf(c.effortMax);
    let di = inScale(c.effortDefault) ? scale.indexOf(c.effortDefault) : Math.floor((lo + hi) / 2);
    di = Math.min(Math.max(di, lo), hi);
    c.effortDefault = scale[di];
  } else {
    c.effortFloor = null;
    c.effortMax = null;
    c.effortDefault = typeof c.effortDefault === "string" ? c.effortDefault : "";
  }

  c.defaultDepth = Number.isInteger(c.defaultDepth) && c.defaultDepth >= 0 ? c.defaultDepth : 0;
  c.minN = Number.isInteger(c.minN) && c.minN > 0 ? c.minN : MIN_N;
  c.ageDecayPerYear = typeof c.ageDecayPerYear === "number" && c.ageDecayPerYear > 0 && c.ageDecayPerYear <= 1
    ? c.ageDecayPerYear : DEFAULT_CONFIG.ageDecayPerYear;
  return c;
}

// Effort to store for one log: apply the default when omitted, validate against
// the scale + floor/max. Throws (so no row is written) on an invalid effort.
export function resolveEffort(effort, config = DEFAULT_CONFIG) {
  const scale = Array.isArray(config.effortScale) ? config.effortScale : [];
  const raw = effort != null && String(effort).trim() !== "" ? String(effort).trim() : "";
  const e = raw || config.effortDefault || "";
  if (!e) return "";
  if (!scale.length) return e; // free-form mode

  const idx = scale.indexOf(e);
  if (idx === -1) {
    throw new Error(
      `--effort "${e}" is not in the effort scale [${scale.join(", ")}]; ` +
        "add it with `config --effort-scale` or clear the scale for free-form efforts",
    );
  }
  const floorIdx = config.effortFloor && scale.includes(config.effortFloor)
    ? scale.indexOf(config.effortFloor) : 0;
  const maxIdx = config.effortMax && scale.includes(config.effortMax)
    ? scale.indexOf(config.effortMax) : scale.length - 1;
  if (idx < floorIdx) throw new Error(`--effort "${e}" is below the configured floor "${scale[floorIdx]}"`);
  if (idx > maxIdx) throw new Error(`--effort "${e}" is above the configured max "${scale[maxIdx]}"`);
  return e;
}

// Effort's 1-based rank in the scale (minimal=1 .. high=4); empty/off-scale weighs 1.
export function effortWeight(effort, config = DEFAULT_CONFIG) {
  const scale = Array.isArray(config.effortScale) ? config.effortScale : [];
  const e = effort ? String(effort).trim() : "";
  if (!e || !scale.length) return 1;
  const idx = scale.indexOf(e);
  return idx === -1 ? 1 : idx + 1;
}

// --- model hierarchy --------------------------------------------------------
// Names split on space / - / _ / : / (dots kept, so "5.6" stays one segment).
// Depth truncates a name to read a rating more general or more specific.
const SEG_DELIM = /[\s\-_/:]+/g;

// Segments plus the delimiter that followed each, so a truncated name keeps its
// original punctuation (e.g. "gpt-5.6").
export function modelParts(model) {
  const s = String(model == null ? "" : model).trim();
  if (!s) return [];
  const parts = [];
  let idx = 0;
  let m;
  SEG_DELIM.lastIndex = 0;
  while ((m = SEG_DELIM.exec(s))) {
    parts.push({ seg: s.slice(idx, m.index), sep: m[0] });
    idx = m.index + m[0].length;
  }
  parts.push({ seg: s.slice(idx), sep: "" });
  return parts.filter((p) => p.seg);
}

// Ordered segments only, no delimiters.
export function modelSegments(model) {
  return modelParts(model).map((p) => p.seg);
}

// Name truncated to `depth` segments (0 / >= len → full name), rebuilt with its
// original delimiters.
export function modelAtDepth(model, depth = 0) {
  const parts = modelParts(model);
  const full = () => parts.map((p, i) => p.seg + (i < parts.length - 1 ? p.sep : "")).join("");
  if (!Number.isInteger(depth) || depth <= 0 || depth >= parts.length) return full();
  const kept = parts.slice(0, depth);
  return kept.map((p, i) => p.seg + (i < kept.length - 1 ? p.sep : "")).join("");
}

// --- model age / knowledge cutoff -------------------------------------------
// Age comes from a per-rating cutoff (YYYY-MM or YYYY-MM-DD), computed locally at
// report time. No provider API exists for knowledge cutoffs, so nothing is fetched.
const CUTOFF_RE = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/;

// Validate/normalize an explicit --cutoff; throw on malformed input so no row is
// written (matching the strict --delta / --effort handling).
export function normalizeCutoff(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return "";
  const m = CUTOFF_RE.exec(s);
  if (!m) throw new Error(`--cutoff "${s}" must be YYYY-MM or YYYY-MM-DD`);
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw new Error(`--cutoff "${s}" has an invalid month`);
  if (m[3]) {
    const day = Number(m[3]);
    if (day < 1 || day > 31) throw new Error(`--cutoff "${s}" has an invalid day`);
    return `${m[1]}-${m[2]}-${m[3]}`;
  }
  return `${m[1]}-${m[2]}`;
}

// Detect a date inside a model name — hyphenated YYYY-MM(-DD) or compact
// YYYYMMDD (20xx only, to skip version numbers). Lenient: "" when none, with
// month/day ranges checked so "1234-56" doesn't match.
export function parseNameDate(model) {
  const s = String(model == null ? "" : model);
  let m = /(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(s);
  if (m) {
    const mo = Number(m[2]);
    if (mo >= 1 && mo <= 12) {
      if (m[3]) {
        const d = Number(m[3]);
        if (d >= 1 && d <= 31) return `${m[1]}-${m[2]}-${m[3]}`;
      } else {
        return `${m[1]}-${m[2]}`;
      }
    }
  }
  m = /(?:^|[^\d])(20\d{2})(\d{2})(\d{2})(?:[^\d]|$)/.exec(s);
  if (m) {
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  return "";
}

// normalizeCutoff that swallows errors — a bad seed entry shouldn't abort a log.
function safeCutoff(v) {
  try {
    return normalizeCutoff(v);
  } catch {
    return "";
  }
}

// Seed lookup by exact name, then hierarchical prefix (longest first), so a
// "gpt-5.6" entry answers for "gpt-5.6-sol". "" when nothing matches.
export function lookupSeedCutoff(model, seed = {}) {
  if (!seed || typeof seed !== "object") return "";
  const s = String(model == null ? "" : model).trim();
  if (!s) return "";
  if (seed[s]) return safeCutoff(seed[s]);
  const parts = modelParts(s);
  for (let d = parts.length - 1; d >= 1; d--) {
    const key = modelAtDepth(s, d);
    if (seed[key]) return safeCutoff(seed[key]);
  }
  return "";
}

// Cutoff precedence: explicit --cutoff > date in the name > seed > "".
export function resolveCutoff(explicit, model, seed = {}) {
  const e = normalizeCutoff(explicit); // throws on a malformed explicit value
  if (e) return e;
  const named = parseNameDate(model);
  if (named) return named;
  return lookupSeedCutoff(model, seed);
}

// Whole months from cutoff to `now` (month precision); null if no cutoff, 0 if future.
export function ageMonths(cutoff, now = new Date()) {
  if (!cutoff) return null;
  const m = CUTOFF_RE.exec(cutoff);
  if (!m) return null;
  const months = (now.getUTCFullYear() - Number(m[1])) * 12 + (now.getUTCMonth() + 1 - Number(m[2]));
  return months < 0 ? 0 : months;
}

// Coarse age bucket; "" when unknown.
export function ageTier(months) {
  if (months == null) return "";
  if (months < 3) return "fresh";
  if (months < 9) return "recent";
  if (months < 18) return "aging";
  return "stale";
}

// Staleness confidence factor in (0,1]: `base` compounded per year of age, so an
// old rating is regressed TOWARD the neutral 0 (not penalized). 1 when age is
// unknown (no cutoff) — an unknown-age rating is not decayed.
export function ageDecayFactor(cutoff, now = new Date(), base = 0.9) {
  const m = ageMonths(cutoff, now);
  if (m == null) return 1;
  return Math.pow(base, m / 12);
}

// --- argument parsing -------------------------------------------------------
// Parse `--key value` pairs and bare positionals; booleanFlags consume no value.
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
// Δ must be an integer in -3..3; throws otherwise (no write). Note: Number("")
// and Number(" ") coerce to 0, so blank input is guarded explicitly.
export function validateDelta(v) {
  if (v == null || String(v).trim() === "") throw new Error("--delta must be an integer in -3..3");
  const d = Number(v);
  if (!Number.isInteger(d) || !DELTAS.has(d)) throw new Error("--delta must be an integer in -3..3");
  return d;
}

// Validated row from parsed opts; requires model/tier/delta, resolves effort + cutoff.
export function buildRow(o, config = DEFAULT_CONFIG, now = new Date(), seed = {}) {
  for (const k of ["model", "tier", "delta"]) {
    if (o[k] == null) throw new Error(`missing --${k}`);
  }
  return {
    date: o.date || now.toISOString().slice(0, 10),
    model: o.model,
    effort: resolveEffort(o.effort, config),
    tier: o.tier,
    task: o.task || "",
    complexity: o.complexity || "",
    delta: validateDelta(o.delta),
    cutoff: resolveCutoff(o.cutoff, o.model, seed),
    note: o.note || "",
  };
}

// --- reading ----------------------------------------------------------------
// Tolerant JSONL parse: skip blank / unparseable / non-numeric-delta lines.
// Returns kept rows plus 1-based bad line numbers.
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

// Inclusive since/until filter (ISO dates compare lexically).
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
// Bucket key at a hierarchy depth (0 = full model name).
export function bucketKey(r, depth = 0) {
  const model = modelAtDepth(r.model, depth);
  return `${model}${r.effort ? "@" + r.effort : ""} · ${r.tier || "?"}`;
}

// model@effort · tier → { sum, n, comp, cutoff }, grouped at `depth`. Keeps the
// latest cutoff seen (lexical compare works for both cutoff forms).
export function aggregate(rows, depth = 0) {
  const buckets = new Map();
  for (const r of rows) {
    const key = bucketKey(r, depth);
    const b = buckets.get(key) || { sum: 0, n: 0, comp: {}, cutoff: "" };
    b.sum += r.delta;
    b.n += 1;
    if (r.complexity) b.comp[r.complexity] = (b.comp[r.complexity] || 0) + 1;
    if (r.cutoff && r.cutoff > b.cutoff) b.cutoff = r.cutoff;
    buckets.set(key, b);
  }
  return buckets;
}

// Render rows sorted by avg desc; flags thin buckets, derives age at report time.
export function scorecardRows(buckets, minN = MIN_N, now = new Date()) {
  return [...buckets.entries()]
    .map(([k, b]) => {
      const age = ageMonths(b.cutoff, now);
      return {
        key: k,
        avg: b.sum / b.n,
        n: b.n,
        comp: b.comp,
        lowConfidence: b.n < minN,
        cutoff: b.cutoff || "",
        ageMonths: age,
        ageTier: ageTier(age),
      };
    })
    .sort((a, b) => b.avg - a.avg);
}

// --- effort-weighted view ---------------------------------------------------
// Fold @effort back into one model·tier bucket, weighting each Δ by effort rank
// (higher effort counts more). Answers "which model is best overall, crediting
// wins earned at higher effort".
export function aggregateWeighted(rows, depth = 0, config = DEFAULT_CONFIG) {
  const buckets = new Map();
  for (const r of rows) {
    const model = modelAtDepth(r.model, depth);
    const key = `${model} · ${r.tier || "?"}`; // effort folded in via weight, not the key
    const b = buckets.get(key) || { wsum: 0, wtot: 0, n: 0, comp: {}, eff: {}, cutoff: "" };
    const w = effortWeight(r.effort, config);
    b.wsum += w * r.delta;
    b.wtot += w;
    b.n += 1;
    if (r.complexity) b.comp[r.complexity] = (b.comp[r.complexity] || 0) + 1;
    if (r.effort) b.eff[r.effort] = (b.eff[r.effort] || 0) + 1;
    if (r.cutoff && r.cutoff > b.cutoff) b.cutoff = r.cutoff;
    buckets.set(key, b);
  }
  return buckets;
}

// Weighted rows sorted by weighted avg desc.
export function weightedRows(buckets, minN = MIN_N, now = new Date()) {
  return [...buckets.entries()]
    .map(([k, b]) => {
      const age = ageMonths(b.cutoff, now);
      return {
        key: k,
        weightedAvg: b.wtot ? b.wsum / b.wtot : 0,
        n: b.n,
        eff: b.eff,
        comp: b.comp,
        lowConfidence: b.n < minN,
        cutoff: b.cutoff || "",
        ageMonths: age,
        ageTier: ageTier(age),
      };
    })
    .sort((a, b) => b.weightedAvg - a.weightedAvg);
}

// --- age-decayed view -------------------------------------------------------
// Same buckets as the default table, but each rating's Δ is shrunk toward 0 by
// its age-decay factor (staleness = less trust in the rating, NOT a penalty).
// Raw Δ is kept alongside the decayed value so the discount is visible.
export function aggregateDecayed(rows, depth = 0, now = new Date(), base = 0.9) {
  const buckets = new Map();
  for (const r of rows) {
    const key = bucketKey(r, depth);
    const b = buckets.get(key) || { sum: 0, sumDecayed: 0, n: 0, comp: {}, cutoff: "" };
    b.sum += r.delta;
    b.sumDecayed += r.delta * ageDecayFactor(r.cutoff, now, base);
    b.n += 1;
    if (r.complexity) b.comp[r.complexity] = (b.comp[r.complexity] || 0) + 1;
    if (r.cutoff && r.cutoff > b.cutoff) b.cutoff = r.cutoff;
    buckets.set(key, b);
  }
  return buckets;
}

// Decayed rows sorted by decayed avg desc.
export function decayedRows(buckets, minN = MIN_N, now = new Date()) {
  return [...buckets.entries()]
    .map(([k, b]) => {
      const age = ageMonths(b.cutoff, now);
      return {
        key: k,
        avg: b.sum / b.n,
        decayedAvg: b.sumDecayed / b.n,
        n: b.n,
        comp: b.comp,
        lowConfidence: b.n < minN,
        cutoff: b.cutoff || "",
        ageMonths: age,
        ageTier: ageTier(age),
      };
    })
    .sort((a, b) => b.decayedAvg - a.decayedAvg);
}

// --- stacked depth × complexity report --------------------------------------
// Grid: each bucket (model@effort · tier, at `depth`) a row, complexity S/M/L
// columns, plus an "all" total.
export function stackedData(rows, depth = 0) {
  const buckets = new Map();
  const comps = new Set();
  for (const r of rows) {
    const key = bucketKey(r, depth);
    const comp = r.complexity || "?";
    comps.add(comp);
    const b = buckets.get(key) || { byComp: {}, total: { sum: 0, n: 0 } };
    b.byComp[comp] = b.byComp[comp] || { sum: 0, n: 0 };
    b.byComp[comp].sum += r.delta;
    b.byComp[comp].n += 1;
    b.total.sum += r.delta;
    b.total.n += 1;
    buckets.set(key, b);
  }
  // Columns: S, M, L first (when present), then any others, then "?" last.
  const preferred = ["S", "M", "L"];
  const rest = [...comps].filter((c) => !preferred.includes(c) && c !== "?").sort();
  const cols = [...preferred.filter((c) => comps.has(c)), ...rest, ...(comps.has("?") ? ["?"] : [])];
  const rowsOut = [...buckets.entries()]
    .map(([key, b]) => ({ key, byComp: b.byComp, total: b.total }))
    .sort((a, b) => b.total.sum / b.total.n - a.total.sum / a.total.n);
  return { rows: rowsOut, cols };
}

// --- compare ----------------------------------------------------------------
// model → { groups: {label:{sum,n}}, all:{sum,n} }. Axis is tier (default),
// complexity, or age; models are matched at `depth`.
export function compareData(rows, models, { depth = 0, groupBy = "tier", now = new Date() } = {}) {
  const data = {};
  for (const r of rows) {
    const md = modelAtDepth(r.model, depth);
    const m = models.find((x) => x === md || `${md}@${r.effort}` === x);
    if (!m) continue;
    data[m] = data[m] || { groups: {}, all: { sum: 0, n: 0 } };
    let label;
    if (groupBy === "complexity") label = r.complexity;
    else if (groupBy === "age") label = ageTier(ageMonths(r.cutoff, now));
    else label = r.tier;
    label = label || "?";
    data[m].groups[label] = data[m].groups[label] || { sum: 0, n: 0 };
    data[m].groups[label].sum += r.delta;
    data[m].groups[label].n++;
    data[m].all.sum += r.delta;
    data[m].all.n++;
  }
  return data;
}

// Sorted union of group labels across the requested models.
export function groupsOf(data, models) {
  return [...new Set(models.flatMap((m) => Object.keys(data[m]?.groups || {})))].sort();
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
  const header = "bucket,avg_delta,n,low_confidence,complexity,cutoff,age_months,age_tier";
  const body = rows.map((r) => {
    const comp = Object.entries(r.comp).map(([c, n]) => `${c}:${n}`).join(" ");
    return [r.key, r.avg.toFixed(4), r.n, r.lowConfidence, comp,
      r.cutoff || "", r.ageMonths == null ? "" : r.ageMonths, r.ageTier || ""]
      .map(csvEscape).join(",");
  });
  return [header, ...body].join("\n");
}
