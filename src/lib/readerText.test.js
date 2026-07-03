import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tokenize, normalizeWordForm, getSentence, blockPlainText, mergeRuns } from './readerText.js'

test('tokenize splits words incl. umlauts and hyphens', () => {
  const tokens = tokenize('Das Mädchen-Chor lief.')
  const words = tokens.filter(t => t.isWord).map(t => t.text)
  assert.deepEqual(words, ['Das', 'Mädchen-Chor', 'lief'])
})

test('normalizeWordForm strips German articles and lowercases', () => {
  assert.equal(normalizeWordForm('das Buch'), 'buch')
  assert.equal(normalizeWordForm('Häuser'), 'häuser')
})

test('getSentence finds the sentence containing the word', () => {
  const text = 'Erster Satz. Der Hund bellt laut! Letzter Satz.'
  assert.equal(getSentence(text, 'Hund'), 'Der Hund bellt laut!')
})

test('blockPlainText joins runs, br becomes space', () => {
  const block = { type: 'verse', runs: [{ text: 'Zeile eins' }, { br: true }, { text: 'Zeile zwei' }] }
  assert.equal(blockPlainText(block), 'Zeile eins Zeile zwei')
})

test('blockPlainText is empty for image/hr blocks', () => {
  assert.equal(blockPlainText({ type: 'hr' }), '')
  assert.equal(blockPlainText({ type: 'image', imageId: 'x', alt: 'a' }), '')
})

test('mergeRuns merges same-flag neighbors and trims edges', () => {
  const merged = mergeRuns([{ text: ' Der ' }, { text: 'Hund', em: true }, { text: '' }, { text: ' bellt ' }])
  assert.deepEqual(merged, [{ text: 'Der ' }, { text: 'Hund', em: true }, { text: ' bellt' }])
})

test('mergeRuns collapses doubled boundary spaces, keeps br', () => {
  const merged = mergeRuns([{ text: 'a ' }, { text: ' b' }, { br: true }, { text: ' c ' }])
  assert.deepEqual(merged, [{ text: 'a b' }, { br: true }, { text: 'c' }])
})
