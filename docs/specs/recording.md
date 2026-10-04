# SPEC-002: Record and submit a pronunciation attempt

Status: reconstructed from implementation and existing tests on 2026-10-03. This describes current behavior and distinguishes unverified failure cases from guarantees.

## Context and contracts

Intent: [PRD-001](../product/PRD-001-hear-the-sounds-you-miss.md). Requirements: [REQ-005/006](../requirements.md#req-005-read-aloud-and-see-which-sounds-were-wrong). Structure: [architecture](../architecture/README.md). Decisions: [local API security](../adr/ADR-0001-local-api-access-control.md), [local service](../adr/ADR-0002-local-server-and-extension.md), [storage](../adr/ADR-0005-sqlite-and-local-files.md). Comparison semantics: [SPEC-001](scoring.md).

Request bodies, supported durations, response schemas and HTTP errors are defined by [OpenAPI](../../contracts/openapi/openapi.json), operations `createAttempt`, `createWordAttempt` and `attemptAudio`. This document specifies the interaction around those operations rather than duplicating their definitions.

## Preconditions and states

The UI needs a selected saved card or saved word and a connected service before enabling a new recording. Microphone permission must be granted. The following states describe observable interaction, not additional persisted data.

| State or event | Current behavior | Next state |
|---|---|---|
| Idle; start with permission granted | Clear the old hint and request the microphone stream | Starting capture |
| Idle; permission needs asking or cannot be queried | Open the extension permission page; recheck after it closes | Starting capture if granted, otherwise idle with a permission hint |
| Permission denied | Open extension site settings and show a permission hint | Idle |
| Capture setup fails | Show a hint; if worklet loading failed, release tracks and close the audio context | Idle |
| Capture starts | Collect samples; the owning read button becomes stop, and the other target kind is disabled | Recording |
| Stop for the recording's target kind | Disconnect capture, release tracks, close the audio context, encode the collected samples and submit | Uploading |
| Read action during upload | Ignore the action and keep the read button disabled | Uploading |
| Upload completes or reports an error | Clear recording state, refresh the relevant list, display any failure hint | Idle |

The permission page immediately stops its temporary stream; actual recording is performed by the panel. Repeated permission prompts are guarded. Evidence: [mic.js](../../extension/mic.js), `askMicrophone`, `toggleRecord` and `readState` in [sidepanel.js](../../extension/sidepanel.js), and `readButton` in [cues.js](../../extension/cues.js).

## Capture, submission and persistence

The audio worklet gathers samples in the panel. On stop, helpers concatenate and resample them, then encode the WAV body. The selected target ID is captured when recording starts and determines the upload destination; changing the selected item does not rewrite that destination. The server reads the target's text when it receives the request. This flow does not lock text edits for the whole recording duration.

The server resolves the target, checks speech availability, validates/decodes the audio and enforces the contract's duration bounds after resampling. Duration endpoints are inclusive. The current short-recording check measures sample count, not audible speech energy; its message is not evidence of silence detection. Unsupported WAV encodings and malformed audio are rejected by [wav.rs](../../src/wav.rs).

After successful comparison, the server writes the uploaded recording bytes and inserts an attempt record. Failed database insertion triggers an attempt to delete the new audio file. This cleanup is best effort; a filesystem failure or process interruption can leave an orphan file. The HTTP success response follows both successful writes. Playback resolves a stored attempt's path; an unknown attempt or missing file is reported as unavailable.

Exact request-size enforcement belongs to the router in [server.rs](../../src/server.rs). Both attempt operations describe the router's 413 `text/plain` response in OpenAPI, and the contract integration test exercises it for cards and words.

## Errors, concurrency and retries

- The panel displays an API error explanation when available, otherwise a fallback. A failed upload request produces a local-service-unavailable hint. Failure to refresh the list after upload does not leave the UI stuck in the uploading state.
- Once recording is active, card and word capture exclude one another; a read action for the other kind cannot stop the active recording. Upload actions are guarded. There is no explicit guard covering every asynchronous step before capture starts, so rapid starts during setup are not guaranteed to be serialized.
- Each successful POST creates a new attempt; there is no request deduplication key. A lost response does not prove that saving failed. The panel does not automatically retry an upload.
- No automatic duration cutoff, upload timeout, durable upload queue or recovery after the panel closes is implemented in this flow. These are observed limits, not newly approved product requirements.
- Server access policy remains in ADR-0001. The panel's disabled buttons are not server authorization or input validation.

## Verification and remaining decisions

| Behavior | Existing evidence |
|---|---|
| Permission, cleanup, active recording exclusion and upload recovery | `recording permission:`, `recording failure:` and `recording:` cases in [sidepanel.test.js](../../test/sidepanel.test.js) |
| Permission-page lifecycle and sample processing | [mic.test.js](../../test/mic.test.js), [recorder-worklet.test.js](../../test/recorder-worklet.test.js), [audio.test.js](../../test/audio.test.js) |
| Audio bounds and request size | `unusable_recordings_are_rejected_with_a_reason`, `a_body_over_three_megabytes_is_refused_before_it_is_read` in [server.rs](../../src/server.rs) |
| Persistence, playback and missing dependencies | Recording, save failure and model availability tests in [server.rs](../../src/server.rs), storage tests in [store.rs](../../src/store.rs) |
| API access and response shapes | Access-policy tests in [server.rs](../../src/server.rs), [contract tests](../../src/contract.rs) |

Panel closure, rapid starts before capture is active, editing during recording, response loss and crash recovery are not claimed to have end-to-end verification. Repeat-attempt comparison remains an open design choice under [REQ-006](../requirements.md#req-006-read-the-same-sentence-several-times-and-see-the-change); documenting the current flow does not depend on choosing that UI.
