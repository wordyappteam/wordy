// Pure reader math. Extended in the Paginator task with page arithmetic.

export function bookProgress(chapterBlockCounts, chapterIndex, blockOffset) {
  const total = chapterBlockCounts.reduce((a, b) => a + b, 0)
  if (total === 0) return 0
  const done = chapterBlockCounts.slice(0, chapterIndex).reduce((a, b) => a + b, 0) + blockOffset
  return Math.min(100, Math.round((done / total) * 100))
}
