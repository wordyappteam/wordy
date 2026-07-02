# SRS v2 Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the v2 guided session the daily default (Start-centered dashboard, auto-sized chunked sessions, per-day new-word budget, gap forgiveness) and retire the legacy `words`-based session path.

**Architecture:** Evolve, don't rebuild. The pure planner/scorer in `src/lib/srs.js` gains reviews-first selection, a per-day new budget, chunked-block assembly, and gap forgiveness (all unit-tested). `SessionV2.jsx` becomes the daily runner at `/session`; the Dashboard reads `word_senses` and centers on one Start button. Legacy `Session.jsx`/`planSession`/`completeSession` are deleted; standalone tiles become exposure-only.

**Tech Stack:** React 19 + Vite 8 + Tailwind v4 + Supabase (Postgres) + Claude API. Tests: Node built-in `node --test` (zero new deps).

## Global Constraints

- Git author email must be `wordy.app.team@gmail.com`.
- Test v2 only on Nika's account, never mom's (shared prod/preview Supabase DB).
- Apostrophes inside single-quoted JS strings break the Vite build — use double quotes.
- The Claude API is only ever called via the `callClaude` wrapper (never from a component directly).
- Pre-commit hook runs `vite build` and blocks broken commits. Keep the existing 25 `node --test` tests green.
- No new dependencies. No DB migration (per-day new count lives in `localStorage`).
- Defaults: session cap **18**, block size **5**, new words **7/day**.
- Commit after every task. Push is allowed (Nika authorized Netlify deploys).

---

## Task 1: Gap forgiveness in `applyVerdict`

A word reviewed **more than its own interval late** is a "gap review": a FAIL is forgiven (treated like a first-strike retry — no demotion, no lapse), so a break can't crater mature vocabulary.

**Files:**
- Modify: `src/lib/srs.js` (`applyVerdict`, ~lines 85-127; add a `daysBetween` helper)
- Test: `src/lib/srs.test.js`

**Interfaces:**
- Consumes: existing `applyVerdict(state, verdict, todayISO)` where `state` includes `interval_step`, `lapses`, `slipped`, `next_review_date`; `INTERVALS`, `addDays`, `clampStep`.
- Produces: `applyVerdict` unchanged signature; new behavior only.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/srs.test.js`:

```js
test('gap forgiveness: a FAIL far past due does not demote or count a lapse', () => {
  // step 5 (late), interval 21 days; due 2026-06-01, reviewed 2026-07-01 = 30 days late (> 21) → gap
  const state = { interval_step: 5, lapses: 0, slipped: false, next_review_date: '2026-06-01' }
  const r = applyVerdict(state, 'FAIL', '2026-07-01')
  assert.equal(r.interval_step, 5)          // no demotion
  assert.equal(r.lapses, 0)                  // no lapse counted
  assert.equal(r.next_review_date, '2026-07-02') // short leash: retry tomorrow
})

