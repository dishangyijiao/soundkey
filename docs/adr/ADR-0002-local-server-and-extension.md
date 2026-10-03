# ADR-0002: A Chrome extension plus a local Rust server; scoring and storage stay on the machine

## Status

Accepted (written after the fact, 2026-10-03). This records a practice that already existed; the original discussion left no text.

## Context

What Fengsong does: pick one caption sentence from YouTube, play the reference pronunciation, record the user reading it, compare phoneme by phoneme, and point out which phoneme was wrong.

Facts confirmed in the repository:

- The initial commit message says "pick a sentence, read it aloud, and compare phonemes locally" (in Chinese).
- The extension owns the interface and caption capture: `extension/sidepanel.*` is the side panel, and `extension/page.js` and `content.js` read captions inside the YouTube page.
- The local server synthesizes speech, recognizes phonemes, scores, and stores cards and recordings: `src/server.rs`, `src/asr.rs`, `src/espeak.rs`, `src/store.rs`.
- The server listens only on `127.0.0.1:17321` (`src/paths.rs`).

Why this split was chosen. **Confirmed by the owner:** to avoid paying for cloud services. Two other reasons were offered to the owner in the interview (keeping recordings private, and the model not being able to run inside a browser) and were not chosen, so they are not recorded as reasons.

## Decision

- The extension only does the interface and caption capture; it does not run the model.
- The local server exposes an HTTP API for synthesis, recognition, scoring and storage, and keeps its data in `~/Library/Application Support/fengsong/`.
- The two talk over `127.0.0.1`; access control is in ADR-0001.

## Alternatives Considered

A cloud service is the alternative the owner's reason points to. Which other options were compared: not recorded.

## Consequences

### Positive

- No cloud cost.
- Recordings and cards stay on the user's own computer. This is a consequence; the owner did not name it as a reason.
- Scoring is plain Rust code that can be tested on its own, without a browser.

### Negative

- The user must install and start the local program first; the extension alone does not work. This is the biggest obstacle to letting others use it, see the distribution item in `docs/status.md`.
- The two components carry separate versions, kept equal by a test in `src/consistency.rs`.

### Risks

- When the local program is not running the extension can only say it is off, which is a poor experience.

## Related

- ADR-0001: access control of the local API
- ADR-0003: phoneme model
- ADR-0004: speech synthesis
- ADR-0005: local storage
