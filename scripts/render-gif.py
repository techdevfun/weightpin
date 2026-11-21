#!/usr/bin/env python3
"""Render demo/transcript.txt as a terminal-typing GIF.

The transcript is generated from real CLI runs (scripts/capture-demo.sh);
this script only renders it, never edits the content.

Frames are written as PNGs to a temp dir and encoded with ffmpeg
(streaming, low memory) instead of holding every frame in RAM.
"""
from PIL import Image, ImageDraw, ImageFont
import os
import shutil
import subprocess
import sys
import textwrap

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FRAMES_DIR = "/tmp/weightpin-gif-frames"

W = 1240
BG = (18, 18, 24)
FG = (220, 220, 220)
DIM = (150, 150, 160)
GREEN = (120, 220, 130)
YELLOW = (235, 200, 100)
RED = (240, 110, 110)
CYAN = (120, 200, 230)

font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 12)
bold = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", 12)
LINE_H = 16

lines = open(os.path.join(ROOT, "demo", "transcript.txt")).read().splitlines()
# Wrap over-long lines at word boundaries for display only: the
# transcript itself is unchanged, but a long remediation line would
# otherwise run off the right edge of the 1240px canvas.
# Wrap width 100 chars at font 12.
display_lines: list[str] = []
for _raw in lines:
    if len(_raw) <= 100:
        display_lines.append(_raw)
    else:
        display_lines.extend(
            textwrap.wrap(_raw, width=100, subsequent_indent="  ", break_on_hyphens=False)
        )
lines = display_lines
# Fixed-height scrolling terminal viewport: the transcript is long,
# so a full-height canvas OOMs the encoder. Show the last VIEW_LINES
# lines like a real terminal scrolling; content is unchanged.
VIEW_LINES = 38
H = 14 + VIEW_LINES * LINE_H + 44


def color_for(line: str):
    if line.startswith("$"):
        return GREEN
    if line.startswith("#"):
        return DIM
    if line.startswith("summary:"):
        return CYAN
    if "CHANGED" in line:
        return RED
    if "MISSING" in line or "NEW" in line:
        return YELLOW
    if line.startswith("verdict: CLEAN"):
        return GREEN
    if line.startswith("verdict: CHANGED"):
        return RED
    if line.startswith("check: FAIL"):
        return RED
    if line.startswith("check: PASS"):
        return GREEN
    if line.startswith("exit: 1"):
        return RED
    if line.startswith("exit: 0"):
        return GREEN
    if line.startswith("  fix:"):
        return CYAN
    return FG


def render(canvas_tmp):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    y = 14
    for text, color in canvas_tmp[-VIEW_LINES:]:
        f = bold if text.startswith("$") else font
        d.text((14, y), text, font=f, fill=color)
        y += LINE_H
        if y > H - 30:
            break
    d.rectangle([14, H - 24, 22, H - 12], fill=GREEN)
    return img


shutil.rmtree(FRAMES_DIR, ignore_errors=True)
os.makedirs(FRAMES_DIR)

n = 0


def save(img):
    global n
    n += 1
    img.save(os.path.join(FRAMES_DIR, f"frame{n:04d}.png"))


# Title card (3s at 20 fps).
title = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(title)
d.text((14, 120), "weightpin - did these weights change since I pinned them?", font=bold, fill=GREEN)
d.text((14, 170), "1. pin: hash every weight file into a lockfile", font=font, fill=FG)
d.text((14, 200), "   (.safetensors / .bin / .pt / .gguf / .onnx, sha256)", font=font, fill=FG)
d.text((14, 230), "2. check: re-hash against the lockfile - CLEAN or CHANGED", font=font, fill=FG)
d.text((14, 260), "3. diff: old vs new hash per file, exit 1 on drift", font=font, fill=FG)
d.text((14, 290), "4. explain: why frozen weights matter + honest limits", font=font, fill=FG)
d.text((14, 320), "5. init: scaffold a lockfile + print the CI gate", font=font, fill=FG)
d.text((14, 350), "zero-dep CLI - read-only, local files only, no network", font=font, fill=DIM)
d.text((14, 380), "a hash detects any byte change - it cannot say why", font=font, fill=DIM)
for _ in range(60):
    save(title.copy())


# Extra hold frames so a first-time viewer can actually read the
# verdict lines and the gate result. Total target is ~25-30 s at 20 fps.
def extra_holds(line: str) -> int:
    if line.startswith("summary:"):
        return 10
    if line.startswith("verdict:"):
        return 15
    if line.startswith("exit:"):
        return 5
    if line.startswith("  changed:"):
        return 8
    return 0


canvas: list[tuple[str, tuple]] = []
command_count = 0
for line in lines:
    color = color_for(line)
    # Clear the screen at each new command (like a real `clear` between
    # demo steps). Without this the 38-line viewport scrolls on nearly
    # every frame and the GIF balloons: a scrolling frame stores the
    # whole canvas, an appending frame stores only the new lines.
    if line.startswith("$") and command_count >= 1:
        canvas = []
    if line.startswith("$"):
        command_count += 1
    # One typing step per line + two holds: ~3 frames/line keeps the
    # total near 25-30 s at 20 fps without holding frames in memory.
    half = line[: max(1, len(line) // 2)]
    save(render(canvas + [(half, color)]))
    save(render(canvas + [(line, color)]))
    save(render(canvas + [(line, color)]))
    canvas.append((line, color))
    for _ in range(extra_holds(line)):
        save(render(canvas))

out = os.path.join(ROOT, "demo", "weightpin-demo.gif")
# Hold the final frame so the closing SAFE verdict stays readable.
for _ in range(40):
    save(render(canvas))
cmd = [
    "ffmpeg", "-y", "-v", "error",
    "-framerate", "20", "-i", os.path.join(FRAMES_DIR, "frame%04d.png"),
    "-vf", "split[s0][s1];[s0]palettegen=max_colors=256[p];[s1][p]paletteuse",
    out,
]
res = subprocess.run(cmd)
if res.returncode != 0:
    print("ffmpeg failed", file=sys.stderr)
    sys.exit(1)
shutil.rmtree(FRAMES_DIR, ignore_errors=True)
size = os.path.getsize(out)
print(f"GIF written: {out} ({n} frames, {n * 50 / 1000:.1f}s, {size} bytes)")
