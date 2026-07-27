const ARTICLES = new Set(['der', 'die', 'das', 'to'])
const REFLEXIVES = new Set(['sich', 'oneself'])
// A short, closed set of the governed prepositions the identifier attaches.
const PREPS = new Set([
  'an', 'auf', 'aus', 'bei', 'für', 'gegen', 'in', 'mit', 'nach',
  'über', 'um', 'unter', 'von', 'vor', 'zu', 'oneself',
])

export function baseSpelling(wordForm) {
  const tokens = (wordForm || '').trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!tokens.length) return ''
  // drop a leading article
  if (ARTICLES.has(tokens[0])) tokens.shift()
  // drop a leading reflexive (English "oneself" trails; German "sich" leads)
  if (REFLEXIVES.has(tokens[0])) tokens.shift()
  // drop a trailing governed preposition / reflexive
  while (tokens.length > 1 && PREPS.has(tokens[tokens.length - 1])) tokens.pop()
  return tokens.join(' ')
}

export function splitCandidates(entry) {
  const senses = entry.senses ?? []
  if (senses.length <= 1) return [entry]
  const groups = new Map() // base spelling -> senses[]
  for (const s of senses) {
    const key = baseSpelling(s.wordForm) || baseSpelling(entry.word)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(s)
  }
  if (groups.size === 1) return [entry]
  // The entry's own spelling leads; the rest follow in first-seen order.
  const entryKey = baseSpelling(entry.word)
  const keys = [...groups.keys()].sort((a, b) =>
    (a === entryKey ? -1 : 0) - (b === entryKey ? -1 : 0))
  return keys.map(key => {
    const group = groups.get(key)
    // Each candidate's display word is its first sense's wordForm, stripped of a
    // trailing preposition so the headword is the lemma (kämpfen, not kämpfen gegen).
    const lead = group[0].wordForm || entry.word
    return { word: stripTrailingPrep(lead), entryType: entry.entryType, senses: group }
  })
}

function stripTrailingPrep(wordForm) {
  const tokens = (wordForm || '').trim().split(/\s+/)
  while (tokens.length > 1 && PREPS.has(tokens[tokens.length - 1].toLowerCase())) tokens.pop()
  return tokens.join(' ')
}
