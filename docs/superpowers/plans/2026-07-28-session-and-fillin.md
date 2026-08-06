# Session Persistence & the Fill-in Card — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop sessions restarting from zero when the tab is left, and make the graded fill-in card show the learner what form is actually wanted.

**Architecture:** Part A persists the in-flight session to `localStorage` through three pure, store-injected functions in a new `src/lib/sessionSnapshot.js`; `SessionV2.jsx` only calls them. Reviews still commit to the SRS only on completion — an abandoned session advances nothing. Part B adds one pure helper (`tenseHint`) plus data plumbing (`tense` through `buildFillBlank`; `form` and `aspect` onto the planned step), then renders that existing data on the fill-in and flashcard cards. No AI generation changes anywhere.

**Tech Stack:** React 19, Vite 8, Tailwind v4, `node --test` (tests are plain `node:test` files under `src/lib/`, run via `npm test`).

**Spec:** `docs/superpowers/specs/2026-07-27-session-and-fillin-design.md`

## Global Constraints

- **Branch:** `feat/session-fillin` (already rebased onto `main` @ `af4cf22`). Never commit to `main`.
- **Pure logic lives in `src/lib/`, is unit-tested, and never imports React or Supabase.** The component calls it. This is how every prior feature here was built.
- **`npm test` must stay green — 124 tests currently pass.** The pre-commit hook runs `vite build` AND `npm test`; it blocks on either.
- **Verify HEAD builds, not just the working tree.** The 2026-07-27 session shipped a committed syntax error because every pre-commit build ran the working tree, which carried an uncommitted fix. After committing, confirm `git status --short` is empty — that is what makes the green build HEAD's build.
- **Never throw into the loader.** Every `localStorage` access is wrapped in try/catch; on any failure the feature degrades to today's behaviour (no persistence), never a crash. Private mode and quota exhaustion are both real.
- **B2 is defined for German, English AND Ukrainian together** — per the standing cross-language rule, a language feature is not "add it for German and back-fill the others later". All three ship in the same task.
- **Never invent a hint.** When the required form cannot be determined, `tenseHint` returns `null` and the card renders nothing. A wrong hint is worse than no hint.
- **Apostrophes in single-quoted JS strings break the build** — use double quotes or `ʼ`. This has bitten this repo repeatedly.
- **Do not change `gradeFillIn`.** Grading is deliberately unchanged; we remove *unfair* misses by showing the required form, not by loosening the grader.

---

### Task 1: Snapshot primitives (`sessionSnapshot.js`)

Pure, store-injected persistence. No React, no browser.

**Files:**
- Create: `src/lib/sessionSnapshot.js`
- Test: `src/lib/sessionSnapshot.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `snapshotKey(userId, targetLang)` → `string`
  - `saveSnapshot(store, key, snapshot)` → `boolean` (false when storage unavailable)
  - `loadSnapshot(store, key)` → `snapshot | null` (null on missing/corrupt)
  - `clearSnapshot(store, key)` → `void`
  - `resumableSnapshot(snapshot, { today, collectionId })` → `snapshot | null`
  - Snapshot shape: `{ date, sessionId, collectionId, steps, idx, outcomes }`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/sessionSnapshot.test.js`:

