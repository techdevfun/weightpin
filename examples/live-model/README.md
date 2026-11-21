# Live model fixture - real weights from Hugging Face

This directory holds a REAL small model weight file, downloaded from
Hugging Face on 2026-11-21. It is the live evidence for weightpin:
`pin` and `check` run against this exact file in the test suite.

- Model: `hf-internal-testing/tiny-random-gpt2` (a tiny random GPT-2)
- File: `model.safetensors`
- URL: https://huggingface.co/hf-internal-testing/tiny-random-gpt2/resolve/main/model.safetensors
- Pulled: 2026-11-21
- Size: 453,864 bytes
- sha256: `8111d5afb0715dbf5a31396d31432cb56370ba23f6650a035ea0fc8a20b4e500`
- Contents (verified locally by parsing the safetensors header):
  64 tensors, all F32 (transformer blocks h.0-h.4, ln_f, wpe, wte)

`config.json` comes from the same repo and the same pull. It is not a
weight file, so weightpin ignores it when hashing - that is the point:
config and tokenizer files are not hashed, only weights are.

Do not edit `model.safetensors`: if you do, `check` against the
recorded hash must report CHANGED. That is the tool working.
