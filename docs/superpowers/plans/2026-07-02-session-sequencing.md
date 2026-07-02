# Session Card Sequencing v2.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorder session cards into stage packs with type phases (all flashcards → all context cards → all tests) so the sequence reads as deliberate instead of random.

**Architecture:** All logic lands in the pure planner `planSessionV2` (`src/lib/srs.js`) via two new exported pure helpers — `packSenses` (stage bucketing + tiny-pack merge) and `balancedChunks` (runt-free chunk splitting). Selection (which senses enter the session) is untouched; only presentation order changes. `SessionV2.jsx` changes one number (`blockSize: 5 → 4`).

**Tech Stack:** Plain ES modules, `node --test` + `node:assert/strict` for tests, Vite build (run by the pre-commit hook automatically).

**Spec:** `docs/superpowers/specs/2026-07-02-session-sequencing-design.md`

## Global Constraints

- Branch: `srs-v2`. Commit directly to it (no new branch).
- Tests: `node --test src/lib/srs.test.js` — all 27 existing tests must keep passing.
- The pre-commit hook runs `vite build` and blocks broken commits; do not bypass with `--no-verify`.
- Git author email must be `wordy.app.team@gmail.com` (already configured; do not change).
- Never put an apostrophe inside a single-quoted JS string — use double quotes (it breaks the build).
- Stage mapping (from `stageOf` in `src/lib/srs.js`): step 0 = new, 1–2 = early, 3–4 = mid, 5 = late, 6–7 = known, 8 = mastered.
- Scaffold recipes (from `scaffoldFor`): new = `['flashcard']`, early/mid = `['flashcard','fill_blank']`, late = `['fill_blank']`, known+ = `[]`. Remedial (leech) recipe = `['flashcard']` + graded `word_choice`, regardless of stage.
- Selection facts the tests rely on: a sense is *new* iff `last_reviewed` is null/undefined AND `interval_step` is 0; new words are **shuffled** (order-sensitive tests must use due reviews, not new words); `leechCap` is 2; `selected` order is reviews → leeches → new.

---

### Task 1: Pure helpers — `balancedChunks` and `packSenses`

**Files:**
- Modify: `src/lib/srs.js` (add two exported functions + one const near the other helpers at the bottom, after `antiCluster`)
- Test: `src/lib/srs.test.js` (append)

**Interfaces:**
- Consumes: existing `stageOf(step)` from `srs.js`.
- Produces:
  - `balancedChunks(arr, maxSize) -> Array<Array>` — splits `arr` into `ceil(n/maxSize)` near-equal chunks, each ≤ `maxSize`, never a runt tail. `[]` in → `[]` out.
  - `packSenses(selected) -> Array<Array<sense>>` — non-empty stage packs in emission order (new → early → mid → late → known → mastered → leech-help). Input senses may carry `_remedial: true` (leech). Tiny (<3) scaffolded packs (new/early/mid/late) are merged into their best-recipe neighbor; leech-help and known+ never merge; merged packs are stage-ordered internally.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/srs.test.js` (extend the import line at the top of the file to include the two new names):

```js
// change line 4 to:
import { planSessionV2, applyVerdict, sentenceOutcome, gradedExerciseFor, nextExampleIndex, buildFillBlank, firstFillBlank, gradeFillIn, balancedChunks, packSenses } from './srs.js'
```

Append at the end of the file:

```js
// ── Sequencing v2.1: balanced chunks ──────────────────────────────────────────
// Spec: docs/superpowers/specs/2026-07-02-session-sequencing-design.md

test('balancedChunks: splits into near-equal cycles, never a runt tail', () => {
  const arr = (n) => Array.from({ length: n }, (_, i) => i)
  assert.deepEqual(balancedChunks(arr(12), 4).map((c) => c.length), [4, 4, 4])
  assert.deepEqual(balancedChunks(arr(7), 4).map((c) => c.length), [4, 3])
  assert.deepEqual(balancedChunks(arr(9), 4).map((c) => c.length), [3, 3, 3], 'never 4+4+1')
  assert.deepEqual(balancedChunks(arr(3), 4).map((c) => c.length), [3])
  assert.deepEqual(balancedChunks([], 4), [])
  assert.deepEqual(balancedChunks(arr(7), 4).flat(), arr(7), 'order preserved')
})

