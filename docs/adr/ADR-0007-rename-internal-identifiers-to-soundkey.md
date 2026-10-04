# ADR-0007: Rename internal identifiers to Soundkey

## Status

Accepted (owner-confirmed, 2026-10-04). Supersedes the compatibility clause of [ADR-0006](ADR-0006-adopt-soundkey-as-the-product-name.md).

## Context

[ADR-0006](ADR-0006-adopt-soundkey-as-the-product-name.md) adopted Soundkey as the product name but kept the former identifiers (executable, environment variables, code identifiers, data directory) to avoid a data migration. The owner then asked for a complete switch to the new name.

## Decision

- The Rust package and executable are `soundkey`.
- Environment variables use the `SOUNDKEY_` prefix: `SOUNDKEY_PORT`, `SOUNDKEY_ROOT`, `SOUNDKEY_ECDICT_URL`.
- The app data directory is `~/Library/Application Support/soundkey/`.
- Extension globals, the AudioWorklet processor name and test fixtures use `Soundkey` / `soundkey`.
- No fallback to the old environment variable names or the old data directory is implemented. The owner moves existing data once (see [recovery runbook](../runbooks/recovery.md)).

## Consequences

- Existing installs do not find their cards and recordings until the directory is moved.
- Any script that sets `FENGSONG_*` variables or calls `fengsong` must be updated.
- Accepted ADRs written before this change (ADR-0001 to ADR-0005) still use the former name and path, as a record of what was decided at the time.
- The Soundkey trademark and distribution risks in ADR-0006 are unchanged.
