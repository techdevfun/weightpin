#!/usr/bin/env bash
# Capture the demo transcript from the REAL CLI (no hand-edited output).
# The live-model dir holds a REAL safetensors file downloaded from
# Hugging Face on 2026-11-21 (see examples/live-model/README.md).
# The tamper step copies it to /tmp and flips one byte in the copy;
# the shipped file is never modified.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRATCH=/tmp/weightpin-demo
BIN="$SCRATCH/bin"
rm -rf "$SCRATCH"
mkdir -p "$BIN" "$ROOT/demo"
ln -sf "$ROOT/dist/cli.js" "$BIN/weightpin"
chmod +x "$ROOT/dist/cli.js"
export PATH="$BIN:$PATH"

LIVE="$SCRATCH/live-model"
cp -r "$ROOT/examples/live-model" "$LIVE"
TAMPERED="$SCRATCH/model-tampered"
cp -r "$LIVE" "$TAMPERED"
python3 -c "p='$TAMPERED/model.safetensors'; d=bytearray(open(p,'rb').read()); d[-1]^=0xff; open(p,'wb').write(d)"
FRESH="$SCRATCH/fresh-model"
cp -r "$ROOT/examples/demo-model" "$FRESH"

OUT="$ROOT/demo/transcript.txt"
cd "$SCRATCH"
{
  echo "# weightpin demo - real CLI output"
  echo "# (live-model is the REAL tiny GPT-2 safetensors file from"
  echo "#  Hugging Face, pulled 2026-11-21; the tampered copy is a"
  echo "#  copy of it with one byte flipped; the demo-model files"
  echo "#  are synthetic fixtures - see examples/*/README.md)"
  echo ""
  echo "$ weightpin pin live-model --lockfile demo.lock.json"
  weightpin pin live-model --lockfile demo.lock.json || echo "exit: $?"
  echo ""
  echo "$ weightpin check live-model --lockfile demo.lock.json"
  weightpin check live-model --lockfile demo.lock.json || echo "exit: $?"
  echo ""
  echo "# Flip one byte in a COPY of the real weights and check again"
  echo "$ weightpin check model-tampered --lockfile demo.lock.json"
  weightpin check model-tampered --lockfile demo.lock.json || echo "exit: $?"
  echo ""
  echo "$ weightpin diff model-tampered --lockfile demo.lock.json"
  weightpin diff model-tampered --lockfile demo.lock.json || echo "exit: $?"
  echo ""
  echo "$ weightpin explain limits"
  weightpin explain limits
  echo ""
  echo "$ weightpin init fresh-model --lockfile fresh.lock.json"
  weightpin init fresh-model --lockfile fresh.lock.json || echo "exit: $?"
} > "$OUT" 2>&1

echo "transcript written: $OUT ($(wc -l < "$OUT") lines)"
