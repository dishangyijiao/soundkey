# ADR-0003: Use a wav2vec2 phoneme model, exported to ONNX and run in Rust

## Status

Accepted (written after the fact, 2026-10-03)

## Context

Scoring needs the user's recording recognized as a sequence of phonemes, which is then compared with the reference phonemes.

Facts confirmed in the repository:

- The model is `facebook/wav2vec2-lv-60-espeak-cv-ft` (`MODEL_ID` in `tools/export_onnx.py`).
- The export script is used once at install time ("Runtime does not use this script"), is called by `fengsong setup`, and needs Python and PyTorch (`tools/export_onnx.py`).
- At runtime Rust loads `model.onnx` with `ort` (`src/asr.rs`) and decodes the logits with greedy CTC decoding.
- The vocabulary `assets/vocab.json` is compiled into the program (`include_str!`); the model file itself lives in the app data directory and is not in the repository.

Why this model was chosen: to be confirmed. Inferred: `espeak` in the model name suggests its output labels are espeak-style phonemes, which line up directly with the reference phonemes from espeak-ng in ADR-0004. There is no written evidence.

## Decision

- Recognize phonemes with a wav2vec2 phoneme model, not speech-to-text.
- Export to ONNX offline once; at runtime depend only on `ort`, not on Python.
- Keep the model out of the repository; the user exports it with `cargo run --release -- setup` on first run.

## Alternatives Considered

Which options were compared historically: to be confirmed; nothing is recorded in the repository.

## Consequences

### Positive

- At runtime there is a single Rust program and no resident Python.
- Tests use two tiny ONNX fixtures (`tests/fixtures/`) and need no real model download.

### Negative

- First install has to download and export the model, which needs Python and PyTorch and is large and slow.
- The vocabulary and the model must match; changing the model means changing `assets/vocab.json` too.

### Risks

- The licenses of the model and the vocabulary are still to be checked and must be confirmed before open sourcing, see `docs/status.md`.

## Related

- ADR-0002, ADR-0004
- Implementation: `src/asr.rs`, `tools/export_onnx.py`, `assets/vocab.json`
