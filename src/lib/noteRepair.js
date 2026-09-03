// Proposing a correction for a note the audit flagged.
//
// Only where the correction is DERIVABLE from the defect itself. A gender
// disagreement carries its own answer — the noun says what the adjective should
// have been. A Russian word on the list has one Ukrainian counterpart. A Latin
// letter that looks identical to a Cyrillic one can be swapped without changing
// what the word says.
//
// Everything else returns null and waits for a person. A tool that guesses at
// wording in a language the reviewer may not read is worse than one that admits
// it does not know: the reviewer cannot tell a good guess from a bad one, so
// every guess ships.

import { NOUN_GENDER, ADJ_STEMS, ADJ_ENDINGS, adjectiveGender } from './noteAudit.js'

const ENDING_FOR = { m: 'ий', f: 'а', n: 'е' }

// Each Russian word the audit knows, and the one Ukrainian word it should be.
const UKRAINIAN_FOR = {
  'или': 'або', 'это': 'це', 'этот': 'цей', 'эта': 'ця', 'эти': 'ці',
  'что': 'що', 'чтобы': 'щоб', 'если': 'якщо', 'как': 'як',
  'тоже': 'теж', 'также': 'також', 'очень': 'дуже', 'сейчас': 'зараз',
  'всегда': 'завжди', 'здесь': 'тут', 'тщательно': 'ретельно',
  'настоящий': 'справжній', 'настоящая': 'справжня', 'настоящее': 'справжнє',
  'нужно': 'потрібно', 'может': 'може', 'можно': 'можна',
  'используется': 'використовується', 'используются': 'використовуються',
  'значит': 'значить', 'только': 'тільки', 'когда': 'коли', 'где': 'де',
  'почему': 'чому', 'потому': 'тому', 'вместо': 'замість', 'между': 'між',
  'после': 'після', 'более': 'більше', 'нет': 'ні',
  'который': 'який', 'которая': 'яка', 'которые': 'які',
  'другой': 'інший', 'каждый': 'кожний', 'самый': 'найбільш',
  'его': 'його', 'ее': 'її', 'их': 'їх', 'она': 'вона', 'они': 'вони',
  'был': 'був', 'была': 'була', 'было': 'було', 'были': 'були', 'есть': 'є',
  'время': 'час', 'лицо': 'обличчя', 'дело': 'справа', 'вещь': 'річ',
}

// Latin letters whose Cyrillic twin is the SAME shape, so swapping one for the
// other cannot change which word is written. Deliberately short: Latin B is not
// here, because a word wanting Б would come back as В — a different word.
const TWIN = {
  a: 'а', c: 'с', e: 'е', i: 'і', o: 'о', p: 'р', x: 'х', y: 'у',
  A: 'А', C: 'С', E: 'Е', I: 'І', K: 'К', M: 'М', O: 'О', P: 'Р',
  T: 'Т', X: 'Х', H: 'Н',
}

const matchCase = (source, replacement) =>
  source[0] === source[0].toUpperCase() && source[0] !== source[0].toLowerCase()
    ? replacement[0].toUpperCase() + replacement.slice(1)
    : replacement

// Rebuild an adjective on the gender its noun actually has.
function agree(adjective, gender) {
  const lower = adjective.toLowerCase()
  for (const stem of ADJ_STEMS) {
    if (!lower.startsWith(stem)) continue
    if (!(lower.slice(stem.length) in ADJ_ENDINGS)) continue
    return matchCase(adjective, stem + ENDING_FOR[gender])
  }
  return null
}

// Swap every Latin letter for its Cyrillic twin — but only if every one of them
// HAS a twin. A single letter without one means the word was transliterated,
// not mistyped, and only a person knows what it was meant to say.
function detwin(word) {
  let out = ''
  for (const ch of word) {
    if (/[A-Za-z]/.test(ch)) {
      if (!(ch in TWIN)) return null
      out += TWIN[ch]
    } else out += ch
  }
  return out
}

// Returns the whole field, corrected — or null when nothing can be derived.
export function proposeRepair(finding, text) {
  if (typeof text !== 'string' || !finding?.excerpt) return null

  let fixed = null

  if (finding.code === 'gender-agreement') {
    const [adjective, noun] = finding.excerpt.split(/\s+/)
    const gender = NOUN_GENDER[noun?.toLowerCase()]
    const corrected = gender && agree(adjective, gender)
    if (corrected) fixed = `${corrected} ${noun}`
  }

  if (finding.code === 'russian-word') {
    const bare = finding.excerpt.toLowerCase().replace(/[.:!?]+$/, '')
    const ukrainian = UKRAINIAN_FOR[bare]
    if (ukrainian) fixed = matchCase(finding.excerpt, ukrainian)
  }

  if (finding.code === 'mixed-script-word') fixed = detwin(finding.excerpt)

  if (fixed === null || fixed === finding.excerpt) return null

  // Replace the flagged occurrence only. Another copy of the same word further
  // along is its own finding, and gets its own look.
  const at = text.indexOf(finding.excerpt)
  if (at < 0) return null
  return text.slice(0, at) + fixed + text.slice(at + finding.excerpt.length)
}
