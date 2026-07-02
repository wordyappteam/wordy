// Pure-core SRS v2 tests. Run with: node --test src/lib/srs.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { badgeForStage, planSessionV2, applyVerdict, sentenceOutcome, gradedExerciseFor, nextExampleIndex, buildFillBlank, firstFillBlank, gradeFillIn, balancedChunks, packSenses } from './srs.js'

// ── Bug #1: fill_blank scaffold must carry the sense's examples ───────────────
// The UI renders a context fill-blank from step.examples[0].target. If the
// planner drops `examples`, the fill-blank silently degrades to a flashcard.
test('fill_blank scaffold carries the sense examples through to the step', () => {
  const examples = [{ target: 'Ich trinke Wasser.', native: 'I drink water.' }]
  const midSense = {
    id: 's1', word_id: 'w1', interval_step: 4, // mid -> scaffolds include fill_blank
    last_reviewed: '2026-06-01', next_review_date: '2026-06-01', is_leech: false,
    word_form: 'Wasser', translation: 'water', pos: 'noun', examples,
  }

  const steps = planSessionV2([midSense], { today: '2026-06-24' })
  const fill = steps.find((s) => s.exercise === 'fill_blank')

  assert.ok(fill, 'expected a fill_blank scaffold step for a mid-stage sense')
  assert.deepEqual(fill.examples, examples, 'fill_blank step should carry examples')
})

// ── Judgment call A: failure must not promote a never-learned word ────────────
test('failing a brand-new word twice keeps it at step 0 (no promotion-by-failure)', () => {
  const first = applyVerdict({ interval_step: 0, lapses: 0, slipped: false }, 'FAIL', '2026-06-24')
  assert.equal(first.interval_step, 0)
  assert.equal(first.slipped, true)

  const second = applyVerdict(
    { interval_step: first.interval_step, lapses: first.lapses, slipped: first.slipped },
    'FAIL', '2026-06-25',
  )
  assert.equal(second.interval_step, 0, 'a word never answered correctly stays "new"')
})

// ── Judgment call B: a stuck beginner word still accrues lapses -> leech help ──
test('a repeatedly-failed word accrues lapses at any stage and reaches the leech threshold', () => {
  let state = { interval_step: 0, lapses: 0, slipped: false }
  for (let day = 0; day < 8; day++) {
    const iso = `2026-06-${String(10 + day).padStart(2, '0')}`
    const r = applyVerdict(state, 'FAIL', iso)
    state = { interval_step: r.interval_step, lapses: r.lapses, slipped: r.slipped, is_leech: r.is_leech }
  }
  assert.ok(state.lapses >= 4, 'eight days of failing a new word should reach the leech threshold')
  assert.equal(state.is_leech, true, 'and should be flagged as a leech for remedial help')
})

// ── Judgment call C: an "almost" on a slipped word stays on a short leash ──────
test('HOLD on a recently-failed (slipped) word keeps a short leash, not the full interval', () => {
  const failed = applyVerdict({ interval_step: 5, lapses: 0, slipped: false }, 'FAIL', '2026-06-24')
  assert.equal(failed.slipped, true)

  const held = applyVerdict(
    { interval_step: failed.interval_step, lapses: failed.lapses, slipped: failed.slipped },
    'HOLD', '2026-06-25',
  )
  assert.equal(held.interval_step, 5, 'step unchanged on HOLD')
  assert.equal(held.next_review_date, '2026-06-27', 'short leash (~2 days), not the full 21-day interval')
})

// Regression guard: a normal HOLD (not slipped) still earns the full interval.
test('HOLD on a word that was not slipped keeps the normal full interval', () => {
  const held = applyVerdict({ interval_step: 5, lapses: 0, slipped: false }, 'HOLD', '2026-06-24')
  assert.equal(held.next_review_date, '2026-07-15', '2026-06-24 + INTERVALS[5]=21 days')
})

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

