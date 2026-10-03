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

**To be confirmed.** One journey as the owner described the problem: watching a video, hearing a word that is not understood, and then something to find out which sound it was. The steps after "hearing a word that is not understood" have not been described by the owner yet.

## Success criteria

**Confirmed.** The product is a success when:

1. While watching videos, the owner can hear the sounds that used to be missed.
2. The read-aloud hit rate for the same sound visibly goes up over time.
3. The owner keeps using it every week.

**To be confirmed.** How each one is measured: how "can hear it" is judged, over what period the hit rate should rise and by how much, and how many sessions a week counts as keeping it up. Without these, criteria 1 and 3 cannot be turned into a testable requirement yet.

**Not chosen by the owner:** other people trying it and finding it useful. It is not a success criterion for now.

## Constraints

**Observed.**

- Data stays on the owner's machine; nothing is uploaded (ADR-0002).
- It needs the Chrome extension plus a local program, `espeak-ng` and an exported phoneme model (ADR-0002 to ADR-0004).
- Picking a sentence from a video needs a YouTube video with English captions; a sentence can also be pasted in, without a video.

## Related requirements

None written yet. They are derived from this PRD once the non-goals and the success criteria are confirmed.
