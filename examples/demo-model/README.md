# Demo model fixture - synthetic weight files

Small synthetic weight files used by the demo and the end-to-end
tests. They are NOT real model weights: each file is a few hundred
bytes of deterministic text, named with a real weight extension so
the CLI treats it as a weight file.

- `weights-a.safetensors` - pretend safetensors shard
- `weights-b.bin` - pretend PyTorch binary
- `weights-c.pt` - pretend PyTorch checkpoint
- `weights-d.gguf` - pretend GGUF file
- `weights-e.onnx` - pretend ONNX file
- `notes.txt` - NOT a weight file; weightpin ignores it

The real model evidence lives in `examples/live-model/` (a real
tiny GPT-2 safetensors file from Hugging Face, with its real sha256
recorded there). This directory exists so the demo can show a
tamper: flipping one byte in `weights-b.bin` makes `check` report
CHANGED, while the live-model file stays untouched.
