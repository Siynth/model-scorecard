// Unit tests for the pure logic in scripts/lib.mjs. Run: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseArgs, validateDelta, buildRow, parseLines, filterByDate,
  aggregate, scorecardRows, compareData, groupsOf, avgLabel, signed, scorecardCsv, csvEscape,
  DEFAULT_CONFIG, normalizeConfig, resolveEffort,
  modelParts, modelSegments, modelAtDepth, bucketKey,
  normalizeCutoff, parseNameDate, resolveCutoff, ageMonths, ageTier,
  effortWeight, lookupSeedCutoff, aggregateWeighted, weightedRows, stackedData,
  ageDecayFactor, aggregateDecayed, decayedRows,
  parseDims, buildTokens, aggregateDimension, dimensionRows, dimensionsPresent,
  aggregateTokens, tokenRows, terciles, computeBadges, parseLine, sanitizeRow,
} from "../scripts/lib.mjs";

// --- parseArgs --------------------------------------------------------------
test("parseArgs: key/value pairs, boolean flags, positionals", () => {
  const { opts, positional } = parseArgs(
    ["opus", "terra", "--tier", "orchestration", "--global", "--delta", "-2"],
    ["global"],
  );
  assert.deepEqual(positional, ["opus", "terra"]);
  assert.equal(opts.tier, "orchestration");
  assert.equal(opts.global, true);
  assert.equal(opts.delta, "-2");
});

// --- delta validation -------------------------------------------------------
test("validateDelta: accepts integers in -3..3", () => {
  for (const d of [-3, -2, -1, 0, 1, 2, 3]) assert.equal(validateDelta(String(d)), d);
});

test("validateDelta: rejects out-of-range and non-integers", () => {
  for (const bad of ["4", "-4", "1.5", "abc", "", "NaN"]) {
    assert.throws(() => validateDelta(bad), /-3\.\.3/);
  }
});

test("buildRow: rejects missing required fields, no row produced", () => {
  assert.throws(() => buildRow({ model: "opus", delta: "0" }), /missing --tier/);
  assert.throws(() => buildRow({ tier: "t", delta: "0" }), /missing --model/);
  assert.throws(() => buildRow({ model: "opus", tier: "t" }), /missing --delta/);
});

test("buildRow: fills defaults and validates delta", () => {
  const row = buildRow(
    { model: "opus", tier: "orchestration", delta: "1" },
    DEFAULT_CONFIG,
    new Date("2026-09-18T00:00:00Z"),
  );
  assert.equal(row.date, "2026-09-18");
  assert.equal(row.delta, 1);
  assert.equal(row.effort, DEFAULT_CONFIG.effortDefault); // default applied
  assert.throws(() => buildRow({ model: "o", tier: "t", delta: "9" }), /-3\.\.3/);
});

// --- config -----------------------------------------------------------------
test("normalizeConfig: coerces junk, keeps floor<=max, default in range", () => {
  const c = normalizeConfig({
    effortScale: [" low ", "high", ""], effortFloor: "high", effortMax: "low",
    effortDefault: "bogus", defaultDepth: -3, minN: 0,
  });
  assert.deepEqual(c.effortScale, ["low", "high"]);
  assert.equal(c.effortFloor, "low"); // floor/max swapped back into order
  assert.equal(c.effortMax, "high");
  assert.ok(c.effortScale.includes(c.effortDefault)); // bogus default snapped into scale
  assert.equal(c.defaultDepth, 0);
  assert.equal(c.minN, 3);
});

test("normalizeConfig: empty scale means free-form efforts", () => {
  const c = normalizeConfig({ effortScale: [], effortDefault: "whatever" });
  assert.deepEqual(c.effortScale, []);
  assert.equal(c.effortFloor, null);
  assert.equal(c.effortMax, null);
  assert.equal(c.effortDefault, "whatever");
});

test("resolveEffort: applies default when omitted", () => {
  assert.equal(resolveEffort("", DEFAULT_CONFIG), DEFAULT_CONFIG.effortDefault);
  assert.equal(resolveEffort(undefined, DEFAULT_CONFIG), DEFAULT_CONFIG.effortDefault);
});

test("resolveEffort: rejects unknown or out-of-range effort (no coercion)", () => {
  const cfg = normalizeConfig({
    effortScale: ["minimal", "low", "medium", "high"],
    effortFloor: "low", effortMax: "medium", effortDefault: "low",
  });
  assert.equal(resolveEffort("medium", cfg), "medium");
  assert.throws(() => resolveEffort("xhigh", cfg), /not in the effort scale/);
  assert.throws(() => resolveEffort("minimal", cfg), /below the configured floor/);
  assert.throws(() => resolveEffort("high", cfg), /above the configured max/);
});

