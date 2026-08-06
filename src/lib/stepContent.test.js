import test from 'node:test'
import assert from 'node:assert/strict'
import { attachStepContent, makeOptions } from './stepContent.js'

function fakeStore(initial = {}) {
  const data = { ...initial }
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v) },
    removeItem: (k) => { delete data[k] },
  }
}

const POOL = [
  { word_id: 'w1', word_form: 'erreichen', translation: 'досягати' },
  { word_id: 'w2', word_form: 'ankommen', translation: 'прибувати' },
  { word_id: 'w3', word_form: 'verlieren', translation: 'втрачати' },
  { word_id: 'w4', word_form: 'gewinnen', translation: 'вигравати' },
  { word_id: 'w5', word_form: 'beginnen', translation: 'починати' },
]

const EXAMPLES = [
  { target: 'Wir haben das Ziel erreicht.', blank: 'erreicht', translation: 'Ми досягли мети.', tense: 'past' },
  { target: 'Er hat den Zug erreicht.', blank: 'erreicht', translation: 'Він встиг на потяг.', tense: 'past' },
  { target: 'Sie erreichte das Ufer.', blank: 'erreichte', translation: 'Вона дісталася берега.', tense: 'past' },
]

const fillStep = (over = {}) => ({
  exercise: 'fill_in', senseId: 's1', wordId: 'w1', word: 'erreicht',
  translation: 'досягати', examples: EXAMPLES, ...over,
})

// ── makeOptions ──────────────────────────────────────────────────────────────

test('makeOptions always contains the correct answer', () => {
  const opts = makeOptions('досягати', POOL, (s) => s.translation, 'w1')
  assert.ok(opts.includes('досягати'))
})

test('makeOptions returns 4 options when the pool is big enough', () => {
  const opts = makeOptions('досягати', POOL, (s) => s.translation, 'w1')
  assert.equal(opts.length, 4)
})

test('makeOptions never draws a distractor from the word itself', () => {
  const opts = makeOptions('erreichen', POOL, (s) => s.word_form, 'w1')
  assert.equal(opts.filter((o) => o === 'erreichen').length, 1)
})

test('makeOptions degrades to the correct answer alone on an empty or missing pool', () => {
  assert.deepEqual(makeOptions('досягати', [], (s) => s.translation, 'w1'), ['досягати'])
  assert.deepEqual(makeOptions('досягати', null, (s) => s.translation, 'w1'), ['досягати'])
})

test('makeOptions does not repeat a value that duplicates the correct answer', () => {
  const pool = [{ word_id: 'w9', translation: 'досягати' }, { word_id: 'w2', translation: 'прибувати' }]
  const opts = makeOptions('досягати', pool, (s) => s.translation, 'w1')
  assert.deepEqual([...opts].sort(), ['досягати', 'прибувати'])
})

// ── attachStepContent: the resume guarantee ──────────────────────────────────

test('multiple-choice options are baked into the step, so a resume cannot re-roll them', () => {
  const plan = [{ exercise: 'recognition', senseId: 's1', wordId: 'w1', word: 'erreichen', translation: 'досягати' }]
  const [step] = attachStepContent(plan, POOL, fakeStore())
  assert.ok(Array.isArray(step.options))
  assert.ok(step.options.includes('досягати'))
  // Round-tripping through the snapshot must preserve them exactly.
  assert.deepEqual(JSON.parse(JSON.stringify(step)).options, step.options)
})

test('word_choice options are drawn from the target-language forms', () => {
  const plan = [{ exercise: 'word_choice', senseId: 's1', wordId: 'w1', word: 'erreichen', translation: 'досягати' }]
  const [step] = attachStepContent(plan, POOL, fakeStore())
  assert.ok(step.options.includes('erreichen'))
  assert.ok(step.options.every((o) => POOL.some((p) => p.word_form === o) || o === 'erreichen'))
})

test('the fill-in sentence is baked into the step', () => {
  const [step] = attachStepContent([fillStep()], POOL, fakeStore())
  assert.equal(step.fillBlank.target, 'Wir haben das Ziel erreicht.')
  assert.ok(step.fillBlank.sentence.includes('___'))
})

test('the example cursor advances once per planned step, not once per render', () => {
  const store = fakeStore()
  attachStepContent([fillStep()], POOL, store)
  assert.equal(store.getItem('wordy_ex_cursor_s1'), '1')
  // Re-rendering that card does not touch the store at all — the content is
  // already in the step. Only planning again advances.
  attachStepContent([fillStep()], POOL, store)
  assert.equal(store.getItem('wordy_ex_cursor_s1'), '2')
})

test('the scaffold and the graded test of one word get different sentences', () => {
  const store = fakeStore()
  const [scaffold, graded] = attachStepContent(
    [fillStep({ exercise: 'fill_blank' }), fillStep()], POOL, store,
  )
  assert.notEqual(scaffold.fillBlank.target, graded.fillBlank.target)
})

test('a fill-in with no examples gets fillBlank: null, not a missing key', () => {
  const [step] = attachStepContent([fillStep({ examples: [] })], POOL, fakeStore())
  assert.ok('fillBlank' in step)
  assert.equal(step.fillBlank, null)
  // Distinguishable from an unplanned step, which the card must derive live.
  assert.equal(fillStep().fillBlank, undefined)
})

test('a step with no generated content passes through untouched', () => {
  const plan = [{ exercise: 'flashcard', senseId: 's1', word: 'erreichen' }]
  const [step] = attachStepContent(plan, POOL, fakeStore())
  assert.deepEqual(step, plan[0])
  assert.equal(step.options, undefined)
  assert.equal(step.fillBlank, undefined)
})

test('attachStepContent does not mutate the plan it is given', () => {
  const plan = [fillStep()]
  const before = JSON.parse(JSON.stringify(plan))
  attachStepContent(plan, POOL, fakeStore())
  assert.deepEqual(plan, before)
})

test('a hostile or absent store never costs the learner the content', () => {
  const hostile = {
    getItem: () => { throw new Error('denied') },
    setItem: () => { throw new Error('denied') },
  }
  for (const store of [hostile, null, undefined]) {
    const [step] = attachStepContent([fillStep()], POOL, store)
    assert.ok(step.fillBlank, 'fill-in content must survive a dead store')
  }
})

test('attachStepContent tolerates an empty or missing plan', () => {
  assert.deepEqual(attachStepContent([], POOL, fakeStore()), [])
  assert.deepEqual(attachStepContent(null, POOL, fakeStore()), [])
})
