// Unit tests for the pure logic in scripts/lib.mjs. Run: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseArgs, validateDelta, buildRow, parseLines, filterByDate,
  aggregate, scorecardRows, compareData, tiersOf, avgLabel, signed, scorecardCsv,
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
test("validateDelta: accepts integers in -2..2", () => {
  for (const d of [-2, -1, 0, 1, 2]) assert.equal(validateDelta(String(d)), d);
});

test("validateDelta: rejects out-of-range and non-integers", () => {
  for (const bad of ["3", "-3", "1.5", "abc", "", "NaN"]) {
    assert.throws(() => validateDelta(bad), /-2\.\.2/);
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
    new Date("2026-09-18T00:00:00Z"),
  );
  assert.equal(row.date, "2026-09-18");
  assert.equal(row.delta, 1);
  assert.equal(row.effort, "");
  assert.throws(() => buildRow({ model: "o", tier: "t", delta: "9" }), /-2\.\.2/);
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
  assert.equal(data["opus@high"].tiers.orchestration.sum, 2);
  assert.equal(data["opus@high"].all.sum, 0); // 2 + -2
  assert.equal(data["opus@high"].all.n, 2);
  assert.equal(data.terra.all.sum, 2);
  assert.deepEqual(tiersOf(data, ["opus@high", "terra"]), ["orchestration", "simple"]);
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
  assert.equal(header, "bucket,avg_delta,n,low_confidence,complexity");
  assert.match(row, /^"a,b · t",1\.0000,1,true,S:1$/); // comma-containing bucket quoted
});
