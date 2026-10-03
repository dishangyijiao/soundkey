# Fengsong (讽诵)

English | [简体中文](README.zh-CN.md)

Pick one sentence, read it aloud, and see which sound you got wrong.

## Setup

`espeak-ng` must be installed locally. Export the phoneme model once:

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

In Chrome open `chrome://extensions`, turn on developer mode, choose "Load unpacked", and select the `extension` directory of this project. Open YouTube and click the extension icon; Fengsong appears in the side panel on the right.

The program listens on `http://127.0.0.1:17321`. Cards and recordings are kept in `~/Library/Application Support/fengsong/`.

## Development and testing

Develop test-first: write a failing test, then the smallest implementation that makes it pass, then refactor. A behavior change without a matching test is not merged.

```bash
cargo test          # Rust: unit tests + tests/cli.rs (starts the real binary)
npm test            # extension: the real extension scripts run in jsdom / vm
npm run coverage    # gate: JS lines, branches and functions, and Rust lines and functions, must all be 100%
```

- Rust coverage uses [`cargo-llvm-cov`](https://github.com/taiki-e/cargo-llvm-cov) (`cargo install cargo-llvm-cov`). Error branches created by `?` are reported as region coverage only and are not gated, because they can only be triggered by corrupting SQLite or the file system.
- The tests need `espeak-ng` on the machine. Without it the tests that depend on it fail on purpose instead of being skipped.
- No real model is downloaded: `tests/fixtures/*.onnx` are two tiny ONNX fixtures, regenerated with `python tools/make_test_model.py` (needs `onnx`).
- `tests/cli.rs` points `HOME` at a temporary directory and uses `FENGSONG_PORT`, `FENGSONG_ROOT` and `FENGSONG_ECDICT_URL` to replace the port, the export environment and the dictionary download with local ones, so it touches neither the network nor your real data.
- Mutation testing checks that the tests really assert something: `npm run mutate` (JS, Stryker) and `npm run mutate:rust` (Rust, cargo-mutants).

## Working with AI agents

`AGENTS.md` holds the rules for AI agents (`CLAUDE.md` imports it). `docs/README.md` says where each kind of fact lives, `docs/status.md` tracks what is still missing, and `docs/glossary.md` explains the terms.
