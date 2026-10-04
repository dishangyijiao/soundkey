# Repository migration assessment

Assessment date: 2026-10-03. Baseline: `f7c39b2`. This is a migration snapshot and proposal, not a second specification. The current source map is [README](README.md); ongoing gaps belong in [status](status.md).

## 1. Repository inventory

Observed from tracked files and local history; no live service or remote CI run was inspected.

| Lifecycle stage | Existing evidence | Assessment |
|---|---|---|
| PRD | [PRD-001](product/PRD-001-hear-the-sounds-you-miss.md) | Draft includes owner confirmations and open questions |
| Requirements | [Requirements](requirements.md) | Stable REQ-001 through REQ-010, acceptance criteria and implementation evidence |
| ADR | [Decision records](adr/) | Five accepted records; reconstructed reasoning explicitly marked |
| Architecture | [Extension manifest](../extension/manifest.json), [server](../src/server.rs), ADR-0002 | Structure recoverable from code; no architecture document |
| Spec | [Requirements](requirements.md), [alignment](../src/align.rs), [panel tests](../test/sidepanel.test.js) | Acceptance criteria exist; scoring and recording lack explicit behavioral specs |
| Code | [Rust modules](../src/), [extension](../extension/), [setup tools](../tools/) | Existing boundaries should be retained |
| Tests | [Rust CLI tests](../tests/cli.rs), [JS tests](../test/), inline Rust tests, [test scripts](../package.json), [mutation configuration](../mutants.toml) | Multiple verification layers exist; not executed during inventory |
| Deploy | [Installation](../README.md), [CI](../.github/workflows/ci.yml), [setup implementation](../src/main.rs) | Local source installation and CI configuration; no packaged release workflow or recovery runbook found |
| Observe | [Server diagnostics and health handler](../src/server.rs), [panel health polling](../extension/sidepanel.js) | Local diagnostics exist; no logging policy, alert configuration or reliability targets found |

Additional observed boundaries: [OpenAPI](../contracts/openapi/openapi.json) defines HTTP; [store](../src/store.rs) owns database migrations and dictionary schema; [contract tests](../src/contract.rs) exercise API operations. No event broker, cloud infrastructure, CODEOWNERS, CONTRIBUTING or project LICENSE was found in the tracked inventory. The local checkout also contains untracked `.claude/` and `coverage/`; these are outside this migration.

## 2. Current source-of-truth map

Use the canonical map in [README](README.md). Keep OpenAPI, database migrations, implementation, tests and CI in their existing locations. Proposed new sources are limited to architecture relationships, behavioral specs and recovery procedures, which currently have no dedicated source. Local runtime output remains evidence of actual state; this assessment makes no claim that the installed application or remote CI is healthy.

## 3. Duplicated or conflicting sources

Observed at the baseline:

- The glossary says PRD, requirements and CI do not exist, despite the files linked in the inventory. Replace these stale claims with references.
- PRD-001 ends with a claim that requirements have not been written. Link the existing requirements instead.
- The baseline source map described exact route parity and every response being checked. Since then, a source check catches literal server route paths missing from OpenAPI, and the JS fetch test double checks exercised extension paths and methods. Full request/response schema conformance remains incomplete; see current limits in status.
- Product summaries in README and AGENTS emphasize read-aloud scoring. The PRD and the owner's clarification start with a listening difficulty while watching an English video. Keep product intent in the PRD and use references or short entry-point summaries elsewhere.
- Port and version appear in several formats. Existing consistency tests address this necessary duplication; retain them rather than introducing another manually maintained list.

At this migration checkpoint, the owner confirmed the product name Fengsong, with positioning recorded in PRD-001. The owner later renamed the product to Soundkey. Existing executable identifiers and supported sites are implementation facts, not evidence that the owner requested a data migration or additional video integrations.

## 4. Missing artifacts

Evidence-backed proposals, not approved product requirements:

- Architecture overview: justified by the relationships across `extension/manifest.json`, `extension/background.js`, `src/server.rs` and ADR-0002.
- Scoring and recording specs: justified by REQ-005/006 and their existing code and tests. Extract observable behavior and reference OpenAPI instead of copying its fields.
- Backup, restore and rollback runbook: justified by `src/store.rs` migrations and ADR-0005. Validate procedures with disposable data before presenting them as reliable.
- Lightweight document checks: stale links and claims above justify a small check before considering broader CI changes.
- Contributor and distribution guidance: useful before public distribution; see the existing distribution and license risks in status. Do not invent maintainers for CODEOWNERS.

