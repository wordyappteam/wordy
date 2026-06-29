// Pure-core SRS v2 tests. Run with: node --test src/lib/srs.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planSessionV2, applyVerdict, sentenceOutcome, gradedExerciseFor } from './srs.js'

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

// ── Bug #3: new words get a reserved quota; a review backlog can't starve them ─
test('new words are not starved by a backlog of due reviews', () => {
  const due = (i) => ({
    id: `r${i}`, word_id: `rw${i}`, interval_step: 4,
    last_reviewed: '2026-06-01', next_review_date: '2026-06-01', is_leech: false,
    word_form: `Wort${i}`, translation: `word${i}`,
  })
  const fresh = (i) => ({
    id: `n${i}`, word_id: `nw${i}`, interval_step: 0,
    last_reviewed: null, next_review_date: null, is_leech: false,
    word_form: `Neu${i}`, translation: `new${i}`,
  })
  const reviews = Array.from({ length: 30 }, (_, i) => due(i))
  const news = Array.from({ length: 10 }, (_, i) => fresh(i))

  const steps = planSessionV2([...reviews, ...news], { today: '2026-06-24', timeBudget: 30 })
  const gradedIds = new Set(steps.filter((s) => s.graded).map((s) => s.senseId))
  const newGraded = [...gradedIds].filter((id) => id.startsWith('n'))

  assert.ok(newGraded.length > 0, 'new words should appear even with a big review backlog')
  assert.equal(newGraded.length, 7, 'new words filled to newCap (7)')
  assert.ok(gradedIds.size <= 18, 'total graded stays within gradedCap for a 30-min budget')
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
