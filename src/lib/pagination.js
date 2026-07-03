// Pure reader math. Extended in the Paginator task with page arithmetic.

export function bookProgress(chapterBlockCounts, chapterIndex, blockOffset) {
  const total = chapterBlockCounts.reduce((a, b) => a + b, 0)
  if (total === 0) return 0
  const done = chapterBlockCounts.slice(0, chapterIndex).reduce((a, b) => a + b, 0) + blockOffset
  return Math.min(100, Math.round((done / total) * 100))
}

export function pageCount(scrollWidth, pageWidth, gap) {
  if (pageWidth <= 0) return 1
  return Math.max(1, Math.round((scrollWidth + gap) / (pageWidth + gap)))
}

export function pageOffset(page, pageWidth, gap) {
  return page * (pageWidth + gap)
}

export function pageOfOffsetLeft(offsetLeft, pageWidth, gap) {
  if (pageWidth + gap <= 0) return 0
  return Math.round(offsetLeft / (pageWidth + gap))
}

export function clampPage(page, count) {
  return Math.min(Math.max(0, page), Math.max(0, count - 1))
}

export function tocLabelFor(toc, chapterIndex) {
  let label = ''
  for (const entry of toc) {
    if (entry.chapterIndex <= chapterIndex && entry.depth === 0) label = entry.label
  }
  return label
}
