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

Why this model was chosen. **Confirmed by the owner:** an AI chose it when the code was written; the owner did not check whether a better option exists and asked whether it is current best practice. The answer found in a later review is in the Review section below. One observation, not a confirmed reason: `espeak` in the model name suggests its output labels are espeak-style phonemes.

## Decision

- Recognize phonemes with a wav2vec2 phoneme model, not speech-to-text.
- Export to ONNX offline once; at runtime depend only on `ort`, not on Python.
- Keep the model out of the repository; the user exports it with `cargo run --release -- setup` on first run.

## Alternatives Considered

Which options were compared when the model was chosen: not recorded. Alternatives found in the 2026-10-03 review, none of them evaluated yet, are listed in the Review section.

## Consequences

### Positive

- At runtime there is a single Rust program and no resident Python.
- Tests use two tiny ONNX fixtures (`tests/fixtures/`) and need no real model download.

### Negative

- First install has to download and export the model, which needs Python and PyTorch and is large and slow.
- The vocabulary and the model must match; changing the model means changing `assets/vocab.json` too.

### Risks

- The license of the model is reported as Apache-2.0 by third-party catalog pages; it has not been checked against the original model card, and the vocabulary comes from the same model. Confirm before open sourcing, see `docs/status.md`.
- The model is from 2021 and newer ones exist (see Review); it has not been compared on the owner's own recordings.

## Review (2026-10-03)

Question from the owner: is this current best practice? A web search found the following. It is a literature check, not a benchmark on the owner's voice.

- Recognizing phonemes with a fine-tuned wav2vec2-style model and comparing them with the expected phonemes is an established approach for computer-assisted pronunciation training, so the design is mainstream, not a mistake.
- The classic way to score a phoneme is Goodness of Pronunciation (GOP), a probability-based score. Recent work uses CTC-based, alignment-free GOP and reports the best results. This product uses recognize-then-compare instead, which shows what was heard against what was expected (good for diagnosis) but gives no confidence for each phoneme.
- Alternatives that exist: ZIPA (2025, phone recognition with much smaller models), Allosaurus, and an already exported ONNX build of a wav2vec2 espeak model on Hugging Face (`sadda-speech/wav2vec2-espeak-ctc`). A ready-made ONNX file would remove the Python and PyTorch export step that makes installation hard, so it matters for distribution. Its license has not been checked.

Conclusion: keep the model for now. Before deciding to replace it, compare candidates on the owner's own recordings, for example ZIPA and an alternative scoring method, and check licenses. Tracked in `docs/status.md`.

Sources: [Phonological level wav2vec2-based MDD](https://arxiv.org/pdf/2311.07037), [GOP with phonological knowledge in CTC-based MDD](https://arxiv.org/pdf/2506.02080), [Segmentation-free GOP](https://arxiv.org/html/2507.16838v3), [ZIPA](https://preview.aclanthology.org/setup/2025.acl-long.961), [wav2vec2-espeak-ctc ONNX](https://huggingface.co/sadda-speech/wav2vec2-espeak-ctc).

## Related

- ADR-0002, ADR-0004
- Implementation: `src/asr.rs`, `tools/export_onnx.py`, `assets/vocab.json`
