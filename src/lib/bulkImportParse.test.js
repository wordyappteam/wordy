// Run with: node --test src/lib/bulkImportParse.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseBulkLine, guessBarePos } from './bulkImportParse.js'

test('blank / header lines are skipped', () => {
  assert.equal(parseBulkLine(''), null)
  assert.equal(parseBulkLine('   '), null)
  assert.equal(parseBulkLine('Dativ'), null)
  assert.equal(parseBulkLine('Akkusativ'), null)
})

test('noun with article + plural ending', () => {
  const r = parseBulkLine('die Architektur, -en')
  assert.equal(r.pos, 'noun')
  assert.equal(r.word, 'die Architektur')
  assert.equal(r.form, 'Architekturen')
})

test('verb with conjugation in parens', () => {
  const r = parseBulkLine('abreißen (reißt ab, riss ab, hat abgerissen)')
  assert.equal(r.pos, 'verb')
  assert.equal(r.word, 'abreißen')
  assert.equal(r.form, 'reißt ab / riss ab / hat abgerissen')
  assert.equal(r.entry_type, 'word')
})

test('verb + preposition formats stay verbs', () => {
  assert.equal(parseBulkLine('achten (auf)').word, 'achten auf')
  assert.equal(parseBulkLine('achten (auf)').pos, 'verb')
  assert.equal(parseBulkLine('anmelden (sich) für').word, 'sich anmelden für')
  assert.equal(parseBulkLine('abhängen von').pos, 'verb')
})

// ── the fix: bare words classified by German morphology, not defaulted to adjective ──
test('bare infinitives are verbs (-en / -eln / -ern)', () => {
  assert.equal(parseBulkLine('bedeuten').pos, 'verb')
  assert.equal(parseBulkLine('erreichen').pos, 'verb')
  assert.equal(parseBulkLine('gehören').pos, 'verb')
  assert.equal(parseBulkLine('sammeln').pos, 'verb')
  assert.equal(parseBulkLine('ändern').pos, 'verb')
})

test('bare capitalized word is a noun (German nouns are capitalized)', () => {
  assert.equal(parseBulkLine('Regierung').pos, 'noun')
  assert.equal(parseBulkLine('Regierung').word, 'Regierung')
  assert.equal(parseBulkLine('Ziel').pos, 'noun')
})

test('bare lowercase non-verb word stays adjective/adverb', () => {
  assert.equal(parseBulkLine('notwendig').pos, 'adjective')
  assert.equal(parseBulkLine('erfolgreich').pos, 'adjective')
  assert.equal(parseBulkLine('allerdings').pos, 'adjective')
})

test('guessBarePos unit', () => {
  assert.equal(guessBarePos('Haus'), 'noun')
  assert.equal(guessBarePos('laufen'), 'verb')
  assert.equal(guessBarePos('handeln'), 'verb')
  assert.equal(guessBarePos('schnell'), 'adjective')
})
