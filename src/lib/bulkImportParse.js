// Parsing one line of a pasted vocabulary list.
//
// Lifted out of Dictionary.jsx so it can be tested at all: it never had a test,
// and its last line quietly decided the part of speech for every word it did
// not recognise.

const PREPOSITIONS = ['auf','an','für','über','um','von','mit','nach','zu','bei','in','gegen','durch','aus','als']

export function parseBulkLine(line) {
  line = line.trim()
  if (!line) return null

  // Skip section headers like "Dativ", "Akkusativ"
  if (/^(Dativ|Akkusativ|Genitiv)$/i.test(line)) return null

  // Verb + preposition formats:
  // "achten (auf)" → "achten auf"
  // "anmelden (sich) für" → "sich anmelden für"
  // "abhängen von" (no parens)
  const prepInParen = line.match(/^(\S+)\s+\((sich)\)\s+(\S+)$/)   // verb (sich) prep
  const prepInParen2 = line.match(/^(\S+)\s+\((\S+)\)$/)            // verb (prep)
  const verbPrepPlain = line.match(/^(\S+)\s+(auf|an|für|über|um|von|mit|nach|zu|bei|in|gegen|durch|aus|als)\s*$/)

  if (prepInParen) {
    const [, verb, , prep] = prepInParen
    return { word: `sich ${verb} ${prep}`, form: null, pos: 'verb', entry_type: 'phrasal-verb', translation: '', status: 'new' }
  }
  if (prepInParen2 && PREPOSITIONS.includes(prepInParen2[2])) {
    const [, verb, prep] = prepInParen2
    return { word: `${verb} ${prep}`, form: null, pos: 'verb', entry_type: 'phrasal-verb', translation: '', status: 'new' }
  }
  if (verbPrepPlain) {
    const [, verb, prep] = verbPrepPlain
    return { word: `${verb} ${prep}`, form: null, pos: 'verb', entry_type: 'phrasal-verb', translation: '', status: 'new' }
  }
  // Multi-word verb + preposition: "einverstanden sein mit", "fertig sein mit", "beteiligt sein an"
  const multiWordPrep = line.match(new RegExp(`^(.+?)\\s+(${PREPOSITIONS.join('|')})$`))
  if (multiWordPrep && !line.includes('(')) {
    const [, verb, prep] = multiWordPrep
    return { word: `${verb} ${prep}`, form: null, pos: 'verb', entry_type: 'phrasal-verb', translation: '', status: 'new' }
  }

  // Noun: starts with der/die/das
  if (/^(der|die|das)\s/i.test(line)) {
    const commaIdx = line.indexOf(',')
    const word = commaIdx > -1 ? line.slice(0, commaIdx).trim() : line.trim()
    const noun = word.replace(/^(der|die|das)\s+/i, '')
    const ending = commaIdx > -1 ? line.slice(commaIdx + 1).trim() : null
    let form = null
    if (ending) {
      if (ending === '-') form = noun // no change plural
      else if (ending.startsWith('-¨')) form = ending // umlaut — store as-is
      else if (ending.startsWith('-')) form = noun + ending.slice(1)
      else form = ending
    }
    return { word, form, pos: 'noun', entry_type: 'word', translation: '', status: 'new' }
  }

  // Verb / phrasal verb: has conjugation in parens
  if (line.includes('(') && !line.startsWith('-')) {
    const parenIdx = line.indexOf('(')
    const wordRaw = line.slice(0, parenIdx).trim()
    const conj = line.match(/\(([^)]+)\)/)?.[1] || ''
    const parts = conj.split(',').map(s => s.trim()).filter(Boolean)
    // form: "reißt ab / riss ab / hat abgerissen"
    const form = parts.slice(0, 3).join(' / ')
    const isPhrasal = wordRaw.includes(' ')
    return {
      word: wordRaw,
      form,
      pos: 'verb',
      entry_type: isPhrasal ? 'phrasal-verb' : 'word',
      translation: '',
      status: 'new',
    }
  }

  const word = line.replace(/,.*/, '').replace(/\(.*\)/, '').trim()
  if (!word) return null

  // A bare word carries its own evidence in German: nouns are capitalised, and
  // an infinitive ends in -en, -eln or -ern. Everything unrecognised used to
  // become an adjective, so a textbook list of infinitives imported as a list of
  // adjectives. That is not only untidy — a verb whose pos is wrong silently
  // loses its tense hint, and no insert path defaults pos.
  //
  // The AI identify step confirms or corrects all of this later; the point is to
  // hand it a sensible guess rather than a wrong one, and to be right for the
  // words that are never identified.
  const row = (pos) => ({ word, form: null, pos, entry_type: 'word', translation: '', status: 'new' })

  if (/^[A-ZÄÖÜ]/.test(word)) return row('noun')
  if (/(?:eln|ern|en)$/.test(word)) return row('verb')

  // Adjective / adverb / other. Many of these are BOTH — German adjectives
  // double as adverbs without changing form — which the identify step marks as
  // adjective-adverb once it has looked at the word.
  return row('adjective')
}