test("resolveEffort: free-form scale accepts anything", () => {
  const cfg = normalizeConfig({ effortScale: [] });
  assert.equal(resolveEffort("thinking-32k", cfg), "thinking-32k");
});

test("buildRow: rejects out-of-range effort so no row is written", () => {
  const cfg = normalizeConfig({ effortScale: ["low", "high"], effortFloor: "low", effortMax: "low" });
  assert.throws(() => buildRow({ model: "m", tier: "t", delta: "0", effort: "high" }, cfg), /above the configured max/);
});

// --- model hierarchy --------------------------------------------------------
test("modelSegments/modelParts: split on space/-/_/:// keep dots", () => {
  assert.deepEqual(modelSegments("5.6 sol"), ["5.6", "sol"]);
  assert.deepEqual(modelSegments("gpt-5.6-sol"), ["gpt", "5.6", "sol"]);
  assert.deepEqual(modelSegments("claude/opus-4.8"), ["claude", "opus", "4.8"]);
  assert.deepEqual(modelSegments("opus4.8"), ["opus4.8"]);
  assert.deepEqual(modelSegments(""), []);
});

test("modelAtDepth: truncates preserving original delimiters; 0/over-len = full", () => {
  assert.equal(modelAtDepth("gpt-5.6-sol", 0), "gpt-5.6-sol"); // full
  assert.equal(modelAtDepth("gpt-5.6-sol", 2), "gpt-5.6");     // original hyphen kept
  assert.equal(modelAtDepth("5.6 sol", 1), "5.6");
  assert.equal(modelAtDepth("5.6 sol", 9), "5.6 sol");         // depth > len -> full
});

test("bucketKey: groups variants together at a shallow depth", () => {
  const sol = { model: "5.6 sol", effort: "", tier: "orchestration" };
  const terra = { model: "5.6 terra", effort: "", tier: "orchestration" };
  assert.notEqual(bucketKey(sol, 0), bucketKey(terra, 0)); // specific: distinct
  assert.equal(bucketKey(sol, 1), bucketKey(terra, 1));    // general: same "5.6" bucket
});

// --- model age / knowledge cutoff -------------------------------------------
test("normalizeCutoff: accepts YYYY-MM and YYYY-MM-DD, rejects malformed", () => {
  assert.equal(normalizeCutoff("2026-06"), "2026-06");
  assert.equal(normalizeCutoff(" 2026-06-15 "), "2026-06-15");
  assert.equal(normalizeCutoff(""), "");
  assert.equal(normalizeCutoff(null), "");
  assert.throws(() => normalizeCutoff("2026"), /YYYY-MM/);
  assert.throws(() => normalizeCutoff("2026/06"), /YYYY-MM/);
  assert.throws(() => normalizeCutoff("2026-13"), /invalid month/);
  assert.throws(() => normalizeCutoff("2026-06-40"), /invalid day/);
});

test("parseNameDate: detects hyphenated and compact dates, lenient otherwise", () => {
  assert.equal(parseNameDate("gpt-5.6-2026-01"), "2026-01");
  assert.equal(parseNameDate("claude-sonnet-20241022"), "2024-10-22");
  assert.equal(parseNameDate("gpt-4o-2024-08-06"), "2024-08-06");
  assert.equal(parseNameDate("5.6 sol"), ""); // no date-shaped part
  assert.equal(parseNameDate("1234-56"), ""); // invalid month -> not a date
  assert.equal(parseNameDate(""), "");
});

test("resolveCutoff: explicit wins over name-parsed, falls back to name", () => {
  assert.equal(resolveCutoff("2025-01", "gpt-5.6-2026-01"), "2025-01"); // explicit override
  assert.equal(resolveCutoff("", "gpt-5.6-2026-01"), "2026-01"); // parsed from name
  assert.equal(resolveCutoff("", "5.6 sol"), ""); // nothing to derive
  assert.throws(() => resolveCutoff("bogus", "m"), /YYYY-MM/); // malformed explicit still throws
});

