# ADR-0006: Adopt Soundkey as the product name

## Status

Accepted (owner-confirmed, 2026-10-04). The compatibility clause in the Decision section and the capitalization (now `SoundKey`) are superseded by [ADR-0007](ADR-0007-rename-internal-identifiers-to-soundkey.md). The UK question is resolved by [ADR-0008](ADR-0008-keep-the-soundkey-name-and-exclude-the-uk.md).

## Context

The product was previously named Fengsong. The owner said the name was difficult for users to understand and reopened the naming decision. The product helps someone watching an English video recover a sentence they missed or did not understand, then replay it, look up an unfamiliar word, and practice saying it. Listening and pronunciation are both goals; see [PRD-001](../product/PRD-001-hear-the-sounds-you-miss.md).

Names discussed included Fengsong, Heargrain, One More Listen, Second Listen, Catch That Line, and Soundkey. The owner asked whether Soundkey was already used by a Chrome extension, then chose Soundkey after a search did not find an exact-name listing in the Chrome Web Store.

The search did find a separate SoundKey Chrome extension project on Devpost, and public records include uses of SoundKey in software and audio products. A UK trademark journal published a SoundKey application covering downloadable software and SaaS for acoustic authentication. These findings are not a full trademark clearance, and the territorial scope for release has not been confirmed.

## Decision

- Use **Soundkey** as the product's Latin name in the Chrome extension listing, user-facing interface, and product documentation.
- Do not assign a Chinese name as part of this decision; none has been chosen.
- Keep existing executable, environment variable, internal code identifier, and local data-directory names for compatibility. The data directory remains `~/Library/Application Support/fengsong/`.

## Alternatives Considered

- **Fengsong** — the existing name; the owner said it was difficult for users to understand.
- **Heargrain** — discussed earlier, but not selected.
- **One More Listen**, **Second Listen**, and **Catch That Line** — scenario-oriented candidates discussed during naming; not selected.

## Rationale

The owner selected Soundkey after making Chrome Web Store name availability the main check. No exact-name listing appeared in that search. The owner has not provided a further explanation for preferring Soundkey over the other candidates; no additional rationale is inferred here.

## Consequences

### Positive

- The extension now presents a consistent Latin product name in Chrome and in the product documentation.
- Existing local data and executable identifiers remain usable without a data migration.

### Negative

- The name does not by itself explain the product's English-video sentence workflow; the positioning statement in PRD-001 supplies that context.
- Existing code, environment, and storage identifiers still contain the former name.

### Risks

- The Chrome Web Store search was an availability check, not a legal clearance. Existing SoundKey software and audio uses create a potential naming conflict.
- A UK SoundKey application covering software was found. UK availability has not been confirmed, and excluding the UK from a listing has not been recorded as a decision.

## Related

- Product identity and positioning: [PRD-001](../product/PRD-001-hear-the-sounds-you-miss.md)
- Historical migration snapshot: [migration assessment](../migration.md)
- Chrome Web Store name search: [SoundKey project on Devpost](https://devpost.com/software/soundkey)
- UK trademark journal: [UK00004304227](https://www.ipo.gov.uk/types/tm/t-os/t-tmj/tm-journals/2025-052/UK00004304227.html)
