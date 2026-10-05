# Documentation and sources of truth

Principle: each fact has one source. Everywhere else references it and does not copy it.
The repository records what the system should be; the actual runtime state is whatever the local process and its logs say.

## Where each fact lives

| Question | Source | State |
|---|---|---|
| Why build this, and for whom | `docs/product/PRD-001-hear-the-sounds-you-miss.md` | Draft; confirmed by the owner except the items marked to be confirmed |
| Why an engineering or product decision was made | `docs/adr/` | ADR-0001 to ADR-0008; reconstructed records distinguish owner-confirmed reasons from unknown alternatives |
| HTTP API | `contracts/openapi/openapi.json` (OpenAPI 3.1) | Canonical. Rust and JS test harnesses check literal server route paths and exercised client paths/methods; request-body and response coverage limits are tracked in `status.md`, item 5 |
| Data shape | Migrations in `src/store.rs`, ordered by `user_version` | Canonical, keep |
| Scoring and alignment behavior | `docs/specs/scoring.md` (SPEC-001) | Reconstructed behavior; implementation and verification remain in the linked code and tests |
| Recording interaction | `docs/specs/recording.md` (SPEC-002) | States, failures and observed limits; HTTP field shapes stay in OpenAPI |
| Other extension behavior | `extension/*.js` and `test/*.test.js` | The tests remain the reference for flows not yet specified |
| Port | `PORT` in `src/paths.rs` | The addresses in the extension, the README, the `main.rs` help and the contract are kept equal by tests in `src/consistency.rs` |
| Version | `extension/manifest.json` | Bump by hand; `Cargo.toml` and the contract's `info.version` must follow, checked by a test in `src/consistency.rs` |
| How to install, run and test | `README.md`, `package.json` scripts | Canonical |
| Delivery pipeline | `.github/workflows/ci.yml` | Runs the coverage gates on every push to `main` and every pull request; the gates themselves are defined in `package.json` |
| Local Markdown references | `tools/check_markdown_links.py` and its tests | CI checks common inline relative links and heading fragments; reference-style links and complex escaped destinations are outside the current parser |
| What the product must do, and whether it does | `docs/requirements.md` | Draft; derived from the PRD, each requirement has a status and evidence |
| Rules for AI agents | `AGENTS.md` (`CLAUDE.md` imports it) | Canonical |
| What a term means | `docs/glossary.md` | Add a row whenever a new term appears |
| Product intent and positioning | `docs/product/PRD-001-hear-the-sounds-you-miss.md` | Canonical product intent; no official Chinese name has been chosen |
| Which features could exist, and the owner's Must/Should/Could/Won't choice for each | `docs/candidate-features.md` | Draft; priorities not set. Feature status stays in `docs/requirements.md` and `docs/status.md` |
| Product name decision and history | `docs/adr/ADR-0006-adopt-soundkey-as-the-product-name.md` | Accepted; records the selection and the trademark findings; the UK decision is in ADR-0008 |
| Product name spelling | `docs/adr/ADR-0007-rename-internal-identifiers-to-soundkey.md` | `SoundKey` for display, lowercase `soundkey` for identifiers; tests in `src/consistency.rs` reject the old spelling and the former name outside the history records |
| System structure and deployment topology | `docs/architecture/README.md` | Observed component boundaries, data flows, trust boundaries and local deployment; linked to implementation and verification sources |
| Recovery procedures | `docs/runbooks/recovery.md` | Backup and restore copy mechanics verified with disposable WAL data; application rollback remains untested |
| Third-party provenance and license findings | `docs/security/third-party-components.md` | Upstream statements and repository use; distribution and data provenance questions remain open |
| Migration assessment and sequence | `docs/migration.md` | Dated inventory and incremental proposal; ongoing progress stays in `status.md` |
| Actual local runtime state | Running process diagnostics and live health responses | Not established by repository documents or past test results |

Items marked missing or duplicated are tracked in `status.md` and fixed one at a time by priority, not all at once.

## Conventions

- Facts a machine can verify live in a structured or executable form (migrations, OpenAPI, tests); Markdown only explains them.
- Once an ADR is Accepted its history is not edited. When a decision changes, write a new ADR and mark the old one `Superseded by`.
- When a reason cannot be confirmed, write "to be confirmed". Do not invent it.
- All repository content is written in English; the Chinese README is `README.zh-CN.md`.
