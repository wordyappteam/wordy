import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSentenceSet } from './sentenceSet.js'

const GOOD = '```json\\n' + JSON.stringify({
  bank: [{ lemma: "trinken", senseId: "s1" }, { lemma: "gehen", senseId: "s2" }, { lemma: "essen", senseId: "s3" }],
  sentences: [
    { text: "Jeden Morgen ___ ich Kaffee.", senseId: "s1", answerLemma: "trinken", answerForm: "trinke", hint: "present, 'ich'", explanation: "trinken — present tense." },
    { text: "Gestern ___ wir ins Kino.", senseId: "s2", answerLemma: "gehen", answerForm: "gingen", hint: "past, 'wir'", explanation: "gehen — Präteritum." },
  ],
}) + '\\n```'

test('parseSentenceSet parses a fenced valid response', () => {
  const r = parseSentenceSet(GOOD)
  assert.equal(r.bank.length, 3)
  assert.equal(r.sentences.length, 2)
  assert.equal(r.sentences[0].answerForm, "trinke")
  assert.equal(r.sentences[1].senseId, "s2")
})

test('parseSentenceSet throws on missing sentences', () => {
  assert.throws(() => parseSentenceSet(JSON.stringify({ bank: [] })))
})

test('parseSentenceSet throws on non-JSON', () => {
  assert.throws(() => parseSentenceSet("sorry, I cannot help with that"))
})