test('gap forgiveness does NOT apply to an on-time FAIL (normal two-strike still works)', () => {
  // reviewed exactly on the due date → not a gap; a slipped word demotes as before
  const state = { interval_step: 5, lapses: 0, slipped: true, next_review_date: '2026-07-01' }
  const r = applyVerdict(state, 'FAIL', '2026-07-01')
  assert.equal(r.interval_step, 3)           // max(1, 5-2) = 3 demotion
  assert.equal(r.lapses, 1)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test src/lib/srs.test.js`
Expected: FAIL — the first test demotes (interval_step 3, lapses 1) because gap forgiveness doesn't exist yet.

- [ ] **Step 3: Implement gap forgiveness**

In `src/lib/srs.js`, add near the other date helpers (e.g. just below `addDays`):

```js
function daysBetween(fromISO, toISO) {
  return Math.round((Date.parse(toISO) - Date.parse(fromISO)) / 86400000)
}
```

In `applyVerdict`, replace the FAIL branch condition `if (!slipped) {` with a gap-aware version. The full FAIL branch becomes:

```js
  } else { // FAIL
    const overdue = state.next_review_date ? daysBetween(state.next_review_date, todayISO) : 0
    const gapReview = overdue > INTERVALS[step] // reviewed more than its own interval late
    if (!slipped || gapReview) {
      // First strike OR a review after a real gap: one-day retry, no demotion, no lapse.
      slipped = true
      nextDate = addDays(todayISO, 1)
    } else {
      // Confirmed lapse (on-time second strike): tighten schedule, maybe drop a band.
      nextStep = step <= 0 ? 0 : Math.max(1, step - 2)
      lapses += 1
      slipped = false
      nextDate = addDays(todayISO, 1)
    }
  }
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test src/lib/srs.test.js`
Expected: PASS — all tests (27 total now).

- [ ] **Step 5: Commit**

```bash
git add src/lib/srs.js src/lib/srs.test.js
git commit -m "feat(srs): gap forgiveness — forgive FAIL on reviews past a real gap"
```

---

## Task 2: Reviews-first selection + per-day new budget in `planSessionV2`

New words fill only the room reviews leave under the cap, capped by a per-day budget, and pause entirely when a full session of reviews is already due.

**Files:**
- Modify: `src/lib/srs.js` (`planSessionV2` selection block, ~lines 138-168)
- Test: `src/lib/srs.test.js`

**Interfaces:**
- Consumes: `planSessionV2(senses, opts)`. `opts` gains `newPerDay` (default 7) and `newToday` (default 0); `gradedCap` stays the session cap; `newCap` is removed.
- Produces: selection where reviews take priority, `newTake.length ≤ min(newPerDay - newToday, roomUnderCap)`, and `newTake.length === 0` when `reviews.length >= cap`.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/srs.test.js` (uses the existing sense-factory pattern in that file — build plain objects with `id`, `word_id`, `interval_step`, `last_reviewed`, `next_review_date`):

```js
test('planSessionV2: reviews take priority; new words fill leftover room under the cap', () => {
  const due = Array.from({ length: 15 }, (_, i) => ({ id: `d${i}`, word_id: `wd${i}`, interval_step: 3, last_reviewed: '2026-06-20', next_review_date: '2026-06-25', word_form: `due${i}`, translation: 't' }))
  const news = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, word_id: `wn${i}`, interval_step: 0, last_reviewed: null, next_review_date: null, word_form: `new${i}`, translation: 't' }))
  const steps = planSessionV2([...due, ...news], { today: '2026-07-01', gradedCap: 18, newPerDay: 7, newToday: 0 })
  const gradedSenses = new Set(steps.filter(s => s.graded).map(s => s.senseId))
  assert.equal(gradedSenses.size, 18)                    // capped at 18
  const newInSession = [...gradedSenses].filter(id => id.startsWith('n')).length
  assert.equal(newInSession, 3)                          // 15 due + 3 new = 18
})

test('planSessionV2: new words pause when a full session of reviews is already due', () => {
  const due = Array.from({ length: 30 }, (_, i) => ({ id: `d${i}`, word_id: `wd${i}`, interval_step: 3, last_reviewed: '2026-06-20', next_review_date: '2026-06-25', word_form: `due${i}`, translation: 't' }))
  const news = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, word_id: `wn${i}`, interval_step: 0, last_reviewed: null, next_review_date: null, word_form: `new${i}`, translation: 't' }))
  const steps = planSessionV2([...due, ...news], { today: '2026-07-01', gradedCap: 18, newPerDay: 7, newToday: 0 })
  const gradedSenses = new Set(steps.filter(s => s.graded).map(s => s.senseId))
  const newInSession = [...gradedSenses].filter(id => id.startsWith('n')).length
  assert.equal(newInSession, 0)                          // behind → 0 new
})

test('planSessionV2: per-day budget subtracts new words already introduced today', () => {
  const news = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, word_id: `wn${i}`, interval_step: 0, last_reviewed: null, next_review_date: null, word_form: `new${i}`, translation: 't' }))
  const steps = planSessionV2(news, { today: '2026-07-01', gradedCap: 18, newPerDay: 7, newToday: 5 })
  const gradedSenses = new Set(steps.filter(s => s.graded).map(s => s.senseId))
  assert.equal(gradedSenses.size, 2)                     // 7 - 5 already done = 2 left today
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test src/lib/srs.test.js`
Expected: FAIL — current code reserves new slots (newCap 7) and would put 7 new in the first test.

- [ ] **Step 3: Implement reviews-first + day budget**

In `src/lib/srs.js` `planSessionV2`, change the destructured opts: remove `newCap = 7,` and add `newPerDay = 7, newToday = 0,`. Then replace the selection block (currently the `newTake` / `leechTake` / `reviewBudget` / `selected` lines) with:

```js
  const cap = gradedCap
  const leechTake = leeches.slice(0, leechCap).map((s) => ({ ...s, _remedial: true }))
  const roomAfterLeech = Math.max(0, cap - leechTake.length)
  const reviewTake = reviews.slice(0, roomAfterLeech)               // reviews take priority
  const behind = reviews.length >= cap                             // a full session already due
  const newBudget = behind ? 0 : Math.max(0, newPerDay - newToday) // per-DAY budget, 0 when behind
  const roomForNew = Math.max(0, cap - leechTake.length - reviewTake.length)
  const newTake = news.slice(0, Math.min(newBudget, roomForNew))
  const selected = [...reviewTake, ...leechTake, ...newTake]
  if (selected.length === 0) return []
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test src/lib/srs.test.js`
Expected: PASS (30 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/srs.js src/lib/srs.test.js
git commit -m "feat(srs): reviews-first selection with a per-day new-word budget"
```

---

## Task 3: Chunked-block session assembly

Replace batch-encode-then-batch-test with blocks of ~5 words, each block running encode → test, so the session has a predictable cadence with spacing preserved.

**Files:**
- Modify: `src/lib/srs.js` (`planSessionV2` assembly/return, ~lines 170-189)
- Test: `src/lib/srs.test.js`

**Interfaces:**
- Consumes: `opts.blockSize` (default 5), `scaffoldFor`, `gradedExerciseFor`, `directionFor`, `stageName`, `antiCluster`.
- Produces: step order = for each block of `blockSize` selected senses, that block's scaffold (encode) steps followed by its graded (test) steps.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/srs.test.js`:

```js
test('planSessionV2: chunks into blocks — block 1 is fully tested before block 2 encodes', () => {
  // 7 mid senses, blockSize 3 → blocks [0,1,2] [3,4,5] [6]
  const senses = Array.from({ length: 7 }, (_, i) => ({ id: `s${i}`, word_id: `w${i}`, interval_step: 3, last_reviewed: '2026-06-20', next_review_date: '2026-06-25', word_form: `w${i}`, translation: 't', examples: [] }))
  const steps = planSessionV2(senses, { today: '2026-07-01', gradedCap: 18, blockSize: 3 })
  const firstBlockIds = new Set(['s0', 's1', 's2'])
  // index of the first graded step whose sense is in block 1
  const firstBlockGradedIdx = steps.findIndex(s => s.graded && firstBlockIds.has(s.senseId))
  // index of the first encode step whose sense is NOT in block 1 (i.e. block 2)
  const secondBlockEncodeIdx = steps.findIndex(s => !s.graded && !firstBlockIds.has(s.senseId))
  assert.ok(firstBlockGradedIdx < secondBlockEncodeIdx, 'block 1 must be graded before block 2 encodes')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test src/lib/srs.test.js`
Expected: FAIL — current code encodes ALL senses then grades ALL, so block-2 encode comes before block-1 graded.

- [ ] **Step 3: Implement chunked assembly**

In `planSessionV2`, add `blockSize = 5,` to the destructured opts. Replace the final assembly (the `scaffoldSteps`/`gradedSteps` loop and the `return [...antiCluster(...), ...antiCluster(...)]`) with:

```js
  const display = (s) => ({ word: s.word_form ?? s.word ?? '', translation: s.translation ?? '' })
  const out = []
  for (let i = 0; i < selected.length; i += blockSize) {
    const block = selected.slice(i, i + blockSize)
    const scaffoldSteps = []
    const gradedSteps = []
    for (const s of block) {
      const step = s.interval_step ?? 0
      const remedial = !!s._remedial
      const base = { senseId: s.id, wordId: s.word_id, pos: s.pos, examples: s.examples ?? [], remedial, direction: directionFor(step), stage: stageName(step), ...display(s) }
      for (const ex of (remedial ? ['flashcard'] : scaffoldFor(step))) {
        scaffoldSteps.push({ ...base, exercise: ex, graded: false })
      }
      gradedSteps.push({ ...base, exercise: remedial ? 'word_choice' : gradedExerciseFor(step), graded: true })
    }
    out.push(
      ...antiCluster(scaffoldSteps, (x) => x.wordId, antiClusterWindow),
      ...antiCluster(gradedSteps, (x) => x.wordId, antiClusterWindow),
    )
  }
  return out
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test src/lib/srs.test.js`
Expected: PASS (31 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/srs.js src/lib/srs.test.js
git commit -m "feat(srs): chunked-block session rhythm (encode->test per ~5 words)"
```

---

## Task 4: Session runner — remove dev fast-forward, feed the day budget

`SessionV2.jsx` becomes the real runner: no `?date=` fast-forward, no jump buttons; it computes `newToday` from `localStorage` and passes `newPerDay`/`blockSize`/`gradedCap` to `planSessionV2`.

**Files:**
- Modify: `src/pages/SessionV2.jsx` (imports ~line 6-13; date logic ~lines 302-326; the `planSessionV2(...)` call; the jump-button JSX)
- Create: `src/lib/dailyNew.js` (localStorage per-day new-word counter)

**Interfaces:**
- Produces: `getNewToday(todayISO): number` and `addNewToday(todayISO, n): void` in `src/lib/dailyNew.js`.
- Consumes: `planSessionV2(senses, { today, gradedCap: 18, blockSize: 5, newPerDay: 7, newToday })`.

- [ ] **Step 1: Create the per-day counter helper**

Create `src/lib/dailyNew.js`:

```js
// Per-day count of NEW words the guided session has introduced, stored locally.
// Device-local is fine for a single-learner-per-device app; it self-resets daily.
const key = (todayISO) => `wordy_new_today_${todayISO}`

export function getNewToday(todayISO) {
  try { return parseInt(localStorage.getItem(key(todayISO)) || '0', 10) || 0 } catch { return 0 }
}

export function addNewToday(todayISO, n) {
  try { localStorage.setItem(key(todayISO), String(getNewToday(todayISO) + n)) } catch { /* no storage */ }
}
```

- [ ] **Step 2: Remove the fast-forward and wire the budget**

In `src/pages/SessionV2.jsx`:
1. Remove `useSearchParams` from the `react-router-dom` import (line ~6); keep `useNavigate`.
2. Delete the fast-forward block: `const [searchParams, setSearchParams] = useSearchParams()`, the `?date=` override, `realToday`/`jumpTo`, and any `dateParam` usage. Replace all reads of the simulated date with `new Date().toISOString().split('T')[0]` (call it `todayISO`).
3. Import the counter: `import { getNewToday, addNewToday } from '../lib/dailyNew'`.
4. At the `planSessionV2(...)` call, pass options:

```js
const todayISO = new Date().toISOString().split('T')[0]
const steps = planSessionV2(senses, {
  today: todayISO,
  gradedCap: 18,
  blockSize: 5,
  newPerDay: 7,
  newToday: getNewToday(todayISO),
})
```

5. When the session completes, before/after `completeSessionV2`, count the new senses that were graded this session and record them:

```js
const newGraded = steps.filter(s => s.graded && (s.stage === 'new')).length
if (newGraded > 0) addNewToday(todayISO, newGraded)
```

6. Delete the jump-button JSX (`+1d / +3d / +7d / +30d` and the date pill) from the render.

- [ ] **Step 3: Verify build + tests**

Run: `npm run build 2>&1 | grep -E "built in|error"` — Expected: `✓ built in …`, no errors.
Run: `node --test src/lib/*.test.js 2>&1 | grep -E "^ℹ (tests|pass|fail)"` — Expected: pass == tests, fail 0.

- [ ] **Step 4: Manual check**

Run the app (`npm run dev`), open `/session-v2`, confirm: no date buttons; a session runs in encode→test blocks; completing it persists (Session complete screen) and reschedules.

- [ ] **Step 5: Commit**

```bash
git add src/pages/SessionV2.jsx src/lib/dailyNew.js
git commit -m "feat(session): daily runner — drop dev fast-forward, feed per-day new budget"
```

---

## Task 5: Keep-going flow

After a session, if more reviews are genuinely due, offer a calm "keep going?" that re-plans the next capped batch immediately (respecting the day budget, so a behind day adds no new words).

**Files:**
- Modify: `src/pages/SessionV2.jsx` (the "Session complete" screen)

**Interfaces:**
- Consumes: the same load+plan path as initial mount; `getNewToday` (already updated by Task 4 so new stays capped across batches).

- [ ] **Step 1: Add re-plan on the complete screen**

On the Session-complete screen, after `completeSessionV2` resolves, re-query due senses (reuse the existing load function) and compute whether any remain due today. If `remainingDue > 0`, render a secondary button:

```jsx
{remainingDue > 0 && (
  <button onClick={restart} className="btn-secondary mt-3">
    {uk ? 'Продовжити →' : 'Keep going →'} ({remainingDue})
  </button>
)}
```

`restart` resets the runner state (steps, index, feedback) and re-runs the load+`planSessionV2` path — which now returns the next capped batch, with new words already throttled by the updated `getNewToday`.

- [ ] **Step 2: Verify build**

Run: `npm run build 2>&1 | grep -E "built in|error"` — Expected: clean.

- [ ] **Step 3: Manual check**

Seed >18 due senses on Nika's account (SQL), run a session, confirm "Keep going" appears with the remaining count and the next batch has 0 new words (behind day).

- [ ] **Step 4: Commit**

```bash
git add src/pages/SessionV2.jsx
git commit -m "feat(session): keep-going continues the backlog without adding new words"
```

---

## Task 6: Dashboard counts from `word_senses` + drop legacy plan

Replace the legacy `planSession` preview and `words`-derived session with `word_senses`-based counts: due-today, new-available, and a small progress readout.

**Files:**
- Modify: `src/pages/Dashboard.jsx` (remove `planSession` import line 7 and its usage ~line 116-124; add sense-based counts near the existing `senseCount` query ~lines 75-79)

**Interfaces:**
- Produces: `dueToday` (count of `word_senses` where `next_review_date <= today` OR `next_review_date is null` and not new-at-step-0-unreviewed... use the same due logic as the planner: `last_reviewed not null AND (next_review_date <= today OR next_review_date is null)`), `newAvailable` (senses at `interval_step = 0` and `last_reviewed is null`), for the Start CTA.

- [ ] **Step 1: Add the counts query**

In `src/pages/Dashboard.jsx`, alongside the existing `word_senses` count effect (~line 75), add queries scoped to `user.id` + active target language:

```js
const todayISO = new Date().toISOString().split('T')[0]
// due reviews: reviewed before, and due today or unscheduled
supabase.from('word_senses')
  .select('id', { count: 'exact', head: true })
  .eq('user_id', user.id).eq('target_language', targetLang)
  .not('last_reviewed', 'is', null)
  .or(`next_review_date.lte.${todayISO},next_review_date.is.null`)
  .then(({ count }) => setDueToday(count ?? 0))
// new available: never reviewed, still at step 0
supabase.from('word_senses')
  .select('id', { count: 'exact', head: true })
  .eq('user_id', user.id).eq('target_language', targetLang)
  .is('last_reviewed', null).eq('interval_step', 0)
  .then(({ count }) => setNewAvailable(count ?? 0))
```

Add `const [dueToday, setDueToday] = useState(0)` and `const [newAvailable, setNewAvailable] = useState(0)` with the other state.

- [ ] **Step 2: Remove the legacy plan**

Delete `import { planSession } from '../lib/sessionEngine'` (line 7) and the `planSession(wordsWithStage, timeBudget, lang)` block (~line 116-124) and any `timeBudget` UI it fed. (The Start CTA in Task 7 replaces it.)

- [ ] **Step 3: Verify build**

Run: `npm run build 2>&1 | grep -E "built in|error"` — Expected: clean (fix any now-unused vars from the removed plan block).

- [ ] **Step 4: Commit**

```bash
git add src/pages/Dashboard.jsx
git commit -m "feat(dashboard): due/new counts from word_senses; drop legacy planSession"
```

---

## Task 7: Dashboard Start CTA + empty states + Extra-practice section

**Files:**
- Modify: `src/pages/Dashboard.jsx` (the Session-plans render region ~lines 387-417; the `EXERCISES` tiles render ~lines 320-370)

- [ ] **Step 1: Primary Start CTA**

Replace the legacy Session-plan block with a single primary CTA whose label depends on state:

```jsx
{dueToday > 0 ? (
  <button onClick={() => navigate('/session')} className="btn-primary w-full">
    {uk ? `Почати — ${Math.min(dueToday, 18)} сьогодні` : `Start — ${Math.min(dueToday, 18)} today`}
  </button>
) : newAvailable > 0 ? (
  <button onClick={() => navigate('/session')} className="btn-primary w-full">
    {uk ? `Ви все опрацювали — вивчити ${Math.min(newAvailable, 7)} нових?` : `You're caught up — learn ${Math.min(newAvailable, 7)} new?`}
  </button>
) : (
  <p className="text-sm text-gray-500 text-center">{uk ? 'Усе опрацьовано. Повертайтеся завтра ✨' : 'All caught up. Come back tomorrow ✨'}</p>
)}
```

- [ ] **Step 2: Demote tiles to "Extra practice"**

Wrap the existing `EXERCISES` tiles render in a collapsible section headed `Extra practice` / `Додаткова практика`, closed by default (`const [showExtra, setShowExtra] = useState(false)` + a toggle button). Do not change the tiles themselves.

- [ ] **Step 3: Verify build + manual**

Run: `npm run build 2>&1 | grep -E "built in|error"` — Expected: clean.
Manual: Dashboard shows one Start button with the due count; tiles are under a collapsed "Extra practice"; empty states render when nothing is due.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Dashboard.jsx
git commit -m "feat(dashboard): Start-centered layout with empty states; tiles as extra practice"
```

---

## Task 8: Routing + delete legacy session code

**Files:**
- Modify: `src/App.jsx` (routes ~lines 21-22, 71-72)
- Delete: `src/pages/Session.jsx`
- Modify: `src/lib/sessionEngine.js` (remove `planSession` ~line 70-177 and `completeSession` ~line 199-262; keep `completeSessionV2`, `startSession`, `logWordResult`, `stageToStatus`, `checkPromotion` if still referenced)

- [ ] **Step 1: Repoint routes**

In `src/App.jsx`: change `<Route path="/session" element={<Protected><Session /></Protected>} />` to render `SessionV2`. Add a redirect for the old test URL: `<Route path="/session-v2" element={<Navigate to="/session" replace />} />`. Remove `import Session from './pages/Session'`.

- [ ] **Step 2: Delete legacy files/functions**

```bash
git rm src/pages/Session.jsx
```

In `src/lib/sessionEngine.js`, delete `planSession` and `completeSession`. Grep first to confirm no remaining importers:

```bash
grep -rn "planSession\b\|completeSession\b" src/ | grep -v completeSessionV2
```

Expected after Tasks 6/8: only the (now-deleted) definitions — no live importers. Remove any that remain.

- [ ] **Step 3: Verify build + tests**

Run: `npm run build 2>&1 | grep -E "built in|error"` — Expected: clean (no missing-import errors).
Run: `node --test src/lib/*.test.js 2>&1 | grep -E "^ℹ (tests|pass|fail)"` — Expected: green.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: /session runs v2; delete legacy Session.jsx/planSession/completeSession"
```

---

## Task 9: Standalone tiles → exposure-only

Now that the legacy schedule is retired, tiles must not write SRS state (`learning_stage`/`next_review_date`/`interval_step`) — otherwise self-practice back-doors around the 7/day enrollment throttle.

**Files:**
- Modify: `src/pages/Flashcards.jsx` (remove the `word_senses.update({learning_stage, next_review_date})` write at ~line 255 and the `computeSenseReview` call at ~line 254)
- Modify: `src/pages/WordOrder.jsx` (the `learning_stage: 'new'` insert path ~line 271 — keep sense CREATION for genuinely new words if that's how words enter the dictionary, but do NOT advance stage on practice; confirm by reading the surrounding handler)
- Modify: `src/pages/ActiveRecall.jsx`, `src/pages/SentenceWriting.jsx` (remove any `.update(` of stage/schedule fields)

- [ ] **Step 1: Find every SRS write in the tiles**

```bash
grep -rnE "word_senses'\)\.update\(|\.update\(\{[^}]*learning_stage|\.update\(\{[^}]*next_review_date|\.update\(\{[^}]*interval_step" src/pages/Flashcards.jsx src/pages/WordOrder.jsx src/pages/ActiveRecall.jsx src/pages/SentenceWriting.jsx
```

- [ ] **Step 2: Remove the writes**

For each hit, delete the update call (and any now-unused review-computation like `computeSenseReview`). Practice still shows cards and feedback; it just no longer persists SRS state. Leave `image_url` writes and genuine sense CREATION (Dictionary/onboarding) untouched.

- [ ] **Step 3: Verify build**

Run: `npm run build 2>&1 | grep -E "built in|error"` — Expected: clean.

- [ ] **Step 4: Manual check**

Practice a few flashcards on a tile, then confirm in Supabase (Nika's account) that the touched senses' `interval_step`/`last_reviewed`/`next_review_date` are unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Flashcards.jsx src/pages/WordOrder.jsx src/pages/ActiveRecall.jsx src/pages/SentenceWriting.jsx
git commit -m "refactor(tiles): practice is exposure-only — no SRS writes"
```

---

## Task 10: Data-safety check + merge

Guarantee no dictionary entry disappears (every word has ≥1 sense), then merge to `main`.

**Files:** none (verification + git)

- [ ] **Step 1: Orphan check (Supabase SQL editor, Nika's account first, then mom's user_id)**

```sql
select w.id, w.word
from public.words w
left join public.word_senses s on s.word_id = w.id
where s.id is null;
```

Expected: 0 rows. If any rows: backfill by re-identifying those words (Dictionary or `/migrate`) so each gets ≥1 sense, then re-run until 0 rows.

- [ ] **Step 2: Full verification**

Run: `node --test src/lib/*.test.js 2>&1 | grep -E "^ℹ (tests|pass|fail)"` — Expected: green.
Run: `npm run build 2>&1 | grep -E "built in|error"` — Expected: clean.
Manual click-through on the preview (Nika's account): normal day, behind day (seed >18 due), keep-going, empty state, and gap forgiveness (seed a late-overdue mature sense, FAIL it, confirm no demotion in the Session-complete summary).

- [ ] **Step 3: Merge to main**

```bash
git checkout main
git merge --no-ff srs-v2 -m "Merge srs-v2: v2 cutover — guided session is the daily default"
git push origin main
```

Then confirm the live site (`wordy-team.netlify.app`) builds and mom's dictionary still shows all her words.

- [ ] **Step 4: Post-merge sanity**

On the live site with Nika's account: Dashboard shows the Start CTA, a session runs and persists, and no words are missing from the dictionary.
