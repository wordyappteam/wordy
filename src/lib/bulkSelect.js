// Selection arithmetic for bulk delete in the Dictionary. Pure, so it can be
// tested without the page.

// Add every visible word to the selection; words already selected stay.
export function selectAll(selected, visible) {
  const next = new Set(selected)
  visible.forEach((w) => next.add(w.id))
  return next
}

// How many selected words the current filter hides. Delete acts on the whole
// selection, so these would be deleted without being on screen.
export function hiddenSelected(selected, visible) {
  const shown = new Set(visible.map((w) => String(w.id)))
  let n = 0
  selected.forEach((id) => { if (!shown.has(String(id))) n++ })
  return n
}

// "1 слово · 3 слова · 5 слів" — Ukrainian has three plural forms.
export function wordCount(n, lang) {
  if (lang !== 'uk') return `${n} ${n === 1 ? 'word' : 'words'}`
  const d = n % 10, dd = n % 100
  if (d === 1 && dd !== 11) return `${n} слово`
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return `${n} слова`
  return `${n} слів`
}
