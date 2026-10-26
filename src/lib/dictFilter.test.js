import { test } from 'node:test'
import assert from 'node:assert/strict'
import { wordHasPos, posOptions, notYetMembers } from './dictFilter.js'

test('a word matches the part of speech of ANY of its senses, not only the first', () => {
  const w = { pos: 'adjective', senses: [{ pos: 'adjective' }, { pos: 'adverb' }] }
  assert.equal(wordHasPos(w, 'adverb'), true)
  assert.equal(wordHasPos(w, 'verb'), false)
})

test('a word without senses falls back to its own pos', () => {
  assert.equal(wordHasPos({ pos: 'noun', senses: [] }, 'noun'), true)
  assert.equal(wordHasPos({ pos: 'noun' }, 'noun'), true)
})

test('posOptions lists only the parts of speech the dictionary holds, in a fixed order', () => {
  const words = [
    { pos: 'noun', senses: [{ pos: 'noun' }] },
    { pos: 'verb', senses: [{ pos: 'verb' }, { pos: 'noun' }] },
    { pos: 'conjunction' },
  ]
  assert.deepEqual(posOptions(words), ['verb', 'noun', 'conjunction'])
})

test('posOptions keeps an unknown pos, after the known ones, and drops empty ones', () => {
  assert.deepEqual(posOptions([{ pos: 'pronoun' }, { pos: 'noun' }, { pos: null }]), ['noun', 'pronoun'])
})

// word_collections is unique on (collection_id, word_id): inserting a word that
// is already in the collection would fail the whole batch.
test('notYetMembers drops words already in the collection', () => {
  const membership = { 1: new Set(['c1']), 2: new Set(['c2']) }
  assert.deepEqual(notYetMembers([1, 2, 3], 'c1', membership), [2, 3])
})
