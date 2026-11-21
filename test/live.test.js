/**
 * Live smoke tests for weightpin. Every test soft-skips when the
 * network is unavailable - a network failure must never fail CI.
 * The authoritative name checks (npm 404 + org repo 404 via PAT-A)
 * were done at build time and are recorded in the build note.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIVE_FILE = join(ROOT, "examples", "live-model", "model.safetensors");
const LIVE_SHA256 =
  "8111d5afb0715dbf5a31396d31432cb56370ba23f6650a035ea0fc8a20b4e500";

async function head(url) {
  const res = await fetch(url, {
    method: "HEAD",
    signal: AbortSignal.timeout(10000),
  });
  return res.status;
}

test("live: the shipped safetensors file still matches its recorded hash", () => {
  const hash = createHash("sha256")
    .update(readFileSync(LIVE_FILE))
    .digest("hex");
  assert.equal(hash, LIVE_SHA256);
  assert.equal(readFileSync(LIVE_FILE).length, 453864);
});

test("live: npm weightpin is still unclaimed (404)", async (t) => {
  let status;
  try {
    status = await head("https://registry.npmjs.org/weightpin");
  } catch {
    t.skip("network unavailable");
    return;
  }
  assert.equal(status, 404);
});

test("live: GitHub org repo techdevfun/weightpin is still unclaimed (404)", async (t) => {
  let status;
  try {
    const res = await fetch(
      "https://api.github.com/repos/techdevfun/weightpin",
      {
        signal: AbortSignal.timeout(10000),
      },
    );
    status = res.status;
  } catch {
    t.skip("network unavailable");
    return;
  }
  if (status === 403) {
    t.skip("GitHub API rate limit on unauthenticated request");
    return;
  }
  assert.equal(status, 404);
});

test("live: arXiv abstract for the self-rewriting paper returns 200", async (t) => {
  let status;
  try {
    status = await head("https://arxiv.org/abs/2611.21885");
  } catch {
    t.skip("network unavailable");
    return;
  }
  assert.equal(status, 200);
});

test("live: Hugging Face source file for the live fixture is still reachable", async (t) => {
  let status;
  try {
    status = await head(
      "https://huggingface.co/hf-internal-testing/tiny-random-gpt2/resolve/main/model.safetensors",
    );
  } catch {
    t.skip("network unavailable");
    return;
  }
  assert.ok(status === 200 || status === 302, `unexpected status ${status}`);
});
