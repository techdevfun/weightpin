/**
 * `weightpin explain` - why frozen weights matter, what self-rewriting
 * changes, and the honest limits of a hash. Every claim cites its
 * source and check date; numbers come from the paper abstract itself.
 */

export const EXPLAIN_TOPICS = [
  "frozen",
  "self-rewriting",
  "limits",
  "ci",
  "lockfile",
] as const;
export type ExplainTopic = (typeof EXPLAIN_TOPICS)[number];

const TEXTS: Record<ExplainTopic, string> = {
  frozen: [
    "Why frozen weights matter",
    "",
    "A deployed model is governed as if its weights were frozen: eval",
    "scores are quoted against a pinned version, guardrails are tested",
    "against a fixed checkpoint, change control approves a version",
    "string, and rollback means restoring the old files.",
    "",
    "That only works if the bytes on disk are the bytes that were",
    "approved. A version string is a claim; a hash taken at pin time",
    "and re-checked later is evidence. weightpin is that evidence,",
    "as a one-command check you can run in CI.",
    "",
    "Source: arXiv:2611.21885 (checked 2026-11-21).",
  ].join("\n"),
  "self-rewriting": [
    "Self-rewriting: a model that edits its own weights",
    "",
    'arXiv:2611.21885, "Language Models Can Rewrite Their Own Weights"',
    "(Jiajun Fan et al., submitted 16/11/2026, v2 18/11/2026, checked",
    "2026-11-21): an open 27B model (Qwen3.5-27B), given its own",
    "weights, its graded answers and the ability to run itself,",
    "diagnoses its own failure and rewrites the weights behind it -",
    "no gradients, no training.",
    "",
    "Its own edit makes it 6.6 points more accurate on problems it",
    "never saw (57.2% to 63.8% on 490 held-out problems). Over eight",
    "consecutive sessions its accuracy only rises. It repairs a damaged",
    "copy of itself, without retraining and without ever reading the",
    "original weights, back to over 80% of the original accuracy on",
    "image tasks it never saw.",
    "",
    'Related earlier work: MIT CSAIL, "Sparks of Weight-Space',
    'Programming" (blog post 02/11/2026): a frontier model edits a',
    "much smaller model (Qwen3.5-0.8B), changing 131,072 weights",
    "(0.016%) and moving MATH-500 from 7.9% to 48.1%.",
    "",
    "What changes for operators: if a model can rewrite its own",
    "weights in production, change control, audit trail and rollback",
    "all need rethinking. A hash does not stop a rewrite - it makes",
    "sure somebody notices one happened.",
    "",
    "Source: arXiv:2611.21885 abstract and paper body (checked 2026-11-21).",
  ].join("\n"),
  limits: [
    "Honest limits - what a hash can and cannot tell you",
    "",
    "A hash detects ANY byte change in a weight file. It cannot say",
    "WHY the weights changed, or whether the change is benign.",
    "A deliberate self-rewrite, a bug, a bad deploy and a malicious",
    "edit all look identical to weightpin: CHANGED. That judgement",
    "stays human.",
    "",
    "A hash also cannot tell you:",
    "  - whether the first pin was of good weights (pin from a",
    "    known-good source and record the provenance);",
    "  - whether weights changed only in memory and were never",
    "    written to disk (weightpin checks deployed files);",
    "  - who published the weights (that is provenance, and needs",
    "    signing - see Sigstore model-signing);",
    "  - whether behaviour changed while the weights stayed the",
    "    same (that is behaviour drift - see modeldrift).",
    "",
    "And the lockfile itself is only as trustworthy as its storage:",
    "if an attacker can rewrite weights, they can rewrite the",
    "lockfile too. Commit the lockfile to git, protect it with",
    "review and branch protection, and treat a lockfile change as",
    "a change that needs review.",
    "",
    "Source: weightpin design notes (checked 2026-11-21).",
  ].join("\n"),
  ci: [
    "Gating CI on frozen weights",
    "",
    "1. Pin once, from a known-good source, and commit the lockfile:",
    "     weightpin pin ./models/qwen --lockfile weightpin.lock.json",
    '     git add weightpin.lock.json && git commit -m "Pin model weights"',
    "",
    "2. Check on every deploy and on a schedule:",
    "     weightpin check ./models/qwen --lockfile weightpin.lock.json",
    "",
    "3. The check exits 0 when clean and 1 when any weight file",
    "   changed, went missing, or appeared untracked - so the CI job",
    "   fails the build on drift. Use --json when a later step needs",
    "   to parse the result.",
    "",
    "4. When drift is real and approved, re-pin and commit the new",
    "   lockfile in the same change that approves the new weights.",
    "   Never re-pin silently to make a red build green.",
    "",
    "Source: weightpin README (checked 2026-11-21).",
  ].join("\n"),
  lockfile: [
    "The lockfile (weightpin.lock.json)",
    "",
    "A JSON file you commit to git. It records, per weight file:",
    "the path (relative to the model dir), the full sha256 hash,",
    "and the byte size - plus the pin time (UTC), the tool version,",
    "and totals (file count, total bytes).",
    "",
    "Files are sorted by path. Hashes are lowercase hex, full 64",
    "characters in the file (human tables show the first 12).",
    "Only weight files are hashed: .safetensors, .bin, .pt, .pth,",
    ".gguf, .onnx. Config, tokenizer and documentation files are",
    "ignored. Symlinks are skipped, never followed.",
    "",
    "The lockfile itself is never hashed, so pinning twice in a row",
    "produces the same lockfile (except pinnedAt).",
    "",
    "Source: weightpin README (checked 2026-11-21).",
  ].join("\n"),
};

export function explainTopic(topic: string): string | null {
  if ((EXPLAIN_TOPICS as readonly string[]).includes(topic)) {
    return TEXTS[topic as ExplainTopic];
  }
  return null;
}

export function explainList(): string {
  return [
    "Topics:",
    ...EXPLAIN_TOPICS.map((t) => `  ${t}`),
    "",
    "Usage: weightpin explain <topic>",
  ].join("\n");
}
