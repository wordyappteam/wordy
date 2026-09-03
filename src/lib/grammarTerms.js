// The grammatical vocabulary these notes are allowed to use.
//
// One concept, one word. Nika's English dictionary carried FOURTEEN spellings
// of "countable noun" — лічильна, лічуваний, рахункова, зліченна, обчислюваний,
// лічивна, лічива — several of which are not Ukrainian words at all. Correcting
// their endings would have left a tidy, agreeing, still-inconsistent dictionary
// with fourteen terms in it.
//
// So the canon lives in one place and is used three times over: the audit
// reports a term outside it, the repair rewrites the term to it, and the
// identify prompt states it, so new words stop arriving in fourteen spellings.

// What a learner should read, for each concept the notes talk about.
export const CANONICAL_TERMS = {
  countable:    'злічуваний іменник',
  uncountable:  'незлічуваний іменник',
  regular:      'правильне дієслово',
  irregular:    'неправильне дієслово',
  transitive:   'перехідне дієслово',
  intransitive: 'неперехідне дієслово',
  attributive:  'атрибутивне вживання',
  predicative:  'предикативне вживання',
}

// Stems that mean "countable", whatever ending they were given. `злічуван` is
// among them so an already-correct term resolves to itself rather than to null.
const COUNTABLE_STEMS = [
  'злічуван', 'лічильн', 'лічуван', 'рахунков', 'зліченн', 'зліченин',
  'обчислюван', 'обчислювальн', 'лічивн', 'лічив', 'полічуван', 'враховн',
]

// Calques and near-misses for terms that are otherwise fine.
const RENAMED = { 'регулярн': 'правильн', 'нерегулярн': 'неправильн' }

// Already canonical: recognised so the audit does not flag them, and left alone.
const ALREADY_CANONICAL = [
  'правильн', 'неправильн', 'перехідн', 'неперехідн',
  'атрибутивн', 'предикативн', 'зворотн', 'безособов', 'особов',
  'модальн', 'допоміжн', 'означен', 'неозначен', 'множинн', 'однинн',
  'формальн', 'неформальн', 'технічн', 'розмовн', 'переносн', 'буквальн',
  'метафоричн', 'спеціалізован', 'числов',
]

const ADJ_ENDINGS = ['ий', 'ій', 'а', 'я', 'е', 'є', 'ого', 'ому', 'им', 'ім', 'ої', 'ою', 'і']

// Strip a Ukrainian adjective ending, longest first, and return the stem.
function stemOf(word) {
  const w = word.toLowerCase()
  const endings = [...ADJ_ENDINGS].sort((a, b) => b.length - a.length)
  for (const ending of endings) {
    if (w.length > ending.length && w.endsWith(ending)) return w.slice(0, -ending.length)
  }
  return w
}

// The canonical stem for a grammar term, or null when the word is either
// already canonical or not a grammar term at all. Both answers mean "leave it".
export function canonicalStem(word) {
  if (typeof word !== 'string' || !word) return null
  const stem = stemOf(word)

  if (ALREADY_CANONICAL.includes(stem)) return null
  if (stem in RENAMED) return RENAMED[stem]

  const negated = stem.startsWith('не')
  const bare = negated ? stem.slice(2) : stem
  if (COUNTABLE_STEMS.includes(bare)) {
    const canonical = negated ? 'незлічуван' : 'злічуван'
    return canonical === stem ? canonical : canonical
  }
  return null
}
