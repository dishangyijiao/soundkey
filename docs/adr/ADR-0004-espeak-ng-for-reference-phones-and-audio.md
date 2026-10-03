# ADR-0004: Use espeak-ng for reference phonemes and reference speech

## Status

Accepted (written after the fact, 2026-10-03)

## Context

Scoring needs reference phonemes ("what it should sound like"), and the interface needs to play the reference speech.

Facts confirmed in the repository:

- `espeak-ng` is called as an external command (`Command::new` in `src/espeak.rs`), not linked as a library.
- The same program gives the reference IPA (`/phones`) and synthesizes the reference speech (`/speak`).
- To synthesize a single IPA phoneme as sound, it has to be mapped to espeak's own mnemonic and vowels get a stress mark; otherwise a reduced vowel no longer sounds like the phoneme that was asked for. Every entry of the mapping table has a round-trip test: espeak must read the code back as the same IPA (comments and tests in `src/espeak.rs`).
- When `espeak-ng` is not installed, the tests that need it fail on purpose instead of being skipped (`README.md`).

Why espeak-ng was chosen. **Confirmed by the owner:** it can give phonemes from text offline and for free. A second reason offered in the interview (sharing labels with the model in ADR-0003) was not chosen.

## Decision

- Both the reference phonemes and the reference speech come from the local `espeak-ng`.
- It is called as a subprocess and the user installs it (`brew install espeak-ng`).
- User text is passed after `--` so that text starting with `-` is not read as an option (comment in `src/espeak.rs`).

## Alternatives Considered

Which options were compared: not recorded.

## Consequences

### Positive

- No pronunciation dictionary to maintain.
- A subprocess is isolated, so a crash does not take the main program down.

### Negative

- The user has to install `espeak-ng` themselves, and the synthesized voice sounds robotic.
- The phoneme mapping table has to be guarded by tests, and changing it is risky.

### Risks

- The license of `espeak-ng` is to be confirmed. Calling it as a subprocess has different legal implications from linking it into the program; check before open sourcing.

## Related

- ADR-0002, ADR-0003
- Implementation: `src/espeak.rs`
