/**
 * End-to-end tests for weightpin: the real CLI (dist/cli.js) against
 * fixture model dirs in tmp, plus the real live-model safetensors file.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "dist", "cli.js");
const LIVE_MODEL = join(ROOT, "examples", "live-model");
const LIVE_SHA256 =
  "8111d5afb0715dbf5a31396d31432cb56370ba23f6650a035ea0fc8a20b4e500";

function run(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
}

function tmpDir() {
  return mkdtempSync(join(tmpdir(), "weightpin-e2e-"));
}

function makeModel(dir, files) {
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

test("pin writes a valid lockfile with correct hashes and sizes", () => {
  const work = tmpDir();
  const model = makeModel(join(work, "model"), {
    "a.safetensors": "aaa",
    "b.bin": "bb",
    "config.json": "{}",
  });
  const res = run(
    ["pin", model, "--lockfile", join(work, "w.lock.json")],
    work,
  );
  assert.equal(res.status, 0, res.stderr);
  const lock = JSON.parse(readFileSync(join(work, "w.lock.json"), "utf8"));
  assert.equal(lock.totalFiles, 2);
  assert.equal(lock.totalBytes, 5);
  assert.deepEqual(
    lock.files.map((f) => f.path),
    ["a.safetensors", "b.bin"],
  );
  assert.equal(lock.files[0].sha256.length, 64);
  rmSync(work, { recursive: true, force: true });
});

test("pin twice is stable except pinnedAt", () => {
  const work = tmpDir();
  const model = makeModel(join(work, "model"), { "a.bin": "aaa" });
  const lockPath = join(work, "w.lock.json");
  run(["pin", model, "--lockfile", lockPath], work);
  const first = JSON.parse(readFileSync(lockPath, "utf8"));
  run(["pin", model, "--lockfile", lockPath], work);
  const second = JSON.parse(readFileSync(lockPath, "utf8"));
  assert.deepEqual(second.files, first.files);
  assert.equal(second.totalFiles, first.totalFiles);
  rmSync(work, { recursive: true, force: true });
});

test("check CLEAN exits 0 and prints the verdict", () => {
  const work = tmpDir();
  const model = makeModel(join(work, "model"), { "a.bin": "aaa" });
  const lockPath = join(work, "w.lock.json");
  run(["pin", model, "--lockfile", lockPath], work);
  const res = run(["check", model, "--lockfile", lockPath], work);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /verdict: CLEAN/);
  assert.match(res.stdout, /0 changed, 0 missing, 0 new/);
  assert.match(res.stdout, /cannot say why/);
  rmSync(work, { recursive: true, force: true });
});

test("check CHANGED exits 1 after one byte flips", () => {
  const work = tmpDir();
  const model = makeModel(join(work, "model"), { "a.bin": "aaa" });
  const lockPath = join(work, "w.lock.json");
  run(["pin", model, "--lockfile", lockPath], work);
  writeFileSync(join(model, "a.bin"), "aab");
  const res = run(["check", model, "--lockfile", lockPath], work);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /verdict: CHANGED/);
  assert.match(res.stdout, /CHANGED\s+a\.bin/);
  rmSync(work, { recursive: true, force: true });
});

test("check MISSING exits 1 after a file is deleted", () => {
  const work = tmpDir();
  const model = makeModel(join(work, "model"), {
    "a.bin": "aaa",
    "b.gguf": "bb",
  });
  const lockPath = join(work, "w.lock.json");
  run(["pin", model, "--lockfile", lockPath], work);
  rmSync(join(model, "b.gguf"));
  const res = run(["check", model, "--lockfile", lockPath], work);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /verdict: MISSING/);
  rmSync(work, { recursive: true, force: true });
});

test("check NEW exits 1 after an untracked weight file appears", () => {
  const work = tmpDir();
  const model = makeModel(join(work, "model"), { "a.bin": "aaa" });
  const lockPath = join(work, "w.lock.json");
  run(["pin", model, "--lockfile", lockPath], work);
  writeFileSync(join(model, "b.onnx"), "new weights");
  const res = run(["check", model, "--lockfile", lockPath], work);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /verdict: NEW/);
  rmSync(work, { recursive: true, force: true });
});

test("diff shows old vs new hashes in a table", () => {
  const work = tmpDir();
  const model = makeModel(join(work, "model"), { "a.bin": "aaa" });
  const lockPath = join(work, "w.lock.json");
  run(["pin", model, "--lockfile", lockPath], work);
  writeFileSync(join(model, "a.bin"), "aab");
  const res = run(["diff", model, "--lockfile", lockPath], work);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /verdict: CHANGED/);
  assert.match(res.stdout, /a\.bin/);
  assert.match(res.stdout, /changed/);
  rmSync(work, { recursive: true, force: true });
});

test("diff on a clean dir prints no differences and exits 0", () => {
  const work = tmpDir();
  const model = makeModel(join(work, "model"), { "a.bin": "aaa" });
  const lockPath = join(work, "w.lock.json");
  run(["pin", model, "--lockfile", lockPath], work);
  const res = run(["diff", model, "--lockfile", lockPath], work);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /no differences/);
  rmSync(work, { recursive: true, force: true });
});

test("check --json returns the structured result with full hashes", () => {
  const work = tmpDir();
  const model = makeModel(join(work, "model"), { "a.bin": "aaa" });
  const lockPath = join(work, "w.lock.json");
  run(["pin", model, "--lockfile", lockPath], work);
  writeFileSync(join(model, "a.bin"), "aab");
  const res = run(["check", model, "--lockfile", lockPath, "--json"], work);
  assert.equal(res.status, 1);
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.verdict, "CHANGED");
  assert.equal(parsed.tool, "weightpin");
  assert.equal(parsed.files[0].status, "changed");
  assert.equal(parsed.files[0].oldSha256.length, 64);
  assert.equal(parsed.files[0].newSha256.length, 64);
  rmSync(work, { recursive: true, force: true });
});

test("check with a missing lockfile exits 2", () => {
  const work = tmpDir();
  const model = makeModel(join(work, "model"), { "a.bin": "aaa" });
  const res = run(
    ["check", model, "--lockfile", join(work, "nope.json")],
    work,
  );
  assert.equal(res.status, 2);
  assert.match(res.stderr, /lockfile not found/);
  rmSync(work, { recursive: true, force: true });
});

test("check with a missing model dir exits 2", () => {
  const work = tmpDir();
  const res = run(
    ["check", join(work, "nope"), "--lockfile", join(work, "w.json")],
    work,
  );
  assert.equal(res.status, 2);
  assert.match(res.stderr, /model dir not found/);
  rmSync(work, { recursive: true, force: true });
});

test("init pins weight files and prints the CI gate snippet", () => {
  const work = tmpDir();
  const model = makeModel(join(work, "model"), { "a.bin": "aaa" });
  const lockPath = join(work, "w.lock.json");
  const res = run(["init", model, "--lockfile", lockPath], work);
  assert.equal(res.status, 0, res.stderr);
  assert.ok(existsSync(lockPath));
  assert.match(res.stdout, /CI gate/);
  assert.match(res.stdout, /weightpin check/);
  const check = run(["check", model, "--lockfile", lockPath], work);
  assert.equal(check.status, 0);
  rmSync(work, { recursive: true, force: true });
});

test("init on an empty dir writes an empty scaffold and still exits 0", () => {
  const work = tmpDir();
  const model = makeModel(join(work, "model"), {});
  const lockPath = join(work, "w.lock.json");
  const res = run(["init", model, "--lockfile", lockPath], work);
  assert.equal(res.status, 0, res.stderr);
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  assert.equal(lock.totalFiles, 0);
  assert.match(res.stdout, /empty lockfile scaffold/);
  rmSync(work, { recursive: true, force: true });
});

test("explain lists topics with no argument and prints a topic", () => {
  const work = tmpDir();
  const list = run(["explain"], work);
  assert.equal(list.status, 0);
  assert.match(list.stdout, /self-rewriting/);
  const limits = run(["explain", "limits"], work);
  assert.equal(limits.status, 0);
  assert.match(limits.stdout, /stays human/);
  const bad = run(["explain", "nope"], work);
  assert.equal(bad.status, 2);
  rmSync(work, { recursive: true, force: true });
});

test("live model: pin and check on the real safetensors file are CLEAN", () => {
  const work = tmpDir();
  const lockPath = join(work, "w.lock.json");
  const pin = run(["pin", LIVE_MODEL, "--lockfile", lockPath], work);
  assert.equal(pin.status, 0, pin.stderr);
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  assert.equal(lock.totalFiles, 1);
  assert.equal(lock.files[0].path, "model.safetensors");
  assert.equal(lock.files[0].sha256, LIVE_SHA256);
  assert.equal(lock.files[0].size, 453864);
  const check = run(["check", LIVE_MODEL, "--lockfile", lockPath], work);
  assert.equal(check.status, 0, check.stdout + check.stderr);
  assert.match(check.stdout, /verdict: CLEAN/);
  rmSync(work, { recursive: true, force: true });
});

test("live model: tampering a copy of the real file is caught", () => {
  const work = tmpDir();
  const copy = join(work, "copy");
  cpSync(LIVE_MODEL, copy, { recursive: true });
  const lockPath = join(work, "w.lock.json");
  run(["pin", copy, "--lockfile", lockPath], work);
  const buf = readFileSync(join(copy, "model.safetensors"));
  buf[buf.length - 1] ^= 0xff;
  writeFileSync(join(copy, "model.safetensors"), buf);
  const check = run(["check", copy, "--lockfile", lockPath], work);
  assert.equal(check.status, 1);
  assert.match(check.stdout, /verdict: CHANGED/);
  rmSync(work, { recursive: true, force: true });
});

test("--help and --version exit 0", () => {
  const work = tmpDir();
  assert.equal(run(["--help"], work).status, 0);
  assert.match(run(["--version"], work).stdout, /weightpin 0\.1\.0/);
  assert.equal(run(["bogus-command"], work).status, 2);
  rmSync(work, { recursive: true, force: true });
});
