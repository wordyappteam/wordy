import test from "node:test"
import assert from "node:assert/strict"
import { auditSense } from "./noteAudit.js"
import { proposeRepair } from "./noteRepair.js"

// A repair is proposed ONLY where the correction is derivable from the defect
// itself. Everything else returns null and waits for a person — a tool that
// guesses at a correction in a language the reviewer may not read is worse
// than one that admits it does not know.

const only = (sense) => {
  const findings = auditSense(sense)
  assert.equal(findings.length, 1, `expected exactly one finding, got ${findings.map((f) => f.code)}`)
  const text = sense[findings[0].field]
  return proposeRepair(findings[0], text)
}

// ── agreement: the noun fixes the adjective ─────────────────────────────────
test("a feminine adjective on a masculine noun is corrected to masculine", () => {
  assert.equal(
    only({ word_form: "strop", grammar_note: "Лічильна іменник; широке значення" }),
    "Лічильний іменник; широке значення",
  )
})

test("a masculine adjective on a neuter noun is corrected to neuter", () => {
  assert.equal(
    only({ word_form: "comb", grammar_note: "Правильний дієслово; третя особа однини" }),
    "Правильне дієслово; третя особа однини",
  )
})

test("a lowercase adjective stays lowercase", () => {
  assert.equal(
    only({ word_form: "patch", grammar_note: "правильний дієслово; теперішній час" }),
    "правильне дієслово; теперішній час",
  )
})

test("the noun decides even when the adjective is about something else", () => {
  assert.equal(
    only({ word_form: "x", grammar_note: "атрибутивний вживання перед іменником" }),
    "атрибутивне вживання перед іменником",
  )
})

// ── Russian words: a known substitution ─────────────────────────────────────
test("a Russian word is replaced by its Ukrainian counterpart", () => {
  assert.equal(
    only({ word_form: "brazen", grammar_note: "предмети з мідного или золотого блиску" }),
    "предмети з мідного або золотого блиску",
  )
})

test("a capitalised Russian word keeps its capital", () => {
  assert.equal(
    only({ word_form: "x", grammar_note: "Тщательно перевірити кожне слово" }),
    "Ретельно перевірити кожне слово",
  )
})

test("only the flagged word changes, not another copy of it elsewhere", () => {
  const f = auditSense({ word_form: "x", explanation: "тщательно і ще раз тщательно" })
  assert.equal(proposeRepair(f[0], "тщательно і ще раз тщательно"), "ретельно і ще раз тщательно")
})

// ── mixed script: only where every Latin letter has a twin ──────────────────
test("Latin letters that look identical to Cyrillic ones are converted", () => {
  assert.equal(
    only({ word_form: "ordeal", translation: "важке, болючe випробування" }),
    "важке, болюче випробування",
  )
})

test("a word needing a letter with no Cyrillic twin is left to a person", () => {
  // "Berегти" wants Б, and Latin B looks like В — converting it would write
  // "Верегти", a different word. Latin r has no twin at all.
  assert.equal(only({ word_form: "erhalten", explanation: "Berегти в гарному стані" }), null)
})

test("барierний is left to a person for the same reason", () => {
  assert.equal(only({ word_form: "diaphragm", explanation: "як барierний контрацептив" }), null)
})

// ── everything else waits for a person ──────────────────────────────────────
test("a foreign diacritic has no derivable correction", () => {
  assert.equal(only({ word_form: "backlash", explanation: "реакція на événement або тренд" }), null)
})

test("a truncated word has no derivable correction", () => {
  assert.equal(only({ word_form: "der Bürger", usage_note: "Einwohner просто живу́" }), null)
})

test("a note in the wrong language has no derivable correction", () => {
  const f = auditSense({
    word_form: "allgemein",
    explanation: "справедливий для всіх або більшості",
    grammar_note: "Attributive: allgemeiner Wunsch",
  })
  assert.equal(proposeRepair(f[0], "Attributive: allgemeiner Wunsch"), null)
})
