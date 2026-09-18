// Integration tests: spawn the CLI scripts against a throwaway HOME so the
// global data path (~/.claude/scorecard) resolves inside a temp dir.
// Run: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts");
const CLI = join(scriptsDir, "scorecard.mjs");

// Point os.homedir() at a temp dir (USERPROFILE on Windows, HOME elsewhere).
function withTempHome(fn) {
  const home = mkdtempSync(join(tmpdir(), "scorecard-test-"));
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  try {
    return fn(home, env);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function run(args, env) {
  try {
    const stdout = execFileSync("node", [CLI, ...args], { env, encoding: "utf8" });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

test("missing data file: show reports gracefully, exit 0", () => {
  withTempHome((home, env) => {
    const r = run(["show"], env);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /no scorecard data yet/);
  });
});

test("log then show: written row appears in its bucket", () => {
  withTempHome((home, env) => {
    const logRes = run([
      "log",
      "--model", "opus", "--effort", "high", "--tier", "orchestration",
      "--task", "e2e", "--complexity", "L", "--delta", "2", "--note", "beat it",
    ], env);
    assert.equal(logRes.code, 0);
    const dataFile = join(home, ".claude", "scorecard", "model_scorecard.jsonl");
    assert.ok(existsSync(dataFile), "data file should be created");
    assert.match(readFileSync(dataFile, "utf8"), /"model":"opus"/);

    const scoreRes = run(["show"], env);
    assert.equal(scoreRes.code, 0);
    assert.match(scoreRes.stdout, /opus@high · orchestration/);
    assert.match(scoreRes.stdout, /\+2\.00/);
  });
});

test("invalid delta: exits non-zero and writes nothing", () => {
  withTempHome((home, env) => {
    const r = run(["log", "--model", "opus", "--tier", "t", "--delta", "5"], env);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /-3\.\.3/);
    const dataFile = join(home, ".claude", "scorecard", "model_scorecard.jsonl");
    assert.equal(existsSync(dataFile), false, "no file should be written on rejection");
  });
});

test("missing required field: exits non-zero, writes nothing", () => {
  withTempHome((home, env) => {
    const r = run(["log", "--model", "opus", "--delta", "0"], env); // no --tier
    assert.equal(r.code, 1);
    assert.match(r.stderr, /missing --tier/);
  });
});

test("--csv emits CSV header", () => {
  withTempHome((home, env) => {
    run(["log", "--model", "opus", "--tier", "t", "--delta", "1"], env);
    const r = run(["show", "--csv"], env);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /^bucket,avg_delta,n,low_confidence,complexity/);
  });
});

test("compare: two models render a per-tier table", () => {
  withTempHome((home, env) => {
    run(["log", "--model", "opus", "--tier", "orchestration", "--delta", "2"], env);
    run(["log", "--model", "terra", "--tier", "orchestration", "--delta", "1"], env);
    const r = run(["compare", "opus", "terra", "--global"], env);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /orchestration/);
    assert.match(r.stdout, /GLOBAL/);
  });
});

test("unknown subcommand: exits non-zero with help", () => {
  withTempHome((home, env) => {
    const r = run(["bogus"], env);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /unknown command/);
  });
});

test("config: set roundtrips to disk and back", () => {
  withTempHome((home, env) => {
    const set = run(["config", "--effort-default", "high", "--default-depth", "1"], env);
    assert.equal(set.code, 0);
    const cfgFile = join(home, ".claude", "scorecard", "config.json");
    assert.ok(existsSync(cfgFile), "config file should be created");
    const saved = JSON.parse(readFileSync(cfgFile, "utf8"));
    assert.equal(saved.effortDefault, "high");
    assert.equal(saved.defaultDepth, 1);
    const show = run(["config"], env);
    assert.match(show.stdout, /"effortDefault": "high"/);
  });
});

test("config: unknown key exits non-zero", () => {
  withTempHome((home, env) => {
    const r = run(["config", "--bogus", "x"], env);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /unknown config key/);
  });
});

