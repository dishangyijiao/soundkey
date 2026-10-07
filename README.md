# SoundKey

English | [简体中文](README.zh-CN.md)

Pick one sentence, read it aloud, and see which sound you got wrong.

## What it does

You are watching an English video on YouTube and cannot make out a sentence. SoundKey, a Chrome side panel, lets you:

1. pick that caption sentence (the whole sentence, even when YouTube splits it into pieces),
2. hear the original audio of that moment again,
3. read the sentence aloud into your microphone,
4. see, sound by sound, which phonemes (the smallest speech sounds) did not match a reference pronunciation, with the words that contain them marked,
5. click any word to see its phonetic transcription and Chinese definition, and keep it in a word notebook.

Everything runs on your own computer: a small Rust program serves the side panel on `127.0.0.1:17321`. The interface text is in Chinese.

## Requirements

- **macOS.** It is the only system it has been used on; the data folder is `~/Library/Application Support/soundkey/` on every system, and the project is not tested on Linux or Windows.
- **Google Chrome** on the desktop, and YouTube videos that have English captions.
- **Rust** (to build and run the program) and **Node.js** (only to run the tests).
- **`espeak-ng`**, for the reference pronunciation (`brew install espeak-ng`).
- **[`uv`](https://docs.astral.sh/uv/)** and a network connection for the one-time `setup`: it creates a Python 3.12 environment, installs PyTorch, `transformers` and `onnx`, downloads the pronunciation model and exports it. The exported model file is about 1.2 GB, and the installation needs more space while it runs.
- A microphone, and permission for the extension to use it.

## Setup

`espeak-ng` must be installed locally. Export the phoneme model once (this is the long step):

```bash
cargo run --release -- setup
```

Before you look up words for the first time, install the local ECDICT dictionary (needs network access and `curl`):

```bash
cargo run --release -- setup-dict
```

The command shows the download size and writes a SQLite dictionary, containing only the word, phonetic, Chinese definition and word-form fields, into the app data directory. ECDICT upstream provides about 760 thousand base entries and is used under the [MIT license](https://github.com/skywind3000/ECDICT/blob/master/LICENSE); a copy of the license is saved on your machine.

## Run

```bash
cargo run --release -- serve
```

In Chrome open `chrome://extensions`, turn on developer mode, choose "Load unpacked", and select the `extension` directory of this project. Open YouTube and click the extension icon; SoundKey appears in the side panel on the right.

The program listens on `http://127.0.0.1:17321`. Cards and recordings are stored in `~/Library/Application Support/soundkey/`. If you used the earlier name, move the old directory once; see [ADR-0007](docs/adr/ADR-0007-rename-internal-identifiers-to-soundkey.md).

## Limits

- It is a personal project, not a finished product, and it is **not in the Chrome Web Store**: you load the `extension` folder yourself.
- The score compares your voice with a **synthesized reference pronunciation**, not with the speaker in the video, and has not been checked against a human judge. Treat it as a pointer to sounds worth listening to again, not as a grade.
- It works with YouTube only, on one sentence at a time, and does not teach grammar or vocabulary.
- Nothing is sent anywhere while you use it. Only the one-time `setup` and `setup-dict` download things (the model, the Python packages, the dictionary).

## Development and testing

Develop test-first: write a failing test, then the smallest implementation that makes it pass, then refactor. A behavior change without a matching test is not merged.

```bash
cargo test          # Rust: unit tests + tests/cli.rs (starts the real binary)
npm test            # extension: the real extension scripts run in jsdom / vm
npm run coverage    # gate: JS lines, branches and functions, and Rust lines and functions, must all be 100%
python3 -m unittest tools.test_check_markdown_links
python3 tools/check_markdown_links.py
```

- Rust coverage uses [`cargo-llvm-cov`](https://github.com/taiki-e/cargo-llvm-cov) (`cargo install cargo-llvm-cov`). Error branches created by `?` are reported as region coverage only and are not gated, because they can only be triggered by corrupting SQLite or the file system.
- The tests need `espeak-ng` on the machine. Without it the tests that depend on it fail on purpose instead of being skipped.
- No real model is downloaded: `tests/fixtures/*.onnx` are two tiny ONNX fixtures, regenerated with `python tools/make_test_model.py` (needs `onnx`).
- `tests/cli.rs` points `HOME` at a temporary directory and uses `SOUNDKEY_PORT`, `SOUNDKEY_ROOT` and `SOUNDKEY_ECDICT_URL` to replace the port, the export environment and the dictionary download with local ones, so it touches neither the network nor your real data.
- Mutation testing checks that the tests really assert something: `npm run mutate` (JS, Stryker) and `npm run mutate:rust` (Rust, cargo-mutants).

## Working with AI agents

`AGENTS.md` holds the rules for AI agents (`CLAUDE.md` imports it). `docs/README.md` says where each kind of fact lives, `docs/status.md` tracks what is still missing, and `docs/glossary.md` explains the terms.

## License

Licensed under either of

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE))
- MIT license ([LICENSE-MIT](LICENSE-MIT))

at your option.

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in this project by you, as defined in the Apache-2.0 license, shall be dual licensed as above, without any additional terms or conditions.

SoundKey does not include or redistribute `espeak-ng`, the phoneme model or the ECDICT dictionary. You install or download them yourself, under their own licenses; see [third-party components](docs/security/third-party-components.md).
