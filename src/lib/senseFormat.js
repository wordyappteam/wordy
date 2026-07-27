export function listHeadword(word) {
  const senses = word.senses ?? []
  const primary = senses[0]
  const form = primary?.wordForm?.trim()
  const base = form && form.toLowerCase() !== (word.word || "").trim().toLowerCase() ? form : word.word
  return senses.length > 1 ? `${base} ·${senses.length}` : base
}
