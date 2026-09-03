import test from "node:test"
import assert from "node:assert/strict"
import { parseBulkLine } from "./bulkImportParse.js"

// Pasting a vocabulary list is the fastest way into the dictionary, and every
// line that is not recognised used to become an ADJECTIVE. A bare infinitive —
// the commonest thing in a textbook list — imported as one. That matters beyond
// tidiness: a verb whose pos is wrong silently loses its tense hint, and no
// insert path defaults pos.

// ── what the parser already did ─────────────────────────────────────────────
test("an article makes a noun, and the plural is read off the ending", () => {
  assert.deepEqual(parseBulkLine("der Tisch, -e"), {
    word: "der Tisch", form: "Tische", pos: "noun", entry_type: "word", translation: "", status: "new",
  })
})

test("a conjugation in parentheses makes a verb", () => {
  const r = parseBulkLine("abreißen (reißt ab, riss ab, hat abgerissen)")
  assert.equal(r.pos, "verb")
  assert.equal(r.form, "reißt ab / riss ab / hat abgerissen")
})

test("a governed preposition makes a phrasal verb", () => {
  assert.equal(parseBulkLine("achten (auf)").word, "achten auf")
  assert.equal(parseBulkLine("achten (auf)").entry_type, "phrasal-verb")
  assert.equal(parseBulkLine("anmelden (sich) für").word, "sich anmelden für")
})

test("a case heading is not a word", () => {
  assert.equal(parseBulkLine("Dativ"), null)
  assert.equal(parseBulkLine("   "), null)
})

// ── the morphology heuristic ────────────────────────────────────────────────
test("a bare infinitive is a verb, not an adjective", () => {
  for (const verb of ["bedeuten", "erreichen", "verhindern", "sammeln", "ändern"]) {
    assert.equal(parseBulkLine(verb).pos, "verb", verb)
  }
})

test("a capitalised bare word is a noun — German capitalises them", () => {
  for (const noun of ["Gesetz", "Übung", "Ärztin"]) {
    assert.equal(parseBulkLine(noun).pos, "noun", noun)
  }
})

test("a lowercase word that is not an infinitive stays an adjective", () => {
  for (const word of ["schnell", "gut", "wichtig"]) {
    assert.equal(parseBulkLine(word).pos, "adjective", word)
  }
})

test("the heuristic never overrides a form the line states outright", () => {
  // "der Wagen" ends in -en and is capitalised, but it carries an article.
  assert.equal(parseBulkLine("der Wagen, -").pos, "noun")
  // A conjugation in parentheses is explicit, whatever the word looks like.
  assert.equal(parseBulkLine("Segeln (segelt, segelte, ist gesegelt)").pos, "verb")
})