test("ageMonths / ageTier: month diff and coarse tiers", () => {
  const now = new Date("2026-09-18T00:00:00Z");
  assert.equal(ageMonths("2026-08", now), 1);
  assert.equal(ageMonths("2026-06", now), 3);
  assert.equal(ageMonths("2025-09", now), 12);
  assert.equal(ageMonths("2099-01", now), 0); // future clamps to 0
  assert.equal(ageMonths("", now), null);
  assert.equal(ageMonths(null, now), null);
  assert.equal(ageTier(0), "fresh");
  assert.equal(ageTier(5), "recent");
  assert.equal(ageTier(12), "aging");
  assert.equal(ageTier(24), "stale");
  assert.equal(ageTier(null), "");
});

test("buildRow: stores cutoff from --cutoff or auto-parses model name", () => {
  const explicit = buildRow(
    { model: "opus", tier: "t", delta: "0", cutoff: "2026-03" },
    DEFAULT_CONFIG, new Date("2026-09-18T00:00:00Z"),
  );
  assert.equal(explicit.cutoff, "2026-03");
  const parsed = buildRow(
    { model: "gpt-5.6-2026-01", tier: "t", delta: "0" },
    DEFAULT_CONFIG, new Date("2026-09-18T00:00:00Z"),
  );
  assert.equal(parsed.cutoff, "2026-01"); // auto-detected
  assert.throws(
    () => buildRow({ model: "m", tier: "t", delta: "0", cutoff: "nope" }, DEFAULT_CONFIG),
    /YYYY-MM/,
  ); // malformed cutoff blocks the write
});

test("aggregate: keeps the latest cutoff in a bucket; scorecardRows derives age", () => {
  const now = new Date("2026-09-18T00:00:00Z");
  const rows = [
    { model: "m", effort: "", tier: "t", delta: 1, cutoff: "2026-01" },
    { model: "m", effort: "", tier: "t", delta: 1, cutoff: "2026-06" },
  ];
  const b = aggregate(rows).get("m · t");
  assert.equal(b.cutoff, "2026-06"); // latest kept
  const scored = scorecardRows(aggregate(rows), 3, now);
  assert.equal(scored[0].cutoff, "2026-06");
  assert.equal(scored[0].ageMonths, 3);
  assert.equal(scored[0].ageTier, "recent");
});

test("compareData: --by-age groups by age tier", () => {
  const now = new Date("2026-09-18T00:00:00Z");
  const rows = [
    { model: "opus", effort: "", tier: "t", delta: 2, cutoff: "2026-08" }, // fresh
    { model: "opus", effort: "", tier: "t", delta: 0, cutoff: "2024-01" }, // stale
    { model: "terra", effort: "", tier: "t", delta: 1, cutoff: "2026-08" }, // fresh
  ];
  const data = compareData(rows, ["opus", "terra"], { groupBy: "age", now });
  assert.equal(data.opus.groups.fresh.sum, 2);
  assert.equal(data.opus.groups.stale.sum, 0);
  assert.deepEqual(groupsOf(data, ["opus", "terra"]), ["fresh", "stale"]);
});

// --- effort weighting / seed cutoffs / weighted view / stacked --------------
test("effortWeight: 1-based rank in scale; off-scale/empty weighs 1", () => {
  assert.equal(effortWeight("minimal", DEFAULT_CONFIG), 1);
  assert.equal(effortWeight("high", DEFAULT_CONFIG), 4);
  assert.equal(effortWeight("", DEFAULT_CONFIG), 1);
  assert.equal(effortWeight("bogus", DEFAULT_CONFIG), 1);
  assert.equal(effortWeight("x", normalizeConfig({ effortScale: [] })), 1); // free-form
});

test("lookupSeedCutoff: exact then hierarchical-prefix match", () => {
  const seed = { "gpt-5.6": "2026-01", "claude-3-5-sonnet": "2024-04" };
  assert.equal(lookupSeedCutoff("gpt-5.6", seed), "2026-01"); // exact
  assert.equal(lookupSeedCutoff("gpt-5.6-sol", seed), "2026-01"); // prefix
  assert.equal(lookupSeedCutoff("claude-3-5-sonnet", seed), "2024-04");
  assert.equal(lookupSeedCutoff("mystery-model", seed), ""); // no match
  assert.equal(lookupSeedCutoff("gpt-5.6", { "gpt-5.6": "bad" }), ""); // malformed seed skipped
});

