# Agent Instructions

Soundkey is a Chrome extension (side panel) plus a local Rust server. Product identity, purpose and the intended journey live in `docs/product/PRD-001-hear-the-sounds-you-miss.md`; supported sites and permissions live in `extension/manifest.json`.

## What to read first

Read only what the task needs; do not read everything:

1. `README.md`: install, run and test commands.
2. `docs/README.md`: where the single source of each kind of fact lives.
3. `docs/status.md`: known duplicated sources, gaps and risks.
4. `docs/glossary.md`: terms used in this repository.
5. The code you will change and the tests next to it.

## Commands

```bash
cargo test            # Rust: unit tests + tests/cli.rs
npm test              # extension: real scripts run in jsdom / vm
npm run coverage      # gate: JS lines, branches, functions and Rust lines, functions are all 100%
npm run mutate        # JS incremental mutation testing (Stryker)
npm run mutate:rust   # Rust mutation testing (cargo-mutants, configured in mutants.toml)
```

- `espeak-ng` must be installed locally. Without it the tests that need it fail on purpose.
- The `serve_*` tests in `tests/cli.rs` and Stryker bind a local port. In a sandbox they fail with `EPERM`; that is an environment limit, not a code bug.

## Where facts live

- Never state the same fact in two places; reference it instead.
- The single source of each fact is listed in `docs/README.md`. When externally visible behavior changes, update the source listed there and its tests.
- Do not invent the reasoning behind a historical decision. If you cannot confirm it, write "to be confirmed".
- Preserve accepted ADR history. Change only status or links when superseding a decision, and record the new decision in a new ADR.

## Before implementation

- Identify the relevant PRD, requirement, ADR, architecture constraint, behavioral spec, contract and existing tests. Use `docs/README.md` to locate each source; explicitly note missing artifacts.
- Read only the relevant sources and implementation. Create missing documents only when repository evidence or an owner decision justifies them.
- Keep migration steps independently reviewable. Update operational procedures when an operational change requires it; do not create placeholder infrastructure or monitoring targets.

## Language

- Everything in the repository is English: docs, code comments, identifiers, test names, commit messages. Talk to the user in Chinese.
- `README.md` is English and `README.zh-CN.md` is the Chinese version; keep them in step.
- When you use a term the user may not know, explain it in one line and add it to `docs/glossary.md`.

## Development rules

- Follow TDD: write a failing test, confirm it fails for the right reason, then write the smallest implementation.
- Add property tests for high-risk logic (fast-check for JS, proptest for Rust). Run incremental mutation tests on key modules; exclude a true equivalent mutant in `mutants.toml` with the reason written next to it.
- Keep pure logic free of DOM dependencies so it can be tested.
- Never weaken or delete a test just to make a check pass.

## Commits

- Conventional Commits, English description, one independently reviewable commit per module.
- No Co-Authored-By or other AI attribution lines.
- Commit only the relevant files. Never commit `.claude/`, `coverage/`, `extension.crx` or `extension.pem` (it holds a private key).

## Before you call a task done

- Run the relevant tests and checks, and report exactly what changed and what was not verified.
- Do not say a task is done before verification has run.
- Never merge automatically, and never silently change a public interface, the meaning of persisted data, or the local server's security boundary.
