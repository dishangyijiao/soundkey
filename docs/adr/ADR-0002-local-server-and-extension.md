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

Why this split was chosen: to be confirmed. The next two points are inferences with no written evidence:

- Inferred: running the model and phoneme synthesis inside the browser was impractical, so they run in a local process.
- Inferred: the user's recordings stay on the machine and are not uploaded.

## Decision

- The extension only does the interface and caption capture; it does not run the model.
- The local server exposes an HTTP API for synthesis, recognition, scoring and storage, and keeps its data in `~/Library/Application Support/fengsong/`.
- The two talk over `127.0.0.1`; access control is in ADR-0001.

## Alternatives Considered

Which options were compared historically: to be confirmed; nothing is recorded in the repository.

## Consequences

### Positive

- Recordings and cards stay on the user's own computer (see the second inference above, to be confirmed).
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