test("resolveCutoff: seed is the last resort after explicit and name", () => {
  const seed = { opus: "2024-02" };
  assert.equal(resolveCutoff("2025-05", "opus", seed), "2025-05"); // explicit wins
  assert.equal(resolveCutoff("", "opus-2026-01", seed), "2026-01"); // name wins over seed
  assert.equal(resolveCutoff("", "opus", seed), "2024-02"); // seed fallback
  assert.equal(resolveCutoff("", "unknown", seed), ""); // nothing
});

test("buildRow: seed supplies cutoff when neither flag nor name has a date", () => {
  const row = buildRow(
    { model: "opus", tier: "t", delta: "0" },
    DEFAULT_CONFIG, new Date("2026-09-18T00:00:00Z"), { opus: "2024-02" },
  );
  assert.equal(row.cutoff, "2024-02");
});

test("aggregateWeighted/weightedRows: folds efforts, weights Δ by effort rank", () => {
  const rows = [
    { model: "m", effort: "high", tier: "t", delta: 2 },    // weight 4
    { model: "m", effort: "minimal", tier: "t", delta: -2 }, // weight 1
  ];
  const b = aggregateWeighted(rows, 0, DEFAULT_CONFIG).get("m · t");
  assert.equal(b.n, 2);
  assert.equal(b.wtot, 5);        // 4 + 1
  assert.equal(b.wsum, 6);        // 4*2 + 1*-2
  assert.deepEqual(b.eff, { high: 1, minimal: 1 });
  const scored = weightedRows(aggregateWeighted(rows, 0, DEFAULT_CONFIG), 3);
  assert.equal(scored[0].key, "m · t");
  assert.ok(Math.abs(scored[0].weightedAvg - 1.2) < 1e-9); // 6/5, not the plain mean 0
});

test("stackedData: model rows × complexity cols with totals, S/M/L ordered", () => {
  const rows = [
    { model: "opus", effort: "high", tier: "t", complexity: "L", delta: 2 },
    { model: "opus", effort: "high", tier: "t", complexity: "S", delta: 0 },
    { model: "opus", effort: "high", tier: "t", complexity: "L", delta: 1 },
  ];
  const { rows: srows, cols } = stackedData(rows, 0);
  assert.deepEqual(cols, ["S", "L"]); // preferred order, only present ones
  const r = srows.find((x) => x.key === "opus@high · t");
  assert.equal(r.byComp.L.sum, 3);
  assert.equal(r.byComp.L.n, 2);
  assert.equal(r.byComp.S.sum, 0);
  assert.equal(r.total.n, 3);
});

test("ageDecayFactor: base^(age_years), 1 when age unknown", () => {
  const now = new Date("2026-09-18T00:00:00Z");
  assert.equal(ageDecayFactor("", now, 0.9), 1);         // no cutoff → no decay
  assert.equal(ageDecayFactor("2026-09", now, 0.9), 1);  // 0 months → 0.9^0 = 1
  assert.ok(Math.abs(ageDecayFactor("2025-09", now, 0.9) - 0.9) < 1e-9); // 12mo → 0.9
  assert.ok(ageDecayFactor("2024-09", now, 0.9) < 0.82); // 24mo → 0.81
});

test("aggregateDecayed/decayedRows: regress Δ toward 0 by age, raw kept", () => {
  const now = new Date("2026-09-18T00:00:00Z");
  const rows = [
    { model: "old", effort: "", tier: "t", delta: 2, cutoff: "2024-09" },  // 24mo, heavy decay
    { model: "new", effort: "", tier: "t", delta: 2, cutoff: "2026-09" },  // fresh, no decay
    { model: "neg", effort: "", tier: "t", delta: -2, cutoff: "2024-09" }, // negative also toward 0
  ];
  const scored = decayedRows(aggregateDecayed(rows, 0, now, 0.9), 3, now);
  const old = scored.find((r) => r.key === "old · t");
  const fresh = scored.find((r) => r.key === "new · t");
  const neg = scored.find((r) => r.key === "neg · t");
  assert.equal(fresh.avg, 2);
  assert.ok(Math.abs(fresh.decayedAvg - 2) < 1e-9);   // fresh unchanged
  assert.ok(old.decayedAvg < 2 && old.decayedAvg > 1.6); // +2 shrunk toward 0
  assert.ok(neg.decayedAvg > -2 && neg.decayedAvg < -1.6); // -2 also shrunk toward 0 (less negative)
});

