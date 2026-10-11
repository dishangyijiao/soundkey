# Usage evidence

Record real listening and pronunciation practice here. This is **not** a second PRD, requirements list or scoring specification. Product intent and success criteria live in [docs/product/PRD-001-hear-the-sounds-you-miss.md](docs/product/PRD-001-hear-the-sounds-you-miss.md); observed implementation gaps are tracked in [docs/status.md](docs/status.md). Scores are tool feedback, **not** verified judgments of pronunciation or listening comprehension.

## Problem

When watching an English video, I sometimes cannot identify a word or sentence in natural speech. One hypothesis is that my learned pronunciation differs from the sound I hear. Reduction, connected speech, familiarity and other factors may also matter. The goal is improved **unaided listening**, not merely a higher tool-generated score.

## Usage

Use actual sentences that were difficult before consulting subtitles. Avoid publishing video transcripts, personal recordings or identifiable practice history. No personal improvement data has been entered in this file yet.

| Date | Listening sample (private ID) | Before practice: unaided recognition | Practice | Later: unaided recognition | Notes |
| --- | --- | --- | --- | --- | --- |
| — | Not recorded | Unmeasured | — | Unmeasured | — |

A useful attempt records what was heard **before** showing captions, followed by the original audio, practice and a delayed check without captions. If practical, compare with similar sentences not practiced in SoundKey. Replaying a familiar sentence alone can improve recall, so distinguish that from transfer to new listening.

## Outcome

**Unknown.** Record whether previously missed sounds or words become recognizable without subtitles, whether that generalizes to new speech, and whether the owner returns to use the tool each week. Distinguish self-reports, program measurements and independently assessed results.

## Friction

**To observe:** local setup time, model installation, microphone access, sentence segmentation, incorrect phoneme flags, and cases where a correct score does not help listening. Cite a reproducible example or sanitized issue when possible.

## Evidence

Use anonymized sample IDs, dated listening notes and relevant issue/test links. The published CI and coverage gates assess software behavior; they do not validate the pronunciation model against human raters. Do not commit copyrighted audio, full caption extracts or private recordings.

## Next

Conduct a short, repeatable personal trial before widening scope. Capture failed as well as successful listening attempts, then decide whether the next step is scoring validity, usability, or no change. Do not infer product-market fit from self-use.

### Entry template

#### YYYY-MM-DD — Listening session (observed / unmeasured)

- **Context / sample ID:**
- **Before:** What could I recognize without subtitles?
- **Use:** What listening and pronunciation steps did I take?
- **After / delayed retest:** What could I recognize unaided? Was the sample familiar or new?
- **Friction / suspected false feedback:**
- **Evidence:** Private observation or sanitized issue.
- **Next:** One testable change, or continue using the existing tool.
