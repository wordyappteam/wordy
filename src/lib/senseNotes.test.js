// Run with: node --test src/lib/senseNotes.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanGrammarNote, cleanUsageNote } from './senseNotes.js'

// These are real Haiku outputs. The prompt forbids every one of them; the model
// produced them anyway, which is why the rule is enforced in code instead.

test('strips the default auxiliary — haben carries no information', () => {
  assert.equal(cleanGrammarNote("обов'язково рефлексивний · допоміжний дієслово haben"), "обов'язково рефлексивний")
  assert.equal(cleanGrammarNote('auf + Akkusativ · з допоміжним дієсловом haben'), 'auf + Akkusativ')
  assert.equal(cleanGrammarNote('Akkusativ · auxiliary haben'), 'Akkusativ')
})

test('keeps sein — the auxiliary that actually matters', () => {
  assert.equal(
    cleanGrammarNote('допоміжне дієслово sein · відокремлювальна префіксна частка auf'),
    'допоміжне дієслово sein · відокремлювальна префіксна частка auf',
  )
})

test('strips a gender that the headword already shows', () => {
  assert.equal(cleanGrammarNote('Maskulinum'), null, 'the headword already reads "der Tisch"')
  assert.equal(cleanGrammarNote('Чоловічий рід · Akkusativ: den Tisch'), 'Akkusativ: den Tisch')
})

test('keeps the governed preposition — the single most useful thing a note can say', () => {
  assert.equal(cleanGrammarNote('bestehen aus + Dativ'), 'bestehen aus + Dativ')
  assert.equal(cleanGrammarNote('sich freuen auf + Akk'), 'sich freuen auf + Akk')
})

test('a note that is nothing but noise becomes null, so the card hides the section', () => {
  assert.equal(cleanGrammarNote('Maskulinum · auxiliary haben'), null)
  assert.equal(cleanGrammarNote(''), null)
  assert.equal(cleanGrammarNote(null), null)
})

// The vocab note is only worth a section when it says something new.
test('a usage note that just restates the grammar note is dropped', () => {
  const grammar = 'допоміжне дієслово sein'
  const usage = 'Сполучається з допоміжним дієсловом sein (не haben): Ich bin aufgestanden.'
  assert.equal(cleanUsageNote(usage, grammar), null, 'aufstehen: the usage note repeated the grammar note verbatim')
})

test('a usage note with a genuinely new fact survives', () => {
  const grammar = 'Akkusativ'
  const usage = 'замість erhalten у розмовній мові частіше використовується bekommen'
  assert.equal(cleanUsageNote(usage, grammar), usage, 'bekommen vs erhalten is a real trap, not a restatement')
})

test('a usage note with no grammar note to compare against is kept', () => {
  assert.equal(cleanUsageNote('для судового рішення використовуйте das Urteil', null),
    'для судового рішення використовуйте das Urteil')
  assert.equal(cleanUsageNote(null, 'Akkusativ'), null)
})
