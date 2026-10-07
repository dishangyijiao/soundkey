# ADR-0009: License the project under MIT OR Apache-2.0

## Status

Accepted (owner-confirmed, 2026-10-07)

## Context

The owner wants to publish the source on GitHub. The repository had no license, so nobody could legally use, copy or change it. [status item 9](../status.md) said not to invent the license; this is the owner's choice. The owner chose a dual license and gave no further reason; none is recorded here.

A review on 2026-10-07 looked at what the choice has to be compatible with:

- **Rust dependencies** (about 170 crates in `Cargo.lock`): all permissive (MIT, Apache-2.0, ISC, Zlib and combinations). One crate, `r-efi`, offers LGPL as one of three alternatives; MIT can be chosen.
- **npm packages**: none at runtime; three development dependencies, all permissive.
- **eSpeak NG** is GPL-3.0-or-later. The program starts it as an external command and does not bundle or link it, so it does not set the license of this repository.
- **The phoneme model** (Apache-2.0 on its model card) and **the ECDICT dictionary** (MIT upstream) are not in the repository; each user exports or downloads them.
- **`assets/vocab.json`** comes from the model's upstream repository and is compiled into the binary; its attribution and pinned revision are still open in [third-party components](../security/third-party-components.md).

## Decision

- The project is licensed under **either the MIT license or the Apache License 2.0, at the user's option**: `MIT OR Apache-2.0`.
- The texts are in `LICENSE-MIT` and `LICENSE-APACHE` at the repository root. The Apache text is the unmodified official file from apache.org.
- `Cargo.toml` and `package.json` carry the SPDX expression `MIT OR Apache-2.0`. Both READMEs state the license, link both files and say that a contribution is licensed the same way, unless its author says otherwise.
- The copyright line reads `Copyright (c) 2026 zhanghao`, the author name used in the git history. Whether it should carry a different or legal name is to be confirmed.

## Alternatives Considered

The following were put to the owner in the review; the owner's reasons for not choosing them are not recorded.

- **MIT only**: shortest text, no explicit patent grant.
- **Apache-2.0 only**: explicit patent grant, longer text.
- **GPL-3.0-or-later**: would require changes that are distributed to stay open. It would not be forced by eSpeak NG as long as that stays an external command.

## Consequences

### Positive

- Anyone may use, change and redistribute the code, including inside commercial products.
- The Rust ecosystem convention is the same dual license, so the project is easy to combine with most Rust code.

### Negative

- Permissive licenses allow closed forks; the owner gets no copyleft protection.
- Commits made before this date have no license of their own. The license applies to the repository as published; whether to say so for earlier history is to be confirmed.

### Risks

- If a release ever includes the `espeak-ng` program or its data, that part is under the GPL and a separate decision is needed. Model and dictionary packaging is still open (status item 10).
- This ADR is not legal advice. It does not settle the trademark questions in [ADR-0006](ADR-0006-adopt-soundkey-as-the-product-name.md) and [ADR-0008](ADR-0008-keep-the-soundkey-name-and-exclude-the-uk.md).

## Related

- [Third-party components](../security/third-party-components.md)
- [status](../status.md), items 9 and 10
