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
    assert.match(r.stderr, /-2\.\.2/);
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
