#!/usr/bin/env node
/**
 * weightpin - did these deployed model weights change since I pinned them?
 *
 * Commands: pin, check, diff, explain, init. Zero runtime dependencies,
 * 100% offline: pin/check/diff/init only read local files and hash them.
 */
import { existsSync, statSync } from "node:fs";
import { shortHash } from "./hash.js";
import {
  buildLockfile,
  compareToLockfile,
  countByStatus,
  exitForVerdict,
  hashModelDir,
  readLockfile,
  writeLockfile,
  TOOL_VERSION,
  type DiffRow,
  type Lockfile,
} from "./lockfile.js";
import { explainList, explainTopic } from "./explain.js";

const USAGE = [
  "weightpin 0.1.0 - did these deployed weights change since I pinned them?",
  "",
  "Usage:",
  "  weightpin pin <model-dir> [--lockfile <path>] [--json]",
  "  weightpin check <model-dir> [--lockfile <path>] [--json]",
  "  weightpin diff <model-dir> [--lockfile <path>] [--json]",
  "  weightpin explain [topic]",
  "  weightpin init [model-dir] [--lockfile <path>]",
  "  weightpin --help | --version",
  "",
  "Weight files: .safetensors .bin .pt .pth .gguf .onnx",
  "Exit codes: 0 clean/success, 1 drift detected, 2 usage error.",
].join("\n");

const SCOPE_FOOTER =
  "A hash detects any byte change. It cannot say why the weights " +
  "changed or whether the change is benign - that judgement stays human.";

const CI_SNIPPET = [
  "CI gate - add this to your deploy job:",
  "  weightpin check ./models/qwen --lockfile weightpin.lock.json",
  "The check exits 0 when clean and 1 on any drift, so it fails the build.",
].join("\n");

interface Flags {
  lockfile: string;
  json: boolean;
  positional: string[];
}

