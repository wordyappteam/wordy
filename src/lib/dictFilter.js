// Dictionary filtering by part of speech, and the membership check for adding
// a selection to a collection. Pure, so it can be tested without the page.

// Order of the part-of-speech options in the filter: the big classes first.
export const POS_ORDER = ['verb', 'noun', 'adjective', 'adjective-adverb', 'adverb', 'conjunction', 'preposition']

// pos lives on each sense; the word-level pos is only the first sense's. A word
// with an adjective sense and an adverb sense must turn up under both.
export function wordHasPos(w, pos) {
  if (w.senses?.length) return w.senses.some((s) => s.pos === pos)
  return w.pos === pos
}

// Only the parts of speech the dictionary actually holds — no empty options.
export function posOptions(words) {
  const found = new Set()
  for (const w of words) {
    if (w.senses?.length) w.senses.forEach((s) => s.pos && found.add(s.pos))
    else if (w.pos) found.add(w.pos)
  }
  const known = POS_ORDER.filter((p) => found.has(p))
  const other = [...found].filter((p) => !POS_ORDER.includes(p)).sort()
  return [...known, ...other]
}

// The selected words not yet in this collection.
export function notYetMembers(wordIds, collectionId, membershipByWord) {
  return wordIds.filter((id) => !membershipByWord[id]?.has(collectionId))
}
