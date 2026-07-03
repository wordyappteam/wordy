// Owned epub pipeline: container.xml → OPF → spine/metadata/cover → TOC (nav/NCX)
// → rich blocks per chapter. Lenient text/html parsing so malformed XHTML never
// drops a chapter. DOMParserImpl is injectable so node tests can pass linkedom.
import JSZip from 'jszip'
import { mergeRuns } from './readerText.js'
import { normalizePath, stripFragment, resolveHref, findZipEntry, mapTocToChapters } from './epubPaths.js'

export const MAX_EPUB_BYTES = 35 * 1024 * 1024

const BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'figcaption'])
const CONTAINER_TAGS = new Set(['div', 'section', 'article', 'main', 'aside', 'header', 'footer', 'figure', 'body'])

function dirOf(path) {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

// linkedom quirks worked around here:
//  - getElementsByTagName('*') always returns an empty list (both html and xml
//    parsing modes), so we use querySelectorAll('*') instead.
//  - its XML parser is not namespace-aware: a tag like <dc:title> keeps the
//    prefix in both .tagName and .localName instead of splitting it off, so
//    we strip any "prefix:" ourselves before comparing local names.
function localNameOf(el) {
  const name = el.localName || el.tagName || ''
  const i = name.indexOf(':')
  return i === -1 ? name : name.slice(i + 1)
}

function findByLocalName(root, name) {
  return [...root.querySelectorAll('*')].filter(el => localNameOf(el) === name)
}

function extractRuns(el, flags = {}) {
  const runs = []
  for (const node of el.childNodes) {
    if (node.nodeType === 3) {
      const text = node.textContent.replace(/\s+/g, ' ')
      if (text) runs.push({ text, ...flags })
    } else if (node.nodeType === 1) {
      const t = node.localName
      if (t === 'br') runs.push({ br: true })
      else if (t === 'em' || t === 'i' || t === 'cite') runs.push(...extractRuns(node, { ...flags, em: true }))
      else if (t === 'strong' || t === 'b') runs.push(...extractRuns(node, { ...flags, strong: true }))
      else if (t === 'sup') runs.push(...extractRuns(node, { ...flags, sup: true }))
      else if (t === 'ul' || t === 'ol' || t === 'img' || t === 'svg') continue // handled at block level
      else runs.push(...extractRuns(node, flags)) // span, a, u, small… → inherit flags
    }
  }
  return runs
}

function hasBlockDescendant(el) {
  // div/section count as block descendants so wrapper divs recurse instead of
  // flattening a whole Kindle-style div-paragraph chapter into one block
  return findByLocalName(el, 'p').length > 0 ||
    [...BLOCK_TAGS].some(t => t !== 'p' && findByLocalName(el, t).length > 0) ||
    findByLocalName(el, 'blockquote').length > 0 ||
    findByLocalName(el, 'ul').length > 0 || findByLocalName(el, 'ol').length > 0 ||
    findByLocalName(el, 'div').length > 0 || findByLocalName(el, 'section').length > 0
}

function imgSrc(node) {
  return node.getAttribute('src') || node.getAttribute('xlink:href') || node.getAttribute('href') || ''
}

// Sync DOM walk → blocks. Image blocks carry {src} — resolved to imageId later.
export function extractBlocks(body) {
  const blocks = []

  function emitText(node, type, ctx, extra = {}) {
    let runs = mergeRuns(extractRuns(node))
    const brCount = runs.filter(r => r.br).length
    let finalType = type
    if (type === 'p' && brCount >= 2) finalType = 'verse'
    if (finalType !== 'verse') runs = mergeRuns(runs.map(r => (r.br ? { text: ' ' } : r)))
    // paragraphs inside a <blockquote> container render as quote blocks
    if (finalType === 'p' && ctx.quoteDepth > 0) finalType = 'blockquote'
    const hasText = runs.some(r => !r.br && r.text.trim())
    if (hasText) {
      const block = { type: finalType, runs, ...extra }
      if (ctx.quoteDepth > 1) block.quoteDepth = ctx.quoteDepth - 1 // extra indent only for nested quotes
      blocks.push(block)
    }
    // hoist images nested anywhere inside this block element
    for (const img of findByLocalName(node, 'img')) emitImage(img)
    for (const svg of findByLocalName(node, 'image')) emitImage(svg)
  }

  function emitImage(node) {
    const src = imgSrc(node)
    if (src) blocks.push({ type: 'image', src, alt: node.getAttribute('alt') || '' })
  }

  function walk(el, ctx) {
    for (const node of el.children) {
      const tag = node.localName
      if (BLOCK_TAGS.has(tag)) emitText(node, tag === 'figcaption' ? 'figcaption' : tag, ctx)
      else if (tag === 'blockquote') {
        if (hasBlockDescendant(node)) walk(node, { quoteDepth: ctx.quoteDepth + 1 })
        else emitText(node, 'blockquote', ctx)
      } else if (tag === 'ul' || tag === 'ol') {
        let n = 1
        for (const li of node.children) {
          if (li.localName === 'li') emitText(li, 'li', ctx, { listType: tag, listIndex: n++ })
        }
      } else if (tag === 'hr') {
        blocks.push({ type: 'hr' })
      } else if (tag === 'img' || tag === 'image') {
        emitImage(node)
      } else if (tag === 'svg') {
        for (const im of findByLocalName(node, 'image')) emitImage(im)
      } else if (tag === 'pre') {
        const lines = node.textContent.split('\n').map(l => l.trim()).filter(Boolean)
        const runs = lines.flatMap((l, i) => (i === 0 ? [{ text: l }] : [{ br: true }, { text: l }]))
        if (runs.length) blocks.push({ type: 'verse', runs })
      } else if (CONTAINER_TAGS.has(tag)) {
        if (hasBlockDescendant(node)) walk(node, ctx)
        else emitText(node, 'p', ctx) // Kindle-style div-paragraph books
      }
      // everything else (script/style/nav/table-for-v1…): skip. Tables are a
      // spec non-goal for v1.
    }
  }

  walk(body, { quoteDepth: 0 })
  return blocks
}

function parseNavToc(doc, tocDir) {
  const navs = findByLocalName(doc, 'nav')
  const nav = navs.find(n => ((n.getAttribute('epub:type') || '') + (n.getAttribute('role') || '')).includes('toc')) ?? navs[0]
  if (!nav) return []
  const raw = []
  function walkList(ol, depth) {
    for (const li of ol.children) {
      if (li.localName !== 'li') continue
      const a = [...li.children].find(c => c.localName === 'a')
      if (a && a.getAttribute('href')) {
        raw.push({ label: a.textContent.replace(/\s+/g, ' ').trim(), path: resolveHref(tocDir, stripFragment(a.getAttribute('href'))), depth })
      }
      for (const sub of li.children) if (sub.localName === 'ol' || sub.localName === 'ul') walkList(sub, depth + 1)
    }
  }
  for (const ol of nav.children) if (ol.localName === 'ol' || ol.localName === 'ul') walkList(ol, 0)
  return raw
}

function parseNcxToc(doc, ncxDir) {
  const raw = []
  function walkPoints(el, depth) {
    for (const np of el.children) {
      if (np.localName !== 'navPoint') continue
      const label = findByLocalName(np, 'text')[0]?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
      const src = findByLocalName(np, 'content')[0]?.getAttribute('src')
      if (label && src) raw.push({ label, path: resolveHref(ncxDir, stripFragment(src)), depth })
      walkPoints(np, depth + 1)
    }
  }
  for (const navMap of findByLocalName(doc, 'navMap')) walkPoints(navMap, 0)
  return raw
}

export async function parseEpub(arrayBuffer, bookId, opts = {}) {
  const DOMParserImpl = opts.DOMParserImpl ?? globalThis.DOMParser
  const parse = (text, type) => new DOMParserImpl().parseFromString(text, type)
  const warnings = []

  const zip = await JSZip.loadAsync(arrayBuffer)
  const entryNames = Object.keys(zip.files).filter(n => !zip.files[n].dir)

  if (findZipEntry(entryNames, 'META-INF/encryption.xml')) {
    throw Object.assign(new Error('This book is DRM-protected and cannot be opened.'), { code: 'drm' })
  }

  const containerEntry = findZipEntry(entryNames, 'META-INF/container.xml')
  if (!containerEntry) throw new Error('Not a valid epub (missing META-INF/container.xml).')
  const containerDoc = parse(await zip.file(containerEntry).async('text'), 'text/xml')
  const opfHref = findByLocalName(containerDoc, 'rootfile')[0]?.getAttribute('full-path')
  if (!opfHref) throw new Error('Not a valid epub (no rootfile in container.xml).')
  const opfPath = normalizePath(opfHref)
  const opfEntry = findZipEntry(entryNames, opfPath)
  if (!opfEntry) throw new Error('Not a valid epub (package document missing).')
  const opfDir = dirOf(opfEntry)
  const opf = parse(await zip.file(opfEntry).async('text'), 'text/xml')

  // metadata (namespace-tolerant via localName)
  const metadataEl = findByLocalName(opf, 'metadata')[0] ?? opf
  const metaText = (name) => findByLocalName(metadataEl, name)[0]?.textContent?.trim() ?? ''
  const title = metaText('title') || 'Untitled'
  const author = metaText('creator')
  const language = (metaText('language') || 'en').split('-')[0].toLowerCase()

  // manifest + spine
  const items = new Map()
  for (const item of findByLocalName(opf, 'item')) {
    items.set(item.getAttribute('id'), {
      href: item.getAttribute('href') ?? '',
      mediaType: item.getAttribute('media-type') ?? '',
      properties: item.getAttribute('properties') ?? '',
    })
  }
  const spineEl = findByLocalName(opf, 'spine')[0]
  const spineIds = findByLocalName(opf, 'itemref')
    .filter(ir => ir.getAttribute('linear') !== 'no')
    .map(ir => ir.getAttribute('idref'))

  // images collected on demand, deduped by zip path
  const imagesByPath = new Map() // path → { id, blob }
  let imageN = 0
  async function imageIdFor(path) {
    const entry = findZipEntry(entryNames, path)
    if (!entry) return null
    if (!imagesByPath.has(entry)) {
      const blob = new Blob([await zip.file(entry).async('arraybuffer')])
      imagesByPath.set(entry, { id: `${bookId}-img${imageN++}`, blob })
    }
    return imagesByPath.get(entry).id
  }

  // sections from spine
  const chapters = []
  const chapterPaths = []
  const spineTotal = spineIds.length
  for (const idref of spineIds) {
    const item = items.get(idref)
    if (!item || !item.href) { warnings.push(`Section "${idref}" missing from manifest — skipped.`); continue }
    const abs = resolveHref(opfDir, stripFragment(item.href))
    const entry = findZipEntry(entryNames, abs)
    if (!entry) { warnings.push(`File "${item.href}" not found in the epub — section skipped.`); continue }
    let blocks
    try {
      const doc = parse(await zip.file(entry).async('text'), 'text/html')
      const body = findByLocalName(doc, 'body')[0] ?? doc.documentElement
      blocks = extractBlocks(body)
    } catch {
      warnings.push(`Could not read section "${item.href}" — skipped.`)
      continue
    }
    // resolve image srcs → stored blob ids (relative to the section's own dir)
    const sectionDir = dirOf(entry)
    const resolved = []
    for (const b of blocks) {
      if (b.type !== 'image') { resolved.push(b); continue }
      const id = await imageIdFor(resolveHref(sectionDir, stripFragment(b.src)))
      if (id) resolved.push({ type: 'image', imageId: id, alt: b.alt })
      else warnings.push(`Image "${b.src}" not found — dropped.`)
    }
    if (resolved.length === 0) continue // empty section (e.g. blank page) — not an error
    const index = chapters.length
    chapters.push({ id: `${bookId}-${index}`, bookId, index, title: '', blocks: resolved })
    chapterPaths.push(entry)
  }
  if (chapters.length === 0) throw new Error('No readable chapters found in this epub.')

  // TOC: EPUB3 nav doc, else NCX, else generated
  let rawToc = []
  const navItem = [...items.values()].find(i => i.properties.split(/\s+/).includes('nav'))
  if (navItem) {
    const navEntry = findZipEntry(entryNames, resolveHref(opfDir, navItem.href))
    if (navEntry) rawToc = parseNavToc(parse(await zip.file(navEntry).async('text'), 'text/html'), dirOf(navEntry))
  }
  if (rawToc.length === 0) {
    const ncxId = spineEl?.getAttribute('toc')
    const ncxItem = (ncxId && items.get(ncxId)) || [...items.values()].find(i => i.mediaType === 'application/x-dtbncx+xml')
    if (ncxItem) {
      const ncxEntry = findZipEntry(entryNames, resolveHref(opfDir, ncxItem.href))
      if (ncxEntry) rawToc = parseNcxToc(parse(await zip.file(ncxEntry).async('text'), 'text/xml'), dirOf(ncxEntry))
    }
  }
  let toc = mapTocToChapters(rawToc, chapterPaths)
  if (toc.length === 0) {
    warnings.push('No table of contents found — generated one from chapter headings.')
    toc = chapters.map((ch, i) => {
      const h = ch.blocks.find(b => ['h1', 'h2', 'h3'].includes(b.type))
      return { label: h ? h.runs.map(r => r.text ?? '').join('') : `Chapter ${i + 1}`, chapterIndex: i, depth: 0 }
    })
  }
  // chapter titles from the first TOC entry pointing at each chapter
  for (const entry of toc) {
    if (chapters[entry.chapterIndex] && !chapters[entry.chapterIndex].title) {
      chapters[entry.chapterIndex].title = entry.label
    }
  }

  // cover: properties="cover-image", else <meta name="cover" content="id">
  let coverImageId = null
  let coverItem = [...items.values()].find(i => i.properties.split(/\s+/).includes('cover-image'))
  if (!coverItem) {
    const coverMeta = findByLocalName(metadataEl, 'meta').find(m => m.getAttribute('name') === 'cover')
    if (coverMeta) coverItem = items.get(coverMeta.getAttribute('content'))
  }
  if (coverItem) {
    const entry = findZipEntry(entryNames, resolveHref(opfDir, coverItem.href))
    if (entry) {
      if (imagesByPath.has(entry)) {
        coverImageId = imagesByPath.get(entry).id
      } else {
        coverImageId = `${bookId}-cover`
        imagesByPath.set('__cover__' + entry, { id: coverImageId, blob: new Blob([await zip.file(entry).async('arraybuffer')]) })
      }
    }
  }

  return {
    title, author, language, coverImageId,
    images: [...imagesByPath.values()],
    chapters, toc, warnings,
    stats: { spineTotal, imported: chapters.length },
  }
}
