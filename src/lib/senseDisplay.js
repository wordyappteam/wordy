// Translation display for compact / card contexts.
//
// A sense's `translation` sometimes carries a parenthetical gloss, e.g.
// "(a stinging insect) wasp" or "wasp (a stinging insect)". When the meaning is
// unambiguous, the card should just say "wasp". Keep the parenthetical only when
// it genuinely disambiguates — i.e. the word has multiple senses shown together
// (pass disambiguate = senses.length > 1).
export function displayTranslation(translation, disambiguate = false) {
  if (!translation) return ''
  if (disambiguate) return translation.trim()
  const stripped = translation
    .replace(/\([^()]*\)/g, ' ')   // drop parenthetical glosses
    .replace(/\s+([,;.])/g, '$1')  // tidy " ," -> ","
    .replace(/\s{2,}/g, ' ')
    .trim()
  return stripped || translation.trim() // fall back if stripping left nothing
}

// The panel header already prints the entry — `aspectPairTitle || word.word`. The
// sense body should print the sense's own form only when it says something the
// header does not: a phrase sense ("eine Entscheidung treffen" under the entry
// "die Entscheidung") or one half of a Ukrainian aspect pair. For an ordinary
// single-sense word the two are the same string, and the card would open by
// saying the same thing twice before reaching the meaning.
export function showSenseForm(sense, headerTitle) {
  const form = sense?.wordForm?.trim()
  if (!form) return false
  return form.toLowerCase() !== (headerTitle || '').trim().toLowerCase()
}
