import test from "node:test"
import assert from "node:assert/strict"
import { tenseHint } from "./tenseHint.js"

// ── German ──────────────────────────────────────────────────────────────────
test("de: auxiliary + Partizip II is Perfekt", () => {
  const fb = { target: "Wir haben Berlin um 18 Uhr erreicht.", tense: "past" }
  assert.equal(tenseHint(fb, "de", "en"), "Perfekt")
})

test("de: sein as the auxiliary is still Perfekt", () => {
  const fb = { target: "Der Zug ist pünktlich angekommen.", tense: "past" }
  assert.equal(tenseHint(fb, "de", "en"), "Perfekt")
})

test("de: an -iert participle counts, it has no ge- prefix", () => {
  const fb = { target: "Sie hat das Zimmer reserviert.", tense: "past" }
  assert.equal(tenseHint(fb, "de", "en"), "Perfekt")
})

test("de: an inseparable-prefix participle counts — it never takes ge-", () => {
  const fb = { target: "Er hat die Stadt verlassen.", tense: "past" }
  assert.equal(tenseHint(fb, "de", "en"), "Perfekt")
})

test("de: a plain ge- participle counts", () => {
  const fb = { target: "Er hat das Buch gelesen.", tense: "past" }
  assert.equal(tenseHint(fb, "de", "en"), "Perfekt")
})

test("de: a single finite past verb is Präteritum", () => {
  const fb = { target: "Der Zug erreichte den Bahnhof.", tense: "past" }
  assert.equal(tenseHint(fb, "de", "en"), "Präteritum")
})

test("de: weak and strong Präteritum verbs are not mistaken for participles", () => {
  // These are the forms the participle regex must NOT match, or every
  // Präteritum sentence would be mislabelled Perfekt.
  assert.equal(tenseHint({ target: "Er kaufte den Wagen.", tense: "past" }, "de", "en"), "Präteritum")
  assert.equal(tenseHint({ target: "Sie ging nach Hause.", tense: "past" }, "de", "en"), "Präteritum")
})

test("de: present is Präsens", () => {
  const fb = { target: "Der Zug erreicht den Bahnhof.", tense: "present" }
  assert.equal(tenseHint(fb, "de", "en"), "Präsens")
})

test("de: a capitalised Ge- noun is not a participle", () => {
  const fb = { target: "Sie hat gute Gedanken.", tense: "past" }
  assert.equal(tenseHint(fb, "de", "en"), "Präteritum")
})

test("de: a zu-infinitive is not a participle", () => {
  const fb = { target: "Ich habe Zeit, dich zu besuchen.", tense: "past" }
  assert.equal(tenseHint(fb, "de", "en"), "Präteritum")
})

test("de: an inseparable participle still reads as Perfekt after the tightening", () => {
  assert.equal(tenseHint({ target: "Er hat die Stadt verlassen.", tense: "past" }, "de", "en"), "Perfekt")
})

test("de: a fronted participle is still Perfekt", () => {
  assert.equal(tenseHint({ target: "Gesehen habe ich ihn nicht.", tense: "past" }, "de", "en"), "Perfekt")
  assert.equal(tenseHint({ target: "Verlassen hat er die Stadt nie.", tense: "past" }, "de", "en"), "Perfekt")
})

// ── English ─────────────────────────────────────────────────────────────────
test("en: have/has + participle is the present perfect", () => {
  const fb = { target: "We have reached Berlin.", tense: "past" }
  assert.equal(tenseHint(fb, "en", "en"), "Present perfect")
})

test("en: a bare past verb is the past simple", () => {
  const fb = { target: "We reached Berlin at six.", tense: "past" }
  assert.equal(tenseHint(fb, "en", "en"), "Past simple")
})

test("en: be + -ing is the present continuous", () => {
  const fb = { target: "We are reaching Berlin now.", tense: "present" }
  assert.equal(tenseHint(fb, "en", "en"), "Present continuous")
})

