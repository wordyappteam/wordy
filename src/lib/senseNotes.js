// Grammar-note hygiene.
//
// A grammar note earns its place only when it says something specific to THIS
// word that isn't already visible on the card. Two kinds of noise survive every
// attempt to prompt them away, so they're stripped deterministically here:
//
//   1. "auxiliary haben" — haben is the default; saying it carries no information.
//      Only sein is worth a learner's attention. (Haiku emits it regardless of
//      being told not to, in every language we ask in.)
//   2. bare gender/article — the headword already reads "der Tisch"; repeating
//      "Maskulinum" tells the learner nothing they can't see.
//
// Notes are telegraphic and ' · '-separated, so this works segment by segment.
// A segment survives unless it is pure noise; if nothing survives, the note is
// null and the card hides the section entirely rather than showing filler.

const SEP = /\s*[·;]\s*/

// Mentions the default auxiliary. Matched across EN/DE/UK/RU phrasings, since the
// note is written in whatever the interface language is.
const AUX_HABEN = /\bhaben\b/i

// Says only what the headword's article already says.
const BARE_GENDER = /^(maskulinum|femininum|neutrum|masculine|feminine|neuter|чоловічий рід|жіночий рід|середній рід|мужской род|женский род|средний род)$/i

// A gender word glued to a generic declension fact ("Maskulinum, Akkusativ: den Tisch")
// is still just the article restated — but keep anything naming a governed
// preposition, which is the one thing worth saying.
const GOVERNED_PREP = /[+]|\bakk|\bdat|\bgen\b/i

function keepSegment(seg) {
  const s = seg.trim().replace(/[.,]$/, '')
  if (!s) return false
  if (AUX_HABEN.test(s)) return false            // "auxiliary haben", "з допоміжним дієсловом haben"
  if (BARE_GENDER.test(s)) return false          // "Maskulinum"
  if (!GOVERNED_PREP.test(s) && /^(der|die|das)\b/i.test(s)) return false // "die Entscheidung" restated
  return true
}

// Returns a cleaned note, or null when nothing informative is left.
export function cleanGrammarNote(note) {
  if (!note || typeof note !== 'string') return null
  const kept = note.split(SEP).map((s) => s.trim()).filter(keepSegment)
  if (!kept.length) return null
  return kept.join(' · ')
}

// A usage note that merely restates the grammar note is filler. Cheap containment
// check: if the grammar note's informative core already appears in the usage note,
// drop the usage note.
export function cleanUsageNote(usage, grammarNote) {
  if (!usage || typeof usage !== 'string') return null
  const u = usage.trim()
  if (!u) return null
  if (!grammarNote) return u

  const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}+]+/gu, ' ').trim()
  const nu = norm(u)
  // Compare on stems, not whole words: Ukrainian inflects, so the grammar note's
  // "допоміжне дієслово sein" and the usage note's "допоміжним дієсловом sein" are
  // the same fact in different cases. A 5-char prefix survives the declension.
  const stem = (t) => t.slice(0, 5)
  const stems = norm(grammarNote).split(' ').filter((t) => t.length > 3).map(stem)
  // Every meaningful stem of the grammar note already present in the usage note
  // => the usage note is a restatement, not a new fact.
  if (stems.length && stems.every((s) => nu.includes(s))) return null
  return u
}
