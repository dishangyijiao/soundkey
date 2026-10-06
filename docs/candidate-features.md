# Candidate features

Status: draft, **priorities not set**. Every row comes from evidence in the repository; the "Comes from" column says where. The "Priority" and "Reason" columns are for the owner: **M**ust, **S**hould, **C**ould or **W**on't (this time), each with a reason. Nothing here is a decision until the owner fills it in.

This page lists candidates and records the owner's choices. It does not restate a feature's status: that stays in [requirements](requirements.md) and the [status page](status.md), which the "Tracked in" column points to.

How to use it: read the rows, fill in Priority and Reason, and keep Won't rows with their reason so a dropped idea is not mistaken for a forgotten one.

## Journey (what happens while watching)

| ID | Candidate | Comes from | Tracked in | Priority | Reason |
|---|---|---|---|---|---|
| CF-01 | Show the whole sentence for a clicked word | PRD-001 journey step 2 | REQ-001 | | |
| CF-02 | Look a word up from the sentence | PRD-001 journey step 2 | REQ-002 | | |
| CF-03 | Keep a sentence to practice | PRD-001 journey step 3 | REQ-003 | | |
| CF-04 | Hear the original audio of the sentence | PRD-001 journey step 4 | REQ-004 | | |
| CF-05 | Read aloud and see which sounds were wrong | PRD-001 journey step 5 | REQ-005 | | |
| CF-06 | Read the same sentence several times and see the change | PRD-001 success criterion 2 | REQ-006 | | |
| CF-07 | Help understand what the whole sentence means | PRD-001 journey step 6 | REQ-007 | | |
| CF-08 | Show the neighboring sentences for context, not only complete a split sentence | PRD-001 "to be confirmed" | status item 6 | | |
| CF-09 | Click the word in YouTube's own caption, not only in the side panel | PRD-001 "to be confirmed" | status item 6 | | |
| CF-33 | End a shown sentence at an end-of-sentence mark inside a caption piece, so one sentence never holds two (the automatic way to get correct boundaries) | Measured 2026-10-06 on one real video: 3.4% of pieces; not the cause of the screenshot, see REQ-001 | REQ-001 | W | Owner decision 2026-10-06: not now. Only 3.4% of pieces on the one video measured; no word timing, so times would be estimates saved into cards. Revisit after the trial if it gets in the way |
| CF-34 | Open the side panel only on YouTube pages | Owner request 2026-10-06 | not a requirement yet | | Done in `background.js`; not checked in a real browser |
| CF-35 | Hide YouTube's recommended videos on watch pages | Owner request 2026-10-06 | not a requirement yet | | Done in `youtube.css`; the right column is hidden too so the video fills the width (measured on a real watch page); live chat is hidden with it; not yet checked visually in the browser |

## Progress and analysis

| ID | Candidate | Comes from | Tracked in | Priority | Reason |
|---|---|---|---|---|---|
| CF-10 | Show progress per sound, relative to the owner's own starting point | PRD-001 success criterion 2 | REQ-009 | | |
| CF-11 | Show how many days a week the owner practiced | PRD-001 success criterion 3 | REQ-010 | | |
| CF-12 | Analyze one's own data with SQL or CSV | PRD-001 goals | REQ-008 | | |
| CF-13 | A command or server that exposes the data beyond SQL or CSV (for example an export command) | status item 10 ("to be confirmed", no request recorded) | status item 10 | | |
| CF-14 | Point out which sounds are the owner's blind spots | PRD-001 supporting goal, "to be confirmed" | not tracked | | |
| CF-15 | Hear the real speaker's sentence next to a clean reference | PRD-001 supporting goal, "to be confirmed" | not tracked | | |

## Pronunciation engine

| ID | Candidate | Comes from | Tracked in | Priority | Reason |
|---|---|---|---|---|---|
| CF-16 | Analyze the video's actual connected speech instead of comparing with a synthesized reference | PRD-001 open question | not tracked | | |
| CF-17 | Compare other phoneme models or alignment-free scoring on the owner's recordings | ADR-0003 review | status item 8 | | |

## Reliability and operations

| ID | Candidate | Comes from | Tracked in | Priority | Reason |
|---|---|---|---|---|---|
| CF-18 | Clean up audio files left unmatched after an interrupted save | architecture overview, recovery runbook | status "Gaps" | | |
| CF-19 | Verify rapid recording starts, edits during capture and panel closure | SPEC-002 | status "Gaps" | | |
| CF-20 | Exercise application rollback | recovery runbook | status "Recovery runbook validation" | | |
| CF-21 | Tag the remaining requirements' tests with their IDs | status "Gaps" | status "Gaps" | | |
| CF-22 | Observe a remote CI run | CI workflow | status item 7 | | |

## Release

| ID | Candidate | Comes from | Tracked in | Priority | Reason |
|---|---|---|---|---|---|
| CF-23 | Release to other people (a Chrome extension anyone can install) | PRD-001 target users, "possible later step" | status item 10 | | |
| CF-24 | Choose a project license, add `LICENSE` and `CONTRIBUTING.md`, generate a dependency license report | status item 9 | status item 9 | | |
| CF-25 | Decide whether the model and dictionary are exported by each user or bundled | status items 9 and 10 | status item 10 | | |
| CF-26 | Choose an official Chinese product name | ADR-0006 ("none chosen") | ADR-0006 | | |

## Already decided: Won't

The owner confirmed these as non-goals. They are listed so they are not proposed again.

| ID | Candidate | Comes from | Priority | Reason |
|---|---|---|---|---|
| CF-27 | Accounts or cloud sync | PRD-001 non-goals (confirmed) | W | Owner-confirmed non-goal: data stays on the machine |
| CF-28 | A phone version, or browsers other than desktop Chrome | PRD-001 non-goals (confirmed) | W | Owner-confirmed non-goal |
| CF-29 | Teaching grammar or vocabulary, or offering courses | PRD-001 non-goals (confirmed) | W | Owner-confirmed non-goal: the product is only about sounds |
| CF-30 | Turning a whole video into text | PRD-001 non-goals (confirmed) | W | Owner-confirmed non-goal: it handles only the one sentence the owner picks |
| CF-31 | Support for video sites other than YouTube | [migration assessment](migration.md), status page migration notes (owner confirmed no additional video-site support) | W | Owner-confirmed at the migration checkpoint |
| CF-32 | Let the owner move the start or end of the current sentence by hand, and reset it | Controls removed 2026-10-05 | W | Owner decision: sentence boundaries are found by the program, with no manual intervention |