// ── Bug #2: sentence reviews score meaning and form separately ────────────────
// Meaning wrong = FAIL; meaning right but form wrong = "almost" (HOLD), so a
// grammar slip never demotes a word; both right = PASS.
test('sentenceOutcome maps separated meaning/form judgements to a session outcome', () => {
  assert.equal(sentenceOutcome({ meaningCorrect: false, formCorrect: true }), 'wrong')
  assert.equal(sentenceOutcome({ meaningCorrect: true, formCorrect: false }), 'almost')
  assert.equal(sentenceOutcome({ meaningCorrect: true, formCorrect: true }), 'correct')
})

test('sentenceOutcome falls back to isCorrect when the meaning/form split is absent', () => {
  assert.equal(sentenceOutcome({ isCorrect: true }), 'correct')
  assert.equal(sentenceOutcome({ isCorrect: false }), 'wrong')
})

test('mid-stage graded exercise is fill_in (steps 3 and 4)', () => {
  assert.equal(gradedExerciseFor(3), 'fill_in')
  assert.equal(gradedExerciseFor(4), 'fill_in')
})

test('early stays word_choice, late stays active_recall, known stays sentence_writing', () => {
  assert.equal(gradedExerciseFor(1), 'word_choice')   // early
  assert.equal(gradedExerciseFor(5), 'active_recall')  // late
  assert.equal(gradedExerciseFor(6), 'sentence_writing') // known
})

test('nextExampleIndex cycles and guards empty', () => {
  assert.equal(nextExampleIndex(0, 3), 0)
  assert.equal(nextExampleIndex(1, 3), 1)
  assert.equal(nextExampleIndex(3, 3), 0)   // wraps
  assert.equal(nextExampleIndex(4, 3), 1)
  assert.equal(nextExampleIndex(0, 0), 0)   // no examples
  assert.equal(nextExampleIndex(undefined, 3), 0)
})

test('buildFillBlank uses the inflected blank field when present', () => {
  const ex = { target: "Sie isst jeden Morgen ein Ei.", translation: "…", blank: "isst" }
  const r = buildFillBlank(ex, "essen")
  assert.equal(r.sentence, "Sie ____ jeden Morgen ein Ei.")
  assert.equal(r.answer, "isst")
  assert.equal(r.target, "Sie isst jeden Morgen ein Ei.")
})

test('buildFillBlank falls back to the lemma regex when no blank field', () => {
  const ex = { target: "Ich mag Senf.", translation: "…" }
  const r = buildFillBlank(ex, "Senf")
  assert.equal(r.sentence, "Ich mag ____.")
  assert.equal(r.answer, "Senf")
})

test('buildFillBlank returns null when nothing matches', () => {
  const ex = { target: "Gestern aßen wir.", translation: "…" } // inflected, no blank field, lemma absent
  assert.equal(buildFillBlank(ex, "essen"), null)
})

test('firstFillBlank scans past a non-blankable example to the one that works', () => {
  // The "slide" bug: rotated example uses an inflected form with no blank field,
  // but another example of the same sense contains the lemma verbatim.
  const exs = [
    { target: "Gestern aßen wir spät.", translation: "…" },  // inflected, lemma absent → null
    { target: "Wir essen jeden Tag.", translation: "…" },    // contains lemma → usable
  ]
  const r = firstFillBlank(exs, "essen", 0)
  assert.equal(r.sentence, "Wir ____ jeden Tag.")
  assert.equal(r.answer, "essen")
})

test('firstFillBlank returns null only when NO example yields a blank', () => {
  const exs = [
    { target: "Gestern aßen wir.", translation: "…" },
    { target: "Sie aß ein Ei.", translation: "…" },
  ]
  assert.equal(firstFillBlank(exs, "essen", 0), null)
  assert.equal(firstFillBlank([], "essen", 0), null)
  assert.equal(firstFillBlank(null, "essen", 0), null)
})

