// src/lib/identifyCandidates.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { baseSpelling, splitCandidates } from './identifyCandidates.js'

test('baseSpelling strips article, reflexive, and governed preposition', () => {
  assert.equal(baseSpelling('die Bank'), 'bank')
  assert.equal(baseSpelling('kämpfen gegen'), 'kämpfen')
  assert.equal(baseSpelling('sich freuen auf'), 'freuen')
  assert.equal(baseSpelling('to conduct oneself'), 'conduct')
  assert.equal(baseSpelling('callus'), 'callus')
})

test('splitCandidates keeps same-spelling senses together', () => {
  const entry = { word: 'die Bank', entryType: 'word', senses: [
    { wordForm: 'die Bank', translation: 'bench' },
    { wordForm: 'die Bank', translation: 'bank (finance)' },
  ] }
  const out = splitCandidates(entry)
  assert.equal(out.length, 1)
  assert.equal(out[0].senses.length, 2)
})

test('splitCandidates separates different spellings into distinct entries', () => {
  const entry = { word: 'callous', entryType: 'word', senses: [
    { wordForm: 'callous', translation: 'unfeeling' },
    { wordForm: 'callus',  translation: 'hardened skin' },
  ] }
  const out = splitCandidates(entry)
  assert.equal(out.length, 2)
  assert.deepEqual(out.map(c => c.word).sort(), ['callous', 'callus'])
  assert.ok(out.every(c => c.senses.length === 1))
})

test('splitCandidates keeps a prepositional verb family as one entry', () => {
  const entry = { word: 'kämpfen', entryType: 'word', senses: [
    { wordForm: 'kämpfen gegen', translation: 'fight against' },
    { wordForm: 'kämpfen für',   translation: 'fight for' },
  ] }
  assert.equal(splitCandidates(entry).length, 1)
})
