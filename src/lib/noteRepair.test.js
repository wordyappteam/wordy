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
    only({ word_form: "crack", grammar_note: "Предикативна прикметник; перед іменником" }),
    "Предикативний прикметник; перед іменником",
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

// ── non-standard terms are rewritten, not merely made to agree ──────────────
import { CANONICAL_TERMS } from "./grammarTerms.js"

test("a non-standard countable term becomes the canonical one, agreeing", () => {
  assert.equal(
    only({ word_form: "strop", grammar_note: "Лічильна іменник; широке значення" }),
    "Злічуваний іменник; широке значення",
  )
})

test("every spelling of countable lands on the same term", () => {
  for (const variant of ["Лічуваний", "Рахункова", "Зліченна", "Обчислюваний", "Лічивна"]) {
    assert.equal(
      only({ word_form: "x", grammar_note: `${variant} іменник` }),
      "Злічуваний іменник",
      variant,
    )
  }
})

test("the negative term keeps its negation", () => {
  assert.equal(only({ word_form: "x", grammar_note: "Незлічувана іменник" }), "Незлічуваний іменник")
})

test("регулярний дієслово becomes правильне дієслово", () => {
  assert.equal(only({ word_form: "überprüfen", grammar_note: "регулярний дієслово" }), "правильне дієслово")
})

test("a canonical term with the wrong ending is still just an agreement fix", () => {
  assert.equal(only({ word_form: "comb", grammar_note: "Правильний дієслово" }), "Правильне дієслово")
})

test("a non-standard term is reported once, not twice", () => {
  const findings = auditSense({ word_form: "strop", grammar_note: "Лічильна іменник" })
  assert.deepEqual(findings.map((f) => f.code), ["nonstandard-term"])
})

// ── a whole sense, field by field ───────────────────────────────────────────
import { repairSense } from "./noteRepair.js"

test("repairSense returns one row per field, not one per finding", () => {
  // Two Russian words in one note is one edit to review, not two.
  const rows = repairSense({
    word_form: "purgatory", id: "s1",
    usage_note: "метафорично: 'это настоящее чистилище' означає жах",
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].field, "usage_note")
  assert.equal(rows[0].after, "метафорично: 'це справжнє чистилище' означає жах")
  assert.deepEqual(rows[0].codes, ["russian-letter", "russian-word", "russian-word"])
})

test("a field with nothing derivable comes back with after = null", () => {
  const rows = repairSense({ word_form: "backlash", id: "s2", explanation: "реакція на événement" })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].after, null)
})

test("an approved one-off wins over the derived repair", () => {
  const rows = repairSense({
    word_form: "brazen", id: "s3", translation: "дерзкий, нахабный, безстидний",
  })
  assert.equal(rows[0].after, "зухвалий, нахабний, безсоромний")
  assert.equal(rows[0].oneOff, true)
})

test("a clean sense produces no rows at all", () => {
  assert.deepEqual(repairSense({ word_form: "x", id: "s4", explanation: "уважно дослідити щось" }), [])
})

// ── hand-written repairs the audit cannot find at all ───────────────────────
// "лепеста" is not a Ukrainian word; "направлення" is a real word in the wrong
// place; hingegen is called a Сполучник when it is an adverb. Every one is
// fluent Cyrillic, so no rule reaches them — but a person reading the dictionary
// does, and what they decide has to be applicable.

test("a one-off applies even when the audit finds nothing wrong", () => {
  const rows = repairSense({
    id: "s9", word_form: "hingegen", pos: "conjunction",
    explanation: "Сполучник, який показує контраст або протилежність між двома висловленнями.",
  })
  const byField = Object.fromEntries(rows.map((r) => [r.field, r]))
  assert.equal(byField.explanation.after,
    "Прислівник (Konjunktionaladverb), який показує контраст або протилежність між двома висловленнями.")
  assert.equal(byField.explanation.codes.length, 0)
  assert.equal(byField.explanation.oneOff, true)
})

test("a one-off can correct a field that is not a note at all", () => {
  const rows = repairSense({
    id: "s9", word_form: "hingegen", pos: "conjunction",
    explanation: "Сполучник, який показує контраст або протилежність між двома висловленнями.",
  })
  const pos = rows.find((r) => r.field === "pos")
  assert.equal(pos.before, "conjunction")
  assert.equal(pos.after, "adverb")
})

test("a one-off whose text has since changed does not apply", () => {
  const rows = repairSense({ id: "s9", word_form: "hingegen", pos: "adverb", explanation: "Прислівник." })
  assert.deepEqual(rows, [])
})