test("log: applies configured default effort when --effort omitted", () => {
  withTempHome((home, env) => {
    run(["config", "--effort-default", "high"], env);
    const r = run(["log", "--model", "opus", "--tier", "t", "--delta", "1"], env);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /"effort":"high"/);
  });
});

test("log: rejects out-of-range effort, writes nothing", () => {
  withTempHome((home, env) => {
    run(["config", "--effort-scale", "low,medium", "--effort-max", "medium"], env);
    const r = run(["log", "--model", "opus", "--tier", "t", "--delta", "1", "--effort", "high"], env);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /not in the effort scale|above the configured max/);
  });
});

test("show --depth: rolls up model variants into one bucket", () => {
  withTempHome((home, env) => {
    run(["log", "--model", "5.6 sol", "--tier", "orchestration", "--delta", "2", "--effort", "high"], env);
    run(["log", "--model", "5.6 terra", "--tier", "orchestration", "--delta", "0", "--effort", "high"], env);
    const specific = run(["show"], env);
    assert.match(specific.stdout, /5\.6 sol@high/);
    assert.match(specific.stdout, /5\.6 terra@high/);
    const general = run(["show", "--depth", "1"], env);
    assert.match(general.stdout, /5\.6@high · orchestration/);
    assert.doesNotMatch(general.stdout, /sol|terra/);
  });
});

test("compare --by-complexity: rows are complexities", () => {
  withTempHome((home, env) => {
    run(["log", "--model", "opus", "--tier", "t", "--complexity", "L", "--delta", "2"], env);
    run(["log", "--model", "terra", "--tier", "t", "--complexity", "L", "--delta", "1"], env);
    const r = run(["compare", "opus", "terra", "--by-complexity"], env);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /^complexity/m);
    assert.match(r.stdout, /^L /m);
  });
});

test("log --cutoff then show: age column reflects the cutoff", () => {
  withTempHome((home, env) => {
    const r = run(["log", "--model", "opus", "--tier", "t", "--delta", "1", "--cutoff", "2026-06"], env);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /"cutoff":"2026-06"/);
    const show = run(["show"], env);
    assert.equal(show.code, 0);
    assert.match(show.stdout, /\d+mo (fresh|recent|aging|stale)/); // an age like "3mo recent" is rendered
  });
});

test("log: auto-detects a date in the model name as the cutoff", () => {
  withTempHome((home, env) => {
    const r = run(["log", "--model", "gpt-5.6-2026-01", "--tier", "t", "--delta", "0"], env);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /"cutoff":"2026-01"/);
  });
});

test("log: rejects malformed --cutoff, writes nothing", () => {
  withTempHome((home, env) => {
    const r = run(["log", "--model", "opus", "--tier", "t", "--delta", "0", "--cutoff", "2026"], env);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /YYYY-MM/);
    const dataFile = join(home, ".claude", "scorecard", "model_scorecard.jsonl");
    assert.equal(existsSync(dataFile), false);
  });
});

test("compare --by-age: rows are age tiers", () => {
  withTempHome((home, env) => {
    run(["log", "--model", "opus", "--tier", "t", "--delta", "2", "--cutoff", "2020-01"], env);
    run(["log", "--model", "terra", "--tier", "t", "--delta", "1", "--cutoff", "2020-01"], env);
    const r = run(["compare", "opus", "terra", "--by-age"], env);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /^age/m);
    assert.match(r.stdout, /^stale /m);
  });
});

test("show --weighted: folds efforts into model·tier with effort-weighted Δ", () => {
  withTempHome((home, env) => {
    run(["log", "--model", "opus", "--effort", "high", "--tier", "t", "--delta", "2"], env);
    run(["log", "--model", "opus", "--effort", "minimal", "--tier", "t", "--delta", "-2"], env);
    const r = run(["show", "--weighted"], env);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /^wΔ = effort-weighted/m); // legend present
    assert.match(r.stdout, /opus · t/);               // effort folded out of the key
    assert.doesNotMatch(r.stdout, /opus@high/);        // not split by @effort here
  });
});

