/**
 * Unit tests for weightpin (run after `npm run build`).
 * Pure logic: hashing, discovery, lockfile round-trip, verdicts,
 * diff rows, explain topics. No network, no CLI spawn.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discoverWeightFiles,
  isWeightFile,
  sha256File,
  shortHash,
} from "../dist/hash.js";
import {
  buildLockfile,
  compareToLockfile,
  countByStatus,
  exitForVerdict,
  readLockfile,
  writeLockfile,
  LOCKFILE_FORMAT,
} from "../dist/lockfile.js";
import { explainList, explainTopic, EXPLAIN_TOPICS } from "../dist/explain.js";

const LIVE_SHA256 =
  "8111d5afb0715dbf5a31396d31432cb56370ba23f6650a035ea0fc8a20b4e500";

function tmpDir() {
  return mkdtempSync(join(tmpdir(), "weightpin-unit-"));
}

function hashed(relPath, sha256, size) {
  return { relPath, absPath: `/tmp/${relPath}`, size, sha256 };
}

test("sha256File: empty file hashes to the known empty sha256", async () => {
  const dir = tmpDir();
  const file = join(dir, "empty.bin");
  writeFileSync(file, "");
  const hash = await sha256File(file);
  assert.equal(hash, createHash("sha256").update("").digest("hex"));
  assert.equal(
    hash,
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  rmSync(dir, { recursive: true, force: true });
});

test("sha256File: 'abc' hashes to the known value", async () => {
  const dir = tmpDir();
  const file = join(dir, "abc.bin");
  writeFileSync(file, "abc");
  assert.equal(
    await sha256File(file),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  rmSync(dir, { recursive: true, force: true });
});

test("sha256File: 1 MB of deterministic bytes hashes stably", async () => {
  const dir = tmpDir();
  const file = join(dir, "big.gguf");
  const buf = Buffer.alloc(1024 * 1024, 0xab);
  writeFileSync(file, buf);
  const first = await sha256File(file);
  const second = await sha256File(file);
  assert.equal(first, second);
  assert.equal(first.length, 64);
  rmSync(dir, { recursive: true, force: true });
});

test("shortHash truncates to 12 chars", () => {
  assert.equal(shortHash(LIVE_SHA256), "8111d5afb071");
  assert.equal(shortHash("a".repeat(64)).length, 12);
});

test("isWeightFile accepts the five families, case-insensitively", () => {
  for (const name of [
    "a.safetensors",
    "b.bin",
    "c.pt",
    "d.pth",
    "e.gguf",
    "f.onnx",
  ]) {
    assert.equal(isWeightFile(name), true, name);
  }
  assert.equal(isWeightFile("g.SAFETENSORS"), true);
  assert.equal(isWeightFile("h.Bin"), true);
});

test("isWeightFile rejects non-weight files", () => {
  for (const name of [
    "config.json",
    "tokenizer.json",
    "README.md",
    "model",
    "a.txt",
    "a.safetensors.bak",
  ]) {
    assert.equal(isWeightFile(name), false, name);
  }
});

test("discoverWeightFiles: finds all five extensions, sorted, recursive", () => {
  const dir = tmpDir();
  mkdirSync(join(dir, "shard"));
  writeFileSync(join(dir, "b.bin"), "b");
  writeFileSync(join(dir, "a.safetensors"), "a");
  writeFileSync(join(dir, "shard", "c.gguf"), "c");
  writeFileSync(join(dir, "shard", "d.onnx"), "d");
  writeFileSync(join(dir, "e.pt"), "e");
  writeFileSync(join(dir, "config.json"), "{}");
  const found = discoverWeightFiles(dir);
  assert.deepEqual(
    found.map((f) => f.relPath),
    ["a.safetensors", "b.bin", "e.pt", "shard/c.gguf", "shard/d.onnx"],
  );
  assert.equal(found[0].size, 1);
  rmSync(dir, { recursive: true, force: true });
});

test("discoverWeightFiles: skips hidden dirs and symlinks", () => {
  const dir = tmpDir();
  mkdirSync(join(dir, ".hidden"));
  writeFileSync(join(dir, ".hidden", "x.bin"), "x");
  writeFileSync(join(dir, "real.bin"), "r");
  const target = join(dir, "target.bin");
  writeFileSync(target, "t");
  symlinkSync(target, join(dir, "link.bin"));
  const found = discoverWeightFiles(dir);
  assert.deepEqual(
    found.map((f) => f.relPath),
    ["real.bin", "target.bin"],
  );
  rmSync(dir, { recursive: true, force: true });
});

test("discoverWeightFiles: empty dir returns an empty list", () => {
  const dir = tmpDir();
  assert.deepEqual(discoverWeightFiles(dir), []);
  rmSync(dir, { recursive: true, force: true });
});

test("buildLockfile: sorts files, totals, and stamps metadata", () => {
  const files = [
    hashed("b.bin", "b".repeat(64), 20),
    hashed("a.safetensors", "a".repeat(64), 10),
  ];
  const lock = buildLockfile("models/qwen", files);
  assert.equal(lock.format, LOCKFILE_FORMAT);
  assert.equal(lock.tool, "weightpin");
  assert.equal(lock.version, "0.1.0");
  assert.equal(lock.algorithm, "sha256");
  assert.equal(lock.modelDir, "models/qwen");
  assert.equal(lock.totalFiles, 2);
  assert.equal(lock.totalBytes, 30);
  assert.deepEqual(
    lock.files.map((f) => f.path),
    ["a.safetensors", "b.bin"],
  );
  assert.ok(!Number.isNaN(Date.parse(lock.pinnedAt)));
});

test("lockfile round-trip: write then read returns the same data", () => {
  const dir = tmpDir();
  const lock = buildLockfile("m", [hashed("a.bin", "c".repeat(64), 5)]);
  const path = join(dir, "weightpin.lock.json");
  writeLockfile(path, lock);
  const back = readLockfile(path);
  assert.deepEqual(back.files, lock.files);
  assert.equal(back.totalFiles, 1);
  assert.equal(back.totalBytes, 5);
  rmSync(dir, { recursive: true, force: true });
});

test("readLockfile: missing file throws a plain error", () => {
  assert.throws(
    () => readLockfile("/tmp/weightpin-no-such-lock.json"),
    /lockfile not found/,
  );
});

test("readLockfile: bad JSON throws", () => {
  const dir = tmpDir();
  const path = join(dir, "bad.json");
  writeFileSync(path, "{not json");
  assert.throws(() => readLockfile(path), /not valid JSON/);
  rmSync(dir, { recursive: true, force: true });
});

test("readLockfile: wrong format version throws", () => {
  const dir = tmpDir();
  const path = join(dir, "v2.json");
  writeFileSync(
    path,
    JSON.stringify({ format: 99, tool: "weightpin", files: [] }),
  );
  assert.throws(() => readLockfile(path), /unsupported lockfile format/);
  rmSync(dir, { recursive: true, force: true });
});

test("readLockfile: wrong tool name throws", () => {
  const dir = tmpDir();
  const path = join(dir, "other.json");
  writeFileSync(path, JSON.stringify({ format: 1, tool: "other", files: [] }));
  assert.throws(() => readLockfile(path), /not a weightpin lockfile/);
  rmSync(dir, { recursive: true, force: true });
});

test("readLockfile: bad file entry throws", () => {
  const dir = tmpDir();
  const path = join(dir, "badentry.json");
  writeFileSync(
    path,
    JSON.stringify({
      format: 1,
      tool: "weightpin",
      files: [{ path: "a.bin" }],
    }),
  );
  assert.throws(() => readLockfile(path), /bad file entry/);
  rmSync(dir, { recursive: true, force: true });
});

test("compareToLockfile: identical files give CLEAN", () => {
  const lock = buildLockfile("m", [hashed("a.bin", "a".repeat(64), 10)]);
  const { verdict, rows } = compareToLockfile(lock, [
    hashed("a.bin", "a".repeat(64), 10),
  ]);
  assert.equal(verdict, "CLEAN");
  assert.equal(rows[0].status, "unchanged");
  assert.equal(exitForVerdict(verdict), 0);
});

test("compareToLockfile: a changed hash gives CHANGED", () => {
  const lock = buildLockfile("m", [hashed("a.bin", "a".repeat(64), 10)]);
  const { verdict, rows } = compareToLockfile(lock, [
    hashed("a.bin", "b".repeat(64), 10),
  ]);
  assert.equal(verdict, "CHANGED");
  assert.equal(rows[0].status, "changed");
  assert.equal(rows[0].oldSha256, "a".repeat(64));
  assert.equal(rows[0].newSha256, "b".repeat(64));
  assert.equal(exitForVerdict(verdict), 1);
});

test("compareToLockfile: a missing file gives MISSING", () => {
  const lock = buildLockfile("m", [hashed("a.bin", "a".repeat(64), 10)]);
  const { verdict, rows } = compareToLockfile(lock, []);
  assert.equal(verdict, "MISSING");
  assert.equal(rows[0].status, "missing");
  assert.equal(rows[0].newSha256, null);
});

test("compareToLockfile: an untracked file gives NEW", () => {
  const lock = buildLockfile("m", [hashed("a.bin", "a".repeat(64), 10)]);
  const { verdict, rows } = compareToLockfile(lock, [
    hashed("a.bin", "a".repeat(64), 10),
    hashed("b.bin", "b".repeat(64), 5),
  ]);
  assert.equal(verdict, "NEW");
  assert.equal(rows.find((r) => r.path === "b.bin").status, "new");
  assert.equal(rows.find((r) => r.path === "b.bin").oldSha256, null);
});

test("compareToLockfile: precedence is CHANGED over MISSING over NEW", () => {
  const lock = buildLockfile("m", [
    hashed("a.bin", "a".repeat(64), 10),
    hashed("b.bin", "b".repeat(64), 10),
  ]);
  const { verdict } = compareToLockfile(lock, [
    hashed("a.bin", "c".repeat(64), 10),
    hashed("c.bin", "d".repeat(64), 1),
  ]);
  assert.equal(verdict, "CHANGED");
  const lock2 = buildLockfile("m", [hashed("a.bin", "a".repeat(64), 10)]);
  const second = compareToLockfile(lock2, [hashed("b.bin", "b".repeat(64), 1)]);
  assert.equal(second.verdict, "MISSING");
});

test("compareToLockfile: empty lockfile and empty dir are CLEAN", () => {
  const lock = buildLockfile("m", []);
  const { verdict, rows } = compareToLockfile(lock, []);
  assert.equal(verdict, "CLEAN");
  assert.deepEqual(rows, []);
});

test("countByStatus counts each status once", () => {
  const lock = buildLockfile("m", [
    hashed("a.bin", "a".repeat(64), 10),
    hashed("b.bin", "b".repeat(64), 10),
  ]);
  const { rows } = compareToLockfile(lock, [
    hashed("a.bin", "c".repeat(64), 10),
  ]);
  const counts = countByStatus(rows);
  assert.deepEqual(counts, { unchanged: 0, changed: 1, missing: 1, new: 0 });
});

test("explain: all five topics return text, unknown returns null", () => {
  assert.equal(EXPLAIN_TOPICS.length, 5);
  for (const topic of EXPLAIN_TOPICS) {
    const text = explainTopic(topic);
    assert.ok(typeof text === "string" && text.length > 100, topic);
  }
  assert.equal(explainTopic("nope"), null);
  assert.ok(explainList().includes("self-rewriting"));
});

test("explain self-rewriting cites the paper and the verified numbers", () => {
  const text = explainTopic("self-rewriting");
  assert.ok(text.includes("arXiv:2611.21885"));
  assert.ok(text.includes("6.6 points"));
  assert.ok(text.includes("57.2% to 63.8%"));
  assert.ok(text.includes("490 held-out problems"));
});

test("explain limits states the honest limit plainly", () => {
  const text = explainTopic("limits");
  assert.ok(text.includes("cannot say"));
  assert.ok(text.includes("WHY"));
  assert.ok(text.includes("stays human"));
});
