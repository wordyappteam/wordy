// Builds a compact, most-recent-first snapshot of the learner's saved words for
// injection into the Grammar Chat tutor prompt, so it can reference "my last N
// words" without having to be handed the list each time. Input: an array of
// word_senses ALREADY ordered newest-first (the caller does the DB ordering).
// Output: a numbered text block, or '' when there's nothing usable.
export function buildDictionarySnapshot(senses, limit = 40) {
  const rows = (senses ?? [])
    .filter((s) => s?.word_form?.trim() && s?.translation?.trim())
    .slice(0, limit)
  if (!rows.length) return ''
  return rows
    .map((s, i) => {
      const meta = [s.pos, s.learning_stage].filter(Boolean).join(' · ')
      return `${i + 1}. ${s.word_form.trim()} — ${s.translation.trim()}${meta ? ` (${meta})` : ''}`
    })
    .join('\n')
}
