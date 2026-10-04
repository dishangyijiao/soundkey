# ADR-0007: Rename internal identifiers to soundkey and fix the SoundKey spelling

## Status

Accepted (owner-confirmed, 2026-10-04). Supersedes the compatibility clause and the capitalization used in [ADR-0006](ADR-0006-adopt-soundkey-as-the-product-name.md).

## Context

[ADR-0006](ADR-0006-adopt-soundkey-as-the-product-name.md) adopted Soundkey as the product name but kept the former identifiers (executable, environment variables, code identifiers, data directory) to avoid a data migration. The owner then asked for a complete switch to the new name and, when the capitalization was reviewed, chose `SoundKey` over the `Soundkey` written in ADR-0006.

## Decision

- **Display name: `SoundKey`** (capital K, as in YouTube or JavaScript, so the two words Sound and Key stay visible). Use it in the extension manifest, the user interface, documentation prose and JavaScript PascalCase identifiers.
- **Machine identifiers: lowercase `soundkey`**, and `SOUNDKEY_` for environment variables. Do not write `Soundkey` anywhere new; ADR-0006 keeps that spelling as the record of the original decision.
- The Rust package and executable are `soundkey`.
- Environment variables use the `SOUNDKEY_` prefix: `SOUNDKEY_PORT`, `SOUNDKEY_ROOT`, `SOUNDKEY_ECDICT_URL`.
- The app data directory is `~/Library/Application Support/soundkey/`.
- Extension globals use PascalCase `SoundKey` (for example `SoundKeyCues`); the AudioWorklet processor name and test fixtures use `soundkey`.
- No fallback to the old environment variable names or the old data directory is implemented. The owner moves existing data once (see [recovery runbook](../runbooks/recovery.md)).

## Consequences

- Existing installs do not find their cards and recordings until the directory is moved.
- Any script that sets `FENGSONG_*` variables or calls `fengsong` must be updated.
- Accepted ADRs written before this change (ADR-0001 to ADR-0005) still use the former name and path, as a record of what was decided at the time.
- The capitalization does not change the trademark and distribution risks in ADR-0006; a different letter case does not avoid a conflict with existing SoundKey products.