```js
import test from "node:test"
import assert from "node:assert/strict"
import {
  snapshotKey, saveSnapshot, loadSnapshot, clearSnapshot, resumableSnapshot,
} from "./sessionSnapshot.js"

// A minimal stand-in for localStorage. The real one is injected in the app.
function fakeStore(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  }
}

// A store that throws on every access — private mode / quota exhausted.
const hostileStore = {
  getItem() { throw new Error("nope") },
  setItem() { throw new Error("quota") },
  removeItem() { throw new Error("nope") },
}

const snap = {
  date: "2026-07-28", sessionId: "sess-1", collectionId: null,
  steps: [{ senseId: "a" }, { senseId: "b" }], idx: 1, outcomes: { a: "correct" },
}

test("snapshotKey is namespaced per user and language", () => {
  assert.equal(snapshotKey("u1", "de"), "verba.session.v2:u1:de")
  assert.notEqual(snapshotKey("u1", "de"), snapshotKey("u1", "en"))
  assert.notEqual(snapshotKey("u1", "de"), snapshotKey("u2", "de"))
})

test("save then load round-trips the snapshot", () => {
  const store = fakeStore()
  const key = snapshotKey("u1", "de")
  assert.equal(saveSnapshot(store, key, snap), true)
  assert.deepEqual(loadSnapshot(store, key), snap)
})

test("loadSnapshot returns null when nothing is stored", () => {
  assert.equal(loadSnapshot(fakeStore(), "missing"), null)
})

test("loadSnapshot returns null on a corrupt value instead of throwing", () => {
  const store = fakeStore({ k: "{not json" })
  assert.equal(loadSnapshot(store, "k"), null)
})

test("clearSnapshot removes the entry", () => {
  const store = fakeStore()
  saveSnapshot(store, "k", snap)
  clearSnapshot(store, "k")
  assert.equal(loadSnapshot(store, "k"), null)
})

test("a hostile store never throws — save reports false, load gives null", () => {
  assert.equal(saveSnapshot(hostileStore, "k", snap), false)
  assert.equal(loadSnapshot(hostileStore, "k"), null)
  assert.doesNotThrow(() => clearSnapshot(hostileStore, "k"))
})

test("resumableSnapshot accepts a snapshot from today with a matching collection", () => {
  assert.deepEqual(
    resumableSnapshot(snap, { today: "2026-07-28", collectionId: null }),
    snap,
  )
})

test("resumableSnapshot rejects a snapshot from a previous day", () => {
  // The due set has changed overnight — a stale queue must not be resurrected.
  assert.equal(resumableSnapshot(snap, { today: "2026-07-29", collectionId: null }), null)
})

test("resumableSnapshot rejects a collection mismatch in both directions", () => {
  assert.equal(resumableSnapshot(snap, { today: "2026-07-28", collectionId: "c1" }), null)
  const collectionSnap = { ...snap, collectionId: "c1" }
  assert.equal(resumableSnapshot(collectionSnap, { today: "2026-07-28", collectionId: null }), null)
  assert.deepEqual(
    resumableSnapshot(collectionSnap, { today: "2026-07-28", collectionId: "c1" }),
    collectionSnap,
  )
})

test("resumableSnapshot rejects a finished or out-of-range session", () => {
  const finished = { ...snap, idx: 2 }   // idx === steps.length
  assert.equal(resumableSnapshot(finished, { today: "2026-07-28", collectionId: null }), null)
  const overrun = { ...snap, idx: 5 }
  assert.equal(resumableSnapshot(overrun, { today: "2026-07-28", collectionId: null }), null)
})

test("resumableSnapshot rejects null, and snapshots with no steps", () => {
  assert.equal(resumableSnapshot(null, { today: "2026-07-28", collectionId: null }), null)
  assert.equal(
    resumableSnapshot({ ...snap, steps: [] }, { today: "2026-07-28", collectionId: null }),
    null,
  )
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test src/lib/sessionSnapshot.test.js`
Expected: FAIL — cannot find module `./sessionSnapshot.js`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/sessionSnapshot.js`:

```js
// In-flight session persistence.
//
// The v2 runner held `steps`/`idx`/`outcomes` in React state only and re-planned
// on every mount, so a tab switch (or any route change) threw away the session —
// including reviews already answered, which were never written anywhere. These
// functions let the runner snapshot itself after every card and pick the same
// session back up.
//
// `store` is injected so none of this needs a browser: the app passes
// `window.localStorage`, the tests pass a fake.

export function snapshotKey(userId, targetLang) {
  return `verba.session.v2:${userId}:${targetLang}`
}

export function saveSnapshot(store, key, snapshot) {
  try {
    store.setItem(key, JSON.stringify(snapshot))
    return true
  } catch {
    // Private mode or quota. Persistence is a nicety — losing it must never
    // cost the learner the session they are in.
    return false
  }
}

export function loadSnapshot(store, key) {
  try {
    const raw = store.getItem(key)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    // Unreadable or corrupt: behave exactly as if there were no snapshot.
    return null
  }
}

export function clearSnapshot(store, key) {
  try {
    store.removeItem(key)
  } catch { /* nothing to do — see saveSnapshot */ }
}

