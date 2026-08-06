import test from "node:test"
import assert from "node:assert/strict"
import { tenseHint } from "./tenseHint.js"

// Every hint below is for a VERB. The hint names a tense, and only a verb has
// one to produce, so `pos` is now part of the contract — see the non-verb block
// at the bottom.
const VERB = { pos: "verb" }

// ── German ──────────────────────────────────────────────────────────────────
test("de: auxiliary + Partizip II is Perfekt", () => {
  const fb = { target: "Wir haben Berlin um 18 Uhr erreicht.", tense: "past" }
  assert.equal(tenseHint(fb, "de", "en", VERB), "Perfekt")
})

test("de: sein as the auxiliary is still Perfekt", () => {
  const fb = { target: "Der Zug ist pünktlich angekommen.", tense: "past" }
  assert.equal(tenseHint(fb, "de", "en", VERB), "Perfekt")
})

test("de: an -iert participle counts, it has no ge- prefix", () => {
  const fb = { target: "Sie hat das Zimmer reserviert.", tense: "past" }
  assert.equal(tenseHint(fb, "de", "en", VERB), "Perfekt")
})

test("de: an inseparable-prefix participle counts — it never takes ge-", () => {
  const fb = { target: "Er hat die Stadt verlassen.", tense: "past" }
  assert.equal(tenseHint(fb, "de", "en", VERB), "Perfekt")
})

test("de: a plain ge- participle counts", () => {
  const fb = { target: "Er hat das Buch gelesen.", tense: "past" }
  assert.equal(tenseHint(fb, "de", "en", VERB), "Perfekt")
})

test("de: a single finite past verb is Präteritum", () => {
  const fb = { target: "Der Zug erreichte den Bahnhof.", tense: "past" }
  assert.equal(tenseHint(fb, "de", "en", VERB), "Präteritum")
})

test("de: weak and strong Präteritum verbs are not mistaken for participles", () => {
  // These are the forms the participle regex must NOT match, or every
  // Präteritum sentence would be mislabelled Perfekt.
  assert.equal(tenseHint({ target: "Er kaufte den Wagen.", tense: "past" }, "de", "en", VERB), "Präteritum")
  assert.equal(tenseHint({ target: "Sie ging nach Hause.", tense: "past" }, "de", "en", VERB), "Präteritum")
})

test("de: present is Präsens", () => {
  const fb = { target: "Der Zug erreicht den Bahnhof.", tense: "present" }
  assert.equal(tenseHint(fb, "de", "en", VERB), "Präsens")
})

test("de: a capitalised Ge- noun is not a participle", () => {
  const fb = { target: "Sie hat gute Gedanken.", tense: "past" }
  assert.equal(tenseHint(fb, "de", "en", VERB), "Präteritum")
})

test("de: a zu-infinitive is not a participle", () => {
  const fb = { target: "Ich habe Zeit, dich zu besuchen.", tense: "past" }
  assert.equal(tenseHint(fb, "de", "en", VERB), "Präteritum")
})

test("de: an inseparable participle still reads as Perfekt after the tightening", () => {
  assert.equal(tenseHint({ target: "Er hat die Stadt verlassen.", tense: "past" }, "de", "en", VERB), "Perfekt")
})

test("de: a fronted participle is still Perfekt", () => {
  assert.equal(tenseHint({ target: "Gesehen habe ich ihn nicht.", tense: "past" }, "de", "en", VERB), "Perfekt")
  assert.equal(tenseHint({ target: "Verlassen hat er die Stadt nie.", tense: "past" }, "de", "en", VERB), "Perfekt")
})

// ── English ─────────────────────────────────────────────────────────────────
test("en: have/has + participle is the present perfect", () => {
  const fb = { target: "We have reached Berlin.", tense: "past" }
  assert.equal(tenseHint(fb, "en", "en", VERB), "Present perfect")
})

test("en: a bare past verb is the past simple", () => {
  const fb = { target: "We reached Berlin at six.", tense: "past" }
  assert.equal(tenseHint(fb, "en", "en", VERB), "Past simple")
})

test("en: be + -ing is the present continuous", () => {
  const fb = { target: "We are reaching Berlin now.", tense: "present" }
  assert.equal(tenseHint(fb, "en", "en", VERB), "Present continuous")
})

test("en: plain present is the present simple", () => {
  const fb = { target: "We reach Berlin at six.", tense: "present" }
  assert.equal(tenseHint(fb, "en", "en", VERB), "Present simple")
})

test("en: a noun ending in -en does not make a present perfect", () => {
  assert.equal(tenseHint({ target: "I have seven children.", tense: "past" }, "en", "en", VERB), "Past simple")
  assert.equal(tenseHint({ target: "I have eleven dollars.", tense: "past" }, "en", "en", VERB), "Past simple")
})

test("en: a noun ending in -ood does not make a present perfect", () => {
  assert.equal(tenseHint({ target: "I have wood for the fire.", tense: "past" }, "en", "en", VERB), "Past simple")
})

test("en: irregular participles are recognised", () => {
  assert.equal(tenseHint({ target: "They have gone home.", tense: "past" }, "en", "en", VERB), "Present perfect")
  assert.equal(tenseHint({ target: "She has written the letter.", tense: "past" }, "en", "en", VERB), "Present perfect")
})

test("en: a noun phrase after have is not a perfect", () => {
  assert.equal(tenseHint({ target: "I have a good put in golf.", tense: "past" }, "en", "en", VERB), "Past simple")
  assert.equal(tenseHint({ target: "I have a chess set at home.", tense: "past" }, "en", "en", VERB), "Past simple")
  assert.equal(tenseHint({ target: "I have a born talent for music.", tense: "past" }, "en", "en", VERB), "Past simple")
  assert.equal(tenseHint({ target: "I have a left turn ahead.", tense: "past" }, "en", "en", VERB), "Past simple")
})

