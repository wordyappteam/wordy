import test from "node:test"
import assert from "node:assert/strict"
import { auditSense, auditDictionary } from "./noteAudit.js"

// Every case below is a real defect found in Nika's exported dictionary on
// 2026-09-02, or the shape of one found on 2026-08-07 and since repaired.
// The audit only reports what it can be SURE of — a note that is merely clumsy
// is not a finding, because a checker that cries wolf gets switched off.

const codes = (s) => auditSense(s).map((f) => f.code)
const sense = (over) => ({ word_form: "prüfen", pos: "verb", explanation: "перевіряти щось уважно", ...over })

// ── script-level defects ────────────────────────────────────────────────────
test("a single word written half in Cyrillic and half in Latin is a finding", () => {
  const f = auditSense(sense({ explanation: "Fortificована стіна, збудована 1961 року" }))
  assert.deepEqual(f.map((x) => x.code), ["mixed-script-word"])
  assert.equal(f[0].excerpt, "Fortificована")
  assert.equal(f[0].field, "explanation")
})

test("a German word beside a Ukrainian one is NOT a finding", () => {
  assert.deepEqual(codes(sense({ grammar_note: "bestehen aus + Dativ · вимагає прийменника" })), [])
})

test("a combining stress mark is a finding — it means a truncated word", () => {
  const f = auditSense(sense({ usage_note: "Einwohner просто живу́" }))
  assert.deepEqual(f.map((x) => x.code), ["stress-mark"])
})

test("a script that is neither Latin nor Cyrillic is a finding", () => {
  assert.deepEqual(codes(sense({ explanation: "說（某事為真）， робити твердження" })), ["foreign-script"])
})

test("a Latin letter carrying a diacritic German does not have is a finding", () => {
  const f = auditSense(sense({ usage_note: "erhalten más офіційна, формальна" }))
  assert.deepEqual(f.map((x) => x.code), ["foreign-diacritic"])
  assert.equal(f[0].excerpt, "más")
})

test("German umlauts and the sharp s are not diacritic findings", () => {
  assert.deepEqual(codes(sense({ usage_note: "Maßstab, Größe, für — усе це німецькі слова" })), [])
})

test("a letter that exists in Russian but not Ukrainian is a finding", () => {
  const f = auditSense(sense({ explanation: "это слово используется в речи" }))
  assert.equal(f[0].code, "russian-letter")
  assert.equal(f[0].excerpt, "э")
  // The same sentence also trips the word list — both rules are meant to fire.
  assert.deepEqual(f.filter((x) => x.code === "russian-word").map((x) => x.excerpt),
                   ["это", "используется"])
})

// ── one sense, one language ─────────────────────────────────────────────────
// The dictionary holds English and Ukrainian entries side by side by design, so
// an English note is only wrong when the rest of ITS OWN sense is Ukrainian.
test("a sense whose fields disagree about their language is a finding", () => {
  const f = auditSense(sense({
    translation: "загальний, універсальний",
    explanation: "справедливий для всіх або більшості",
    grammar_note: "Attributive: allgemeiner Wunsch; predicative: Das ist allgemein bekannt.",
  }))
  assert.deepEqual(f.map((x) => x.code), ["mixed-language"])
  assert.equal(f[0].field, "grammar_note")
})

test("a sense written entirely in English is not a finding", () => {
  assert.deepEqual(codes(sense({
    translation: "to set, to establish",
    explanation: "To create or determine something like a goal, standard, or limit.",
  })), [])
})

test("a sense written entirely in Ukrainian is not a finding", () => {
  assert.deepEqual(codes(sense({
    translation: "перевіряти",
    explanation: "уважно дослідити щось",
    grammar_note: "перехідне дієслово · Akkusativ",
  })), [])
})

// ── Ukrainian agreement ─────────────────────────────────────────────────────
// Grammar notes draw on a tiny closed vocabulary, which is what makes checking
// their agreement possible at all. Outside that vocabulary the audit says nothing.
test("a masculine adjective on a neuter grammar noun is a finding", () => {
  const f = auditSense(sense({ grammar_note: "регулярний дієслово" }))
  assert.deepEqual(f.map((x) => x.code), ["gender-agreement"])
  assert.equal(f[0].excerpt, "регулярний дієслово")
  assert.match(f[0].detail, /дієслово/)
})

test("the same note in the right gender is not a finding", () => {
  assert.deepEqual(codes(sense({ grammar_note: "регулярне дієслово" })), [])
})

test("a feminine adjective on a feminine grammar noun is not a finding", () => {
  assert.deepEqual(codes(sense({ grammar_note: "зворотна конструкція" })), [])
})

test("an adjective outside the grammar vocabulary is left alone", () => {
  assert.deepEqual(codes(sense({ explanation: "величезний слово" })), [])
})

// ── the whole dictionary ────────────────────────────────────────────────────
test("auditDictionary tags each finding with the word it came from", () => {
  const found = auditDictionary([
    sense({ word_form: "überprüfen", grammar_note: "регулярний дієслово" }),
    sense({ word_form: "prüfen" }),
  ])
  assert.equal(found.length, 1)
  assert.equal(found[0].word, "überprüfen")
  assert.equal(found[0].code, "gender-agreement")
})

test("camelCase senses from the app are read the same as snake_case ones from an export", () => {
  assert.deepEqual(codes({ word_form: "x", grammarNote: "регулярний дієслово" }), ["gender-agreement"])
})

// ── what a second dictionary taught the audit ───────────────────────────────
// Run against Nika's ENGLISH dictionary, the first two rules here fired 41
// times and almost all of it was noise. Both times the audit was wrong.

