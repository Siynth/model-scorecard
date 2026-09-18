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
