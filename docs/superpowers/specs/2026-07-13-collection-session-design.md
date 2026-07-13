# Collection-scoped SRS session — design

**Date:** 2026-07-13
**Status:** approved

Let the learner run the real graded session against a single collection —
"test me on my colours" — instead of only flipping flashcards at it.

## Starting point (what already exists)

Roadmap "Next up #1" claims collections are not yet practiceable. **That is stale.**
Two entry points already launch collection practice today:

- `Dashboard.jsx:461` — the collection picker
- `Dictionary.jsx:2467` — the collection panel's Practice button

Both go to `/flashcards?collectionId=…&collectionName=…`, and `Flashcards.jsx`
loads the collection's words correctly.

The real gap is what that practice *is*. **Flashcards only read.** There is no
`applyVerdict`, no interval update, no recall count — a learner can flip every
card in a collection and the app records nothing. Collections are reviewable but
not *assessable*.

## What we're building

`/session?collectionId=<id>&collectionName=<name>` — the graded SessionV2 engine
(recognition, fill-in-context, word choice, typing) scoped to one collection.

Passive flip-through is kept, not replaced: it has real value when the learner is
tired or skimming before class. The two acts get separate doors (see UI below).

## Sense pool

`SessionV2.fetchDuePlan()` currently pulls every sense for the target language.
With a `collectionId` it first resolves the collection's members
(`word_collections → word_id[]`), then filters senses to those words. One extra
query; everything downstream is unchanged.

## Planner: `practiceAll`

`planSessionV2` selects only `isNew` or `isDue` senses and silently drops the rest
(`srs.js:168-171`). A collection session wants the whole collection, so the
planner gains one option:

```js
planSessionV2(senses, { ...opts, practiceAll: true })
```

When set, senses that are neither new nor due are still selected, tagged
`_practice: true`, and their emitted steps carry `practice: true`.

New words still respect the daily new-word budget exactly as today. Introducing a
new word is real intake and must not slip past the cap the learner just set.

## Verdict: cramming must not inflate the schedule

This is the heart of the feature. If answering a **not-yet-due** word correctly
advanced its interval, drilling a collection would push all its words far into the
future and the learner would stop seeing them — cramming would quietly damage
retention. (This is why Anki's filtered decks offer "do not reschedule".)

`applyVerdict` gains a flag:

```js
applyVerdict(state, verdict, today, { practice: true })
```

| Verdict | Normal | Practice (not-yet-due word) |
|---|---|---|
| PASS | advance step, push interval | **`null`** — nothing persisted |
| HOLD | reschedule at current step | **`null`** — nothing persisted |
| FAIL | retry / lapse / demote | **applies normally** — pulls the word back |

`null` means "nothing to write"; the caller skips the DB update.

Why not even write `last_reviewed` on a practice pass: it would poison the
`gapReview` calculation in the FAIL path (`srs.js:118-119`), which asks how overdue
a word was. A crammed word would then look recently reviewed and a later genuine
lapse would be misjudged. So a correct cram is **completely invisible** to the
scheduler.

A failed cram, by contrast, is real signal — the learner just proved they don't
know a word they thought they knew — so it applies normally and pulls the word back.

Due words inside the collection are treated normally throughout: they were due,
so their verdicts count.

## UI

Two doors, matching the intent of the page you're already on:

| Where | Means | Goes to |
|---|---|---|
| Dashboard → "Practice collection" → pick one | **Test me** | `/session?collectionId=…` (graded, records progress) |
| Dictionary → collection panel | **Flip through** | `/flashcards?collectionId=…` (passive, records nothing) |

Both buttons must be **relabelled** so they no longer both read as "Practice" —
otherwise the same word does two different things depending on where it was
clicked. Dashboard: "Test me →". Dictionary: "Flip through →". EN/UK both.

`SessionV2` shows the collection name in its header when scoped, the way
`Flashcards.jsx:429` already does.

## Choosing what to practise (collections bigger than one session)

A 60-word collection cannot fit in a 24-step session, so something is left out.
When that happens the learner should decide *what* — but only then. For a 9-word
collection nothing is being left out, so asking would be pure friction.

**Trigger:** collection size > `gradedCap` (24). At or below, go straight into the
session, one click, exactly as a small collection does today.

**Above it, a chooser screen offers two modes:**

### Pick for me (default)

The planner's existing priority, made visible: **due words → leeches → new
(within the daily budget) → practice words**.

One refinement: not-due practice words are currently emitted in arbitrary order.
Sort them **weakest stage first** (`early` before `mid` before `known`), so a large
collection spends its one session on the words that need it rather than on the
words already mastered.

### Let me choose

A checklist of the collection's words, each showing its stage badge, ordered the
same way "Pick for me" would rank them (weakest first) so the useful ones are at
the top rather than buried.

Selection is capped at `gradedCap` (24). On reaching the cap the unchecked boxes
disable and the footer reads "24 max — one session". This keeps a session a
predictable length and preserves the `gradedCap` invariant the rest of the app
relies on; wanting more simply means running a second session.

Manually selected words are passed to the planner as the sense pool. All the
practice/verdict rules above still apply — a hand-picked not-due word is still a
practice word, and a correct answer on it still writes nothing.

## Edge cases

- **Empty collection** — the picker does not offer collections with no words.
- **Nothing to practice** — impossible by construction: `practiceAll` includes
  every member, so a non-empty collection always yields steps.
- **Collection larger than the graded cap** — the chooser appears (above).
- **Manual selection of zero words** — Start is disabled.
- **Daily new budget spent** — new members of the collection are not introduced;
  the rest still practice. Consistent with the daily session.

## Testing

All planner and verdict logic is pure, so this is unit-testable in `srs.test.js`
with no database:

- `planSessionV2` with `practiceAll` includes a not-due, not-new sense and tags its
  steps `practice: true`.
- `planSessionV2` without `practiceAll` still drops not-due senses (no regression).
- `practiceAll` still respects the daily new-word budget.
- Practice words are ordered weakest stage first, so an over-cap collection spends
  its session on the words that need it.
- Selection still honours `gradedCap`: an over-cap collection yields a
  normal-length session, with due words surviving the cut ahead of practice words.
- `applyVerdict(..., { practice: true })` returns `null` for PASS and for HOLD.
- `applyVerdict(..., { practice: true })` on FAIL returns the same update as a
  normal FAIL — a failed cram still pulls the word back.
- A due word inside a practice session is graded normally (not treated as practice).

## Out of scope

- Chat concierge ("practice my colours" by voice/chat). This is its groundwork,
  not the thing itself.
- Collection-scoped sessions for any exercise page other than SessionV2.
- Reworking the roadmap's stale "Next up" list (worth doing, separately).