// Shared factory for sequencing tests. `step` fixes the stage; new senses have
// last_reviewed null + step 0; everything else is due today or earlier.
const seqSense = (id, step, opts = {}) => ({
  id: `s${id}`, word_id: opts.wordId ?? `w${id}`, interval_step: step,
  last_reviewed: opts.isNew ? null : '2026-06-01',
  next_review_date: opts.isNew ? null : (opts.due ?? '2026-06-20'),
  is_leech: opts.leech ?? false,
  word_form: `wort${id}`, translation: `t${id}`, pos: 'noun',
  examples: [{ target: `Ein Satz mit wort${id}.`, native: 'x' }],
})

// ── Sequencing v2.1: stage packs + tiny-pack merge ────────────────────────────

test('packSenses: buckets in pack order new -> early -> mid -> late -> known+ -> leech', () => {
  const selected = [
    seqSense(1, 6),                       // known
    seqSense(2, 3),                       // mid
    seqSense(3, 3),                       // mid
    seqSense(4, 3),                       // mid
    seqSense(5, 0, { isNew: true }),      // new
    seqSense(6, 0, { isNew: true }),      // new
    seqSense(7, 0, { isNew: true }),      // new
    { ...seqSense(8, 1, { leech: true }), _remedial: true }, // leech-help
  ]
  const packs = packSenses(selected)
  const stagesPerPack = packs.map((p) => p.map((s) => (s._remedial ? 'leech' : String(s.interval_step))))
  // new(3) stays, mid(3) stays, known(1) is exempt from merging, leech last.
  assert.deepEqual(stagesPerPack, [['0', '0', '0'], ['3', '3', '3'], ['6'], ['leech']])
})

test('packSenses: a tiny early pack merges into mid (identical recipe), stage-ordered', () => {
  const selected = [
    seqSense(1, 3), seqSense(2, 3), seqSense(3, 3), seqSense(4, 3), // 4 mid
    seqSense(5, 1),                                                 // 1 early
  ]
  const packs = packSenses(selected)
  assert.equal(packs.length, 1, 'early folds into mid')
  assert.deepEqual(packs[0].map((s) => s.id), ['s5', 's1', 's2', 's3', 's4'], 'early first (stage order)')
})

test('packSenses: leech-help and known+ packs never merge, even when tiny', () => {
  const selected = [
    seqSense(1, 3), seqSense(2, 3), seqSense(3, 3), // 3 mid (not tiny)
    seqSense(4, 6),                                 // 1 known
    { ...seqSense(5, 2, { leech: true }), _remedial: true }, // 1 leech
  ]
  const packs = packSenses(selected)
  assert.equal(packs.length, 3)
  assert.equal(packs[1].length, 1, 'known+ pack of 1 stays')
  assert.ok(packs[2][0]._remedial, 'leech-help stays a distinct tail')
})

