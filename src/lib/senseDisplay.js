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
