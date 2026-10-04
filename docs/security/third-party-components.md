# Third-party component and asset inventory

Reviewed: 2026-10-04. This inventory records upstream statements and how the repository uses each component. It is not a legal opinion or a conclusion that the project is ready for public or commercial distribution. Keep this file as the source for provenance and license review; the [status page](../status.md) tracks open risks.

| Component or asset | Upstream source and stated license | Use in this repository | Open verification |
|---|---|---|---|
| `facebook/wav2vec2-lv-60-espeak-cv-ft` model | [Hugging Face model card](https://huggingface.co/facebook/wav2vec2-lv-60-espeak-cv-ft) labels the checkpoint Apache-2.0. Its card says it builds on [`wav2vec2-large-lv60`](https://huggingface.co/facebook/wav2vec2-large-lv60), whose model card also labels it Apache-2.0, and is fine-tuned on Common Voice. | `tools/export_onnx.py` downloads the checkpoint for local export; the resulting model is kept in the user's app-data directory, not checked into this repository. | Record the exact model revision and retain its license/notice with any redistributed model. Review training-data terms and downstream model redistribution before publishing weights. |
| `assets/vocab.json` | The upstream model repository contains a `vocab.json` with 392 entries; its model card labels the checkpoint Apache-2.0. | The repository file has 392 entries and is compiled into the Rust binary by `src/asr.rs`. | The local file's upstream revision and hash are not pinned, so byte-for-byte identity is unverified. Record a pinned revision and hash before distributing the compiled binary. |
| eSpeak NG command and speech data | The [upstream README](https://github.com/espeak-ng/espeak-ng) states GPL version 3 or later and lists separate BSD-2-Clause, Apache-2.0 and UCD license files for components. | Users install `espeak-ng` separately; `src/espeak.rs` starts it as an external process. This repository does not bundle its executable or data. | Confirm the exact installed package's notices and assess distribution obligations for this process boundary before packaging or redistributing SoundKey. The repository does not make a legal conclusion about that boundary. |
| ECDICT data | The [upstream repository](https://github.com/skywind3000/ECDICT) includes an [MIT license](https://github.com/skywind3000/ECDICT/blob/master/LICENSE). | `setup-dict` downloads the CSV and imports selected fields into the local SQLite database; it writes the upstream MIT notice as `ECDICT-LICENSE.txt` next to the user's data. | Upstream project licensing does not by itself establish provenance or rights for every dictionary definition. The data is downloaded at setup and is not stored in this repository; resolve field-level provenance before redistributing a database or dictionary dump. |
| Rust and JavaScript dependencies | Per-package license metadata is maintained by their package registries and lockfiles. | Runtime and development dependencies are declared in `Cargo.toml` and `package.json`/lockfiles. | No complete dependency license report has been generated. Generate and review one before public distribution; do not infer a project license from dependency licenses. |

The project currently has no root `LICENSE`. A repository license choice, notices, model revision, generated model distribution, and dictionary redistribution all require an explicit review before any release that includes them.

## Evidence in the repository

- Model export and source identifier: [tools/export_onnx.py](../../tools/export_onnx.py).
- Embedded vocabulary: [src/asr.rs](../../src/asr.rs) and [assets/vocab.json](../../assets/vocab.json).
- eSpeak subprocess invocation: [src/espeak.rs](../../src/espeak.rs); installation: [README](../../README.md).
- Dictionary download and selected fields: [src/main.rs](../../src/main.rs), [src/ecdict.rs](../../src/ecdict.rs), and [README](../../README.md).
- Runtime storage boundary: [ADR-0002](../adr/ADR-0002-local-server-and-extension.md) and [ADR-0005](../adr/ADR-0005-sqlite-and-local-files.md).
