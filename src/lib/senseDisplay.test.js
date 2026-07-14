import { test } from 'node:test'
import assert from 'node:assert/strict'
import { displayTranslation, showSenseForm } from './senseDisplay.js'

// ── displayTranslation ────────────────────────────────────────────────────
test('displayTranslation drops the gloss when the word has one sense', () => {
  assert.equal(displayTranslation('(a stinging insect) wasp'), 'wasp')
})

test('displayTranslation keeps the gloss when senses are shown together', () => {
  assert.equal(displayTranslation('(insect) wasp', true), '(insect) wasp')
})

// ── showSenseForm ─────────────────────────────────────────────────────────
// The panel header already prints `aspectPairTitle || word.word`. The sense body
// should only repeat the form when it says something the header does not.

test('a single-sense word does not reprint its own headword', () => {
  assert.equal(showSenseForm({ wordForm: 'bestehen' }, 'bestehen'), false)
})

test('a phrase sense prints its form — the header shows only the entry word', () => {
  assert.equal(
    showSenseForm({ wordForm: 'eine Entscheidung treffen' }, 'die Entscheidung'),
    true,
  )
})

test('an aspect-pair half prints its form — the header shows the whole pair', () => {
  assert.equal(showSenseForm({ wordForm: 'зробити' }, 'робити / зробити'), true)
})

test('a sense with no form prints nothing', () => {
  assert.equal(showSenseForm({ wordForm: null }, 'der Tisch'), false)
  assert.equal(showSenseForm({}, 'der Tisch'), false)
})

test('the comparison ignores surrounding whitespace and case', () => {
  assert.equal(showSenseForm({ wordForm: '  Bestehen ' }, 'bestehen'), false)
})
