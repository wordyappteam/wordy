// Run with: node --test src/lib/dictionaryContext.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDictionarySnapshot } from './dictionaryContext.js'

test('empty / null input -> empty string', () => {
  assert.equal(buildDictionarySnapshot(null), '')
  assert.equal(buildDictionarySnapshot([]), '')
})

test('formats rows: numbered, most-recent-first, with pos + stage meta', () => {
  const senses = [
    { word_form: 'vermeiden', translation: 'to avoid', pos: 'verb', learning_stage: 'new' },
    { word_form: 'gehören',   translation: 'to belong to', pos: 'verb', learning_stage: 'early' },
  ]
  const out = buildDictionarySnapshot(senses)
  assert.equal(out,
    '1. vermeiden — to avoid (verb · new)\n' +
    '2. gehören — to belong to (verb · early)')
})

test('omits the meta parens when pos and stage are both missing', () => {
  const out = buildDictionarySnapshot([{ word_form: 'Haus', translation: 'house' }])
  assert.equal(out, '1. Haus — house')
})

test('drops rows missing a word_form or translation', () => {
  const senses = [
    { word_form: 'lernen', translation: 'to learn', pos: 'verb' },
    { word_form: '   ',    translation: 'blank word' },
    { word_form: 'Tisch',  translation: '   ' },
    { word_form: 'Buch',   translation: 'book' },
  ]
  const out = buildDictionarySnapshot(senses)
  assert.equal(out, '1. lernen — to learn (verb)\n2. Buch — book')
})

test('respects the limit (default 40)', () => {
  const senses = Array.from({ length: 50 }, (_, i) => ({ word_form: `w${i}`, translation: `t${i}` }))
  assert.equal(buildDictionarySnapshot(senses).split('\n').length, 40)
  assert.equal(buildDictionarySnapshot(senses, 5).split('\n').length, 5)
})