function parseArgs(argv: string[]): Flags {
  const flags: Flags = {
    lockfile: "weightpin.lock.json",
    json: false,
    positional: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--lockfile") {
      const next = argv[i + 1];
      if (next === undefined) throw new Error("--lockfile needs a path");
      flags.lockfile = next;
      i += 1;
    } else if (arg.startsWith("--lockfile=")) {
      flags.lockfile = arg.slice("--lockfile=".length);
    } else if (arg === "--json") {
      flags.json = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown flag: ${arg}`);
    } else {
      flags.positional.push(arg);
    }
  }
  return flags;
}

function requireModelDir(dir: string | undefined, command: string): string {
  if (dir === undefined) {
    throw new Error(`usage: weightpin ${command} <model-dir>`);
  }
  if (!existsSync(dir)) {
    throw new Error(`model dir not found: ${dir}`);
  }
  let st;
  try {
    st = statSync(dir);
  } catch {
    throw new Error(`cannot read model dir: ${dir}`);
  }
  if (!st.isDirectory()) {
    throw new Error(`not a directory: ${dir}`);
  }
  return dir;
}

function printPinTable(lockfile: Lockfile, lockfilePath: string): void {
  console.log(
    `pinned ${lockfile.totalFiles} weight file(s), ${lockfile.totalBytes} bytes`,
  );
  console.log(`lockfile: ${lockfilePath}`);
  for (const file of lockfile.files) {
    console.log(`  ${file.path}  ${shortHash(file.sha256)}  ${file.size}`);
  }
  console.log(`pinned-at: ${lockfile.pinnedAt}`);
}

function printCheckRows(rows: DiffRow[]): void {
  for (const row of rows) {
    if (row.status === "unchanged") continue;
    const oldHash = row.oldSha256 === null ? "-" : shortHash(row.oldSha256);
    const newHash = row.newSha256 === null ? "-" : shortHash(row.newSha256);
    const oldSize = row.oldSize === null ? "-" : String(row.oldSize);
    const newSize = row.newSize === null ? "-" : String(row.newSize);
    console.log(
      `  ${row.status.toUpperCase().padEnd(7)} ${row.path}  ${oldHash} -> ${newHash}  ${oldSize} -> ${newSize}`,
    );
  }
}

function printSummary(rows: DiffRow[]): void {
  const counts = countByStatus(rows);
  console.log(
    `summary: ${counts.unchanged} unchanged, ${counts.changed} changed, ` +
      `${counts.missing} missing, ${counts.new} new`,
  );
}

async function cmdPin(
  dir: string,
  lockfilePath: string,
  json: boolean,
): Promise<number> {
  const files = await hashModelDir(dir);
  const lockfile = buildLockfile(dir, files);
  try {
    writeLockfile(lockfilePath, lockfile);
  } catch {
    throw new Error(`cannot write lockfile: ${lockfilePath}`);
  }
  if (json) {
    console.log(
      JSON.stringify({ ...lockfile, lockfile: lockfilePath }, null, 2),
    );
  } else {
    printPinTable(lockfile, lockfilePath);
    if (files.length === 0) {
      console.log("warning: no weight files found in the model dir");
    }
  }
  return 0;
}

async function cmdCheck(
  dir: string,
  lockfilePath: string,
  json: boolean,
): Promise<number> {
  const lockfile = readLockfile(lockfilePath);
  const current = await hashModelDir(dir);
  const { verdict, rows } = compareToLockfile(lockfile, current);
  if (json) {
    console.log(
      JSON.stringify(
        {
          tool: "weightpin",
          version: TOOL_VERSION,
          checkedAt: new Date().toISOString(),
          modelDir: dir,
          lockfile: lockfilePath,
          verdict,
          files: rows.map((r) => ({
            path: r.path,
            status: r.status,
            oldSha256: r.oldSha256,
            newSha256: r.newSha256,
            oldSize: r.oldSize,
            newSize: r.newSize,
          })),
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`verdict: ${verdict}`);
    printCheckRows(rows);
    printSummary(rows);
    console.log(SCOPE_FOOTER);
  }
  return exitForVerdict(verdict);
}

async function cmdDiff(
  dir: string,
  lockfilePath: string,
  json: boolean,
): Promise<number> {
  const lockfile = readLockfile(lockfilePath);
  const current = await hashModelDir(dir);
  const { verdict, rows } = compareToLockfile(lockfile, current);
  const changed = rows.filter((r) => r.status !== "unchanged");
  if (json) {
    console.log(
      JSON.stringify(
        {
          tool: "weightpin",
          version: TOOL_VERSION,
          checkedAt: new Date().toISOString(),
          modelDir: dir,
          lockfile: lockfilePath,
          verdict,
          files: changed.map((r) => ({
            path: r.path,
            status: r.status,
            oldSha256: r.oldSha256,
            newSha256: r.newSha256,
            oldSize: r.oldSize,
            newSize: r.newSize,
          })),
        },
        null,
        2,
      ),
    );
  } else if (changed.length === 0) {
    console.log("verdict: CLEAN");
    console.log("no differences");
    printSummary(rows);
    console.log(SCOPE_FOOTER);
  } else {
    console.log(`verdict: ${verdict}`);
    console.log("path  old-sha256  new-sha256  old-size  new-size  status");
    for (const row of changed) {
      const oldHash = row.oldSha256 === null ? "-" : shortHash(row.oldSha256);
      const newHash = row.newSha256 === null ? "-" : shortHash(row.newSha256);
      const oldSize = row.oldSize === null ? "-" : String(row.oldSize);
      const newSize = row.newSize === null ? "-" : String(row.newSize);
      console.log(
        `${row.path}  ${oldHash}  ${newHash}  ${oldSize}  ${newSize}  ${row.status}`,
      );
    }
    printSummary(rows);
    console.log(SCOPE_FOOTER);
  }
  return exitForVerdict(verdict);
}

async function cmdInit(
  dir: string | undefined,
  lockfilePath: string,
): Promise<number> {
  const target = dir ?? ".";
  requireModelDir(target, "init");
  const files = await hashModelDir(target);
  const lockfile = buildLockfile(target, files);
  try {
    writeLockfile(lockfilePath, lockfile);
  } catch {
    throw new Error(`cannot write lockfile: ${lockfilePath}`);
  }
  if (files.length === 0) {
    console.log(
      `no weight files in ${target} - wrote an empty lockfile scaffold`,
    );
  } else {
    console.log(`pinned ${files.length} weight file(s) from ${target}`);
  }
  console.log(`lockfile: ${lockfilePath}`);
  console.log("");
  console.log(CI_SNIPPET);
  return 0;
}

async function main(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    console.log(USAGE);
    return 0;
  }
  if (argv[0] === "--version" || argv[0] === "-V") {
    console.log(`weightpin ${TOOL_VERSION}`);
    return 0;
  }
  const command = argv[0];
  const rest = argv.slice(1);
  try {
    if (command === "explain") {
      const topic = rest[0];
      if (topic === undefined) {
        console.log(explainList());
        return 0;
      }
      const text = explainTopic(topic);
      if (text === null) {
        throw new Error(`unknown topic: ${topic}\n${explainList()}`);
      }
      console.log(text);
      return 0;
    }
    const flags = parseArgs(rest);
    if (command === "pin") {
      const dir = requireModelDir(flags.positional[0], "pin");
      return await cmdPin(dir, flags.lockfile, flags.json);
    }
    if (command === "check") {
      const dir = requireModelDir(flags.positional[0], "check");
      return await cmdCheck(dir, flags.lockfile, flags.json);
    }
    if (command === "diff") {
      const dir = requireModelDir(flags.positional[0], "diff");
      return await cmdDiff(dir, flags.lockfile, flags.json);
    }
    if (command === "init") {
      return await cmdInit(flags.positional[0], flags.lockfile);
    }
    throw new Error(`unknown command: ${command}\n${USAGE}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`error: ${message}`);
    return 2;
  }
}

const code = await main(process.argv.slice(2));
process.exit(code);
