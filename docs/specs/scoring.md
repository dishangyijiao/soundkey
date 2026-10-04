# SPEC-001: Recording comparison and score presentation

Status: reconstructed from implementation and existing tests on 2026-10-03. This specifies current behavior; it does not approve a new scoring algorithm or claim diagnostic accuracy.

## Context and boundaries

- Intent: [PRD-001](../product/PRD-001-hear-the-sounds-you-miss.md).
- Requirements: [REQ-005 and REQ-006](../requirements.md#req-005-read-aloud-and-see-which-sounds-were-wrong).
- Decisions: [model](../adr/ADR-0003-phoneme-model-wav2vec2-onnx.md), [reference speech](../adr/ADR-0004-espeak-ng-for-reference-phones-and-audio.md), [storage](../adr/ADR-0005-sqlite-and-local-files.md).
- Structure and security boundary: [architecture](../architecture/README.md).
- HTTP inputs, outputs and errors: [OpenAPI](../../contracts/openapi/openapi.json), operations `createAttempt` and `createWordAttempt`, schemas `Score`, `ScoreColumn`, `ScoredWord` and `AttemptResult`. Those definitions remain canonical for field shapes.
- Recording lifecycle and request failures: [SPEC-002](recording.md).

## Reference and recognized sounds

The server looks up the target's stored text before scoring. A client recording does not supply a replacement scoring text.

Reference generation uses espeak-ng's configured English voice. It first processes the whole sentence, retaining the engine's sentence context. If the engine's word boundaries do not match the application's tokenization, it falls back to generating each word separately. Text with no words, or a reference with no phones at all, is rejected. Exact tokenization and normalization are implemented in [espeak.rs](../../src/espeak.rs) and [align.rs](../../src/align.rs).

Reference phones already in the model vocabulary remain intact. An unknown phone is split using the longest available matching pieces from left to right; if any part cannot be represented, the original phone is retained. An empty vocabulary leaves the reference unchanged. The model recognizes the owner's audio, not the video's original speech; [asr.rs](../../src/asr.rs) owns recognition details.

## Observable comparison rules

1. Compare the complete ordered reference and recognized sequences using minimum edit cost: matching costs zero; substitution, deletion and insertion each cost one. When alternatives tie, prefer the diagonal match/substitution, then deletion, then insertion. Word boundaries do not split the alignment into independent comparisons.
2. A matching column contains equal phones and neither is marked bad. A substitution contains both phones, both marked bad. A deletion has only a bad reference phone; an insertion has only a bad recognized phone.
3. Removing empty cells from either side of the columns reconstructs that side's original sequence in order.
4. The displayed hit count counts matches; its denominator is the number of reference phones. Insertions are marked as errors but do not increase the denominator or directly subtract from the hit count. A full hit ratio can therefore coexist with an insertion error.
5. Errors with the same kind, source phone, destination phone and sound class are grouped, retaining first-occurrence order and accumulating counts. Classification uses the reference phone for substitutions/deletions and the recognized phone for insertions. The exact vowel inventory belongs in `sound_class` in [align.rs](../../src/align.rs).

The pure comparison accepts empty sequences: two empty inputs yield no columns; an empty reference yields insertions; an empty recognized sequence yields deletions. This does not remove the reference-text validation in the request flow.

## Word attribution and presentation

Columns with reference phones belong to the corresponding reference word. Insertions stay with the current word (normally the preceding word); leading insertions belong to the first word with reference phones, or the final word when every span is empty. Word spans must sum to the reference length; otherwise word attribution is omitted rather than guessed. A word is marked bad if any column assigned to it is not a match.

The sentence view highlights bad words and lets the owner inspect their phone comparison. Without per-word results it falls back to the full comparison grid. When the number of scored words differs from the displayed text's word count, the text gets no per-word highlighting. The saved-word detail uses the grid directly. Missing phones occupy empty cells, so the two rows stay aligned. The presentation implementation is [sidepanel.js](../../extension/sidepanel.js); compatibility fallbacks are in [cues.js](../../extension/cues.js).

## Stored results and repeat attempts

Each accepted submission creates an attempt. Loading a stored result recomputes alignment from its saved reference/recognized phone sequences and word spans using the current algorithm; it does not rerun audio recognition. An algorithm change can therefore change the displayed interpretation of an older attempt and requires an explicit compatibility review.

A card's displayed score is the latest attempt whose text snapshot matches its current text. Its playback recording is independently the latest attempt for that card, even if the text has since changed. Saved words show their latest attempt. Invalid stored score JSON yields no displayed score. Queries order by creation time; equal timestamps have no explicit secondary ordering.

Current repeat-attempt and history limitations remain in [REQ-006](../requirements.md#req-006-read-the-same-sentence-several-times-and-see-the-change). This spec does not introduce a history UI, progress metric or pass threshold.

## Verification

| Behavior | Existing evidence |
|---|---|
| Comparison, insertion denominator, grouping and word attribution | Tests in [align.rs](../../src/align.rs), including `insertion_does_not_change_denominator`, `identical_errors_are_grouped_and_different_ones_are_not` and `an_inserted_phone_belongs_to_the_word_before_it_and_a_leading_one_to_the_first` |
| Sequence preservation, edit distance and complete word ranges | Property tests in [align.rs](../../src/align.rs) |
| Reference extraction and fallback | Tests in [espeak.rs](../../src/espeak.rs) |
| Stored results and edited text | [store.rs](../../src/store.rs): `old_score_json_is_realigned_when_read`, `duplicate_youtube_card_is_reused_and_edited_text_hides_score`, `word_attempts_give_the_word_its_latest_score_and_playable_audio` |
| Grid, highlighting and word detail | `scoring:` and `word detail:` tests in [sidepanel.test.js](../../test/sidepanel.test.js), [cues.test.js](../../test/cues.test.js) |
| Submission and response shape | Recording tests in [server.rs](../../src/server.rs), [contract.rs](../../src/contract.rs) |

The tie preference and equal-timestamp limitation were read from code; they are not claimed to have dedicated regression tests. Fixture-based recognition tests do not establish pronunciation accuracy for the owner's voice. Product questions remain in the PRD and requirements.