test('packSenses: a 1-2 word session yields a single tiny pack (nothing to merge with)', () => {
  const packs = packSenses([seqSense(1, 1)])
  assert.equal(packs.length, 1)
  assert.equal(packs[0].length, 1)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src/lib/srs.test.js 2>&1 | tail -15`
Expected: FAIL — `balancedChunks`/`packSenses` are not exported (SyntaxError or `undefined is not a function`). The 27 pre-existing tests are irrelevant at this step (the import error stops the file).

- [ ] **Step 3: Implement the helpers**

In `src/lib/srs.js`, after the `antiCluster` function (bottom of the planner section), add:

```js
// ── Sequencing v2.1 helpers (spec: 2026-07-02-session-sequencing-design.md) ──

// Split arr into ceil(n/maxSize) chunks of near-equal size, each <= maxSize.
// Balanced so a 9-word pack becomes 3+3+3, never 4+4+1 with a runt tail.
export function balancedChunks(arr, maxSize) {
  if (arr.length === 0) return []
  const n = Math.ceil(arr.length / maxSize)
  const out = []
  let start = 0
  for (let i = 0; i < n; i++) {
    const size = Math.ceil((arr.length - start) / (n - i))
    out.push(arr.slice(start, start + size))
    start += size
  }
  return out
}

// Pack index: 0..5 = stageOf(interval_step), 6 = leech-help (remedial tail).
const LEECH_PACK = 6
// Scaffold shape per mergeable pack: F = flashcard, C = context fill_blank.
const PACK_RECIPE = ['F', 'FC', 'FC', 'C']
const MERGE_MIN = 3

// Group selected senses into stage packs (emission order), merging tiny
// scaffolded packs (new/early/mid/late, <3 words) into the neighbor whose
// scaffold recipe matches best. Known+ packs (test-only) and the leech-help
// pack (deliberately tiny rescue tail, leechCap=2) never merge.
export function packSenses(selected) {
  const packOf = (s) => (s._remedial ? LEECH_PACK : stageOf(s.interval_step ?? 0))
  const packs = Array.from({ length: 7 }, () => [])
  for (const s of selected) packs[packOf(s)].push(s)

  const recipeDist = (a, b) => {
    const A = PACK_RECIPE[a], B = PACK_RECIPE[b]
    return (A.includes('F') !== B.includes('F') ? 1 : 0) + (A.includes('C') !== B.includes('C') ? 1 : 0)
  }
  for (;;) {
    const live = [0, 1, 2, 3].filter((p) => packs[p].length > 0)
    const tiny = live.find((p) => packs[p].length < MERGE_MIN)
    if (tiny === undefined || live.length < 2) break
    const target = live
      .filter((p) => p !== tiny)
      .sort((a, b) =>
        (recipeDist(tiny, a) - recipeDist(tiny, b)) ||
        (Math.abs(a - tiny) - Math.abs(b - tiny)) ||
        (a - b))[0]
    packs[target].push(...packs[tiny])
    packs[tiny] = []
    packs[target].sort((a, b) => packOf(a) - packOf(b)) // stable: stage order, original order within stage
  }
  return packs.filter((p) => p.length > 0)
}
```

Notes for the implementer:
- `stageOf` already exists in this file — no import needed.
- `Array.prototype.sort` is stable in all modern engines (ES2019 guarantee), which is what keeps original within-stage order after a merge.
- Do NOT wire these into `planSessionV2` yet — that is Task 2.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src/lib/srs.test.js 2>&1 | tail -5`
Expected: `pass 32` (27 existing + 5 new), `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/srs.js src/lib/srs.test.js
git commit -m "feat(srs): balancedChunks + packSenses helpers for stage-pack sequencing"
```

---

### Task 2: Rewire `planSessionV2` emission — stage packs, type phases, blockSize 4

**Files:**
- Modify: `src/lib/srs.js:137-197` (the `planSessionV2` options + block-building loop)
- Test: `src/lib/srs.test.js` (append)

**Interfaces:**
- Consumes: `packSenses(selected)` and `balancedChunks(pack, blockSize)` from Task 1 (exact signatures above); existing `scaffoldFor`, `gradedExerciseFor`, `directionFor`, `stageName`, `antiCluster`.
- Produces: `planSessionV2(senses, opts)` — same signature and same step-object shape as today (`{ senseId, wordId, pos, examples, remedial, direction, stage, newIntake, word, translation, exercise, graded }`), same *selection*, new *order*. Default `blockSize` changes 5 → 4. `SessionV2.jsx` (Task 3) relies on nothing new — only the order of the returned array changes.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/srs.test.js`:

```js
// ── Sequencing v2.1: planner emits stage packs in type phases ─────────────────

// Split the flat step list into encode->test cycles: a new cycle starts when a
// non-graded step follows a graded one. (Consecutive test-only cycles fuse into
// one graded run — fine for these assertions.)
function cyclesOf(steps) {
  const cycles = []
  let cur = []
  for (const st of steps) {
    if (cur.length && !st.graded && cur[cur.length - 1].graded) { cycles.push(cur); cur = [] }
    cur.push(st)
  }
  if (cur.length) cycles.push(cur)
  return cycles
}

// A mixed deterministic roster: no new words (they are shuffled), so order
// assertions are stable. 1 early + 5 mid + 1 late + 1 known + 2 leeches.
function mixedRoster() {
  return [
    seqSense(1, 1),                    // early (tiny -> merges into mid)
    seqSense(2, 3), seqSense(3, 3), seqSense(4, 4), seqSense(5, 4), seqSense(6, 3), // 5 mid
    seqSense(7, 5),                    // late (tiny -> merges into mid pack too)
    seqSense(8, 6),                    // known
    seqSense(9, 2, { leech: true }),   // leech
    seqSense(10, 2, { leech: true }),  // leech
  ]
}

test('planSessionV2: card types never interleave — every cycle is flashcards, then context, then tests', () => {
  const steps = planSessionV2(mixedRoster(), { today: '2026-07-02', gradedCap: 18, blockSize: 4 })
  for (const cycle of cyclesOf(steps)) {
    const kinds = cycle.map((s) => (s.graded ? 'G' : s.exercise === 'flashcard' ? 'F' : 'C')).join('')
    assert.match(kinds, /^F*C*G+$/, `phases must not interleave, got: ${kinds}`)
  }
})

test('planSessionV2: within a cycle, a context card always follows its own flashcard (when the recipe has one)', () => {
  const steps = planSessionV2(mixedRoster(), { today: '2026-07-02', gradedCap: 18, blockSize: 4 })
  for (const cycle of cyclesOf(steps)) {
    for (const ctx of cycle.filter((s) => s.exercise === 'fill_blank')) {
      if (ctx.stage === 'late') continue // late recipe has no flashcard by design
      const flashIdx = cycle.findIndex((s) => s.exercise === 'flashcard' && s.senseId === ctx.senseId)
      const ctxIdx = cycle.indexOf(ctx)
      assert.ok(flashIdx !== -1 && flashIdx < ctxIdx, `context for ${ctx.senseId} must follow its flashcard in the same cycle`)
    }
  }
})

test('planSessionV2: pack order is stage-ascending with leech-help last; tests within a cycle are stage-ordered', () => {
  const steps = planSessionV2(mixedRoster(), { today: '2026-07-02', gradedCap: 18, blockSize: 4 })
  const graded = steps.filter((s) => s.graded)
  // Leech tests come last.
  const firstLeech = graded.findIndex((s) => s.remedial)
  assert.ok(firstLeech !== -1)
  assert.ok(graded.slice(firstLeech).every((s) => s.remedial), 'all leech tests sit at the tail')
  // Non-leech graded steps never decrease in stage rank.
  const rank = { new: 0, early: 1, mid: 2, late: 3, known: 4, mastered: 5 }
  const ranks = graded.filter((s) => !s.remedial).map((s) => rank[s.stage])
  for (let i = 1; i < ranks.length; i++) {
    assert.ok(ranks[i] >= ranks[i - 1], `stage rank must not decrease: ${ranks.join(',')}`)
  }
})

test('planSessionV2: a big pack splits into balanced cycles of at most blockSize', () => {
  const nine = Array.from({ length: 9 }, (_, i) => seqSense(i + 1, 3)) // 9 mid words
  const steps = planSessionV2(nine, { today: '2026-07-02', gradedCap: 18, blockSize: 4 })
  const cycles = cyclesOf(steps)
  assert.deepEqual(cycles.map((c) => c.filter((s) => s.graded).length), [3, 3, 3], '9 -> 3+3+3, never 4+4+1')
})

test('planSessionV2: sequencing changes order only — selection set and graded exercises are unchanged', () => {
  const roster = mixedRoster()
  const steps = planSessionV2(roster, { today: '2026-07-02', gradedCap: 18, blockSize: 4 })
  const graded = steps.filter((s) => s.graded)
  assert.equal(new Set(graded.map((s) => s.senseId)).size, roster.length, 'every selected sense gets exactly one graded step')
  for (const g of graded.filter((s) => !s.remedial)) {
    const sense = roster.find((r) => r.id === g.senseId) // seqSense ids are already "s<N>"
    assert.equal(g.exercise, gradedExerciseFor(sense.interval_step), 'graded exercise per stage unchanged')
  }
  assert.ok(graded.filter((s) => s.remedial).every((s) => s.exercise === 'word_choice'), 'leech test stays word_choice')
})

test('planSessionV2: sibling senses of one word are not adjacent within a phase when avoidable', () => {
  const roster = [
    seqSense(1, 3, { wordId: 'shared' }), seqSense(2, 3, { wordId: 'shared' }),
    seqSense(3, 3), seqSense(4, 3),
  ]
  const steps = planSessionV2(roster, { today: '2026-07-02', gradedCap: 18, blockSize: 4 })
  for (let i = 1; i < steps.length; i++) {
    const a = steps[i - 1], b = steps[i]
    if (a.graded === b.graded && a.exercise === b.exercise) {
      assert.ok(!(a.wordId === 'shared' && b.wordId === 'shared'), 'sibling senses must not sit adjacent within a phase')
    }
  }
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test src/lib/srs.test.js 2>&1 | tail -8`
Expected: FAIL — at minimum the interleave test and the stage-order test fail against the current mixed-block builder (current code emits scaffolds anti-clustered across types). `pass` count < 38.

- [ ] **Step 3: Rewrite the emission loop**

In `src/lib/srs.js`, change the `blockSize` default in the `planSessionV2` options destructure (line ~145):

```js
    blockSize = 4,
```

Also update the options comment above the function (line ~137) — it stays accurate, no rename.

Then replace the entire block-building section (currently lines 174–196, from the comment `// Build steps in blocks:` through the final `return out`) with:

```js
  // Sequencing v2.1: stage packs -> balanced encode->test cycles -> type
  // phases (all flashcards, then all context cards, then all tests; same
  // word order per phase). Spec: 2026-07-02-session-sequencing-design.md.
  const display = (s) => ({ word: s.word_form ?? s.word ?? '', translation: s.translation ?? '' })
  const out = []
  for (const pack of packSenses(selected)) {
    for (const chunk of balancedChunks(pack, blockSize)) {
      const flash = [], ctx = [], tests = []
      for (const s of chunk) {
        const step = s.interval_step ?? 0
        const remedial = !!s._remedial
        const base = { senseId: s.id, wordId: s.word_id, pos: s.pos, examples: s.examples ?? [], remedial, direction: directionFor(step), stage: stageName(step), newIntake: isNew(s), ...display(s) }
        const scaffolds = remedial ? ['flashcard'] : scaffoldFor(step)
        if (scaffolds.includes('flashcard')) flash.push({ ...base, exercise: 'flashcard', graded: false })
        if (scaffolds.includes('fill_blank')) ctx.push({ ...base, exercise: 'fill_blank', graded: false })
        tests.push({ ...base, exercise: remedial ? 'word_choice' : gradedExerciseFor(step), graded: true })
      }
      out.push(
        ...antiCluster(flash, (x) => x.wordId, antiClusterWindow),
        ...antiCluster(ctx, (x) => x.wordId, antiClusterWindow),
        ...antiCluster(tests, (x) => x.wordId, antiClusterWindow),
      )
    }
  }
  return out
```

Notes for the implementer:
- Everything above this section in `planSessionV2` (the `isNew`/`isDue` filters, sorting, leech/review/new selection, `selected` assembly, the `if (selected.length === 0) return []` guard) stays byte-for-byte identical.
- `selected` is built reviews → leeches → new, so inside pack 0 the step-0 due retries already precede the shuffled new intake — no extra ordering code needed.
- `antiCluster` is now applied per phase (three calls) instead of scaffold/graded (two calls); same helper, unchanged.

- [ ] **Step 4: Run the full suite**

Run: `node --test src/lib/srs.test.js 2>&1 | tail -5`
Expected: `pass 38` (27 pre-existing + 5 from Task 1 + 6 new), `fail 0`. If a pre-existing planner test fails, the emission rewrite broke selection — re-check that the selection section was not touched.

- [ ] **Step 5: Commit**

```bash
git add src/lib/srs.js src/lib/srs.test.js
git commit -m "feat(srs): stage-pack sequencing — type phases, balanced cycles, blockSize 4"
```

---

### Task 3: `SessionV2.jsx` passes blockSize 4 + end-to-end verification

**Files:**
- Modify: `src/pages/SessionV2.jsx:334`

**Interfaces:**
- Consumes: `planSessionV2` from Task 2 (same call shape, only the number changes).
- Produces: nothing new — the runner renders whatever order the planner emits.

- [ ] **Step 1: Change the blockSize the app passes**

In `src/pages/SessionV2.jsx` (line ~334), change:

```js
      blockSize: 5,
```

to:

```js
      blockSize: 4,
```

- [ ] **Step 2: Full suite + build**

Run: `node --test src/lib/srs.test.js 2>&1 | tail -3`
Expected: `pass 38`, `fail 0`.

Run: `npm run build 2>&1 | tail -3`
Expected: `✓ built in …` (no errors; the chunk-size warning is normal).

- [ ] **Step 3: Commit and push**

```bash
git add src/pages/SessionV2.jsx
git commit -m "feat(session): run stage-pack sequencing with 4-word cycles"
git push origin srs-v2
```

Expected: pre-commit hook prints `✅ Build passed`; push updates PR #1's Netlify preview so the sequencing change is covered by the pending click-through.

---

## Verification (after all tasks)

- `node --test src/lib/srs.test.js` → `pass 38, fail 0`.
- `npm run build` → clean.
- `git log --oneline -3` shows the three commits above on `srs-v2`, pushed.
- The Netlify deploy preview (https://deploy-preview-1--wordy-team.netlify.app) rebuilds; the manual click-through checklist gains one item: a session should visibly run as *new words → learning words → mature words → leech rescue*, with no context card appearing before its own word's flashcard.