test('firstFillBlank starts scanning at the rotation cursor', () => {
  const exs = [
    { target: "Ich mag Senf.", translation: "…" },     // idx 0
    { target: "Er kaufte Senf.", translation: "…" },   // idx 1
  ]
  assert.equal(firstFillBlank(exs, "Senf", 1).target, "Er kaufte Senf.")
})

test('gradeFillIn: exact inflected form passes', () => {
  assert.equal(gradeFillIn("isst", { answer: "isst", lemma: "essen" }), "correct")
})
test('gradeFillIn: right word wrong form is almost (lemma typed)', () => {
  assert.equal(gradeFillIn("essen", { answer: "isst", lemma: "essen" }), "almost")
})
test('gradeFillIn: small typo is almost', () => {
  assert.equal(gradeFillIn("isstt", { answer: "isst", lemma: "essen" }), "almost")
})
test('gradeFillIn: wrong word fails; empty fails', () => {
  assert.equal(gradeFillIn("trinkt", { answer: "isst", lemma: "essen" }), "wrong")
  assert.equal(gradeFillIn("", { answer: "isst", lemma: "essen" }), "wrong")
})
test('gradeFillIn: case and accents are ignored', () => {
  assert.equal(gradeFillIn("  KNYHU ", { answer: "knyhu", lemma: "knyha" }), "correct")
})

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

test('planSessionV2: chunks into blocks — block 1 is fully tested before block 2 encodes', () => {
  // 7 mid senses, blockSize 3 → balanced blocks [0,1,2] [3,4] [5,6]
  const senses = Array.from({ length: 7 }, (_, i) => ({ id: `s${i}`, word_id: `w${i}`, interval_step: 3, last_reviewed: '2026-06-20', next_review_date: '2026-06-25', word_form: `w${i}`, translation: 't', examples: [] }))
  const steps = planSessionV2(senses, { today: '2026-07-01', gradedCap: 18, blockSize: 3 })
  const firstBlockIds = new Set(['s0', 's1', 's2'])
  // index of the first graded step whose sense is in block 1
  const firstBlockGradedIdx = steps.findIndex(s => s.graded && firstBlockIds.has(s.senseId))
  // index of the first encode step whose sense is NOT in block 1 (i.e. block 2)
  const secondBlockEncodeIdx = steps.findIndex(s => !s.graded && !firstBlockIds.has(s.senseId))
  assert.ok(firstBlockGradedIdx < secondBlockEncodeIdx, 'block 1 must be graded before block 2 encodes')
})

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

test("packSenses: multiple tiny scaffolded packs cascade-merge into one stage-ordered pack", () => {
  const selected = [
    seqSense(1, 5),                  // late
    seqSense(2, 3),                  // mid
    seqSense(3, 1),                  // early
    seqSense(4, 0, { isNew: true }), // new
  ]
  const packs = packSenses(selected)
  assert.equal(packs.length, 1, "four tiny stage packs collapse into one")
  assert.deepEqual(packs[0].map((s) => s.id), ["s4", "s3", "s2", "s1"], "merged pack is stage-ordered: new, early, mid, late")
})

// ── Dictionary status pill: derive from a sense's text stage ──────────────────
// The legacy words.status column has no writers since the cutover; the pill
// derives from the primary sense's learning_stage instead (badge vocabulary).
test('badgeForStage maps sense text stages to the four pill values', () => {
  assert.equal(badgeForStage('new'), 'new')
  assert.equal(badgeForStage('early'), 'learning')
  assert.equal(badgeForStage('mid'), 'learning')
  assert.equal(badgeForStage('late'), 'learning')
  assert.equal(badgeForStage('known'), 'known')
  assert.equal(badgeForStage('mastered'), 'mastered')
  assert.equal(badgeForStage(undefined), null, 'no sense stage -> null so callers can fall back')
  assert.equal(badgeForStage('bogus'), null)
})
