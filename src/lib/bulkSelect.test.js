import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectAll, hiddenSelected, wordCount } from './bulkSelect.js'

test('selectAll adds every visible id and keeps what was already selected', () => {
  const next = selectAll(new Set([1]), [{ id: 2 }, { id: 3 }])
  assert.deepEqual([...next].sort(), [1, 2, 3])
})

test('selectAll does not mutate the set it is given', () => {
  const prev = new Set([1])
  selectAll(prev, [{ id: 2 }])
  assert.deepEqual([...prev], [1])
})

// A filter can hide words that are still selected. The delete button acts on
// the whole selection, so the bar must be able to say how many are out of view.
test('hiddenSelected counts selected words the current filter hides', () => {
  assert.equal(hiddenSelected(new Set([1, 2, 3]), [{ id: 1 }]), 2)
  assert.equal(hiddenSelected(new Set([1]), [{ id: 1 }, { id: 2 }]), 0)
})

test('ids compare as strings, as everywhere else in the dictionary', () => {
  assert.equal(hiddenSelected(new Set(['7']), [{ id: 7 }]), 0)
})

test('wordCount uses the three Ukrainian plural forms', () => {
  assert.equal(wordCount(1, 'uk'), '1 слово')
  assert.equal(wordCount(3, 'uk'), '3 слова')
  assert.equal(wordCount(5, 'uk'), '5 слів')
  assert.equal(wordCount(11, 'uk'), '11 слів')
  assert.equal(wordCount(12, 'uk'), '12 слів')
  assert.equal(wordCount(21, 'uk'), '21 слово')
  assert.equal(wordCount(24, 'uk'), '24 слова')
  assert.equal(wordCount(0, 'uk'), '0 слів')
})

test('wordCount in English', () => {
  assert.equal(wordCount(1, 'en'), '1 word')
  assert.equal(wordCount(2, 'en'), '2 words')
})
