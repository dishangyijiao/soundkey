# ADR-0008: Keep the SoundKey name and exclude the UK from release

## Status

Accepted (owner-confirmed, 2026-10-04). Resolves the UK question left open in [ADR-0006](ADR-0006-adopt-soundkey-as-the-product-name.md).

## Context

[ADR-0006](ADR-0006-adopt-soundkey-as-the-product-name.md) recorded a UK trademark journal entry for a SoundKey application covering downloadable software and SaaS for acoustic authentication, a separate SoundKey Chrome extension project on Devpost, and other uses of the name in software and audio products. It noted that this was not a full clearance and that excluding the UK from a listing had not been decided.

## Decision

- Keep **SoundKey** as the product name.
- When the extension is listed, do not make it available in the United Kingdom.

## Consequences

- The UK conflict found so far is avoided by territory. Other territories, the Devpost project and the other uses of the name remain unchecked beyond what ADR-0006 records.
- No full trademark clearance has been done for any territory; one is still needed before a public listing in a territory that matters to the owner. Whether to commission one is to be confirmed.
- The listing configuration must exclude the UK. No listing exists yet, so nothing is configured today.