// --- dimension tags & tokens ------------------------------------------------
test("parseDims: name:score pairs on the -3..3 scale, rejects bad", () => {
  assert.deepEqual(parseDims("correctness:3,efficiency:-1,format:0"),
    { correctness: 3, efficiency: -1, format: 0 });
  assert.deepEqual(parseDims(""), {});
  assert.deepEqual(parseDims(null), {});
  assert.throws(() => parseDims("correctness:4"), /-3\.\.3/);   // out of range
  assert.throws(() => parseDims("correctness:1.5"), /-3\.\.3/); // non-integer
  assert.throws(() => parseDims("noscore"), /name:score/);      // missing score
  assert.throws(() => parseDims(":2"), /name:score|empty name/); // empty name
});

test("buildTokens: reads in/out/cache/total; derives total; rejects negatives", () => {
  assert.deepEqual(buildTokens({ "tokens-in": "1000", "tokens-out": "250", "cache-hits": "40" }),
    { in: 1000, out: 250, cache: 40, total: 1250 }); // total derived from in+out
  assert.deepEqual(buildTokens({ tokens: "5000" }), { total: 5000 });
  assert.equal(buildTokens({}), null); // nothing given
  assert.throws(() => buildTokens({ tokens: "-5" }), /non-negative/);
  assert.throws(() => buildTokens({ "tokens-in": "1.5" }), /non-negative/);
});

test("buildRow: attaches dims and tokens only when present", () => {
  const bare = buildRow({ model: "m", tier: "t", delta: "1" }, DEFAULT_CONFIG, new Date("2026-09-18T00:00:00Z"));
  assert.equal(bare.dims, undefined);
  assert.equal(bare.tokens, undefined);
  const rich = buildRow(
    { model: "m", tier: "t", delta: "1", dims: "correctness:3,efficiency:-1", "tokens-out": "200" },
    DEFAULT_CONFIG, new Date("2026-09-18T00:00:00Z"),
  );
  assert.deepEqual(rich.dims, { correctness: 3, efficiency: -1 });
  assert.deepEqual(rich.tokens, { out: 200, total: 200 });
});

test("aggregateDimension/dimensionRows: per-bucket avg of one facet, skips rows without it", () => {
  const rows = [
    { model: "a", effort: "", tier: "t", delta: 0, dims: { correctness: 3 } },
    { model: "a", effort: "", tier: "t", delta: 0, dims: { correctness: 1 } },
    { model: "a", effort: "", tier: "t", delta: 0 }, // no dims → skipped
    { model: "b", effort: "", tier: "t", delta: 0, dims: { completeness: 2 } }, // different dim
  ];
  const scored = dimensionRows(aggregateDimension(rows, "correctness"), 3);
  assert.equal(scored.length, 1);
  assert.equal(scored[0].key, "a · t");
  assert.equal(scored[0].avg, 2); // (3+1)/2
  assert.equal(scored[0].n, 2);   // the dim-less row excluded
});

test("dimensionsPresent: sorted union of dim names", () => {
  const rows = [
    { dims: { correctness: 1, format: 0 } },
    { dims: { efficiency: 2 } },
    {},
  ];
  assert.deepEqual(dimensionsPresent(rows), ["correctness", "efficiency", "format"]);
});

test("aggregateTokens/tokenRows: per-bucket avgs, ranked by total ascending", () => {
  const rows = [
    { model: "lean", effort: "", tier: "t", delta: 0, tokens: { in: 1000, out: 100, total: 1100 } },
    { model: "lean", effort: "", tier: "t", delta: 0, tokens: { in: 2000, out: 200, total: 2200 } },
    { model: "heavy", effort: "", tier: "t", delta: 0, tokens: { in: 9000, out: 900, total: 9900 } },
    { model: "notok", effort: "", tier: "t", delta: 0 }, // no tokens → excluded
  ];
  const scored = tokenRows(aggregateTokens(rows));
  assert.equal(scored.length, 2);
  assert.equal(scored[0].key, "lean · t"); // fewer tokens ranks first
  assert.equal(scored[0].avgTotal, 1650);  // (1100+2200)/2
  assert.equal(scored[0].avgOut, 150);
  assert.equal(scored[1].key, "heavy · t");
});

test("tokenRows: deltaPerKtok = avg Δ per 1k total tokens", () => {
  const rows = [
    { model: "m", effort: "", tier: "t", delta: 2, tokens: { total: 1000 } },
    { model: "m", effort: "", tier: "t", delta: 2, tokens: { total: 3000 } },
  ];
  const r = tokenRows(aggregateTokens(rows))[0];
  assert.equal(r.avgTotal, 2000);
  assert.equal(r.avgDelta, 2);
  assert.ok(Math.abs(r.deltaPerKtok - 1) < 1e-9); // 2 / (2000/1000)
});