// The gloss is an identifier and belongs in the language the learner already
// has; the explanation is the meaning and belongs in the one being learned.
// "One sense, one language" mistook that design for a defect 40 times over.
test("a Ukrainian gloss on an English entry is the design, not a defect", () => {
  assert.deepEqual(codes({
    word_form: "sorrow",
    translation: "глибокий смуток, горе",
    explanation: "Deep sadness or grief, typically caused by loss.",
    grammar_note: "Uncountable or countable; often used with 'deep'.",
  }), [])
})

test("the notes still have to agree with each other", () => {
  const f = auditSense({
    word_form: "allgemein",
    translation: "загальний",
    explanation: "справедливий для всіх або більшості",
    grammar_note: "Attributive: allgemeiner Wunsch; predicative: Das ist allgemein bekannt.",
  })
  assert.deepEqual(f.map((x) => x.code), ["mixed-language"])
  assert.equal(f[0].field, "grammar_note")
})

test("Ukrainian spliced into an English note is still a finding", () => {
  const f = auditSense({
    word_form: "champagne",
    translation: "шампанське",
    explanation: "Sparkling wine produced in the Champagne region of France.",
    grammar_note: "Uncountable як колективне: 'champagne is expensive'.",
  })
  assert.deepEqual(f.map((x) => x.code), ["mixed-language"])
  assert.equal(f[0].field, "grammar_note")
})

// A Latin acronym hyphenated onto a Ukrainian word is ordinary writing.
test("a hyphenated Latin acronym is not a mixed-script word", () => {
  assert.deepEqual(codes({ word_form: "beacon", explanation: "Сучасні GPS-маяки допомагають навігації" }), [])
})

test("a word spliced together from both scripts is still a finding", () => {
  const f = auditSense({ word_form: "diaphragm", explanation: "барierний шар між порожнинами" })
  assert.deepEqual(f.map((x) => x.code), ["mixed-script-word"])
  assert.equal(f[0].excerpt, "барierний")
})

// ── Russian words, spelled in letters Ukrainian also has ────────────────────
// The russian-letter rule only catches ы ъ э ё. Most of the Russian in these
// notes is spelled in letters both languages share, so it walks straight past:
// "мідного или золотого", "тщательно шукати", "это настоящее чистилище".
// Only words with no Ukrainian reading at all belong on the list — a word that
// is Russian in one sense and Ukrainian in another (души) must stay off it.

test("a Russian conjunction inside a Ukrainian note is a finding", () => {
  const f = auditSense({ word_form: "brazen", grammar_note: "описує предмети з мідного или золотого блиску" })
  assert.deepEqual(f.map((x) => x.code), ["russian-word"])
  assert.equal(f[0].excerpt, "или")
})

test("a Russian adverb is a finding", () => {
  const f = auditSense({ word_form: "comb", explanation: "тщательно шукати щось у якомусь місці" })
  assert.deepEqual(f.map((x) => x.code), ["russian-word"])
  assert.equal(f[0].excerpt, "тщательно")
})

test("a Russian phrase reports each word it is sure of", () => {
  const f = auditSense({ word_form: "purgatory", usage_note: "метафорично: 'это настоящее чистилище'" })
  assert.deepEqual(f.filter((x) => x.code === "russian-word").map((x) => x.excerpt),
                   ["это", "настоящее"])
})

test("the list ignores case and punctuation around a word", () => {
  const f = auditSense({ word_form: "x", explanation: "Или так, или інакше." })
  assert.equal(f[0].excerpt, "Или")
})

test("a word that has a Ukrainian reading too is left alone", () => {
  // "души" is Russian for souls AND the Ukrainian genitive of душа.
  assert.deepEqual(codes({ word_form: "purgatory", explanation: "немає души без тіла" }), [])
})

test("a Ukrainian word is never mistaken for its Russian counterpart", () => {
  assert.deepEqual(codes({ word_form: "x", explanation: "або ретельно шукати, бо це справжнє випробування" }), [])
})

test("a Russian word is not found inside a longer Ukrainian word", () => {
  // "что" must not match inside "нечто-подібний"; "и" boundaries matter.
  assert.deepEqual(codes({ word_form: "x", explanation: "мачто, лишень частина слова" }), [])
})

// ── the gender check knows more of the vocabulary ───────────────────────────
// Grammar notes call a noun лічильний / обчислюваний / неформальний as readily
// as they call a verb правильний, and the check only knew nineteen stems.

test("a feminine adjective on a masculine grammar noun is a finding", () => {
  const f = auditSense({ word_form: "strop", grammar_note: "Лічильна іменник; широке значення" })
  assert.deepEqual(f.map((x) => x.code), ["gender-agreement"])
  assert.equal(f[0].excerpt, "Лічильна іменник")
})

test("неформальна прикметник is a finding", () => {
  const f = auditSense({ word_form: "crack", grammar_note: "Неформальна прикметник; використовується перед іменником" })
  assert.deepEqual(f.map((x) => x.code), ["gender-agreement"])
})

test("технічний термін agrees and is left alone", () => {
  assert.deepEqual(codes({ word_form: "backlash", grammar_note: "Технічний термін; вживається як countable noun" }), [])
})

test("обчислюваний іменник agrees and is left alone", () => {
  assert.deepEqual(codes({ word_form: "mint", grammar_note: "Обчислюваний іменник; з артиклем для конкретного виду." }), [])
})

test("сила is Ukrainian and must never be called Russian", () => {
  // It was on the list, and it fired on "неприборкана сила" — correct writing,
  // flagged. Exactly the failure the strictness rule exists to prevent.
  assert.deepEqual(codes({ word_form: "ferocity", translation: "дика агресивність, неприборкана сила" }), [])
})
