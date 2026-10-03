# Requirements

Draft (2026-10-03), derived from `docs/product/PRD-001-hear-the-sounds-you-miss.md`. Each requirement says what must be true, how to tell, where it comes from, and whether it holds today. The status is judged from the code and the tests; it is not a promise.

Statuses: **Implemented** (holds and is tested), **Partial** (part of it holds), **Not implemented**, **To be confirmed** (the owner has not decided what it should be).

| ID | Requirement | Comes from | Status |
|---|---|---|---|
| REQ-001 | Show the whole sentence, not a caption fragment | Journey step 2 | Implemented |
| REQ-002 | Look a word up from a sentence | Journey step 2, goal "hear these sounds" | Implemented |
| REQ-003 | Keep a sentence to practice | Journey step 3 | Implemented |
| REQ-004 | Hear the original audio of the sentence | Journey step 4 | Implemented |
| REQ-005 | Read aloud and see which sounds were wrong | Journey step 5, goal "pronunciation" | Implemented |
| REQ-006 | Read the same sentence several times and see the change | Journey step 5, criterion 2 | Partial |
| REQ-007 | Help the owner understand what the sentence means | Journey step 6 | To be confirmed |
| REQ-008 | The owner can analyze their own data with SQL or CSV | Goal "analyze data" | Implemented, untested |
| REQ-009 | Show progress per sound, relative to the owner's own start | Success criterion 2 | Not implemented |
| REQ-010 | Show how many days a week the owner practiced | Success criterion 3 | Not implemented |

## REQ-001: Show the whole sentence

**Requirement.** The sentence shown for practice is the whole sentence the current caption belongs to, even when YouTube splits it into several caption pieces.

**Acceptance criteria.**

- Neighboring pieces are joined until a piece ends with sentence-ending punctuation (`.`, `?`, `!`, `…`, with closing quotes or brackets allowed) or the gap to the next piece is more than 1200 ms.
- A joined sentence never has more than 5 pieces or lasts more than 20 000 ms. A single piece that is already longer than that is still shown whole.
- The owner can move either edge of the range by one piece, and can reset it.

**Evidence.** `extension/sentence.js` (`LIMITS`, `sentenceRange`, `moveEdge`), `extension/content.js`. Tests: `test/sentence.test.js` (including the property tests), `test/content.test.js`, `test/sidepanel.test.js` ("adjust caption").

## REQ-002: Look a word up from a sentence

**Requirement.** Clicking a word of a sentence shows how it is pronounced and what it means, and lets the owner save it.

**Acceptance criteria.**

- The popup shows the IPA and the dictionary definition, or says there is no definition.
- When the local dictionary is not installed, the owner is told to run `fengsong setup-dict`.
- A word can be saved to the notebook together with its sentence and video time.

**Evidence.** `extension/sidepanel.js` (word popup), `GET /lookup` and `POST /words` in `contracts/openapi/openapi.json`, `src/server.rs`. Tests: `test/sidepanel.test.js` ("popup"), `src/server.rs` and `src/contract.rs`.

## REQ-003: Keep a sentence to practice

**Requirement.** A sentence can be kept as a card, either picked from a YouTube video with its video id and time range, or pasted in as text.

**Acceptance criteria.**

- A picked sentence needs a video id, a start and an end time; a pasted one needs none.
- The text is 1 to 1000 characters after trimming.
- Picking a sentence from a video again, with the same text, video and start time, returns the existing card instead of creating another. Pasted sentences are not deduplicated.

**Evidence.** `POST /cards` in the contract, `src/server.rs`, `src/store.rs` (`create_card`, `find_youtube`). Tests: `src/server.rs`, `src/store.rs`, `src/contract.rs`, `test/sidepanel.test.js` ("pick this sentence", "paste a sentence").

## REQ-004: Hear the original audio

**Requirement.** The owner can play the original audio of the picked sentence, from its start to its end, in the YouTube video it came from.