## 5. High-risk areas

Inferred priorities based on observed evidence:

| Area | Evidence | Recommended next action |
|---|---|---|
| Local API access | ADR-0001 and `guard_local_access` in `src/server.rs` | Document trust boundaries; preserve existing security tests and policy |
| Data recovery and compatibility | ADR-0005, migrations in `src/store.rs`, paths in `src/paths.rs` | Verify backup/restore before changing storage identifiers or versions |
| Scoring interpretation | PRD scope/open question, `src/align.rs`, `src/asr.rs`, ADR-0003/0004 | Specify current comparison behavior; do not claim it diagnoses the original speaker's connected speech |
| Caption and recording flow | `extension/page.js`, `extension/content.js`, `extension/sidepanel.js`, corresponding JS tests | Link specs to existing tests; separate simulated verification from real-browser evidence |
| Contract confidence | `src/contract.rs`, `test/helpers/panel.js` and status item 5 | Route path discovery and exercised client path/method checks are implemented; request/response schema completeness remains limited |
| Installation and delivery | `src/main.rs`, `tools/export_onnx.py`, CI configuration | Confirm clean setup and remote CI; document dependency and release limits |

Current license uncertainties remain in [status](status.md); this inventory is not a license review.

## 6. Proposed target structure

Retain `src/`, `extension/`, `test/`, `tests/`, `tools/`, `contracts/openapi/`, `docs/product/`, `docs/adr/`, the single `docs/requirements.md`, and `.github/workflows/`. Retain database migrations inside `src/store.rs`.

Add only when the corresponding step is implemented:

```text
docs/architecture/README.md   # boundaries, relationships, data flow, local topology
docs/specs/scoring.md         # observable scoring behavior and verification links
docs/specs/recording.md       # recording states, failures and verification links
docs/runbooks/recovery.md     # verified backup, restore, rollback and diagnosis
```

No empty directory skeleton is needed. Cloud infrastructure, central alerts and service-level objectives need an actual deployment model and owner-approved targets before implementation; the current local application does not justify inventing them. Local failure diagnosis still needs a runbook.

## 7. Incremental migration plan

Each row is independently reviewable and preserves behavior unless explicitly proposed otherwise.

| Order | Change and canonical source impact | Evidence and verification |
|---|---|---|
| 1 | Repair documentation entry points; record owner-confirmed positioning in the existing PRD | Baseline conflicts above; local link checks, diff review, no runtime changes |
| 2 | Add architecture overview as the source for component relationships | ADR-0001/0002/0005, manifest and message/server flows; review every diagram edge against code |
| 3 | Add scoring and recording specs, referenced by REQ-005/006 | Existing implementation and adjacent tests; run relevant Rust and JS tests; leave undecided behavior explicit |
| 4 | Add recovery runbook | ADR-0005, store/CLI tests and installation instructions; disposable WAL copy/restore check passed. Application-version rollback remains untested |
| 5 | Strengthen traceability and contract checks where gaps have value | Request-size 413 responses are documented and checked by `src/contract.rs`; literal route-path discovery and exercised client path/method checks are implemented; generic request/response schema validation remains open |
| 6 | Add lightweight documentation validation and verify delivery | Local-link and anchor checker, unit tests and dedicated CI job added; local checks pass. Inspect an actual remote CI run when available |
| 7 | Reassess distribution and operational needs | Initial component license inventory is in `docs/security/third-party-components.md`; repository licensing, dependency report, model/data redistribution and release decisions remain unresolved |

No product rename is planned. Do not change identifiers, command names or storage paths based on naming exploration. Do not rewrite accepted ADR history.

## 8. Proposed first PR

Title: `docs: reconcile product context and repository migration sources`

Scope: this assessment, the canonical source index, stale glossary/PRD references, and agent instructions for tracing future changes. Record the confirmed product name and positioning in PRD-001; executable branding and data paths remain unchanged.

Applicable context: PRD-001; REQ-001 through REQ-007 for the existing journey; ADR-0002/0005 for implementation and persistence boundaries; OpenAPI for HTTP; existing contract, consistency, panel and CLI tests as verification sources. This describes the proposed first step at the inventory baseline; it was documentation-only and did not change application behavior, API semantics, persisted data or accepted ADR history.

Acceptance at the inventory baseline: local Markdown references resolved and `git diff --check` passed. Current follow-up verification is recorded in `status.md` and per-artifact notes; remote CI and real-video behavior remain unverified.
