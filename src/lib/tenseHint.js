// Name the SPECIFIC form a fill-in blank wants.
//
// "Der Zug ____ pünktlich" accepts both `erreicht` and `erreichte`, so without a
// hint the learner guesses, and a correct guess of the other valid tense is
// scored as a slip. But "past" is too coarse to fix that: in German a past blank
// is still ambiguous between Perfekt and Präteritum, which are different forms to
// produce. So the stored coarse tense is the gate, and the full sentence — which
// still contains the answer — is what refines it.
//
// Defined for de, en and uk together: naming the required form is a
// cross-language feature, not a German one with the others back-filled.
//
// Returns null whenever the form cannot be determined. A wrong hint is worse
// than no hint, so the caller renders nothing.

// German: a finite form of haben/sein. Note these are all PRESENT forms — a
// Präteritum sentence has "hatte"/"war", so a present auxiliary in a past
// sentence can only be the Perfekt one.
const DE_AUX = /\b(habe|hast|hat|haben|habt|bin|bist|ist|sind|seid)\b/i
// … alongside a Partizip II. German nouns are capitalised and a Partizip II
// never is — it sits clause-final, never sentence-initial. Restricting to
// lowercase kills the Ge-noun class (Gedanken, Gemüse, Geschichte) at no cost
// to real participles.
const DE_PARTICIPLE = /\b(?:[a-zäöüß]*ge[a-zäöüß]+(?:t|en)|[a-zäöüß]+iert|(?:be|er|ver|ent|emp|zer|miss)[a-zäöüß]+(?:t|en))\b/
// "zu besuchen" is an infinitive, not a participle — and it defeats the prefix rule.
const DE_ZU_INFINITIVE = /\bzu\s+[a-zäöüß]+(?:e|en)\b/

const EN_AUX = /\b(have|has)\b/i
// An explicit irregular list beats a suffix pattern: -en/-ne/-wn/-ood match far
// more nouns (seven, wood, children) than participles.
const EN_IRREGULAR_PARTICIPLE = "been|gone|seen|done|taken|given|written|eaten|spoken|broken|chosen|driven|known|grown|shown|thrown|flown|drawn|worn|born|brought|bought|caught|taught|thought|fought|sought|understood|stood|made|said|found|lost|left|kept|sent|spent|built|felt|held|met|paid|put|read|run|set|sat|told|won|become|come|had|got|gotten|begun|drunk|sung|swum"
const EN_PARTICIPLE = new RegExp(`\\b(?:\\w+ed|${EN_IRREGULAR_PARTICIPLE})\\b`, "i")
const EN_PROGRESSIVE = /\b(am|is|are)\s+\w+ing\b/i

// German grammatical terms stay in German whatever the interface language —
// they are what the learner will see in a textbook.
const LABELS = {
  de: {
    perfekt:     { en: "Perfekt", uk: "Perfekt" },
    praeteritum: { en: "Präteritum", uk: "Präteritum" },
    praesens:    { en: "Präsens", uk: "Präsens" },
  },
  en: {
    presentPerfect:    { en: "Present perfect", uk: "Present perfect (доконаний)" },
    pastSimple:        { en: "Past simple", uk: "Минулий час (past simple)" },
    presentContinuous: { en: "Present continuous", uk: "Present continuous" },
    presentSimple:     { en: "Present simple", uk: "Теперішній час (present simple)" },
  },
  uk: {
    pastPerfective:   { en: "Past, perfective", uk: "Минулий час, доконаний вид" },
    pastImperfective: { en: "Past, imperfective", uk: "Минулий час, недоконаний вид" },
    past:             { en: "Past", uk: "Минулий час" },
    future:           { en: "Future", uk: "Майбутній час" },
    present:          { en: "Present", uk: "Теперішній час" },
  },
}

function label(lang, keyName, ifaceLang) {
  const entry = LABELS[lang]?.[keyName]
  if (!entry) return null
  return entry[ifaceLang === "uk" ? "uk" : "en"]
}

export function tenseHint(fillBlank, targetLang, ifaceLang = "en", sense = {}) {
  const tense = fillBlank?.tense
  if (!tense) return null
  const text = fillBlank.target ?? ""
  const aspect = sense?.aspect ?? null

  if (targetLang === "de") {
    if (tense === "present") return label("de", "praesens", ifaceLang)
    const perfekt = DE_AUX.test(text) && DE_PARTICIPLE.test(text) && !DE_ZU_INFINITIVE.test(text)
    return label("de", perfekt ? "perfekt" : "praeteritum", ifaceLang)
  }

  if (targetLang === "en") {
    if (tense === "present") {
      return label("en", EN_PROGRESSIVE.test(text) ? "presentContinuous" : "presentSimple", ifaceLang)
    }
    const perfect = EN_AUX.test(text) && EN_PARTICIPLE.test(text)
    return label("en", perfect ? "presentPerfect" : "pastSimple", ifaceLang)
  }

  if (targetLang === "uk") {
    if (tense === "past") {
      if (aspect === "perfective")   return label("uk", "pastPerfective", ifaceLang)
      if (aspect === "imperfective") return label("uk", "pastImperfective", ifaceLang)
      return label("uk", "past", ifaceLang)
    }
    // A perfective verb has no present tense — its "present" forms are future.
    if (aspect === "perfective") return label("uk", "future", ifaceLang)
    return label("uk", "present", ifaceLang)
  }

  // An unsupported target language gets no hint rather than a wrong one.
  return null
}