test("aggregate: collects token totals and per-dim sums for CSV/badges", () => {
  const rows = [
    { model: "m", effort: "", tier: "t", delta: 2, tokens: { in: 500, out: 100, total: 600 }, dims: { correctness: 3 } },
    { model: "m", effort: "", tier: "t", delta: 0, tokens: { in: 700, out: 300, total: 1000 }, dims: { correctness: 1 } },
  ];
  const r = scorecardRows(aggregate(rows), 3)[0];
  assert.equal(r.avgTokens, 800);       // (600+1000)/2
  assert.equal(r.avgTokensOut, 200);    // (100+300)/2
  assert.equal(r.dims.correctness, 2);  // (3+1)/2
});

test("scorecardCsv: token and dims columns populated", () => {
  const scored = scorecardRows(
    aggregate([{ model: "m", tier: "t", delta: 2, tokens: { in: 900, out: 100, total: 1000 }, dims: { correctness: 2 } }]),
    3,
  );
  const row = scorecardCsv(scored).split("\n")[1];
  assert.match(row, /,1000,100,correctness:2\.00$/); // avg_tokens, avg_tokens_out, dims
});

test("compareData: --dim metric compares a dimension instead of Δ", () => {
  const rows = [
    { model: "opus", effort: "", tier: "t", delta: -2, dims: { correctness: 3 } },
    { model: "terra", effort: "", tier: "t", delta: 2, dims: { correctness: 1 } },
    { model: "terra", effort: "", tier: "t", delta: 2 }, // no dim → skipped for the dim metric
  ];
  const data = compareData(rows, ["opus", "terra"], { metric: "dim:correctness" });
  assert.equal(data.opus.groups.t.sum, 3);  // correctness, not delta (-2)
  assert.equal(data.terra.groups.t.sum, 1); // only the row that carried the dim
  assert.equal(data.terra.groups.t.n, 1);
});

test("terciles: bottom/top-third boundaries, null under 3 values", () => {
  assert.equal(terciles([1, 2]), null);
  const t = terciles([10, 20, 30, 40, 50, 60]);
  assert.ok(t.low <= 20 && t.high >= 50); // extremes fall in the outer thirds
});

test("computeBadges: derives over/under-tier, token-lean/heavy, dim strength", () => {
  const rows = [
    { model: "a", effort: "", tier: "t", delta: 3, tokens: { total: 500, out: 50 }, dims: { correctness: 3 } },
    { model: "b", effort: "", tier: "t", delta: 0, tokens: { total: 5000, out: 500 }, dims: { correctness: 1 } },
    { model: "c", effort: "", tier: "t", delta: -3, tokens: { total: 9000, out: 900 }, dims: { correctness: -2 } },
  ];
  const scored = scorecardRows(aggregate(rows), 1);
  const badges = computeBadges(scored);
  assert.ok(badges.get("a · t").includes("over-tier"));
  assert.ok(badges.get("a · t").includes("token-lean"));
  assert.ok(badges.get("a · t").includes("correctness-strong"));
  assert.ok(badges.get("c · t").includes("under-tier"));
  assert.ok(badges.get("c · t").includes("token-heavy"));
});

test("computeBadges: a metric with <3 buckets produces no tags for it", () => {
  const scored = scorecardRows(aggregate([
    { model: "a", effort: "", tier: "t", delta: 2 },
    { model: "b", effort: "", tier: "t", delta: 0 },
  ]), 1);
  const badges = computeBadges(scored);
  assert.deepEqual(badges.get("a · t"), []); // only 2 buckets → no quantile tags
});

