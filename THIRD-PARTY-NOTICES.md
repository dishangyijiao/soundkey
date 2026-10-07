# Third-party notices

SoundKey itself is licensed under `MIT OR Apache-2.0` (see [LICENSE-MIT](LICENSE-MIT) and [LICENSE-APACHE](LICENSE-APACHE)). This file lists third-party material that is **in this repository**, and third-party software that SoundKey uses but **does not ship**. The longer inventory, with the open questions, is in [docs/security/third-party-components.md](docs/security/third-party-components.md).

## Included in this repository

### `assets/vocab.json`

- What it is: the token table (392 entries) that maps the phoneme model's output numbers to phoneme symbols. It is compiled into the program.
- Source: the `vocab.json` of the Hugging Face model [`facebook/wav2vec2-lv-60-espeak-cv-ft`](https://huggingface.co/facebook/wav2vec2-lv-60-espeak-cv-ft), at revision `ae45363bf3413b374fecd9dc8bc1df0e24c3b7f4`.
- License: Apache-2.0, as stated on the model card. The license text is in [LICENSE-APACHE](LICENSE-APACHE).
- Changes: none. The file is byte-identical to the upstream file at that revision.
- sha256: `d732ab2456c0c017930001dc9af0b41b3b93d25b2eb9740bf9d925508d7d87d0`

A test (`test/notices.test.js`) fails if the file changes without this entry being updated.

## Used but not shipped

SoundKey does not include or redistribute the following. You install or download them yourself, under their own licenses.

- **`espeak-ng`**: speech synthesis and the reference pronunciation. GPL-3.0-or-later. SoundKey starts it as a separate program and does not link or bundle it.
- **The phoneme model**: exported from `facebook/wav2vec2-lv-60-espeak-cv-ft` on your machine by `soundkey setup` (Apache-2.0 on the model card). The exported file is not in this repository.
- **ECDICT** dictionary data: downloaded by `soundkey setup-dict` from [skywind3000/ECDICT](https://github.com/skywind3000/ECDICT) (MIT). The program saves a copy of the upstream license next to your data.

Rust crates and development-only npm packages are compiled in or used for testing under their own permissive licenses; a scan of their declared license fields on 2026-10-07 is summarized in the inventory above.
