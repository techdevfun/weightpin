/**
 * Weight-file discovery and streaming sha256 hashing.
 * Read-only: this module never writes, never follows symlinks,
 * and never makes a network call.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdirSync, lstatSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Weight-file extensions hashed by weightpin (case-insensitive). */
export const WEIGHT_EXTENSIONS = new Set([
  ".safetensors",
  ".bin",
  ".pt",
  ".pth",
  ".gguf",
  ".onnx",
]);

export function isWeightFile(name: string): boolean {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return false;
  return WEIGHT_EXTENSIONS.has(lower.slice(dot));
}

export interface DiscoveredFile {
  /** Path relative to the model dir, with `/` separators. */
  relPath: string;
  /** Absolute path on disk. */
  absPath: string;
  size: number;
}

/**
 * Recursively list weight files under `dir`, sorted by relative path.
 * Hidden entries (starting with `.`) and symlinks are skipped.
 */
export function discoverWeightFiles(dir: string): DiscoveredFile[] {
  const found: DiscoveredFile[] = [];
  const walk = (current: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const abs = join(current, entry);
      let st;
      try {
        st = lstatSync(abs);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        walk(abs);
      } else if (st.isFile() && isWeightFile(entry)) {
        found.push({
          relPath: relative(dir, abs).split(sep).join("/"),
          absPath: abs,
          size: st.size,
        });
      }
    }
  };
  walk(dir);
  found.sort((a, b) =>
    a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0,
  );
  return found;
}

/** Stream a file through sha256. Constant memory, any file size. */
export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/** Truncate a hash for human tables (12 chars, like a short git sha). */
export function shortHash(sha256: string): string {
  return sha256.slice(0, 12);
}
