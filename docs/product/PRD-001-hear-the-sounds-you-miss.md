# PRD-001: Hear the sounds you miss

## Status

Draft (2026-10-03). Written from an interview with the owner. Every statement is marked **Confirmed** (said by the owner), **Observed** (a fact in the repository) or **To be confirmed**. Nothing is inferred silently.

## Problem

**Confirmed.** While watching English videos on YouTube, the owner cannot understand some of what is said. Not everything: only certain words, because of certain vowels, consonants, or linked speech.

**Confirmed (the owner's own explanation).** The word is not understood because the owner may have pronounced, and therefore learned, that word wrongly before, so the sound heard does not match the sound the owner has in mind.

**Confirmed.** The current workaround is the subtitles, then looking the word up to see how it is pronounced. This does not always work: a word can have several pronunciations, and in connected speech the sound can change again.

## Target users

- **Confirmed:** for now, only the owner. Making it usable for others (open source, a Chrome extension anyone can install) is a possible later step.
- **To be confirmed:** who those other users would be (for example, Chinese speakers learning English).

## Goals

- **Confirmed:** be able to hear these sounds while watching videos.
- **Confirmed:** also get the owner's own pronunciation right. The owner chose "listening and pronunciation are both goals, equally important".
- **Confirmed:** be able to analyze their own practice data with SQL or CSV (said by the owner when explaining why SQLite was chosen, and earlier when asking about data analysis).
- **To be confirmed (supporting goals, not yet said by the owner):**
  - find out which sounds are the owner's blind spots;
  - hear the real speaker's sentence next to a clean reference.

## Non-goals

**Confirmed.** The product will not:

- have accounts or cloud sync (data stays on the machine);
- have a phone version or support browsers other than desktop Chrome;
- teach grammar or vocabulary, or offer courses (it is only about sounds);
- turn a whole video into text (it handles only the one sentence the owner picks).

## Scope

**Observed.** Today the product lets the owner pick a caption sentence from a YouTube video, replay the original clip, hear a reference pronunciation, record themselves reading it, see a phoneme-by-phoneme comparison, and keep a word notebook with dictionary entries. See ADR-0002 to ADR-0005.

**Confirmed.** Pronunciation practice is a goal in its own right, next to listening, so the features built around the owner's speaking stay in scope. The owner's working belief is that a sound you cannot say right is often a sound you cannot hear; that link is a belief, not something verified.

**Open question.** The reference pronunciation is generated word by word from a dictionary-style engine (espeak-ng), while the problem the owner describes includes connected speech, where sounds change. The current product does not show what the speaker in the video actually said at the phoneme level. Whether it should is undecided.

## User journeys

**Confirmed.** The journey the owner wants, in order:

1. While watching, the owner meets a word that is not understood.
2. The owner clicks that word, and the whole sentence it belongs to appears, complete with the sentences before and after it.
3. The owner picks that sentence.
4. The owner listens to the original audio.
5. The owner reads the sentence aloud two or three times.
6. The owner understands what it means.

**To be confirmed.**

- Where the word is clicked: in the video's own caption on the YouTube page, or in the side panel.
- How the product helps with step 6. Today it can show a dictionary entry for one word; it does not give the meaning of a whole sentence.
- Whether "the sentences before and after" means only completing a sentence that YouTube split into pieces, or also showing the neighboring sentences for context.

## Success criteria

**Confirmed.** The product is a success when:

1. While watching videos, the owner can hear the sounds that used to be missed.
2. The read-aloud hit rate for the same sound visibly goes up over time.
3. The owner keeps using it every week.

### How each criterion is measured

1. **Hearing the sounds. Confirmed.** Judged by the owner alone. The owner's words: being able to hear it means being able to hear it without using the tool, so the owner will know. The product does not measure it.
2. **Hit rate going up.** The owner pointed out that hit rates differ from person to person, so the measure has to be relative to each person's own starting point, and asked for a simple algorithm. **Proposed, not yet approved:**
   - The hit rate of one attempt is `match_count / expected_count`, which is already stored in every score.
   - The hit rate of one sound is, over all stored attempts, the share of score columns whose expected phoneme is that sound and whose status is `match`.
   - For each sound, the baseline is its hit rate over its first 10 occurrences, and the recent value is its hit rate over its latest 10 occurrences. The improvement is recent minus baseline, in percentage points.
   - A sound is judged only after it has occurred at least 20 times, so the two windows do not overlap. Today the most frequent sound has 15 occurrences, so the window sizes may need to start smaller.
   - The criterion holds when the sounds the owner is working on show a positive improvement. The size that counts (for example 10 percentage points) is a starting value to adjust after seeing real data, not a decision.
3. **Using it every week. Confirmed:** 3 or more times a week. **Proposed:** one "time" is a day on which at least one read-aloud attempt is recorded, because a single sitting usually holds several attempts. The data to count this (`created_at` of each attempt) is already stored.

**Not chosen by the owner:** other people trying it and finding it useful. It is not a success criterion for now.

## Constraints

**Observed.**

- Data stays on the owner's machine; nothing is uploaded (ADR-0002).
- It needs the Chrome extension plus a local program, `espeak-ng` and an exported phoneme model (ADR-0002 to ADR-0004).
- Picking a sentence from a video needs a YouTube video with English captions; a sentence can also be pasted in, without a video.

## Related requirements

None written yet. They are derived from this PRD once the non-goals and the success criteria are confirmed.
