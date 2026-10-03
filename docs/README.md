# Documentation and sources of truth

Principle: each fact has one source. Everywhere else references it and does not copy it.
The repository records what the system should be; the actual runtime state is whatever the local process and its logs say.

## Where each fact lives

| Question | Source | State |
|---|---|---|
| Why build this, and for whom | First sentence of `README.md` | One sentence only; no PRD yet |
| Why a technical choice was made | `docs/adr/` | ADR-0001 to ADR-0005; 0002-0005 are written after the fact, rationale to be confirmed |
| HTTP API | The routes in `src/server.rs` and its tests | No OpenAPI yet; one is planned, derived from the code |
| Data shape | Migrations in `src/store.rs`, ordered by `user_version` | Canonical, keep |
| Scoring and alignment behavior | `src/align.rs` and its tests | No spec yet |
| Extension behavior | `extension/*.js` and `test/*.test.js` | The tests are the reference |
| Port | `PORT` in `src/paths.rs` | The addresses in the extension, the README and the `main.rs` help are kept equal by tests in `src/consistency.rs` |
| Version | `extension/manifest.json` | Bump by hand; `Cargo.toml` must follow, checked by a test in `src/consistency.rs` |
| How to install, run and test | `README.md`, `package.json` scripts | Canonical |
| Delivery pipeline | `.github/workflows/ci.yml` | Runs the coverage gates on every push to `main` and every pull request; the gates themselves are defined in `package.json` |
| Rules for AI agents | `AGENTS.md` (`CLAUDE.md` imports it) | Canonical |
| What a term means | `docs/glossary.md` | Add a row whenever a new term appears |

Items marked missing or duplicated are tracked in `status.md` and fixed one at a time by priority, not all at once.

## Conventions

- Facts a machine can verify live in a structured or executable form (migrations, OpenAPI, tests); Markdown only explains them.
- Once an ADR is Accepted its history is not edited. When a decision changes, write a new ADR and mark the old one `Superseded by`.
- When a reason cannot be confirmed, write "to be confirmed". Do not invent it.
- All repository content is written in English; the Chinese README is `README.zh-CN.md`.
