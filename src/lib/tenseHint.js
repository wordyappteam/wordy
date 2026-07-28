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
// … alongside a Partizip II. German builds these four ways and the regex must
// cover all of them, or the hint silently degrades to "Präteritum" on perfectly
// ordinary sentences:
//   plain            ge + stem + t/en      gemacht, gelesen
//   separable prefix stem + ge + stem      angekommen, aufgemacht
//   inseparable      no ge- at all         erreicht, verlassen, besucht
//   -ieren verbs     no ge- at all         reserviert, studiert
// The Präteritum forms it must NOT match end in -e/-te/-ten (erreichte, kaufte,
// ging), which is why every alternative anchors on a final t/en at a word break.
const DE_PARTICIPLE = /\b(\w*ge\w+(?:t|en)|\w+iert|(?:be|er|ver|ent|emp|zer|miss)\w+(?:t|en))\b/i

const EN_AUX = /\b(have|has)\b/i
const EN_PARTICIPLE = /\b\w+(?:ed|en|ne|wn|ught|ood)\b/i
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
    const perfekt = DE_AUX.test(text) && DE_PARTICIPLE.test(text)
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
