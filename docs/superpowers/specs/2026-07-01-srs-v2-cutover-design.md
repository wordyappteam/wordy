# SRS v2 Cutover — Design Spec

**Date:** 2026-07-01
**Branch:** `srs-v2` (→ merge to `main` at the end)
**Status:** Approved design, ready for implementation plan

## Goal

Make the v2 guided session the real, daily default so Nika (and her mom) can use
the whole system every day without thinking about which exercise to pick. Retire
the legacy `words`-based session path. This is the "use it daily" unlock and the
merge-to-`main` gate.

## Scope

**In scope**
1. Dashboard centered on a single **Start** CTA; standalone exercise tiles demoted
   to a secondary "Extra practice" area.
2. Dashboard counts/CTA sourced from `word_senses` (not the legacy `words` stages).
3. Auto-sized session with a hard per-session cap and new-word intake throttle.
4. **Chunked-block session rhythm** (deliberate encode→test cadence).
5. **Gap forgiveness** in SRS scoring (soften penalties after a break).
6. Remove dev-only fast-forward buttons from the session runner.
7. Retire legacy `planSession` / `completeSession` / `Session.jsx`; rename
   `/session-v2` → `/session`.
8. Data-safety verification (no dictionary entry disappears) + merge to `main`.

**Out of scope (separate later work)**
- Fill-in Phase 2, Verb Forms Trainer, Dictionary redesign.
- The standalone exercise tiles' internals (they stay, made exposure-only).
- An explicit **"Start learning these"** action to fast-track a collection into
  daily rotation (liked, parked for the future).

## Section 1 — Daily entry & Dashboard

- **One primary CTA:** a large **Start** button showing today's *bounded* dose —
  `"Start — 18 today"` (or `"Start learning"` when everything is new). The number
  is the **session size**, never the raw backlog.
- **Counts from `word_senses`:** due-today, new-available, and a small progress
  readout (learning / known / mastered).
- **Empty states:**
  - Nothing due + new available → `"You're caught up — learn 7 new?"`
  - Nothing due + no new → `"All caught up. Come back tomorrow ✨"`
- **After a session,** if more is genuinely waiting → a calm `"Nice work — keep
  going?"` (opt-in; never a red pile on entry).
- **Tiles** (Flashcards, Word order, Active recall, Sentence writing, Fill the
  sentences, collection practice) move into a collapsed **Extra practice** area.

## Section 2 — Session engine (`planSessionV2`)

### Pool selection (priority order, capped)
1. **Due reviews first** — oldest-due first; leeches / struggling words prioritized.
2. **New words fill leftover room** under the cap, up to the day's new budget.

Three independent knobs:

| Knob | Default | Controls |
|---|---|---|
| New intake | **~7 / day** | Max new words introduced per *day* (not per session) |
| Block size | **~5 words** | Words per encode→test block (rhythm) |
| Session cap | **~18 words** | Max total per session (new + due) |

**"Pause new when behind" is automatic** — new words only take slots the reviews
leave under the cap:

| Due reviews today | New added | Session |
|---|---|---|
| 8 | 7 | 15 (calm day) |
| 11 | 7 | 18 (full) |
| 15 | 3 | 18 (mostly catch-up) |
| 30 | 0 | 18 reviews · 12 roll to next session |

### New-word budget = per **day**, 0 on catch-up days
- Max ~7 new words per *day*, spent across however many sessions that day.
- **0 new on any day that starts behind** (due backlog exceeds one session).
- Rationale: each new word ≈ ~3 reviews over the next week; a per-day cap keeps
  future review load sustainable no matter how much the user grinds.
- Concretely: a behind day's "keep going" sessions are **reviews-only**; a normal
  light day fills to the cap with new words (12 due + 6 new = 18) in one session.

### Rhythm: chunked blocks
- Split the selected pool into **blocks of ~5 words**.
- Each block runs **encode → test**:
  - *Encode:* each word's flashcard + context card, anti-clustered so two senses of
    the same lemma aren't adjacent.
  - *Test:* one graded card per word in the block.
- New words and reviews are **mixed within blocks** for variety.
- Enough spacing (a few cards) passes between a word's encode and its graded test
  so the test is a real retrieval, not a give-away.

### Overflow & keep-going
- Due reviews beyond the cap simply **wait** (already scheduled) and are picked up
  oldest-first next session.
- **Keep going** lets the user start the next capped batch immediately, respecting
  the same day-budget rules (so keep-going on a behind day adds no new words).

## Section 3 — Gap forgiveness (SRS scoring)

A small addition to `applyVerdict`:

- **Gap definition (self-scaling):** a sense reviewed **more than its own interval
  late** (≈ waited twice as long as scheduled). A 7-day word forgives after ~7+
  days overdue; a 60-day word tolerates a far longer gap. No arbitrary day count.
- **On a gap review:**
  - **FAIL → softened to HOLD** — no demotion, no lapse counted; the word stays at
    its step and is rescheduled on a **short leash** (retry in ~1–2 days).
  - **PASS / almost** → behave normally (a clean recall after a gap still counts).
- Evaluated per-sense at grade time, so it naturally applies to the rusty words on
  the first session(s) back — no "first session" bookkeeping.

## Section 4 — Guided vs self-practice boundary

- **Guided session** is the *only* thing that **enrolls** words into the spaced
  review schedule and writes `interval_step`. Paced at ~7 new/day.
- **Collections & practice tiles** are free, uncapped, user-chosen — **exposure
  only, no scheduling side-effects.** This prevents drilling 40 new words in a
  collection from back-dooring around the 7/day protection and flooding next week.

## Section 5 — Retirement & rollout

- **Routing:** `/session-v2` → `/session` becomes the daily runner; strip the dev
  fast-forward date buttons (or hide behind a dev-only flag).
- **Delete legacy:** `Session.jsx`, `planSession`, `completeSession`; remove the
  `planSession` import/preview from the Dashboard.
- **Standalone tiles → exposure-only** (no SRS writes now that the legacy `words`
  schedule is retired); moved under "Extra practice."
- **Merge** `srs-v2` → `main` after verification on Nika's account (shared
  prod/preview DB — never test on mom's account).

### Data safety (hard requirement)
- **No dictionary entry disappears.** Retiring legacy *code* does not delete data;
  the `words` and `word_senses` tables and their rows are untouched.
- Because the app now reads from `word_senses`, add a **pre-merge check that every
  word has at least one `word_sense`**, and backfill any orphans (re-identify) so
  nothing silently drops from the dictionary view.
- **SRS progress is NOT required to be preserved.** Mom had little progress and was
  lost on the old system; a fresh start on v2 is acceptable (and better). Existing
  seeded `interval_step` (migration 0008) carries whatever it carries.

## Testing / verification

- Pure logic (`srs.js`): unit tests via `node --test` for the new pool-selection
  priority (reviews-first, day-budget throttle, pause-when-behind), block chunking,
  and gap forgiveness in `applyVerdict`.
- Manual click-through on the preview: normal day, behind day (via seeded due
  dates), keep-going, empty states, gap-forgiveness after a simulated break.
- Data-safety query: assert every `words` row for a user has ≥1 `word_senses` row.
- Build green (pre-commit hook) + existing 25 tests stay green.

## Open questions / deferred
- Exact default values (7 / 5 / 18) are tunable; start with these.
- "Start learning these" collection-enrollment action — future.
- Per-day new-budget needs a "new words introduced today" signal (e.g. count
  `word_senses` with `last_reviewed = today` and `interval_step` just advanced from
  0, or a lightweight per-day counter) — settle the exact mechanism in the plan.