test("show --stacked: model rows × complexity columns", () => {
  withTempHome((home, env) => {
    run(["log", "--model", "opus", "--tier", "t", "--complexity", "L", "--delta", "2"], env);
    run(["log", "--model", "opus", "--tier", "t", "--complexity", "S", "--delta", "0"], env);
    const r = run(["show", "--stacked"], env);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /model@effort · tier/);
    assert.match(r.stdout, /\ball\b/);      // total column header
    assert.match(r.stdout, /opus@medium · t/);
  });
});

test("log: bundled seed supplies cutoff for a known model with no date", () => {
  withTempHome((home, env) => {
    const r = run(["log", "--model", "gpt-4o", "--tier", "t", "--delta", "0"], env);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /"cutoff":"2023-10"/); // from scripts/cutoffs.json
  });
});

test("log: accepts the widened -3..3 scale", () => {
  withTempHome((home, env) => {
    assert.equal(run(["log", "--model", "m", "--tier", "t", "--delta", "3"], env).code, 0);
    assert.equal(run(["log", "--model", "m", "--tier", "t", "--delta", "-3"], env).code, 0);
    const r = run(["log", "--model", "m", "--tier", "t", "--delta", "4"], env); // still out of range
    assert.equal(r.code, 1);
    assert.match(r.stderr, /-3\.\.3/);
  });
});

test("show --decayed: shows decayed + raw columns, regresses old ratings", () => {
  withTempHome((home, env) => {
    run(["log", "--model", "old", "--tier", "t", "--delta", "2", "--cutoff", "2020-01"], env);
    const r = run(["show", "--decayed"], env);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /^dΔ = age-decayed/m);
    assert.match(r.stdout, /dΔ.*raw/); // both columns in header
  });
});

test("log --dims + show --dim: rank by a facet", () => {
  withTempHome((home, env) => {
    const l = run(["log", "--model", "opus", "--tier", "t", "--delta", "1", "--dims", "correctness:3,format:-1"], env);
    assert.equal(l.code, 0);
    assert.match(l.stdout, /"dims":\{"correctness":3,"format":-1\}/);
    const r = run(["show", "--dim", "correctness"], env);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /avg correctness/);
    assert.match(r.stdout, /opus@medium · t/); // default effort applied to the bucket key
    const miss = run(["show", "--dim", "nope"], env);
    assert.match(miss.stdout, /no ratings carry dimension "nope"/);
    assert.match(miss.stdout, /known dimensions: correctness, format/);
  });
});

test("log --dims: rejects out-of-range facet score, writes nothing", () => {
  withTempHome((home, env) => {
    const r = run(["log", "--model", "opus", "--tier", "t", "--delta", "1", "--dims", "correctness:5"], env);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /-3\.\.3/);
    const dataFile = join(home, ".claude", "scorecard", "model_scorecard.jsonl");
    assert.equal(existsSync(dataFile), false);
  });
});

test("log --tokens + show --efficiency: per-bucket token averages ranked ascending", () => {
  withTempHome((home, env) => {
    run(["log", "--model", "lean", "--tier", "t", "--delta", "0", "--tokens-in", "1000", "--tokens-out", "100", "--cache-hits", "50"], env);
    run(["log", "--model", "heavy", "--tier", "t", "--delta", "0", "--tokens", "9000"], env);
    const r = run(["show", "--efficiency"], env);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /in\s+out\s+cache\s+total/);
    // lean (1,100 total) should rank above heavy (9,000)
    const leanIdx = r.stdout.indexOf("lean@medium · t");
    const heavyIdx = r.stdout.indexOf("heavy@medium · t");
    assert.ok(leanIdx > -1 && heavyIdx > -1 && leanIdx < heavyIdx);
  });
});

test("log: rejects negative token count, writes nothing", () => {
  withTempHome((home, env) => {
    const r = run(["log", "--model", "m", "--tier", "t", "--delta", "0", "--tokens", "-5"], env);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /non-negative/);
  });
});
