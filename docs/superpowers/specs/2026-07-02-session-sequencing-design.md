# Session Card Sequencing v2.1 — Design Spec

**Date:** 2026-07-02
**Branch:** `srs-v2` (lands on top of the cutover commits, before the merge to `main`)
**Status:** Approved design, ready for implementation plan

## Goal

Make the in-session card order read as *deliberate* instead of random. Today a
session can show 3 flashcards, 2 context cards, another flashcard, then a
context card unrelated to anything just seen. Replace that with **stage packs**:
all of a kind together, every context card following its own word's flashcard,
tests spaced away from their flashcards.

## Problem (why it looks messy today)

Three interacting mechanisms in `planSessionV2` (`src/lib/srs.js`):

1. **Blocks mix stages.** Selection order is reviews (by due date) → leeches →
   new, sliced into fixed blocks of 5 — so one block holds words with three
   different card recipes (new = flashcard; early/mid = flashcard + context;
   late = context only).
2. **Anti-clustering scatters related cards.** Within a block's scaffold phase,
   the same word may not appear within 2 positions — a word's flashcard and its
   context card are pushed apart on purpose.
3. **Orphan context cards.** A late-stage word contributes a context card with
   no flashcard at all — it has no parent card in the session.

None of this is a bug; the combined output just reads as noise.

## Scope

**In scope:** the ordering step of `planSessionV2` (block membership + card
order within a block), plus unit tests.

**Out of scope / unchanged:**
- **Selection** — reviews-first priority, leech cap (2), per-day new budget
  (7, pause-when-behind), graded cap by time budget. Identical inputs → the
  identical *set* of senses and graded exercises; only order changes.
- Scaffold recipes per stage (`scaffoldFor`) and graded exercise per stage
  (`gradedExerciseFor`).
- Verdict handling, `applyVerdict`, `completeSessionV2` (order-independent).
- UI components in `SessionV2.jsx` (they render whatever order the planner
  emits; pack labels in the UI are a possible later nicety, not in this spec).

## Design

### 1. Packs are defined by type, not by count

Group the selected senses into **stage packs**, ordered:

```
new → early → mid → late → known+ → leech-help
```

- Pack boundaries never straddle stages. Pack sizes vary freely with what's
  due that day.
- Within a pack, existing order is preserved: oldest-due first for reviews,
  shuffled for new words. Note the "new" pack can contain both step-0 *due
  retries* (yesterday's fails, `stageOf(step) === 0`) and genuinely new
  intake — same card recipe either way; retries come first (they're due),
  then the shuffled new words.
- **Leech-help goes last** as a distinct rescue tail: its remedial recipe
  (flashcard → word-choice) ignores stage, so it would look random anywhere
  else.
- **Known+ packs** have no scaffolds — they emit a pure test stream at the end
  of the session, a natural "final challenge" stretch.

### 2. Inside a pack: type-phased, with an invisible chunk ceiling

Within each pack, cards run in **phases by type**, each phase in the same word
order:

```
all flashcards → all context cards → all tests
```

- Every context card refers to a flashcard shown moments earlier in the same
  cycle; the flashcard→test gap stays wide (the rest of the cycle intervenes).
- **Chunk ceiling:** a pack larger than `blockSize` (**default changes 5 → 4**)
  silently splits into balanced encode→test cycles of at most `blockSize` —
  `ceil(n / blockSize)` chunks of near-equal size, so a 12-word mid pack runs
  as three cycles of 4 (never with a runt tail) — still 100% mid words. The
  ceiling is a rhythm device, not a visible rule: it caps how many cards sit
  between a word's flashcard and its test (~8–11 with blockSize 4), and keeps
  the learn-a-little/test-a-little cadence. `SessionV2.jsx` passes
  `blockSize: 4` (was 5).
- **Tiny scaffolded packs merge into a stage neighbor.** A *scaffolded* pack
  (new/early/mid/late) with fewer than 3 words folds into the adjacent pack
  whose scaffold recipe matches best (early↔mid are identical; new↔early
  close). Repeat until no scaffolded pack has <3 words or only one pack
  remains. The merged pack still runs clean type phases — only the test phase
  mixes test types, in stage order. If the whole session is 1–2 words, accept
  the short flashcard→test gap — nothing to merge with.
- **Exempt from merging:** the **leech-help** pack (leech cap is 2, so it is
  *always* tiny — but its short flashcard→test gap is desirable: stuck words
  need an easy win, and it stays a distinct rescue tail) and **known+** packs
  (test-only, no answer shown beforehand, so a tiny one has no inflated-PASS
  problem).
- `antiCluster` no longer interleaves card types. It applies **within each
  phase only**, keeping sibling senses of the same word from sitting adjacent.

### 3. Resulting shape (example: 3 new, 1 early, 12 mid, 1 late, 2 leech)

The lone early and late words merge into the mid pack (their nearest recipe
neighbor), giving 14 words → four balanced cycles of 4/4/3/3:

```
▸ NEW pack          🃏🃏🃏 → ✅✅✅ (choose-meaning)
▸ EARLY+MID+LATE    cycle 1: 🃏×4 → 📝×4 → ✅×4
  (14 words)                 (tests in stage order:
                              word-choice → fill-in → recall)
                    cycles 2–4: same shape (4/3/3)
▸ LEECH-HELP        🃏🃏 → ✅✅ (word-choice) — never merged
```

## Implementation sketch

All inside `planSessionV2`'s block-building section (`src/lib/srs.js:174-195`):

1. Bucket `selected` by `stageOf(interval_step)` with `isNew` → bucket 0 and
   `_remedial` → last bucket; concatenate buckets in pack order.
2. Merge scaffolded packs of <3 words into their best stage neighbor
   (leech-help and known+ exempt).
3. Slice each pack into balanced chunks of ≤ `blockSize` (4).
4. Per chunk, emit `flashcard` steps, then `fill_blank` steps, then graded
   steps — same word order per phase, `antiCluster` applied per phase.

No schema, engine, or UI changes.

## Testing (`src/lib/srs.test.js`, `node --test`)

Given a mixed roster (new + early + mid + late + known + leech):

- (a) Within any chunk, a word's context card never precedes its flashcard,
  and card types do not interleave within a phase.
- (b) Pack order is new → early → mid → late → known+ → leech-help; no chunk
  mixes stages.
- (c) A pack of >blockSize words splits into balanced encode→test cycles, each
  ≤ blockSize (4).
- (c2) A scaffolded pack of <3 words merges into a stage neighbor; leech-help
  and known+ packs never merge; a 1–2 word session still plans correctly.
- (d) Selection is unchanged: same set of senseIds and same graded exercise
  per sense as before the change (order aside).
- (e) Sibling senses (same wordId) are not adjacent within a phase when
  avoidable.

## Risks

- **Low.** Ordering is cosmetic to the scheduler (verdicts are per-sense,
  order-independent). The main behavioral shift is pedagogical: new words are
  now always first and mature words last, which matches the intended
  warm-up → challenge arc.
- Lands on `srs-v2` before the merge, so the pending preview click-through
  (cutover Task 10) covers this too.
