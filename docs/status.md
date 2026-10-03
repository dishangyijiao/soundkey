# Project status

This document records, for each layer, whether it exists and how good it is, the known risks, and the to-do list in priority order. Update it as each item is done.

First assessed: 2026-10-03. "Observed" means a fact you can see directly in the repository; "inferred" is a judgment that needs confirming.

## Current state

| Layer | Observed | Verdict |
|---|---|---|
| Intent | `docs/product/PRD-001-hear-the-sounds-you-miss.md`, a draft from an interview: problem, goals, non-goals and success criteria confirmed; how to measure success and the journeys still open | Partial |
| Decisions | ADR-0001 to ADR-0005 exist; the last four were written after the fact and their rationale is to be confirmed by the owner | Partial |
| Architecture | No document; the code shows a local Rust server + Chrome extension + espeak-ng + ONNX model + SQLite | Missing |
| Contracts | `contracts/openapi/openapi.json` for the HTTP API, checked against the server by `src/contract.rs`; database migrations in `src/store.rs` | Good |
| Specs | None | Missing |
| Implementation | `src/` is split into `align`, `wav`, `espeak`, `asr`, `ecdict`, `store`, `server` | Good |
| Verification | 100% line and function coverage gate for JS and Rust; property tests; Stryker and cargo-mutants; `tests/cli.rs` and ONNX fixtures | Very good |
| CI | `.github/workflows/ci.yml` runs the JS and Rust coverage gates; written but not yet seen to run on GitHub | Partial |
| Operations | No runbook; installation relies on README commands | Missing (local tool; a short install and troubleshooting note is enough) |
| AI rules | `AGENTS.md` added, `CLAUDE.md` imports it | Done |

## Duplicated or conflicting sources (observed)

- Port `17321` is written in `src/paths.rs`, `extension/manifest.json` and `extension/sidepanel.js` (handled: different languages cannot share one source, so tests in `src/consistency.rs` keep them equal).
- Version: `Cargo.toml` and `extension/manifest.json` used to differ (handled: both are 0.2.0 and the same test checks them).
- The HTTP API used to exist only in code (handled: `contracts/openapi/openapi.json` is now the source, and `src/contract.rs` fails when the server and the contract differ).

## High risks

1. **Cross-origin policy of the local API (handled)**: `CorsLayer::permissive()` used to let any web page call the local API. It is now restricted as described in `docs/adr/ADR-0001-local-api-access-control.md`.
2. **Licenses (observed + to be confirmed)**: the repository has no `LICENSE`. The model is `facebook/wav2vec2-lv-60-espeak-cv-ft` (`tools/export_onnx.py`) and `assets/vocab.json` comes from it; its license must be checked against the original model card. `espeak-ng` is called as an external process and its license is to be confirmed. ECDICT is MIT and its license copy is saved.
3. **Distribution (inferred)**: the extension needs the local program, and the user has to export the model themselves, so it is hard for ordinary users to install. This decides whether others can use it and deserves its own ADR.

## To-do list (by priority)

1. ~~Restrict the cross-origin policy of the local API~~ (done, ADR-0001).
2. ~~ADRs: architecture, phoneme model, speech synthesis, SQLite~~ (written after the fact as ADR-0002 to ADR-0005). The "why this choice" and "what was compared" parts are not recorded anywhere in the repository and are marked "to be confirmed". **The owner needs to fill in the real reasons.**
3. ~~Make port and version single-sourced~~ (done, see `src/consistency.rs`).
4. ~~Translate the existing Chinese repository content to English and split the README~~ (done: docs, code comments and test names are English; `README.md` and `README.zh-CN.md` exist). Chinese is kept on purpose in product text: UI strings, API error messages, command-line help, and the Chinese dictionary data used as test input. Older commit messages stay in Chinese.
5. ~~Derive an OpenAPI contract from the verified routes and responses, and validate it~~ (done: `contracts/openapi/openapi.json`). Known limits: the contract tests cannot notice a route that is in the server but whose path is not in the contract at all; `500` responses and the `503` for a missing espeak-ng are documented but not exercised by the contract tests (the server tests cover them); the extension's use of the API is not yet checked against the contract.
6. ~~A short PRD~~ (draft written and mostly confirmed, see PRD-001). Still to do: requirements derived from it, and two specs: scoring and alignment, and the recording flow.
7. ~~GitHub Actions~~ (written: `.github/workflows/ci.yml`). **Still to confirm:** push it and check that both jobs pass on the first run, in particular that the Rust 100% gate holds when the `serve_*` tests run (they could not run in the sandbox). Not in CI on purpose: mutation testing (slow), clippy and rustfmt (never enforced so far; adding them may need a cleanup first).
8. Before open sourcing: `LICENSE`, `CONTRIBUTING.md`, a third-party license list, a distribution plan.

Not doing for now: `infra/`, `observability/`, SLOs. This is a local tool and there is nothing for them to describe.