// Is this snapshot still the session the learner is asking for?
//
// Same day (overnight the due set changes, so a stale queue is wrong), same
// collection (a collection session and the daily session are different queues),
// and genuinely mid-flight.
export function resumableSnapshot(snapshot, { today, collectionId = null } = {}) {
  if (!snapshot) return null
  if (snapshot.date !== today) return null
  if ((snapshot.collectionId ?? null) !== (collectionId ?? null)) return null
  const steps = snapshot.steps
  if (!Array.isArray(steps) || !steps.length) return null
  const idx = snapshot.idx
  if (!Number.isInteger(idx) || idx < 0 || idx >= steps.length) return null
  return snapshot
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test src/lib/sessionSnapshot.test.js`
Expected: PASS, 11 tests.

Then run the whole suite: `npm test` — expected 135 passing, 0 failing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sessionSnapshot.js src/lib/sessionSnapshot.test.js
git commit -m "feat(session): snapshot primitives for resume"
```

---

### Task 2: Wire snapshot-and-resume into the runner

**Files:**
- Modify: `src/pages/SessionV2.jsx` — imports; `loadAndPlan` (~`:390`); the mount effect (~`:417`); `restart` (~`:427`); `handleDone` (~`:433`)
- Test: none (integration — the logic under it is covered by Task 1; verified by click-through)

**Interfaces:**
- Consumes: `snapshotKey`, `saveSnapshot`, `loadSnapshot`, `clearSnapshot`, `resumableSnapshot` from Task 1.
- Produces: nothing later tasks depend on.

**Context the implementer needs:** `SessionV2.jsx` holds `steps`, `idx`, `outcomes`, `sessionId` in `useState`. The mount effect at `:417` calls `loadAndPlan` (or `loadCollectionOrChoose` for collections), and `loadAndPlan` deliberately re-queries the DB and re-plans — correct for "Keep going", fatal on remount. `handleDone` advances `idx`, and on the last step calls `completeSessionV2`. `collectionId` comes from the query string.

- [ ] **Step 1: Add the imports and a stable key**

At the top of `src/pages/SessionV2.jsx`, alongside the existing `srs` import, add:

```js
import {
  snapshotKey, saveSnapshot, loadSnapshot, clearSnapshot, resumableSnapshot,
} from '../lib/sessionSnapshot'
```

Inside the `SessionV2` component, next to the other derived values (just after `collectionName` is read from `searchParams`), add:

```js
// One snapshot per user + language. `null` until we have a user, which is also
// the guard that keeps every snapshot call below a no-op before login.
const snapKey = user ? snapshotKey(user.id, targetLang) : null
const store = typeof window !== 'undefined' ? window.localStorage : null
```

- [ ] **Step 2: Resume before planning**

Replace the body of `loadAndPlan` (the function beginning `async function loadAndPlan(isCancelled, onlySenseIds = null) {`) so a resumable snapshot short-circuits the re-plan. New version:

```js
  // Shared by the initial mount and "Keep going": re-query, re-plan, start a
  // fresh session row, and drop the runner into 'running'. `isCancelled` guards
  // against setting state after the owning effect has been cleaned up.
  //
  // `allowResume` is false for "Keep going", which must always plan fresh —
  // the session it would resume is the one that just finished.
  async function loadAndPlan(isCancelled, onlySenseIds = null, allowResume = false) {
    const todayISO = new Date().toISOString().split('T')[0]

    if (allowResume && snapKey && store) {
      const saved = resumableSnapshot(loadSnapshot(store, snapKey), {
        today: todayISO, collectionId,
      })
      if (saved) {
        // Resume exactly where the learner left off — no re-query, no re-plan.
        // `pool` is only used for multiple-choice distractors, so refill it in
        // the background rather than making the learner wait for it.
        countedRef.current = false
        setSteps(saved.steps); setIdx(saved.idx); setOutcomes(saved.outcomes ?? {})
        setSessionId(saved.sessionId); setPhase('running')
        fetchSenses().then(({ senses }) => {
          if (isCancelled?.()) return
          if (senses) setPool(senses)
        })
        return
      }
    }

    const { error, senses, plan } = await fetchDuePlan(onlySenseIds)
    if (isCancelled?.()) return
    if (error) { setPhase('error'); return }
    if (!plan.length) { setPhase('empty'); return }
    const gradedCount = new Set(plan.filter((s) => s.graded).map((s) => s.senseId)).size
    const id = await startSession(user.id, 'v2', gradedCount)
    if (isCancelled?.()) return
    countedRef.current = false
    setPool(senses); setSteps(plan); setSessionId(id); setPhase('running')
    if (snapKey && store) {
      saveSnapshot(store, snapKey, {
        date: todayISO, sessionId: id, collectionId, steps: plan, idx: 0, outcomes: {},
      })
    }
  }
```

- [ ] **Step 3: Let the mount path resume, and the collection chooser too**

In the mount `useEffect` (the one with deps `[user, targetLang, collectionId]`), change the two call sites to allow resume:

```js
    if (collectionId) loadCollectionOrChoose(() => cancelled)
    else loadAndPlan(() => cancelled, null, true)
```

And in `loadCollectionOrChoose`, a resumable collection session must skip the chooser entirely — otherwise returning mid-session re-asks which words to practise. Replace its body:

```js
  async function loadCollectionOrChoose(isCancelled) {
    // A resumable session already has its steps chosen — do not re-ask.
    const todayISO = new Date().toISOString().split('T')[0]
    if (snapKey && store) {
      const saved = resumableSnapshot(loadSnapshot(store, snapKey), {
        today: todayISO, collectionId,
      })
      if (saved) { loadAndPlan(isCancelled, null, true); return }
    }
    const { error, senses } = await fetchSenses()
    if (isCancelled?.()) return
    if (error) { setPhase('error'); return }
    if (senses.length > GRADED_CAP) {
      setCollectionSenses(orderForPractice(senses))
      setPhase('choosing')
      return
    }
    loadAndPlan(isCancelled)
  }
```

- [ ] **Step 4: Snapshot on every advance, clear on completion**

In `handleDone`, persist after each answered card and delete the snapshot once the session is committed. Replace the first three lines and the post-`completeSessionV2` region:

```js
  async function handleDone(outcome) {
    const step = steps[idx]
    const nextOutcomes = step.graded && outcome ? { ...outcomes, [step.senseId]: outcome } : outcomes
    if (step.graded && outcome) setOutcomes(nextOutcomes)
    if (idx + 1 < steps.length) {
      // Persist BEFORE advancing the screen: if the tab is evicted the instant
      // the next card renders, the snapshot must already name that card.
      if (snapKey && store) {
        saveSnapshot(store, snapKey, {
          date: new Date().toISOString().split('T')[0],
          sessionId, collectionId, steps, idx: idx + 1, outcomes: nextOutcomes,
        })
      }
      setIdx(idx + 1)
      return
    }
```

Then, immediately after the `await completeSessionV2(...)` line, add:

```js
    // The session is committed — the snapshot has done its job. "Keep going"
    // must plan a genuinely fresh session, not resurrect this one.
    if (snapKey && store) clearSnapshot(store, snapKey)
```

- [ ] **Step 5: Keep "Keep going" fresh**

`restart` must not resume. It already calls `loadAndPlan()` with no arguments, and `allowResume` defaults to `false`, so it is correct as written — **verify** that `restart` reads:

```js
  function restart() {
    setPhase('loading'); setIdx(0); setOutcomes({}); setSummary([]); setRemainingDue(0)
    loadAndPlan()
  }
```

If it passes a third argument, remove it.

- [ ] **Step 6: Verify the build and suite**

Run: `npx vite build` — expected: `✓ built`.
Run: `npm test` — expected 135 passing, 0 failing (no new tests here; nothing may regress).

- [ ] **Step 7: Commit**

```bash
git add src/pages/SessionV2.jsx
git commit -m "feat(session): resume an in-flight session instead of re-planning"
```

---

### Task 3: Thread `tense`, `form` and `aspect` through to the card

Pure data plumbing. Every later task consumes it; nothing renders yet.

**Files:**
- Modify: `src/lib/srs.js` — `buildFillBlank` (~`:353`), the `display` helper (`:249`) and the `base` step object (`:257`)
- Test: `src/lib/srs.test.js` (append)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `buildFillBlank(example, lemma)` return value gains `tense: "present" | "past" | null`
  - each planned step gains `form: string | null` (principal parts) and `aspect: "imperfective" | "perfective" | null`

**Context:** `buildFillBlank` already returns `{ sentence, answer, target, translation }` from three separate return points — all three need the new field. `display(s)` at `:249` builds `{ word, translation }` and is spread into `base` at `:257`; `s` is the raw `word_senses` row, so `s.form` and `s.aspect` are available there.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/srs.test.js`:

```js
test("buildFillBlank carries the example's tense through", () => {
  const ex = { target: "Der Zug erreichte den Bahnhof.", blank: "erreichte", translation: "The train reached the station.", tense: "past" }
  assert.equal(buildFillBlank(ex, "erreichen").tense, "past")
})

test("buildFillBlank carries tense on the lemma-match path too", () => {
  // No `blank` — the regex fallback path must not drop the field.
  const ex = { target: "Wir erreichen Berlin.", translation: "We reach Berlin.", tense: "present" }
  assert.equal(buildFillBlank(ex, "erreichen").tense, "present")
})

test("buildFillBlank yields a null tense when the example has none", () => {
  const ex = { target: "Wir erreichen Berlin.", blank: "erreichen" }
  assert.equal(buildFillBlank(ex, "erreichen").tense, null)
})

test("planned steps carry the sense's principal parts and aspect", () => {
  const senses = [{
    id: "s1", word_id: "w1", word_form: "erreichen", translation: "to reach",
    pos: "verb", form: "erreicht / erreichte / hat erreicht", aspect: null,
    interval_step: 0, learning_stage: "new", next_review_date: "2026-07-28",
    examples: [],
  }]
  const plan = planSessionV2(senses, { today: "2026-07-28", newPerDay: 7, newToday: 0 })
  assert.ok(plan.length > 0)
  assert.equal(plan[0].form, "erreicht / erreichte / hat erreicht")
  assert.equal(plan[0].aspect, null)
})

test("a sense with no form yields a null form on its steps", () => {
  const senses = [{
    id: "s2", word_id: "w2", word_form: "das Haus", translation: "house",
    pos: "noun", interval_step: 0, learning_stage: "new",
    next_review_date: "2026-07-28", examples: [],
  }]
  const plan = planSessionV2(senses, { today: "2026-07-28", newPerDay: 7, newToday: 0 })
  assert.equal(plan[0].form, null)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test src/lib/srs.test.js`
Expected: FAIL — `tense` is `undefined`, not `"past"`; `form` is `undefined`, not the principal parts.

- [ ] **Step 3: Implement**

In `src/lib/srs.js`, replace `buildFillBlank` with:

```js
export function buildFillBlank(example, lemma) {
  if (!example || !example.target) return null
  const text = example.target
  const surface = example.blank
  // The example's own translation rides along: on reveal the learner sees a full
  // sentence of context, and translating only the target word leaves the rest of
  // it unreadable. Null when the example has none, so the UI can omit the line.
  const translation = example.translation ?? null
  // The coarse tense the generator stored. `tenseHint` refines it into the
  // specific form (Perfekt vs Präteritum) using the full sentence.
  const tense = example.tense ?? null
  if (surface && text.includes(surface)) {
    return { sentence: text.replace(surface, "____"), answer: surface, target: text, translation, tense }
  }
  if (lemma) {
    const re = new RegExp(`\\b${escapeReSrs(lemma)}\\b`, "i")
    const m = text.match(re)
    if (m) return { sentence: text.replace(re, "____"), answer: m[0], target: text, translation, tense }
  }
  return null
}
```

At `src/lib/srs.js:249`, extend `display` so every step carries the principal parts and aspect:

```js
  // `form` = the principal parts ("erreicht / erreichte / hat erreicht"), shown
  // under the infinitive on flashcards so exposure primes the forms the fill-in
  // will ask for. `aspect` is what makes a Ukrainian past tense specific.
  const display = (s) => ({
    word: s.word_form ?? s.word ?? '',
    translation: s.translation ?? '',
    form: s.form ?? null,
    aspect: s.aspect ?? null,
  })
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test src/lib/srs.test.js` — expected PASS.
Run: `npm test` — expected 140 passing, 0 failing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/srs.js src/lib/srs.test.js
git commit -m "feat(srs): carry tense, principal parts and aspect onto session steps"
```

---

### Task 4: `tenseHint` — name the specific required form, per language

The heart of B2. Pure and heavily tested; three languages in one task, deliberately.

**Files:**
- Create: `src/lib/tenseHint.js`
- Test: `src/lib/tenseHint.test.js`

**Interfaces:**
- Consumes: the `{ target, tense }` shape produced by `buildFillBlank` in Task 3.
- Produces: `tenseHint(fillBlank, targetLang, ifaceLang = "en", sense = {})` → localised `string | null`. The fourth argument is the planned step (or any object carrying `aspect`); only Ukrainian reads it.

**Design.** The stored `tense` is only `present | past | null`, which is too coarse — in German a past blank is ambiguous between Perfekt (`hat erreicht`) and Präteritum (`erreichte`), two different forms the learner must *produce*. So `tense` is the gate and the **full sentence** (`fillBlank.target`, which still contains the answer) is what refines it. When neither settles it, return `null`.

| Target | `tense: "past"` | `tense: "present"` |
|---|---|---|
| **de** | finite `haben`/`sein` + a Partizip II (`ge…t`/`ge…en`/`…iert`) → **Perfekt**; otherwise → **Präteritum** | **Präsens** |
| **en** | finite `have`/`has` + past participle → **Present perfect**; otherwise → **Past simple** | `am/is/are` + `…ing` → **Present continuous**; otherwise → **Present simple** |
| **uk** | aspect `perfective` → доконаний вид; `imperfective` → недоконаний вид; unknown aspect → plain "Минулий час" | aspect `perfective` → **Майбутній час** (a perfective verb has no present); otherwise **Теперішній час** |

- [ ] **Step 1: Write the failing tests**

Create `src/lib/tenseHint.test.js`:

```js
import test from "node:test"
import assert from "node:assert/strict"
import { tenseHint } from "./tenseHint.js"

// ── German ──────────────────────────────────────────────────────────────────
test("de: auxiliary + Partizip II is Perfekt", () => {
  const fb = { target: "Wir haben Berlin um 18 Uhr erreicht.", tense: "past" }
  assert.equal(tenseHint(fb, "de", "en"), "Perfekt")
})

test("de: sein as the auxiliary is still Perfekt", () => {
  const fb = { target: "Der Zug ist pünktlich angekommen.", tense: "past" }
  assert.equal(tenseHint(fb, "de", "en"), "Perfekt")
})

test("de: an -iert participle counts, it has no ge- prefix", () => {
  const fb = { target: "Sie hat das Zimmer reserviert.", tense: "past" }
  assert.equal(tenseHint(fb, "de", "en"), "Perfekt")
})

test("de: an inseparable-prefix participle counts — it never takes ge-", () => {
  const fb = { target: "Er hat die Stadt verlassen.", tense: "past" }
  assert.equal(tenseHint(fb, "de", "en"), "Perfekt")
})

test("de: a plain ge- participle counts", () => {
  const fb = { target: "Er hat das Buch gelesen.", tense: "past" }
  assert.equal(tenseHint(fb, "de", "en"), "Perfekt")
})

test("de: a single finite past verb is Präteritum", () => {
  const fb = { target: "Der Zug erreichte den Bahnhof.", tense: "past" }
  assert.equal(tenseHint(fb, "de", "en"), "Präteritum")
})

test("de: weak and strong Präteritum verbs are not mistaken for participles", () => {
  // These are the forms the participle regex must NOT match, or every
  // Präteritum sentence would be mislabelled Perfekt.
  assert.equal(tenseHint({ target: "Er kaufte den Wagen.", tense: "past" }, "de", "en"), "Präteritum")
  assert.equal(tenseHint({ target: "Sie ging nach Hause.", tense: "past" }, "de", "en"), "Präteritum")
})

test("de: present is Präsens", () => {
  const fb = { target: "Der Zug erreicht den Bahnhof.", tense: "present" }
  assert.equal(tenseHint(fb, "de", "en"), "Präsens")
})

// ── English ─────────────────────────────────────────────────────────────────
test("en: have/has + participle is the present perfect", () => {
  const fb = { target: "We have reached Berlin.", tense: "past" }
  assert.equal(tenseHint(fb, "en", "en"), "Present perfect")
})

test("en: a bare past verb is the past simple", () => {
  const fb = { target: "We reached Berlin at six.", tense: "past" }
  assert.equal(tenseHint(fb, "en", "en"), "Past simple")
})

test("en: be + -ing is the present continuous", () => {
  const fb = { target: "We are reaching Berlin now.", tense: "present" }
  assert.equal(tenseHint(fb, "en", "en"), "Present continuous")
})

test("en: plain present is the present simple", () => {
  const fb = { target: "We reach Berlin at six.", tense: "present" }
  assert.equal(tenseHint(fb, "en", "en"), "Present simple")
})

// ── Ukrainian ───────────────────────────────────────────────────────────────
test("uk: the past is named by aspect", () => {
  const past = { target: "Ми досягли Берліна.", tense: "past" }
  assert.equal(tenseHint(past, "uk", "uk", { aspect: "perfective" }), "Минулий час, доконаний вид")
  assert.equal(tenseHint(past, "uk", "uk", { aspect: "imperfective" }), "Минулий час, недоконаний вид")
})

test("uk: an unknown aspect falls back to the plain past", () => {
  const past = { target: "Ми досягли Берліна.", tense: "past" }
  assert.equal(tenseHint(past, "uk", "uk"), "Минулий час")
})

test("uk: a perfective verb in the present slot is really the future", () => {
  const pres = { target: "Ми досягнемо Берліна.", tense: "present" }
  assert.equal(tenseHint(pres, "uk", "uk", { aspect: "perfective" }), "Майбутній час")
  assert.equal(tenseHint(pres, "uk", "uk", { aspect: "imperfective" }), "Теперішній час")
})

// ── Localisation + the null contract ────────────────────────────────────────
test("labels follow the interface language", () => {
  const fb = { target: "Der Zug erreichte den Bahnhof.", tense: "past" }
  assert.equal(tenseHint(fb, "de", "uk"), "Präteritum")   // a German term stays German
  const en = { target: "We reached Berlin.", tense: "past" }
  assert.equal(tenseHint(en, "en", "uk"), "Минулий час (past simple)")
})

test("no tense means no hint — never invent one", () => {
  assert.equal(tenseHint({ target: "Wir erreichen Berlin.", tense: null }, "de", "en"), null)
  assert.equal(tenseHint(null, "de", "en"), null)
  assert.equal(tenseHint({ target: "x", tense: "past" }, "fr", "en"), null)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test src/lib/tenseHint.test.js`
Expected: FAIL — cannot find module `./tenseHint.js`.

- [ ] **Step 3: Implement**

Create `src/lib/tenseHint.js`:

```js
// Name the SPECIFIC form a fill-in blank wants.
//
// "Der Zug ____ pünktlich" accepts both `erreicht` and `erreichte`, so without a
// hint the learner guesses, and a correct guess of the other valid tense is
// scored as a slip. But "past" is too coarse to fix that: in German a past blank
// is still ambiguous between Perfekt and Präteritum, which are different forms to
// produce. So the stored coarse tense is the gate, and the full sentence — which
// still contains the answer — is what refines it.
//
// Defined for de, en and uk together: naming the required form is a
// cross-language feature, not a German one with the others back-filled.
//
// Returns null whenever the form cannot be determined. A wrong hint is worse
// than no hint, so the caller renders nothing.

// German: a finite form of haben/sein. Note these are all PRESENT forms — a
// Präteritum sentence has "hatte"/"war", so a present auxiliary in a past
// sentence can only be the Perfekt one.
const DE_AUX = /\b(habe|hast|hat|haben|habt|bin|bist|ist|sind|seid)\b/i
// … alongside a Partizip II. German builds these four ways and the regex must
// cover all of them, or the hint silently degrades to "Präteritum" on perfectly
// ordinary sentences:
//   plain            ge + stem + t/en      gemacht, gelesen
//   separable prefix stem + ge + stem      angekommen, aufgemacht
//   inseparable      no ge- at all         erreicht, verlassen, besucht
//   -ieren verbs     no ge- at all         reserviert, studiert
// The Präteritum forms it must NOT match end in -e/-te/-ten (erreichte, kaufte,
// ging), which is why every alternative anchors on a final t/en at a word break.
const DE_PARTICIPLE = /\b(\w*ge\w+(?:t|en)|\w+iert|(?:be|er|ver|ent|emp|zer|miss)\w+(?:t|en))\b/i

const EN_AUX = /\b(have|has)\b/i
const EN_PARTICIPLE = /\b\w+(?:ed|en|ne|wn|ught|ood)\b/i
const EN_PROGRESSIVE = /\b(am|is|are)\s+\w+ing\b/i

// German grammatical terms stay in German whatever the interface language —
// they are what the learner will see in a textbook.
const LABELS = {
  de: {
    perfekt:     { en: "Perfekt", uk: "Perfekt" },
    praeteritum: { en: "Präteritum", uk: "Präteritum" },
    praesens:    { en: "Präsens", uk: "Präsens" },
  },
  en: {
    presentPerfect:    { en: "Present perfect", uk: "Present perfect (доконаний)" },
    pastSimple:        { en: "Past simple", uk: "Минулий час (past simple)" },
    presentContinuous: { en: "Present continuous", uk: "Present continuous" },
    presentSimple:     { en: "Present simple", uk: "Теперішній час (present simple)" },
  },
  uk: {
    pastPerfective:   { en: "Past, perfective", uk: "Минулий час, доконаний вид" },
    pastImperfective: { en: "Past, imperfective", uk: "Минулий час, недоконаний вид" },
    past:             { en: "Past", uk: "Минулий час" },
    future:           { en: "Future", uk: "Майбутній час" },
    present:          { en: "Present", uk: "Теперішній час" },
  },
}

function label(lang, keyName, ifaceLang) {
  const entry = LABELS[lang]?.[keyName]
  if (!entry) return null
  return entry[ifaceLang === "uk" ? "uk" : "en"]
}

export function tenseHint(fillBlank, targetLang, ifaceLang = "en", sense = {}) {
  const tense = fillBlank?.tense
  if (!tense) return null
  const text = fillBlank.target ?? ""
  const aspect = sense?.aspect ?? null

  if (targetLang === "de") {
    if (tense === "present") return label("de", "praesens", ifaceLang)
    const perfekt = DE_AUX.test(text) && DE_PARTICIPLE.test(text)
    return label("de", perfekt ? "perfekt" : "praeteritum", ifaceLang)
  }

  if (targetLang === "en") {
    if (tense === "present") {
      return label("en", EN_PROGRESSIVE.test(text) ? "presentContinuous" : "presentSimple", ifaceLang)
    }
    const perfect = EN_AUX.test(text) && EN_PARTICIPLE.test(text)
    return label("en", perfect ? "presentPerfect" : "pastSimple", ifaceLang)
  }

  if (targetLang === "uk") {
    if (tense === "past") {
      if (aspect === "perfective")   return label("uk", "pastPerfective", ifaceLang)
      if (aspect === "imperfective") return label("uk", "pastImperfective", ifaceLang)
      return label("uk", "past", ifaceLang)
    }
    // A perfective verb has no present tense — its "present" forms are future.
    if (aspect === "perfective") return label("uk", "future", ifaceLang)
    return label("uk", "present", ifaceLang)
  }

  // An unsupported target language gets no hint rather than a wrong one.
  return null
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test src/lib/tenseHint.test.js` — expected PASS, 17 tests.
Run: `npm test` — expected 157 passing, 0 failing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tenseHint.js src/lib/tenseHint.test.js
git commit -m "feat(fill-in): name the specific required tense for de, en and uk"
```

---

### Task 5: The graded fill-in card — B1, B2, B3

**Files:**
- Modify: `src/pages/SessionV2.jsx` — the `fill_in` branch of `StepCard` (~`:172`–`:213`), `StepCard`'s signature (`:73`), and the `<StepCard …>` call site
- Test: none (presentational — verified by click-through; the logic beneath is covered by Tasks 3 and 4)

**Interfaces:**
- Consumes: `fillBlank.translation` and `fillBlank.tense` (Task 3), `step.aspect` (Task 3), `tenseHint` (Task 4).
- Produces: nothing.

**Context:** `StepCard` currently receives `{ step, pool, ifaceLang, targetLanguageName, speechLocale, onDone }` — it has the language *name* ("German") but not the *code* ("de") that `tenseHint` needs, so the code must be threaded in. `fillBlank` is already memoised per sense at `:82`. The graded `fill_in` branch begins at `:172` with the comment `// ----- graded: fill_in …`.

- [ ] **Step 1: Thread the target language code into the card**

Add the import next to the other lib imports:

```js
import { tenseHint } from '../lib/tenseHint'
```

Change the `StepCard` signature at `:73` to accept `targetLang`:

```js
function StepCard({ step, pool, ifaceLang, targetLang, targetLanguageName, speechLocale, onDone }) {
```

Find the `<StepCard` call site in the `running` phase and add the prop:

```jsx
            targetLang={targetLang}
```

- [ ] **Step 2: Render the hint, the translation and the richer feedback**

Replace the whole `if (step.exercise === 'fill_in') { … }` block with:

```jsx
  // ----- graded: fill_in (type the word into its own example sentence) -----
  if (step.exercise === 'fill_in') {
    // Which form the sentence actually wants. Null when it cannot be determined
    // — then we show nothing rather than a guess.
    const hint = fillBlank ? tenseHint(fillBlank, targetLang, ifaceLang, step) : null
    // No usable example → fall back to a plain translation→type prompt.
    const submit = () => {
      if (feedback) return
      const outcome = fillBlank
        ? gradeFillIn(input, { answer: fillBlank.answer, lemma: step.word })
        : (norm(input) === norm(step.word) ? 'correct' : 'wrong')
      setFeedback({ outcome })
    }
    // With no example to show, the lemma is all we have — but the sense's own
    // form is a truer target than a dictionary headword.
    const expected = fillBlank?.answer ?? step.form ?? step.word
    return (
      <Shell step={step}>
        <p className="text-sm text-gray-500 text-center mb-1">{cleanTr}</p>
        {fillBlank
          ? <p className="text-lg text-gray-800 text-center mb-2 leading-relaxed">{fillBlank.sentence}</p>
          : <p className="text-xs text-gray-400 text-center mb-4">Type the {targetLanguageName} word</p>}
        {/* B2 — the required form, named specifically. Without it "Der Zug ____
            pünktlich" accepts two tenses and the learner is guessing which. */}
        {hint && !feedback && (
          <p className="text-xs text-indigo-500 text-center mb-4">→ {hint}</p>
        )}
        {!hint && fillBlank && <div className="mb-2" />}
        <input
          autoFocus value={input} disabled={!!feedback}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          className="w-full border border-gray-200 rounded-xl px-4 py-3 text-center text-lg focus:outline-none focus:border-indigo-400"
          placeholder="…"
        />
        {!feedback ? (
          <button onClick={submit} className="btn-primary mt-4">Check</button>
        ) : (
          <>
            {feedback.outcome === 'correct' && (
              <p className="text-center mt-4 text-sm text-green-600">✓ Correct</p>
            )}
            {feedback.outcome === 'almost' && (
              <p className="text-center mt-4 text-sm text-amber-600">≈ Almost — you were on the right path · <strong>{expected}</strong></p>
            )}
            {feedback.outcome === 'wrong' && (
              <p className="text-center mt-4 text-sm text-rose-400">The word was <strong>{expected}</strong></p>
            )}
            {/* B3 — the full sentence makes the required form self-explanatory:
                a plural subject or a past-time clause is visible, not asserted. */}
            {feedback.outcome !== 'correct' && fillBlank && (
              <p className="text-center mt-2 text-sm text-gray-700">{fillBlank.target}</p>
            )}
            {/* B1 — grading a sentence you have never seen the meaning of is
                guesswork; the word gloss alone leaves most of it unread. */}
            {fillBlank?.translation && (
              <p className="text-center mt-2 text-sm text-gray-500 italic">{fillBlank.translation}</p>
            )}
            <NextBtn outcome={feedback.outcome} onClick={() => onDone(feedback.outcome)} />
          </>
        )}
      </Shell>
    )
  }
```

- [ ] **Step 3: Verify the build and suite**

Run: `npx vite build` — expected `✓ built`.
Run: `npm test` — expected 157 passing, 0 failing.

**Watch for the known trap:** a green vite build proves nothing about undefined identifiers in JSX. Confirm by eye that `targetLang` is in `StepCard`'s parameter list and passed at the call site — this exact class of bug (a component using a value it was never given) has shipped to prod here twice.

- [ ] **Step 4: Commit**

```bash
git add src/pages/SessionV2.jsx
git commit -m "feat(fill-in): show the sentence meaning, the required tense and the answer in context"
```

---

### Task 6: Flashcards show the principal parts

**Files:**
- Modify: `src/pages/SessionV2.jsx` — the ungraded scaffold branch of `StepCard` (~`:105`–`:131`)
- Test: none (presentational; `form` plumbing is covered by Task 3)

**Interfaces:**
- Consumes: `step.form` (Task 3).
- Produces: nothing.

**Context:** the `if (!step.graded)` branch renders the flashcard as `<p className="text-3xl font-bold …">{step.word}</p>` with the translation appearing on reveal. `step.form` holds the principal parts (German `erreicht / erreichte / hat erreicht`, English `goes / went / gone`, Ukrainian aspect forms) and is `null` for most nouns and adjectives — which must render nothing, the same "silent when empty" rule the sense card follows.

- [ ] **Step 1: Render `form` under the headword**

In the `if (!step.graded)` branch, replace the non-fill (`!isFill`) fragment:

```jsx
          <>
            <p className="text-3xl font-bold text-gray-900 text-center">{step.word}</p>
            {/* The principal parts, where the word has them. The flashcard is
                where the learner MEETS the word before the fill-in asks them to
                produce its forms — so this is the cheapest possible priming.
                Nouns and adjectives have no `form` and render nothing. */}
            {step.form && (
              <p className="text-sm text-gray-400 text-center mt-1.5">{step.form}</p>
            )}
            {revealed && <p className="text-lg text-gray-600 text-center mt-2">{cleanTr}</p>}
          </>
```

- [ ] **Step 2: Verify the build and suite**

Run: `npx vite build` — expected `✓ built`.
Run: `npm test` — expected 157 passing, 0 failing.

- [ ] **Step 3: Commit**

```bash
git add src/pages/SessionV2.jsx
git commit -m "feat(flashcard): show principal parts under the infinitive"
```

- [ ] **Step 4: Verify HEAD, not just the working tree**

```bash
git status --short   # MUST be empty — that is what makes the green build HEAD's build
npm test && npx vite build
```

---

## Manual click-through (Nika, after the build)

The pure logic is unit-tested; these are the things only a human at the app can confirm.

1. **Resume, desktop.** Start a session, answer ~5 cards, navigate to the dictionary and back to `/session`. Expect the *same card at the same position*, not card 1.
2. **Resume, iPad.** Same, but switch Safari tabs long enough for the tab to be evicted, then return. This is the case that motivated the whole of Part A.
3. **Overnight staleness.** A snapshot from a previous day must be ignored — the session plans fresh.
4. **Keep going.** Finish a session, tap "Keep going": a genuinely new session, never the one just completed.
5. **Collection session.** Start one from a collection, leave mid-way, return — resumes without re-asking which words to practise.
6. **Fill-in card.** Shows gloss + `→ Perfekt`/`→ Präteritum` (correct one for the sentence). On a wrong answer: the expected form, the full sentence, and the sentence translation.
7. **Flashcard.** A verb shows its principal parts under the infinitive; a noun shows nothing extra.

---

## Notes for the session log

- `tenseHint`'s English participle regex is deliberately loose (`-ed|-en|-ne|-wn|-ught|-ood`); it only ever fires when `have`/`has` is also present, so a false positive needs both. If English present-perfect hints turn out wrong in practice, tighten there.
- The DTZ pack build should generate examples whose sentence licenses only one tense — the generation half of B2. Here we infer from the sentence so words already in the dictionary benefit without regeneration.
