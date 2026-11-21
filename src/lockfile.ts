/**
 * The weightpin lockfile: what a pin records, how it is read back,
 * and how a fresh scan compares against it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  discoverWeightFiles,
  sha256File,
  type DiscoveredFile,
} from "./hash.js";

export const LOCKFILE_FORMAT = 1;
export const TOOL_VERSION = "0.1.0";

export interface LockedFile {
  path: string;
  sha256: string;
  size: number;
}

export interface Lockfile {
  format: number;
  tool: string;
  version: string;
  modelDir: string;
  pinnedAt: string;
  algorithm: string;
  files: LockedFile[];
  totalFiles: number;
  totalBytes: number;
}

export interface HashedFile extends DiscoveredFile {
  sha256: string;
}

/** Hash every weight file in `dir`. Files come back sorted by path. */
export async function hashModelDir(dir: string): Promise<HashedFile[]> {
  const discovered = discoverWeightFiles(dir);
  const hashed: HashedFile[] = [];
  for (const file of discovered) {
    hashed.push({ ...file, sha256: await sha256File(file.absPath) });
  }
  return hashed;
}

export function buildLockfile(modelDir: string, files: HashedFile[]): Lockfile {
  const sorted = [...files].sort((a, b) =>
    a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0,
  );
  const locked: LockedFile[] = sorted.map((f) => ({
    path: f.relPath,
    sha256: f.sha256,
    size: f.size,
  }));
  return {
    format: LOCKFILE_FORMAT,
    tool: "weightpin",
    version: TOOL_VERSION,
    modelDir,
    pinnedAt: new Date().toISOString(),
    algorithm: "sha256",
    files: locked,
    totalFiles: locked.length,
    totalBytes: locked.reduce((sum, f) => sum + f.size, 0),
  };
}

export function writeLockfile(path: string, lockfile: Lockfile): void {
  writeFileSync(path, JSON.stringify(lockfile, null, 2) + "\n", "utf8");
}

/** Read and validate a lockfile. Throws an Error with a plain message. */
export function readLockfile(path: string): Lockfile {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(`lockfile not found: ${path}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`lockfile is not valid JSON: ${path}`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`lockfile is not an object: ${path}`);
  }
  const obj = parsed as Record<string, unknown>;
  if (obj["format"] !== LOCKFILE_FORMAT) {
    throw new Error(
      `unsupported lockfile format: ${String(obj["format"])} (expected ${LOCKFILE_FORMAT})`,
    );
  }
  if (obj["tool"] !== "weightpin") {
    throw new Error(`not a weightpin lockfile: ${path}`);
  }
  if (!Array.isArray(obj["files"])) {
    throw new Error(`lockfile has no files array: ${path}`);
  }
  for (const entry of obj["files"] as unknown[]) {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`lockfile has a bad file entry: ${path}`);
    }
    const e = entry as Record<string, unknown>;
    if (
      typeof e["path"] !== "string" ||
      typeof e["sha256"] !== "string" ||
      typeof e["size"] !== "number"
    ) {
      throw new Error(`lockfile has a bad file entry: ${path}`);
    }
  }
  return parsed as Lockfile;
}

export type FileStatus = "unchanged" | "changed" | "missing" | "new";

export interface DiffRow {
  path: string;
  status: FileStatus;
  oldSha256: string | null;
  newSha256: string | null;
  oldSize: number | null;
  newSize: number | null;
}

export type Verdict = "CLEAN" | "CHANGED" | "MISSING" | "NEW";

/** Compare a fresh hash list against a lockfile. Rows sorted by path. */
export function compareToLockfile(
  lockfile: Lockfile,
  current: HashedFile[],
): { verdict: Verdict; rows: DiffRow[] } {
  const lockedByPath = new Map(lockfile.files.map((f) => [f.path, f]));
  const currentByPath = new Map(current.map((f) => [f.relPath, f]));
  const rows: DiffRow[] = [];
  for (const locked of lockfile.files) {
    const now = currentByPath.get(locked.path);
    if (now === undefined) {
      rows.push({
        path: locked.path,
        status: "missing",
        oldSha256: locked.sha256,
        newSha256: null,
        oldSize: locked.size,
        newSize: null,
      });
    } else if (now.sha256 !== locked.sha256 || now.size !== locked.size) {
      rows.push({
        path: locked.path,
        status: "changed",
        oldSha256: locked.sha256,
        newSha256: now.sha256,
        oldSize: locked.size,
        newSize: now.size,
      });
    } else {
      rows.push({
        path: locked.path,
        status: "unchanged",
        oldSha256: locked.sha256,
        newSha256: now.sha256,
        oldSize: locked.size,
        newSize: now.size,
      });
    }
  }
  for (const file of current) {
    if (!lockedByPath.has(file.relPath)) {
      rows.push({
        path: file.relPath,
        status: "new",
        oldSha256: null,
        newSha256: file.sha256,
        oldSize: null,
        newSize: file.size,
      });
    }
  }
  rows.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  let verdict: Verdict = "CLEAN";
  if (rows.some((r) => r.status === "changed")) verdict = "CHANGED";
  else if (rows.some((r) => r.status === "missing")) verdict = "MISSING";
  else if (rows.some((r) => r.status === "new")) verdict = "NEW";
  return { verdict, rows };
}

export function countByStatus(rows: DiffRow[]): Record<FileStatus, number> {
  const counts: Record<FileStatus, number> = {
    unchanged: 0,
    changed: 0,
    missing: 0,
    new: 0,
  };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

/** Exit code for a verdict: 0 clean, 1 drift, 2 usage error (separate). */
export function exitForVerdict(verdict: Verdict): number {
  return verdict === "CLEAN" ? 0 : 1;
}
