# Contributing

Thanks for looking. SoundKey is a small personal project, so a short note on what helps before you spend time on a change. Open an issue first for anything bigger than a typo or a one-line fix, so we can agree on it before you write code.

## Licensing of contributions

SoundKey is `MIT OR Apache-2.0`. Unless you explicitly state otherwise, a contribution you submit is licensed the same way, without additional terms (the usual Rust-project clause, also in the README).

## Setting up

You need Rust, Node.js and `espeak-ng` (without it the tests that need it fail on purpose). Details are in the [README](README.md).

```bash
cargo test            # Rust: unit tests and tests/cli.rs
npm test              # extension: the real scripts run in jsdom / vm
npm run coverage      # the gate: JS lines, branches, functions and Rust lines, functions must stay at 100%
```

The `serve_*` tests in `tests/cli.rs` bind a local port. If a SoundKey server is running on port 17321 on your machine, stop it first.

## How changes are made

The rules are written for AI agents in [AGENTS.md](AGENTS.md), and they apply to people too:

- **Test first.** Write a test, see it fail for the right reason, then write the smallest change that makes it pass. Never weaken or delete a test just to make a check pass.
- **Keep the coverage gate green.** Pure logic stays free of the DOM so it can be tested. For high-risk logic add property tests; for key modules run `npm run mutate` or `npm run mutate:rust`.
- **One fact, one place.** [docs/README.md](docs/README.md) says where each kind of fact lives. When behavior that users can see changes, update that source and its tests. Do not copy a fact into a second place.
- **Accepted ADRs are history.** Do not rewrite one; record a changed decision in a new ADR.
- **Commits:** Conventional Commits (`type(scope): description`), an English description, one reviewable change per commit, only the relevant files. Never commit `.claude/settings.local.json`, `coverage/`, `extension.crx` or `extension.pem`.
- **Language:** everything in the repository is English except the product's own interface text, which is Chinese. Keep `README.md` and `README.zh-CN.md` in step.

## Before you open a pull request

Say what changed and what you did not verify. Run the commands above. The continuous integration (documentation links, JS, Rust) must pass.

## Things that need an owner decision

Please ask before changing a public interface (the HTTP API in `contracts/openapi/openapi.json`), the meaning of stored data, or the local server's access rules. Support for sites other than YouTube is deliberately out of scope for now.
