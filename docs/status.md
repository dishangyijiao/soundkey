# Project status

This document records, for each layer, whether it exists and how good it is, the known risks, and the to-do list in priority order. Update it as each item is done.

First assessed: 2026-10-03. "Observed" means a fact you can see directly in the repository; "inferred" is a judgment that needs confirming.

## Migration continuation

The [migration assessment](migration.md) records the inventory, evidence and proposed sequence at baseline `f7c39b2`. The first documentation step repairs stale PRD, requirement and CI references, qualifies the contract-checking claim in the source map, and records the product identity confirmed at that time in [PRD-001](product/PRD-001-hear-the-sounds-you-miss.md). Subsequent steps added architecture and behavioral specs, a recovery runbook, a third-party component inventory, a Markdown link checker in CI, and contract coverage for request-size errors. The owner later renamed the product to SoundKey; the decision and its open trademark/distribution questions are recorded in [ADR-0006](adr/ADR-0006-adopt-soundkey-as-the-product-name.md). The migration assessment remains a dated record of the earlier state. [ADR-0007](adr/ADR-0007-rename-internal-identifiers-to-soundkey.md) then renamed the internal identifiers, environment variables and data directory; existing data must be moved once ([runbook](runbooks/recovery.md)).

The second step adds the [architecture overview](architecture/README.md), based on the existing implementation and ADRs. The third step adds [SPEC-001](specs/scoring.md) and [SPEC-002](specs/recording.md), linked from REQ-005/006. The fourth step adds the [recovery runbook](runbooks/recovery.md); its disposable WAL backup and restore copy exercise passed, while application rollback remains untested. At that checkpoint, the owner confirmed the Latin name Fengsong and no additional video-site support. The current product name is SoundKey; no official Chinese name has been chosen.

## Current state

| Layer | Observed | Verdict |
|---|---|---|
| Intent | `docs/product/PRD-001-hear-the-sounds-you-miss.md`, a draft from an interview: problem, goals, non-goals and success criteria confirmed; how to measure success and the journeys still open | Partial |
| Decisions | ADR-0001 to ADR-0008 exist; reconstructed technical decisions distinguish owner-confirmed reasons from unknown alternatives; the product name keeps SoundKey and excludes the UK from release (ADR-0008), with no full trademark clearance done | Good; phoneme model remains under review |
| Architecture | `docs/architecture/README.md` documents component relationships, data flows, trust boundaries and local deployment, with code and test references | Documented from source; live topology not verified |
| Contracts | `contracts/openapi/openapi.json` for the HTTP API, checked against the server by `src/contract.rs`; database migrations in `src/store.rs` | Good |
| Specs | SPEC-001 and SPEC-002 reconstruct scoring and recording behavior and identify verification gaps | Critical recording flow documented; other flows remain in requirements and tests |
| Implementation | `src/` is split into `align`, `wav`, `espeak`, `asr`, `ecdict`, `store`, `server` | Good |
| Verification | 100% JS line, branch and function coverage; 100% Rust line and function coverage; property tests; Stryker and cargo-mutants | Very good; mutation suites were not run during this migration |
| CI | `.github/workflows/ci.yml` runs documentation link checks and JS/Rust coverage gates; locally, 5 Markdown-checker tests, 333 JS tests, 154 Rust unit tests and 15 CLI tests pass; remote CI has not been confirmed | All three jobs configured and locally verified; remote run pending |
| Operations | `docs/runbooks/recovery.md` documents data backup, restore, schema rollback and reinstalling generated local dependencies | Backup/restore copy exercise verified with disposable data; application rollback not exercised |
| AI rules | `AGENTS.md` added, `CLAUDE.md` imports it | Done |

## Duplicated or conflicting sources (observed)

- Port `17321` is written in `src/paths.rs`, `extension/manifest.json` and `extension/sidepanel.js` (handled: different languages cannot share one source, so tests in `src/consistency.rs` keep them equal).
- Version: `Cargo.toml` and `extension/manifest.json` used to differ (handled: both are 0.2.0 and the same test checks them).
- The HTTP API used to exist only in code (handled: `contracts/openapi/openapi.json` is canonical; contract checks cover literal server route paths, common methods and exercised responses, with limits listed in item 5).

## High risks

1. **Cross-origin policy of the local API (handled)**: `CorsLayer::permissive()` used to let any web page call the local API. It is now restricted as described in `docs/adr/ADR-0001-local-api-access-control.md`.
2. **Distribution and licenses (partially researched)**: primary-source findings and unresolved questions are in the [component inventory](security/third-party-components.md). The upstream model card says Apache-2.0; eSpeak NG says GPL-3.0-or-later; ECDICT has an MIT license, while dictionary field-level provenance remains unresolved. The repository has no root `LICENSE` or full dependency report. Distribution readiness is not established.
3. **Distribution (inferred)**: the extension needs the local program, and the user has to export the model themselves, so it is hard for ordinary users to install. This decides whether others can use it and deserves its own ADR.