// --- hardening --------------------------------------------------------------
test("csvEscape: neutralizes formula injection, preserves negative numbers", () => {
  assert.equal(csvEscape("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvEscape("+cmd"), "'+cmd");
  assert.equal(csvEscape("@x"), "'@x");
  assert.equal(csvEscape("-cmd"), "'-cmd");     // leading '-' that isn't a number
  assert.equal(csvEscape("-1.5000"), "-1.5000"); // negative number left intact
  assert.equal(csvEscape("2.0000"), "2.0000");
  assert.equal(csvEscape("opus 5"), "opus 5");   // ordinary text untouched
  assert.equal(csvEscape('=a,b'), '"\'=a,b"');   // guarded AND quoted (has comma)
});

test("scorecardCsv: a formula-shaped model name is neutralized", () => {
  const scored = scorecardRows(aggregate([{ model: "=cmd()", tier: "t", delta: 1 }]), 3);
  const row = scorecardCsv(scored).split("\n")[1];
  assert.match(row, /^'=cmd\(\) · t,/); // leading ' prefix neutralizes the formula
});

test("parseLine / sanitizeRow: strips control chars, validates delta", () => {
  const good = parseLine(JSON.stringify({ model: "opus\u001b[31m 5", tier: "t\u0007", delta: 2, note: "hi\u0000" }));
  assert.equal(good.row.model, "opus[31m 5"); // ESC stripped
  assert.equal(good.row.tier, "t");            // BEL stripped
  assert.equal(good.row.note, "hi");           // NUL stripped
  assert.equal(good.row.delta, 2);
  assert.equal(parseLine(""), null);           // blank line
  assert.deepEqual(parseLine("{ not json"), { bad: true });
  assert.deepEqual(parseLine(JSON.stringify({ model: "m", tier: "t", delta: "oops" })), { bad: true });
});

test("sanitizeRow: cleans control chars from dimension names", () => {
  const r = sanitizeRow({ dims: { "correct\u001bness": 2 } });
  assert.deepEqual(r.dims, { correctness: 2 });
});

// --- malformed / missing tolerance -----------------------------------------
test("parseLines: skips blank, unparseable, and non-numeric-delta rows", () => {
  const text = [
    JSON.stringify({ model: "a", tier: "t", delta: 1 }),
    "",
    "{ not json",
    JSON.stringify({ model: "b", tier: "t", delta: "oops" }),
    JSON.stringify({ model: "c", tier: "t", delta: -1 }),
    "   ",
  ].join("\n");
  const { rows, bad } = parseLines(text);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.model), ["a", "c"]);
  assert.deepEqual(bad, [3, 4]); // 1-based line numbers of the two bad lines
});

test("parseLines: empty input yields no rows and does not throw", () => {
  const { rows, bad } = parseLines("");
  assert.equal(rows.length, 0);
  assert.equal(bad.length, 0);
});

// --- date filter ------------------------------------------------------------
test("filterByDate: inclusive since/until range", () => {
  const rows = [
    { date: "2026-01-01", delta: 0 },
    { date: "2026-06-15", delta: 0 },
    { date: "2026-12-31", delta: 0 },
  ];
  assert.equal(filterByDate(rows, { since: "2026-06-15" }).length, 2);
  assert.equal(filterByDate(rows, { until: "2026-06-15" }).length, 2);
  assert.equal(filterByDate(rows, { since: "2026-02-01", until: "2026-11-01" }).length, 1);
  assert.equal(filterByDate(rows, {}).length, 3);
});

// --- aggregation ------------------------------------------------------------
test("aggregate: known rows -> known per-bucket averages", () => {
  const rows = [
    { model: "opus", effort: "high", tier: "orchestration", delta: 2, complexity: "L" },
    { model: "opus", effort: "high", tier: "orchestration", delta: 0, complexity: "L" },
    { model: "opus", effort: "high", tier: "orchestration", delta: 1, complexity: "M" },
    { model: "terra", effort: "", tier: "simple", delta: -1 },
  ];
  const buckets = aggregate(rows);
  const orch = buckets.get("opus@high · orchestration");
  assert.equal(orch.n, 3);
  assert.equal(orch.sum, 3);
  assert.equal(orch.sum / orch.n, 1); // (2+0+1)/3
  assert.deepEqual(orch.comp, { L: 2, M: 1 });
  const simple = buckets.get("terra · simple");
  assert.equal(simple.sum / simple.n, -1);
});

test("aggregate: shallow depth rolls model variants into one bucket", () => {
  const rows = [
    { model: "5.6 sol", effort: "", tier: "orchestration", delta: 2 },
    { model: "5.6 terra", effort: "", tier: "orchestration", delta: 0 },
  ];
  const specific = aggregate(rows, 0);
  assert.equal(specific.size, 2); // sol and terra distinct
  const general = aggregate(rows, 1);
  assert.equal(general.size, 1);
  const b = general.get("5.6 · orchestration");
  assert.equal(b.n, 2);
  assert.equal(b.sum / b.n, 1); // (2+0)/2
});

test("scorecardRows: sorted desc by avg, low-n flagged below minN", () => {
  const rows = [
    { model: "a", tier: "t", delta: 2 },
    { model: "a", tier: "t", delta: 2 },
    { model: "a", tier: "t", delta: 2 }, // n=3
    { model: "b", tier: "t", delta: -1 }, // n=1
  ];
  const scored = scorecardRows(aggregate(rows), 3);
  assert.equal(scored[0].key, "a · t");
  assert.equal(scored[0].avg, 2);
  assert.equal(scored[0].lowConfidence, false);
  const b = scored.find((r) => r.key === "b · t");
  assert.equal(b.lowConfidence, true);
});

// --- compare ----------------------------------------------------------------
test("compareData: per-tier side-by-side + global totals", () => {
  const rows = [
    { model: "opus", effort: "high", tier: "orchestration", delta: 2 },
    { model: "opus", effort: "high", tier: "simple", delta: -2 },
    { model: "terra", effort: "", tier: "orchestration", delta: 1 },
    { model: "terra", effort: "", tier: "simple", delta: 1 },
  ];
  const data = compareData(rows, ["opus@high", "terra"]);
  assert.equal(data["opus@high"].groups.orchestration.sum, 2);
  assert.equal(data["opus@high"].all.sum, 0); // 2 + -2
  assert.equal(data["opus@high"].all.n, 2);
  assert.equal(data.terra.all.sum, 2);
  assert.deepEqual(groupsOf(data, ["opus@high", "terra"]), ["orchestration", "simple"]);
});

test("compareData: --by-complexity groups by complexity instead of tier", () => {
  const rows = [
    { model: "opus", effort: "", tier: "t", complexity: "L", delta: 2 },
    { model: "opus", effort: "", tier: "t", complexity: "S", delta: -1 },
    { model: "terra", effort: "", tier: "t", complexity: "L", delta: 1 },
  ];
  const data = compareData(rows, ["opus", "terra"], { groupBy: "complexity" });
  assert.equal(data.opus.groups.L.sum, 2);
  assert.equal(data.opus.groups.S.sum, -1);
  assert.deepEqual(groupsOf(data, ["opus", "terra"]), ["L", "S"]);
});

test("compareData: matches at hierarchy depth", () => {
  const rows = [
    { model: "5.6 sol", effort: "", tier: "t", delta: 2 },
    { model: "5.6 terra", effort: "", tier: "t", delta: 0 },
  ];
  const data = compareData(rows, ["5.6"], { depth: 1 });
  assert.equal(data["5.6"].all.n, 2); // both variants matched the general name
  assert.equal(data["5.6"].all.sum, 2);
});

test("compareData: matches bare model or model@effort form", () => {
  const rows = [{ model: "opus", effort: "high", tier: "t", delta: 1 }];
  assert.ok(compareData(rows, ["opus"]).opus); // bare match
  assert.ok(compareData(rows, ["opus@high"])["opus@high"]); // effort-qualified match
  assert.deepEqual(compareData(rows, ["opus@low"]), {}); // no match, no crash
});

// --- formatting -------------------------------------------------------------
test("avgLabel / signed", () => {
  assert.equal(avgLabel({ sum: 3, n: 2 }), "+1.50 (2)");
  assert.equal(avgLabel({ sum: -3, n: 2 }), "-1.50 (2)");
  assert.equal(avgLabel({ sum: 0, n: 0 }), "-");
  assert.equal(signed(0), "+0.00");
  assert.equal(signed(-1.234), "-1.23");
});

test("scorecardCsv: header + escaped rows", () => {
  const scored = scorecardRows(
    aggregate([{ model: "a,b", tier: "t", delta: 1, complexity: "S" }]),
    3,
  );
  const csv = scorecardCsv(scored);
  const [header, row] = csv.split("\n");
  assert.equal(header, "bucket,avg_delta,n,low_confidence,complexity,cutoff,age_months,age_tier,avg_tokens,avg_tokens_out,dims");
  // comma-containing bucket quoted; no cutoff/tokens/dims -> trailing empty columns
  assert.match(row, /^"a,b · t",1\.0000,1,true,S:1,,,,,,$/);
});

test("scorecardCsv: cutoff and derived age columns populated", () => {
  const scored = scorecardRows(
    aggregate([{ model: "m", tier: "t", delta: 1, cutoff: "2026-06" }]),
    3,
    new Date("2026-09-18T00:00:00Z"),
  );
  const row = scorecardCsv(scored).split("\n")[1];
  assert.match(row, /,2026-06,3,recent,,,$/); // 3 months old -> recent; no tokens/dims after
});
