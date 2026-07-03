// Pure path/zip/TOC helpers for the epub parser. No DOM, no jszip — testable in node.

export function normalizePath(path) {
  let p = path
  try { p = decodeURIComponent(p) } catch { /* keep raw if malformed encoding */ }
  const out = []
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return out.join('/')
}

export function stripFragment(href) {
  const i = href.indexOf('#')
  return i === -1 ? href : href.slice(0, i)
}

export function resolveHref(baseDir, href) {
  return normalizePath(baseDir ? baseDir + '/' + href : href)
}

export function findZipEntry(entryNames, path) {
  const norm = normalizePath(path)
  const exact = entryNames.find(e => e === norm)
  if (exact) return exact
  const lower = norm.toLowerCase()
  const ci = entryNames.find(e => e.toLowerCase() === lower)
  if (ci) return ci
  const suffix = entryNames.filter(e => e.toLowerCase().endsWith('/' + lower))
  return suffix.length === 1 ? suffix[0] : null
}

export function mapTocToChapters(rawToc, chapterPaths) {
  const index = new Map(chapterPaths.map((p, i) => [p.toLowerCase(), i]))
  const out = []
  for (const entry of rawToc) {
    const chapterIndex = index.get(normalizePath(entry.path).toLowerCase())
    if (chapterIndex !== undefined) out.push({ label: entry.label, chapterIndex, depth: entry.depth })
  }
  return out
}
