import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pageCount, pageOffset, pageOfOffsetLeft, clampPage, bookProgress, tocLabelFor } from './pagination.js'

test('pageCount from scrollWidth', () => {
  // 3 columns of 600 + 2 gaps of 56 → scrollWidth 1912
  assert.equal(pageCount(1912, 600, 56), 3)
  assert.equal(pageCount(600, 600, 56), 1)
  assert.equal(pageCount(0, 600, 56), 1)
  assert.equal(pageCount(500, 0, 56), 1)
})

test('pageOffset and pageOfOffsetLeft are inverse', () => {
  assert.equal(pageOffset(2, 600, 56), 1312)
  assert.equal(pageOfOffsetLeft(1312, 600, 56), 2)
  assert.equal(pageOfOffsetLeft(1300, 600, 56), 2) // near-page offsets round
})

test('clampPage', () => {
  assert.equal(clampPage(-1, 3), 0)
  assert.equal(clampPage(5, 3), 2)
  assert.equal(clampPage(1, 3), 1)
})

test('bookProgress percent across chapters', () => {
  assert.equal(bookProgress([10, 10, 20], 1, 10), 50)
  assert.equal(bookProgress([], 0, 0), 0)
  assert.equal(bookProgress([10], 0, 0), 0)
})

test('tocLabelFor picks last entry at or before chapter', () => {
  const toc = [
    { label: 'One', chapterIndex: 0, depth: 0 },
    { label: 'Two', chapterIndex: 2, depth: 0 },
  ]
  assert.equal(tocLabelFor(toc, 0), 'One')
  assert.equal(tocLabelFor(toc, 1), 'One')  // continuation file
  assert.equal(tocLabelFor(toc, 3), 'Two')
  assert.equal(tocLabelFor([], 0), '')
})