**Acceptance criteria.**

- Playback starts at the sentence start and pauses near its end.
- When the original video is not open in a tab, the owner is told to open it.

**Evidence.** `extension/content.js` (`play-range`), `extension/background.js`. Tests: `test/content.test.js` ("play-range"), `test/background.test.js`.

## REQ-005: Read aloud and see which sounds were wrong

**Requirement.** The owner records reading a sentence or a word and sees, phoneme by phoneme, which sounds did not match the reference.

**Acceptance criteria.**

- A recording of 0.2 to 30 seconds (after resampling to 16 kHz) is accepted; shorter or longer is refused with a message.
- The result has `match_count`, `expected_count`, and one column per phoneme saying `match`, `sub`, `del` or `ins`.
- Wrong phonemes are marked, and the words that contain them are marked.
- The recording is kept and can be played back.

**Evidence.** `POST /cards/{id}/attempts` and `POST /words/{id}/attempts` in the contract, `src/server.rs` (`score_recording`), `src/align.rs`, `src/wav.rs`. Tests: `src/align.rs` (including property tests), `src/server.rs`, `src/contract.rs`, `test/sidepanel.test.js` ("recording").

## REQ-006: Read the same sentence several times and see the change

**Requirement.** The owner can read the same sentence two or three times in a row, and see whether the result got better.

**Acceptance criteria.**

- Every attempt is stored with its own recording and score.
- The owner can see the score of the latest attempt, and compare it with the earlier ones.

**Status: Partial.** Every attempt is stored (`attempts` table). The interface shows only the latest score; there is no view of the earlier attempts, so the comparison cannot be made without querying the database.

**Evidence.** `src/store.rs` (`insert_attempt`, `list_cards` returns the latest attempt only). Tests cover storing and the latest score.

## REQ-007: Help the owner understand what the sentence means

**Requirement.** To be confirmed. The journey ends with "understand what it means", and the owner has not said how the product should help.

**What exists.** A dictionary entry for a single word (REQ-002). Nothing gives the meaning of a whole sentence.

**Question for the owner.** Is a word-by-word dictionary enough, or is a translation of the sentence wanted? A translation would need either a network service or another local model, which affects ADR-0002 (no cloud cost).

## REQ-008: The owner can analyze their own data with SQL or CSV

**Requirement.** Everything the owner produces (cards, attempts with their per-phoneme scores, words, recordings) is in files and formats that ordinary tools can read.

**Acceptance criteria.**

- Cards, attempts and words are tables in one SQLite file.
- A score is stored as JSON with one entry per phoneme, so a per-sound query is possible with SQLite's JSON functions.
- Recordings are WAV files named after the attempt id.

**Status: Implemented by design, untested.** It follows from ADR-0005. It was verified by hand on 2026-10-03 with two queries (most frequent wrong sounds, hit rate per attempt). No automated test pins it, so a change to the score format could break such queries without any test failing.

**Evidence.** ADR-0005, `src/store.rs`, `contracts/openapi/openapi.json` (the `Score` schema).

## REQ-009: Show progress per sound, relative to the owner's own start

**Requirement.** The product shows, for each sound the owner practices, whether its hit rate has gone up compared with the owner's own starting point.

**Acceptance criteria.** As proposed in PRD-001 (not yet approved):

- Per-sound hit rate = share of score columns with that expected phoneme whose status is `match`.
- Baseline = the first 10 occurrences of the sound; recent = the latest 10; improvement = recent minus baseline, in percentage points.
- A sound is judged only after at least 20 occurrences.

**Status: Not implemented.** The data needed is already stored in every score.

## REQ-010: Show how many days a week the owner practiced

**Requirement.** The product shows how many days in the current week had at least one recorded attempt, against the owner's target of 3 or more.

**Status: Not implemented.** The data needed (`attempts.created_at`) is already stored. "A day with at least one attempt" is the proposed definition of one practice time and is not yet approved.