test("en: plain present is the present simple", () => {
  const fb = { target: "We reach Berlin at six.", tense: "present" }
  assert.equal(tenseHint(fb, "en", "en"), "Present simple")
})

test("en: a noun ending in -en does not make a present perfect", () => {
  assert.equal(tenseHint({ target: "I have seven children.", tense: "past" }, "en", "en"), "Past simple")
  assert.equal(tenseHint({ target: "I have eleven dollars.", tense: "past" }, "en", "en"), "Past simple")
})

test("en: a noun ending in -ood does not make a present perfect", () => {
  assert.equal(tenseHint({ target: "I have wood for the fire.", tense: "past" }, "en", "en"), "Past simple")
})

test("en: irregular participles are recognised", () => {
  assert.equal(tenseHint({ target: "They have gone home.", tense: "past" }, "en", "en"), "Present perfect")
  assert.equal(tenseHint({ target: "She has written the letter.", tense: "past" }, "en", "en"), "Present perfect")
})

test("en: a noun phrase after have is not a perfect", () => {
  assert.equal(tenseHint({ target: "I have a good put in golf.", tense: "past" }, "en", "en"), "Past simple")
  assert.equal(tenseHint({ target: "I have a chess set at home.", tense: "past" }, "en", "en"), "Past simple")
  assert.equal(tenseHint({ target: "I have a born talent for music.", tense: "past" }, "en", "en"), "Past simple")
  assert.equal(tenseHint({ target: "I have a left turn ahead.", tense: "past" }, "en", "en"), "Past simple")
})

test("en: adverbs may sit between the auxiliary and the participle", () => {
  assert.equal(tenseHint({ target: "I have never eaten there.", tense: "past" }, "en", "en"), "Present perfect")
  assert.equal(tenseHint({ target: "He has already seen it.", tense: "past" }, "en", "en"), "Present perfect")
})

test("en: an irregular participle that is also a common noun still works as a verb", () => {
  assert.equal(tenseHint({ target: "I have left the house.", tense: "past" }, "en", "en"), "Present perfect")
})

// ── Ukrainian ───────────────────────────────────────────────────────────────
test("uk: the past is named by aspect", () => {
  const past = { target: "Ми досягли Берліна.", tense: "past" }
  assert.equal(tenseHint(past, "uk", "uk", { aspect: "perfective" }), "Минулий час, доконаний вид")
  assert.equal(tenseHint(past, "uk", "uk", { aspect: "imperfective" }), "Минулий час, недоконаний вид")
})

test("uk: an unknown aspect falls back to the plain past", () => {
  const past = { target: "Ми досягли Берліна.", tense: "past" }
  assert.equal(tenseHint(past, "uk", "uk"), "Минулий час")
})

test("uk: a perfective verb in the present slot is really the future", () => {
  const pres = { target: "Ми досягнемо Берліна.", tense: "present" }
  assert.equal(tenseHint(pres, "uk", "uk", { aspect: "perfective" }), "Майбутній час")
  assert.equal(tenseHint(pres, "uk", "uk", { aspect: "imperfective" }), "Теперішній час")
})

// ── Localisation + the null contract ────────────────────────────────────────
test("labels follow the interface language", () => {
  const fb = { target: "Der Zug erreichte den Bahnhof.", tense: "past" }
  assert.equal(tenseHint(fb, "de", "uk"), "Präteritum")   // a German term stays German
  const en = { target: "We reached Berlin.", tense: "past" }
  assert.equal(tenseHint(en, "en", "uk"), "Минулий час (past simple)")
})

test("no tense means no hint — never invent one", () => {
  assert.equal(tenseHint({ target: "Wir erreichen Berlin.", tense: null }, "de", "en"), null)
  assert.equal(tenseHint(null, "de", "en"), null)
  assert.equal(tenseHint({ target: "x", tense: "past" }, "fr", "en"), null)
})