## To-do list (by priority)

1. ~~Restrict the cross-origin policy of the local API~~ (done, ADR-0001).
2. ~~ADRs: architecture, phoneme model, speech synthesis, SQLite~~ (written after the fact as ADR-0002 to ADR-0005). The owner confirmed the reasons in an interview on 2026-10-03. "What was compared" is not recorded anywhere and is marked as such. The phoneme model choice remains under review in ADR-0003.
3. ~~Make port and version single-sourced~~ (done, see `src/consistency.rs`).
4. ~~Translate the existing Chinese repository content to English and split the README~~ (done: docs, code comments and test names are English; `README.md` and `README.zh-CN.md` exist). Chinese is kept on purpose in product text: UI strings, API error messages, command-line help, and the Chinese dictionary data used as test input. Older commit messages stay in Chinese.
5. ~~Derive an OpenAPI contract from the verified routes and responses, and validate it~~ (done: `contracts/openapi/openapi.json`; the 413 request-size response is included and exercised; a source check requires every literal Axum route path to exist in OpenAPI; the JS fetch test double checks exercised extension request paths and methods against the contract). Remaining limits: server method discovery is limited to the common methods probed by the test; `500` and missing-eSpeak `503` responses are documented but not exercised by the contract checker (server tests cover them); extension request bodies and unexercised client paths are not generically validated against OpenAPI.
6. PRD-001 and `docs/requirements.md` are drafts. **Owner decisions remain:** approve or change the proposed progress algorithm and practice-day definition (REQ-009/010); clarify where a word is clicked and what “the sentences before and after” means; choose the repeat-attempt comparison UI (REQ-006) and how the product helps with sentence meaning (REQ-007). Scoring and recording are described in SPEC-001/002.
7. ~~GitHub Actions~~ (written: `.github/workflows/ci.yml`). **Still to confirm:** observe a remote run and confirm all three jobs pass. The full local coverage command now passes, including the CLI listener tests when run with network binding enabled. Mutation testing remains an intentional slower developer check; clippy and rustfmt are not enforced today.
8. Evaluate the phoneme model: compare candidates (for example ZIPA and an alignment-free GOP scoring method) on the owner's own recordings, and check model/data redistribution. See the Review in ADR-0003 and the [third-party component inventory](security/third-party-components.md).
9. Before public distribution: choose a project license, add `LICENSE` and `CONTRIBUTING.md`, generate a full dependency license report, and decide model/dictionary packaging. Do not invent the license or distribution scope.
10. **Owner's own trial first (decided 2026-10-04):** the owner will use the product for one to two weeks (about 2026-10-11 to 2026-10-18) before deciding on public release. Decide after the trial: whether to release, the project license (item 9), and whether the model and dictionary are exported by each user or bundled with the program ([component inventory](security/third-party-components.md)). Not decided yet, and not to be assumed: any way for the owner to reach their data beyond SQL or CSV on `cards.sqlite` (REQ-008, untested), such as an export command or an MCP server; no record of such a request exists in the repository, so it is to be confirmed.

Not doing for now: `infra/`, `observability/`, SLOs. This is a local tool and there is nothing for them to describe.

## Gaps found while extracting behavioral specs

- ~~Observed: attempt request-size rejection was missing from OpenAPI~~ (fixed: both attempt operations document the router's 413 `text/plain` response, and `src/contract.rs` checks that response against the schema).
- Observed: recording startup has asynchronous work before the active-recording guard takes effect. Rapid starts in that interval, edits during capture and panel closure need targeted verification before promising stronger guarantees; see SPEC-002.
- Observed: saved results are realigned on read. Any future scoring algorithm change must review effects on historical displays; see SPEC-001.
- Inferred: a process interruption between audio and database writes can leave unmatched files. This limitation and recovery implications are recorded in the [architecture overview](architecture/README.md) and [recovery runbook](runbooks/recovery.md); orphan-file cleanup is not automated.

## Recovery runbook validation

- Observed: backup and restore steps are written in `docs/runbooks/recovery.md` based on the SQLite WAL configuration and the app-data layout.
- Verified: copied and restored a disposable WAL-mode database and recording-like file; SQLite integrity check returned `ok` and the committed row survived. Details and limits are in the [runbook](runbooks/recovery.md).
- Not verified: application-version rollback and recovery using the owner's actual data.

## Documentation link check

- Implemented in `tools/check_markdown_links.py`, with focused standard-library tests and a dedicated CI job. Its parser covers common inline links; reference-style links and complex escaped destinations are not parsed.
- Verified locally against all 20 project Markdown files at this revision. The GitHub Actions job has not yet been observed on a remote run.