test("en: adverbs may sit between the auxiliary and the participle", () => {
  assert.equal(tenseHint({ target: "I have never eaten there.", tense: "past" }, "en", "en", VERB), "Present perfect")
  assert.equal(tenseHint({ target: "He has already seen it.", tense: "past" }, "en", "en", VERB), "Present perfect")
})

test("en: an irregular participle that is also a common noun still works as a verb", () => {
  assert.equal(tenseHint({ target: "I have left the house.", tense: "past" }, "en", "en", VERB), "Present perfect")
})

test("en: question inversion is still a perfect", () => {
  assert.equal(tenseHint({ target: "Have you seen it?", tense: "past" }, "en", "en", VERB), "Present perfect")
  assert.equal(tenseHint({ target: "Have you ever been to Berlin?", tense: "past" }, "en", "en", VERB), "Present perfect")
})

test("en: ordinary words between the auxiliary and the participle do not break it", () => {
  assert.equal(tenseHint({ target: "They have both gone.", tense: "past" }, "en", "en", VERB), "Present perfect")
  assert.equal(tenseHint({ target: "I have just about finished.", tense: "past" }, "en", "en", VERB), "Present perfect")
})

test("en: a determiner after have still blocks the perfect", () => {
  assert.equal(tenseHint({ target: "I have some money for the trip.", tense: "past" }, "en", "en", VERB), "Past simple")
  assert.equal(tenseHint({ target: "I have the red book here.", tense: "past" }, "en", "en", VERB), "Past simple")
})

// ── Ukrainian ───────────────────────────────────────────────────────────────
test("uk: the past is named by aspect", () => {
  const past = { target: "Ми досягли Берліна.", tense: "past" }
  assert.equal(tenseHint(past, "uk", "uk", { ...VERB, aspect: "perfective" }), "Минулий час, доконаний вид")
  assert.equal(tenseHint(past, "uk", "uk", { ...VERB, aspect: "imperfective" }), "Минулий час, недоконаний вид")
})

test("uk: an unknown aspect falls back to the plain past", () => {
  const past = { target: "Ми досягли Берліна.", tense: "past" }
  assert.equal(tenseHint(past, "uk", "uk", VERB), "Минулий час")
})

test("uk: a perfective verb in the present slot is really the future", () => {
  const pres = { target: "Ми досягнемо Берліна.", tense: "present" }
  assert.equal(tenseHint(pres, "uk", "uk", { ...VERB, aspect: "perfective" }), "Майбутній час")
  assert.equal(tenseHint(pres, "uk", "uk", { ...VERB, aspect: "imperfective" }), "Теперішній час")
})

// ── Localisation + the null contract ────────────────────────────────────────
test("labels follow the interface language", () => {
  const fb = { target: "Der Zug erreichte den Bahnhof.", tense: "past" }
  assert.equal(tenseHint(fb, "de", "uk", VERB), "Präteritum")   // a German term stays German
  const en = { target: "We reached Berlin.", tense: "past" }
  assert.equal(tenseHint(en, "en", "uk", VERB), "Минулий час (past simple)")
})

test("no tense means no hint — never invent one", () => {
  assert.equal(tenseHint({ target: "Wir erreichen Berlin.", tense: null }, "de", "en", VERB), null)
  assert.equal(tenseHint(null, "de", "en", VERB), null)
  assert.equal(tenseHint({ target: "x", tense: "past" }, "fr", "en", VERB), null)
})

// ── Only a verb has a tense to produce ──────────────────────────────────────
// `tense` is stamped on the EXAMPLE SENTENCE, and every sentence has a tense —
// so before this gate, a noun whose example happened to be tagged was told to
// supply a "Perfekt". Which non-verbs got a hint depended only on whether the
// generator had tagged that particular example, so it looked arbitrary in use.
test("a noun gets no hint, however clearly the sentence is in the past", () => {
  const fb = { target: "Wir haben das Buch gelesen.", tense: "past" }
  assert.equal(tenseHint(fb, "de", "en", VERB), "Perfekt")           // the verb sense
  assert.equal(tenseHint(fb, "de", "en", { pos: "noun" }), null)     // "das Buch"
})

test("no part of speech other than verb is hinted", () => {
  const de = { target: "Der Zug kam trotzdem pünktlich an.", tense: "past" }
  for (const pos of ["noun", "adjective", "adverb", "conjunction", "preposition"]) {
    assert.equal(tenseHint(de, "de", "en", { pos }), null, `${pos} must not be hinted`)
  }
})

test("the gate holds in every target language, not just German", () => {
  assert.equal(tenseHint({ target: "I have seen the film.", tense: "past" }, "en", "en", { pos: "noun" }), null)
  assert.equal(tenseHint({ target: "Ми досягли Берліна.", tense: "past" }, "uk", "uk", { pos: "noun", aspect: "perfective" }), null)
})

test("an unknown or missing part of speech is not assumed to be a verb", () => {
  const fb = { target: "Wir haben Berlin erreicht.", tense: "past" }
  assert.equal(tenseHint(fb, "de", "en", {}), null)
  assert.equal(tenseHint(fb, "de", "en"), null)
  assert.equal(tenseHint(fb, "de", "en", { pos: null }), null)
  assert.equal(tenseHint(fb, "de", "en", { pos: "Verb" }), null) // the enum is lowercase
})
