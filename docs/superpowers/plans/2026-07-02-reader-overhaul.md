# Reader Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Reader's fragile epubjs-based parsing and pseudo-pagination with an owned epub pipeline (jszip + lenient HTML parsing + real TOC), a rich block model that preserves text formats, and a Kindle-style paged reading UI with chapter navigation and an Aa menu.

**Architecture:** Parse epubs ourselves (container.xml → OPF → spine/metadata/cover → nav/NCX TOC) into rich blocks (`runs` with em/strong/sup, verse, hr, image blobs) stored in IndexedDB v2 (clean slate). Render in our own DOM with CSS-column pagination — no iframe — so the word-tap → dictionary flow stays first-class. `Reader.jsx` (852 lines) splits into `src/pages/reader/` components.

**Tech Stack:** React 19, Vite 8, Tailwind v4, jszip (direct dep), linkedom (dev-only, parser tests), IndexedDB, `node --test`.

**Spec:** `docs/superpowers/specs/2026-07-02-reader-overhaul-design.md` (approved 2026-07-02).

## Global Constraints

- Branch: `reader-overhaul` off `main`. Do NOT touch SRS/session code (`srs.js`, `sessionEngine.js`, `SessionV2.jsx`, `Dashboard.jsx`).
- Git email must be `wordy.app.team@gmail.com` (already set in repo config).
- Pre-commit hook runs `vite build` — it catches syntax errors, not runtime errors.
- Apostrophes in single-quoted JS strings break the build — use double quotes for any string containing `'`.
- **Do not `git push`** (Netlify build credits are batched — the human pushes).
- Import size cap: **35 MiB** (`35 * 1024 * 1024` bytes) — *Determined* (~33.7 MiB) must pass.
- UI strings stay hardcoded English (parity with current Reader; i18n pass is out of scope).
- Word-tap behavior is sacred: tap word → identify → add to dictionary; known-word highlighting; EN/UA translate toggle.
- Tests: `node --test src/lib/<name>.test.js`. Build: `npm run build`.

## File Structure

```
src/lib/readerText.js      tokenize, normalizeWordForm, getSentence, blockPlainText, mergeRuns (pure)
src/lib/epubPaths.js       normalizePath, resolveHref, stripFragment, findZipEntry, mapTocToChapters (pure)
src/lib/epub.js            parseEpub(arrayBuffer, bookId, {DOMParserImpl}) — the whole pipeline
src/lib/pagination.js      pageCount, pageOffset, pageOfOffsetLeft, clampPage, bookProgress, tocLabelFor (pure)
src/lib/readerDb.js        REWRITE: DB v2 clean slate, images store, blockOffset progress
src/pages/reader/index.jsx        view switcher (library | reading)
src/pages/reader/Library.jsx      bookshelf grid, covers, delete
src/pages/reader/AddBookModal.jsx epub import (size gate, honest report) + paste text
src/pages/reader/ReadingView.jsx  chrome, tap zones, keys, chapter flow, persistence, popup wiring
src/pages/reader/Paginator.jsx    CSS-column pagination engine
src/pages/reader/Block.jsx        renders one rich block (runs → tappable word spans)
src/pages/reader/WordPopup.jsx    bottom-sheet word lookup (ported verbatim)
src/pages/reader/TocDrawer.jsx    contents drawer
src/pages/reader/AaMenu.jsx       font size + serif/sans popover
src/App.jsx                MODIFY line 23: import Reader from "./pages/reader"
src/pages/Reader.jsx       DELETE (task 5)
package.json               + jszip (dep), + linkedom (devDep), − epubjs (task 5)
```

**Block model (used everywhere):**

```js
// Run:   { text, em?: true, strong?: true, sup?: true }  |  { br: true }
// Block: { type: 'p'|'h1'..'h6'|'blockquote'|'figcaption', runs, quoteDepth?: number }
//        { type: 'li', runs, listType: 'ul'|'ol', listIndex: number }
//        { type: 'verse', runs }            // runs include {br:true} line breaks
//        { type: 'hr' }
//        { type: 'image', imageId, alt }
```

**Book record (IndexedDB `books` store):**

```js
{ id, title, author, language,            // language = 2-letter code for hyphenation, e.g. "de"
  format: 'epub'|'text', coverImageId,    // null if none
  toc: [{ label, chapterIndex, depth }],
  chapterCount, chapterBlockCounts,       // number[] — blocks per chapter, for progress %
  addedAt, lastReadAt, lastChapterIndex, lastBlockOffset }
```

---

### Task 1: Branch setup + pure text utilities (`readerText.js`)

**Files:**
- Create: `src/lib/readerText.js`, `src/lib/readerText.test.js`
- Modify: `package.json` (add jszip dependency)

**Interfaces:**
- Produces: `tokenize(text) → [{text, isWord, key}]`; `normalizeWordForm(w) → string`; `getSentence(blockText, word) → string`; `blockPlainText(block) → string`; `mergeRuns(runs) → runs` (merges adjacent same-flag text runs, collapses doubled spaces at boundaries, trims block edges, drops empty text runs, preserves `{br:true}`).

- [ ] **Step 1: Verify the branch**

The branch `reader-overhaul` (off `main`, post SRS-v2 merge) already exists with the spec and this plan committed. Confirm you are on it:

```bash
git branch --show-current   # expect: reader-overhaul
ls docs/superpowers/specs/2026-07-02-reader-overhaul-design.md
```

If not on it: `git checkout reader-overhaul`.

- [ ] **Step 2: Install jszip as a direct dependency**

```bash
npm install jszip@^3.10.1
```

- [ ] **Step 3: Write failing tests**

`src/lib/readerText.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tokenize, normalizeWordForm, getSentence, blockPlainText, mergeRuns } from './readerText.js'

test('tokenize splits words incl. umlauts and hyphens', () => {
  const tokens = tokenize('Das Mädchen-Chor lief.')
  const words = tokens.filter(t => t.isWord).map(t => t.text)
  assert.deepEqual(words, ['Das', 'Mädchen-Chor', 'lief'])
})

test('normalizeWordForm strips German articles and lowercases', () => {
  assert.equal(normalizeWordForm('das Buch'), 'buch')
  assert.equal(normalizeWordForm('Häuser'), 'häuser')
})

test('getSentence finds the sentence containing the word', () => {
  const text = 'Erster Satz. Der Hund bellt laut! Letzter Satz.'
  assert.equal(getSentence(text, 'Hund'), 'Der Hund bellt laut!')
})

test('blockPlainText joins runs, br becomes space', () => {
  const block = { type: 'verse', runs: [{ text: 'Zeile eins' }, { br: true }, { text: 'Zeile zwei' }] }
  assert.equal(blockPlainText(block), 'Zeile eins Zeile zwei')
})

test('blockPlainText is empty for image/hr blocks', () => {
  assert.equal(blockPlainText({ type: 'hr' }), '')
  assert.equal(blockPlainText({ type: 'image', imageId: 'x', alt: 'a' }), '')
})

test('mergeRuns merges same-flag neighbors and trims edges', () => {
  const merged = mergeRuns([{ text: ' Der ' }, { text: 'Hund', em: true }, { text: '' }, { text: ' bellt ' }])
  assert.deepEqual(merged, [{ text: 'Der ' }, { text: 'Hund', em: true }, { text: ' bellt' }])
})

test('mergeRuns collapses doubled boundary spaces, keeps br', () => {
  const merged = mergeRuns([{ text: 'a ' }, { text: ' b' }, { br: true }, { text: ' c ' }])
  assert.deepEqual(merged, [{ text: 'a b' }, { br: true }, { text: 'c' }])
})
```

- [ ] **Step 4: Run tests — expect FAIL (module not found)**

```bash
node --test src/lib/readerText.test.js
```

- [ ] **Step 5: Implement `src/lib/readerText.js`**

```js
// Pure text utilities for the Reader. tokenize/normalizeWordForm/getSentence
// are ports of the versions previously inside src/pages/Reader.jsx.

export function tokenize(text) {
  return text.split(/([\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*)/gu).map((t, i) => ({
    text: t,
    isWord: /[\p{L}]/u.test(t),
    key: i,
  }))
}

export function normalizeWordForm(w) {
  return w.toLowerCase().replace(/^(der|die|das|ein|eine)\s+/i, '').trim()
}

export function getSentence(blockText, word) {
  const sentences = blockText.match(/[^.!?…]+[.!?…]*/g) ?? [blockText]
  const target = word.toLowerCase()
  for (const s of sentences) {
    if (s.toLowerCase().includes(target)) return s.trim()
  }
  return blockText.slice(0, 300).trim()
}

export function blockPlainText(block) {
  if (!block.runs) return ''
  return block.runs.map(r => (r.br ? ' ' : r.text)).join('').replace(/\s+/g, ' ').trim()
}

function sameFlags(a, b) {
  return !!a.em === !!b.em && !!a.strong === !!b.strong && !!a.sup === !!b.sup
}

export function mergeRuns(runs) {
  const out = []
  for (const run of runs) {
    if (run.br) { out.push({ br: true }); continue }
    if (!run.text) continue
    const prev = out[out.length - 1]
    if (prev && !prev.br && sameFlags(prev, run)) {
      prev.text = (prev.text + run.text).replace(/  +/g, ' ')
    } else {
      out.push({ ...run })
    }
  }
  // trim block edges + drop text runs that became empty
  const first = out.find(r => !r.br)
  if (first) first.text = first.text.replace(/^\s+/, '')
  const last = [...out].reverse().find(r => !r.br)
  if (last) last.text = last.text.replace(/\s+$/, '')
  return out.filter(r => r.br || r.text)
}
```

- [ ] **Step 6: Run tests — expect all PASS**

```bash
node --test src/lib/readerText.test.js
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/readerText.js src/lib/readerText.test.js package.json package-lock.json
git commit -m "feat(reader): pure text utils — tokenize/sentence/plaintext/run merging"
```

---

### Task 2: Epub path + zip + TOC-mapping helpers (`epubPaths.js`)

**Files:**
- Create: `src/lib/epubPaths.js`, `src/lib/epubPaths.test.js`

**Interfaces:**
- Produces: `normalizePath(path) → string` (decodes %XX, collapses `.`/`..`, strips leading `/`); `stripFragment(href) → string`; `resolveHref(baseDir, href) → string` (normalized zip path; `baseDir` is '' or 'OEBPS' style, no trailing slash); `findZipEntry(entryNames, path) → string|null` (exact → case-insensitive → unique suffix match); `mapTocToChapters(rawToc, chapterPaths) → [{label, chapterIndex, depth}]` (drops entries whose path matches no chapter).

- [ ] **Step 1: Write failing tests**

`src/lib/epubPaths.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizePath, stripFragment, resolveHref, findZipEntry, mapTocToChapters } from './epubPaths.js'

test('normalizePath decodes and collapses dot segments', () => {
  assert.equal(normalizePath('OEBPS/../ch%201.xhtml'), 'ch 1.xhtml')
  assert.equal(normalizePath('./a/b/./c.html'), 'a/b/c.html')
  assert.equal(normalizePath('/OEBPS/x.html'), 'OEBPS/x.html')
})

test('stripFragment removes #anchor', () => {
  assert.equal(stripFragment('ch1.xhtml#s2'), 'ch1.xhtml')
  assert.equal(stripFragment('ch1.xhtml'), 'ch1.xhtml')
})

test('resolveHref resolves relative to base dir', () => {
  assert.equal(resolveHref('OEBPS', 'ch1.xhtml'), 'OEBPS/ch1.xhtml')
  assert.equal(resolveHref('OEBPS/text', '../images/i%20mg.jpg'), 'OEBPS/images/i mg.jpg')
  assert.equal(resolveHref('', 'ch1.xhtml'), 'ch1.xhtml')
})

test('findZipEntry: exact, case-insensitive, then unique suffix', () => {
  const names = ['mimetype', 'OEBPS/Ch1.xhtml', 'OEBPS/images/pic.jpg']
  assert.equal(findZipEntry(names, 'OEBPS/Ch1.xhtml'), 'OEBPS/Ch1.xhtml')
  assert.equal(findZipEntry(names, 'oebps/ch1.xhtml'), 'OEBPS/Ch1.xhtml')
  assert.equal(findZipEntry(names, 'images/pic.jpg'), 'OEBPS/images/pic.jpg')
  assert.equal(findZipEntry(names, 'nope.xhtml'), null)
})

test('mapTocToChapters maps hrefs to chapter indices, drops misses', () => {
  const raw = [
    { label: 'One', path: 'OEBPS/ch1.xhtml', depth: 0 },
    { label: 'Sub', path: 'OEBPS/ch1.xhtml', depth: 1 },
    { label: 'Two', path: 'OEBPS/ch2.xhtml', depth: 0 },
    { label: 'Ghost', path: 'OEBPS/gone.xhtml', depth: 0 },
  ]
  const mapped = mapTocToChapters(raw, ['OEBPS/ch1.xhtml', 'OEBPS/ch2.xhtml'])
  assert.deepEqual(mapped, [
    { label: 'One', chapterIndex: 0, depth: 0 },
    { label: 'Sub', chapterIndex: 0, depth: 1 },
    { label: 'Two', chapterIndex: 1, depth: 0 },
  ])
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
node --test src/lib/epubPaths.test.js
```

- [ ] **Step 3: Implement `src/lib/epubPaths.js`**

```js
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
```

- [ ] **Step 4: Run tests — expect all PASS**

```bash
node --test src/lib/epubPaths.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/epubPaths.js src/lib/epubPaths.test.js
git commit -m "feat(reader): epub path/zip/toc pure helpers"
```

---

### Task 3: The parser (`epub.js`) with synthetic-epub tests

**Files:**
- Create: `src/lib/epub.js`, `src/lib/epub.test.js`
- Modify: `package.json` (add linkedom devDependency)

**Interfaces:**
- Consumes: `mergeRuns` from `./readerText.js`; `normalizePath, stripFragment, resolveHref, findZipEntry, mapTocToChapters` from `./epubPaths.js`; `JSZip` from `jszip`.
- Produces: `MAX_EPUB_BYTES` (35 MiB); `parseEpub(arrayBuffer, bookId, opts?) → Promise<{ title, author, language, coverImageId, images, chapters, toc, warnings, stats }>` where `opts.DOMParserImpl` defaults to the global `DOMParser` (tests pass linkedom's); `images = [{ id, blob }]`; `chapters = [{ id: \`${bookId}-${index}\`, bookId, index, title, blocks }]` (title `''` for continuation files); `toc = [{ label, chapterIndex, depth }]` (never empty — falls back to generated per-chapter entries); `stats = { spineTotal, imported }`; DRM throws `Error` with `.code === 'drm'`.

- [ ] **Step 1: Install linkedom (dev only)**

```bash
npm install -D linkedom
```

- [ ] **Step 2: Write failing tests — build a synthetic epub in memory**

`src/lib/epub.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { DOMParser as LinkedomDOMParser } from 'linkedom'
import { parseEpub, MAX_EPUB_BYTES } from './epub.js'
import { blockPlainText } from './readerText.js'

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 0, 0xff, 0xd9])

async function buildEpub({ withNav = true } = {}) {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip')
  zip.file('META-INF/container.xml',
    `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
      <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
    </container>`)
  zip.file('OEBPS/content.opf',
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title>Test Book</dc:title><dc:creator>Anna Autor</dc:creator><dc:language>de-DE</dc:language>
      </metadata>
      <manifest>
        ${withNav ? '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' : ''}
        <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
        <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
        <item id="c2" href="ch%202.xhtml" media-type="application/xhtml+xml"/>
        <item id="c3" href="ch3.xhtml" media-type="application/xhtml+xml"/>
        <item id="pic" href="images/pic.jpg" media-type="image/jpeg"/>
        <item id="cov" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>
      </manifest>
      <spine toc="ncx"><itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/></spine>
    </package>`)
  zip.file('OEBPS/nav.xhtml',
    `<html xmlns="http://www.w3.org/1999/xhtml"><body><nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops">
      <ol><li><a href="ch1.xhtml">Kapitel Eins</a><ol><li><a href="ch1.xhtml#s2">Abschnitt</a></li></ol></li>
      <li><a href="ch%202.xhtml">Kapitel Zwei</a></li></ol></nav></body></html>`)
  zip.file('OEBPS/toc.ncx',
    `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>
      <navPoint><navLabel><text>NCX Eins</text></navLabel><content src="ch1.xhtml"/></navPoint>
      <navPoint><navLabel><text>NCX Zwei</text></navLabel><content src="ch%202.xhtml"/></navPoint>
    </navMap></ncx>`)
  zip.file('OEBPS/ch1.xhtml',
    `<html><body>
      <h1>Kapitel Eins</h1>
      <p>Der <em>schnelle</em> Fuchs springt.</p>
      <blockquote><p>Ein Zitat im Block.</p></blockquote>
      <ol><li>erstens</li><li>zweitens</li></ol>
      <hr/>
      <figure><img src="images/pic.jpg" alt="Ein Bild"/><figcaption>Bildtext</figcaption></figure>
    </body></html>`)
  zip.file('OEBPS/ch 2.xhtml',
    `<html><body><p>Rose ist rot<br/>Veilchen sind blau<br/>Zucker ist süß</p><p>Normaler Absatz.</p></body></html>`)
  // ch3 is deliberately malformed XHTML: unclosed <b>, bare &nbsp;
  zip.file('OEBPS/ch3.xhtml',
    `<html><body><p>Kaputt &nbsp; aber <b>lesbar</p></body></html>`)
  zip.file('OEBPS/images/pic.jpg', JPEG)
  zip.file('OEBPS/images/cover.jpg', JPEG)
  return zip.generateAsync({ type: 'arraybuffer' })
}

const opts = { DOMParserImpl: LinkedomDOMParser }

test('metadata, language code, stats', async () => {
  const book = await parseEpub(await buildEpub(), 'b1', opts)
  assert.equal(book.title, 'Test Book')
  assert.equal(book.author, 'Anna Autor')
  assert.equal(book.language, 'de')
  assert.deepEqual(book.stats, { spineTotal: 3, imported: 3 })
  assert.deepEqual(book.warnings, [])
})

test('malformed XHTML chapter still parses (lenient)', async () => {
  const book = await parseEpub(await buildEpub(), 'b1', opts)
  const texts = book.chapters[2].blocks.map(blockPlainText)
  assert.ok(texts.some(t => t.includes('aber lesbar')), 'ch3 text survived: ' + JSON.stringify(texts))
})

test('no blockquote>p double extraction', async () => {
  const book = await parseEpub(await buildEpub(), 'b1', opts)
  const quotes = book.chapters[0].blocks.map(blockPlainText).filter(t => t.includes('Zitat'))
  assert.equal(quotes.length, 1)
  const qBlock = book.chapters[0].blocks.find(b => blockPlainText(b).includes('Zitat'))
  assert.equal(qBlock.type, 'blockquote')
})

test('inline em run survives; ordered list numbered', async () => {
  const book = await parseEpub(await buildEpub(), 'b1', opts)
  const p = book.chapters[0].blocks.find(b => blockPlainText(b).includes('Fuchs'))
  assert.ok(p.runs.some(r => r.em && r.text.includes('schnelle')))
  const lis = book.chapters[0].blocks.filter(b => b.type === 'li')
  assert.deepEqual(lis.map(l => [l.listType, l.listIndex]), [['ol', 1], ['ol', 2]])
})

test('hr, image block, figcaption, cover extraction', async () => {
  const book = await parseEpub(await buildEpub(), 'b1', opts)
  const ch1 = book.chapters[0].blocks
  assert.ok(ch1.some(b => b.type === 'hr'))
  const img = ch1.find(b => b.type === 'image')
  assert.equal(img.alt, 'Ein Bild')
  assert.ok(book.images.some(i => i.id === img.imageId))
  assert.ok(ch1.some(b => b.type === 'figcaption'))
  assert.equal(book.coverImageId, 'b1-cover')
  assert.ok(book.images.some(i => i.id === 'b1-cover'))
})

test('br-heavy paragraph becomes verse with line breaks', async () => {
  const book = await parseEpub(await buildEpub(), 'b1', opts)
  const verse = book.chapters[1].blocks.find(b => b.type === 'verse')
  assert.ok(verse, 'verse block exists')
  assert.equal(verse.runs.filter(r => r.br).length, 2)
  const normal = book.chapters[1].blocks.find(b => b.type === 'p')
  assert.ok(blockPlainText(normal).includes('Normaler'))
})

test('URL-encoded spine href resolves (ch 2 imported)', async () => {
  const book = await parseEpub(await buildEpub(), 'b1', opts)
  assert.equal(book.chapters.length, 3)
  assert.ok(blockPlainText(book.chapters[1].blocks[0]).includes('Rose'))
})

test('EPUB3 nav TOC wins over NCX; anchors map to same chapter', async () => {
  const book = await parseEpub(await buildEpub(), 'b1', opts)
  assert.deepEqual(book.toc, [
    { label: 'Kapitel Eins', chapterIndex: 0, depth: 0 },
    { label: 'Abschnitt', chapterIndex: 0, depth: 1 },
    { label: 'Kapitel Zwei', chapterIndex: 1, depth: 0 },
  ])
  assert.equal(book.chapters[0].title, 'Kapitel Eins')
  assert.equal(book.chapters[2].title, '')
})

test('NCX fallback when no nav doc', async () => {
  const book = await parseEpub(await buildEpub({ withNav: false }), 'b1', opts)
  assert.deepEqual(book.toc.map(t => t.label), ['NCX Eins', 'NCX Zwei'])
})

test('DRM throws code=drm', async () => {
  const zip = new JSZip()
  zip.file('META-INF/container.xml', '<container/>')
  zip.file('META-INF/encryption.xml', '<encryption/>')
  const buf = await zip.generateAsync({ type: 'arraybuffer' })
  await assert.rejects(parseEpub(buf, 'b1', opts), (e) => e.code === 'drm')
})

test('MAX_EPUB_BYTES is 35 MiB', () => {
  assert.equal(MAX_EPUB_BYTES, 35 * 1024 * 1024)
})
```

- [ ] **Step 3: Run tests — expect FAIL (module not found)**

```bash
node --test src/lib/epub.test.js
```

- [ ] **Step 4: Implement `src/lib/epub.js`**

```js
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

function findByLocalName(root, name) {
  return [...root.getElementsByTagName('*')].filter(el => el.localName === name)
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
    } catch (e) {
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
      coverImageId = `${bookId}-cover`
      imagesByPath.set('__cover__' + entry, { id: coverImageId, blob: new Blob([await zip.file(entry).async('arraybuffer')]) })
    }
  }

  return {
    title, author, language, coverImageId,
    images: [...imagesByPath.values()],
    chapters, toc, warnings,
    stats: { spineTotal, imported: chapters.length },
  }
}
```

- [ ] **Step 5: Run tests — expect all PASS** (iterate here: linkedom's DOM is slightly stricter than browsers; adjust only implementation, not test expectations)

```bash
node --test src/lib/epub.test.js
```

- [ ] **Step 6: Run the whole lib test suite + build to make sure nothing broke**

```bash
node --test src/lib/readerText.test.js src/lib/epubPaths.test.js src/lib/epub.test.js src/lib/srs.test.js src/lib/sentenceSet.test.js
npm run build
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/epub.js src/lib/epub.test.js package.json package-lock.json
git commit -m "feat(reader): owned epub parser — lenient parsing, real TOC, rich blocks, images"
```

---

### Task 4: `readerDb.js` v2 — clean slate, images store, block-offset progress

**Files:**
- Rewrite: `src/lib/readerDb.js`

**Interfaces:**
- Produces: `saveBook(book, chapters, images)` (images `[{id, blob}]` → stored as `{id, bookId, blob}`); `getBooks()`; `getBook(id)`; `getChapterList(bookId) → [{id, index, title}]`; `getChapter(bookId, index)`; `getImage(id) → {id, bookId, blob} | undefined`; `deleteBook(id)` (also deletes its images); `updateProgress(bookId, chapterIndex, blockOffset)` (sets `lastChapterIndex`, `lastBlockOffset`, `lastReadAt`).
- Consumers (Tasks 5–9) rely on exactly these names.

- [ ] **Step 1: Rewrite `src/lib/readerDb.js`**

```js
const DB_NAME = 'wordy-reader'
const DB_VERSION = 2

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = e.target.result
      // v2 = clean slate (approved): the v1 flattened-text blocks cannot be
      // upgraded to rich blocks, so old stores are dropped and recreated.
      for (const name of ['books', 'chapters', 'images']) {
        if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name)
      }
      db.createObjectStore('books', { keyPath: 'id' })
      const cs = db.createObjectStore('chapters', { keyPath: 'id' })
      cs.createIndex('bookId', 'bookId', { unique: false })
      const is = db.createObjectStore('images', { keyPath: 'id' })
      is.createIndex('bookId', 'bookId', { unique: false })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function idbReq(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

function txDone(t) {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}

export async function saveBook(book, chapters, images = []) {
  const db = await openDb()
  const t = db.transaction(['books', 'chapters', 'images'], 'readwrite')
  t.objectStore('books').put(book)
  for (const ch of chapters) t.objectStore('chapters').put(ch)
  for (const img of images) t.objectStore('images').put({ id: img.id, bookId: book.id, blob: img.blob })
  return txDone(t)
}

export async function getBooks() {
  const db = await openDb()
  const all = await idbReq(db.transaction('books', 'readonly').objectStore('books').getAll())
  return all.sort((a, b) => (b.lastReadAt ?? b.addedAt) - (a.lastReadAt ?? a.addedAt))
}

export async function getBook(id) {
  const db = await openDb()
  return idbReq(db.transaction('books', 'readonly').objectStore('books').get(id))
}

export async function getChapterList(bookId) {
  const db = await openDb()
  const all = await idbReq(db.transaction('chapters', 'readonly').objectStore('chapters').index('bookId').getAll(bookId))
  return all.sort((a, b) => a.index - b.index).map(({ id, index, title }) => ({ id, index, title }))
}

export async function getChapter(bookId, index) {
  const db = await openDb()
  return idbReq(db.transaction('chapters', 'readonly').objectStore('chapters').get(`${bookId}-${index}`))
}

export async function getImage(id) {
  const db = await openDb()
  return idbReq(db.transaction('images', 'readonly').objectStore('images').get(id))
}

export async function deleteBook(id) {
  const db = await openDb()
  const chapters = await idbReq(db.transaction('chapters', 'readonly').objectStore('chapters').index('bookId').getAll(id))
  const images = await idbReq(db.transaction('images', 'readonly').objectStore('images').index('bookId').getAll(id))
  const t = db.transaction(['books', 'chapters', 'images'], 'readwrite')
  t.objectStore('books').delete(id)
  for (const ch of chapters) t.objectStore('chapters').delete(ch.id)
  for (const img of images) t.objectStore('images').delete(img.id)
  return txDone(t)
}

export async function updateProgress(bookId, chapterIndex, blockOffset = 0) {
  const db = await openDb()
  const t = db.transaction('books', 'readwrite')
  const store = t.objectStore('books')
  const book = await idbReq(store.get(bookId))
  if (book) {
    book.lastChapterIndex = chapterIndex
    book.lastBlockOffset = blockOffset
    book.lastReadAt = Date.now()
    store.put(book)
  }
  return txDone(t)
}
```

- [ ] **Step 2: Verify build (IndexedDB has no node tests — this is thin plumbing exercised by the corpus pass)**

```bash
npm run build
```

Expected: build passes. Note: `src/pages/Reader.jsx` still imports the old `saveBook(book, chapters)` 2-arg form — the 3rd param defaults to `[]`, and `updateProgress` keeps the same positional args, so the old page still compiles; it is deleted next task.

- [ ] **Step 3: Commit**

```bash
git add src/lib/readerDb.js
git commit -m "feat(reader): readerDb v2 — clean-slate stores, image blobs, block-offset progress"
```

---

### Task 5: Reader shell — Library + AddBookModal, route swap, delete old Reader

**Files:**
- Create: `src/pages/reader/index.jsx`, `src/pages/reader/Library.jsx`, `src/pages/reader/AddBookModal.jsx`
- Modify: `src/App.jsx:23` (`import Reader from './pages/reader'`)
- Delete: `src/pages/Reader.jsx`
- Modify: `package.json` (remove epubjs)

**Interfaces:**
- Consumes: `parseEpub`, `MAX_EPUB_BYTES` (`src/lib/epub.js`); `saveBook`, `getBooks`, `getImage`, `deleteBook` (`src/lib/readerDb.js`); `NavBar` (`src/components/NavBar.jsx`).
- Produces: default export `Reader` (route component); `Library({ onOpen })` calls `onOpen(book)` with a book record; `AddBookModal({ onClose, onSaved })`. Task 7 replaces the `ReadingView` placeholder created here.

- [ ] **Step 1: Create `src/pages/reader/index.jsx`**

```jsx
import { useState } from 'react'
import Library from './Library'
import ReadingView from './ReadingView'

export default function Reader() {
  const [book, setBook] = useState(null)
  return book
    ? <ReadingView book={book} onClose={() => setBook(null)} />
    : <Library onOpen={setBook} />
}
```

- [ ] **Step 2: Create a temporary `src/pages/reader/ReadingView.jsx` placeholder** (replaced in Task 7; exists so the build passes)

```jsx
export default function ReadingView({ book, onClose }) {
  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-4">
      <p className="text-gray-500">Reading view for "{book.title}" lands in Task 7.</p>
      <button onClick={onClose} className="px-4 py-2 rounded-2xl border border-gray-200 text-sm text-gray-500">← Library</button>
    </div>
  )
}
```

- [ ] **Step 3: Create `src/pages/reader/Library.jsx`**

```jsx
import { useState, useEffect } from 'react'
import { getBooks, getImage, deleteBook } from '../../lib/readerDb'
import { bookProgress } from '../../lib/pagination'
import NavBar from '../../components/NavBar'
import AddBookModal from './AddBookModal'

const COVER_COLORS = ['bg-indigo-600', 'bg-emerald-700', 'bg-rose-700', 'bg-amber-600', 'bg-sky-700', 'bg-violet-700']

function GeneratedCover({ title, author }) {
  let hash = 0
  for (const ch of title) hash = (hash * 31 + ch.codePointAt(0)) >>> 0
  return (
    <div className={`w-full h-full ${COVER_COLORS[hash % COVER_COLORS.length]} flex flex-col justify-between p-4`}>
      <p className="text-white font-bold leading-snug text-sm line-clamp-5" style={{ fontFamily: 'Georgia, serif' }}>{title}</p>
      {author && <p className="text-white/70 text-xs">{author}</p>}
    </div>
  )
}

export default function Library({ onOpen }) {
  const [books, setBooks] = useState([])
  const [covers, setCovers] = useState({})       // bookId → object URL
  const [showAdd, setShowAdd] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)

  async function load() { setBooks(await getBooks()) }
  useEffect(() => { load() }, [])

  useEffect(() => {
    let cancelled = false
    const urls = []
    async function loadCovers() {
      const next = {}
      for (const b of books) {
        if (!b.coverImageId) continue
        const rec = await getImage(b.coverImageId)
        if (rec?.blob) { const u = URL.createObjectURL(rec.blob); urls.push(u); next[b.id] = u }
      }
      if (!cancelled) setCovers(next)
    }
    loadCovers()
    return () => { cancelled = true; for (const u of urls) URL.revokeObjectURL(u) }
  }, [books])

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <NavBar />
      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Reader</h1>
            <p className="text-sm text-gray-400 mt-0.5">Tap any word to look it up and add it to your dictionary.</p>
          </div>
          <button onClick={() => setShowAdd(true)}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-sm font-semibold transition-colors">
            + Add book
          </button>
        </div>

        {books.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="text-5xl mb-4">📚</div>
            <p className="text-gray-500 font-medium mb-1">No books yet</p>
            <p className="text-gray-400 text-sm mb-6">Upload an epub or paste any text to start reading.</p>
            <button onClick={() => setShowAdd(true)}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-sm font-semibold transition-colors">
              Add your first book
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {books.map(book => {
              const pct = bookProgress(book.chapterBlockCounts ?? [], book.lastChapterIndex ?? 0, book.lastBlockOffset ?? 0)
              return (
                <div key={book.id} className="group flex flex-col">
                  <button onClick={() => onOpen(book)}
                    className="aspect-[2/3] w-full rounded-xl overflow-hidden shadow-md hover:shadow-xl transition-shadow bg-white border border-gray-100">
                    {covers[book.id]
                      ? <img src={covers[book.id]} alt={book.title} className="w-full h-full object-cover" />
                      : <GeneratedCover title={book.title} author={book.author} />}
                  </button>
                  <p className="mt-2 text-sm font-semibold text-gray-900 leading-snug line-clamp-2">{book.title}</p>
                  {book.author && <p className="text-xs text-gray-400 line-clamp-1">{book.author}</p>}
                  <div className="flex items-center justify-between mt-1">
                    <p className="text-xs text-gray-400">{book.lastReadAt ? `${pct}%` : 'Not started'}</p>
                    <button onClick={() => setConfirmDelete(book.id)}
                      className="text-xs text-gray-300 hover:text-red-400 transition-colors">Remove</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>

      {showAdd && <AddBookModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load() }} />}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="bg-white rounded-3xl shadow-2xl p-6 w-full max-w-sm text-center">
            <p className="font-semibold text-gray-900 mb-2">Remove this book?</p>
            <p className="text-sm text-gray-400 mb-6">It will be deleted from your browser. Words you added remain in your dictionary.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(null)}
                className="flex-1 py-2.5 rounded-2xl border border-gray-200 text-sm text-gray-500 hover:bg-gray-50">Cancel</button>
              <button onClick={async () => { await deleteBook(confirmDelete); setConfirmDelete(null); load() }}
                className="flex-1 py-2.5 rounded-2xl bg-red-500 hover:bg-red-600 text-white text-sm font-semibold">Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Create `src/lib/pagination.js` with `bookProgress` only** (the pagination math itself is Task 6 — but Library needs `bookProgress` now; Task 6 extends this file)

```js
// Pure reader math. Extended in the Paginator task with page arithmetic.

export function bookProgress(chapterBlockCounts, chapterIndex, blockOffset) {
  const total = chapterBlockCounts.reduce((a, b) => a + b, 0)
  if (total === 0) return 0
  const done = chapterBlockCounts.slice(0, chapterIndex).reduce((a, b) => a + b, 0) + blockOffset
  return Math.min(100, Math.round((done / total) * 100))
}
```

- [ ] **Step 5: Create `src/pages/reader/AddBookModal.jsx`**

```jsx
import { useState, useRef } from 'react'
import { parseEpub, MAX_EPUB_BYTES } from '../../lib/epub'
import { saveBook } from '../../lib/readerDb'

function genId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export default function AddBookModal({ onClose, onSaved }) {
  const [tab, setTab] = useState('epub')
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [status, setStatus] = useState('idle') // idle | parsing | saving | done | error
  const [report, setReport] = useState(null)   // { imported, spineTotal, warnings }
  const [errorMsg, setErrorMsg] = useState('')
  const fileRef = useRef(null)

  async function handleEpub(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setErrorMsg('')
    if (file.size > MAX_EPUB_BYTES) {
      setErrorMsg(`This file is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 35 MB.`)
      setStatus('error')
      return
    }
    setStatus('parsing')
    try {
      const bookId = genId()
      const parsed = await parseEpub(await file.arrayBuffer(), bookId)
      setStatus('saving')
      const book = {
        id: bookId, title: parsed.title, author: parsed.author, language: parsed.language,
        format: 'epub', coverImageId: parsed.coverImageId, toc: parsed.toc,
        chapterCount: parsed.chapters.length,
        chapterBlockCounts: parsed.chapters.map(c => c.blocks.length),
        addedAt: Date.now(), lastReadAt: null, lastChapterIndex: 0, lastBlockOffset: 0,
      }
      await saveBook(book, parsed.chapters, parsed.images)
      setReport({ imported: parsed.stats.imported, spineTotal: parsed.stats.spineTotal, warnings: parsed.warnings })
      setStatus('done')
    } catch (err) {
      setErrorMsg(err.code === 'drm'
        ? 'This book is DRM-protected and cannot be opened.'
        : (err.message ?? 'Failed to parse epub.'))
      setStatus('error')
    }
  }

  async function handleTextSave() {
    if (!text.trim() || !title.trim()) return
    setStatus('saving')
    try {
      const bookId = genId()
      const paragraphs = text.split(/\n{2,}/).map(p => p.replace(/\n/g, ' ').trim()).filter(Boolean)
      const blocks = paragraphs.map(p => ({ type: 'p', runs: [{ text: p }] }))
      const PARA_PER_CHAPTER = 50
      const chunkCount = Math.max(1, Math.ceil(blocks.length / PARA_PER_CHAPTER))
      const chapters = Array.from({ length: chunkCount }, (_, i) => ({
        id: `${bookId}-${i}`, bookId, index: i,
        title: chunkCount === 1 ? title.trim() : `Part ${i + 1}`,
        blocks: blocks.slice(i * PARA_PER_CHAPTER, (i + 1) * PARA_PER_CHAPTER),
      }))
      const book = {
        id: bookId, title: title.trim(), author: '', language: 'en',
        format: 'text', coverImageId: null,
        toc: chapters.map((c, i) => ({ label: c.title, chapterIndex: i, depth: 0 })),
        chapterCount: chapters.length,
        chapterBlockCounts: chapters.map(c => c.blocks.length),
        addedAt: Date.now(), lastReadAt: null, lastChapterIndex: 0, lastBlockOffset: 0,
      }
      await saveBook(book, chapters, [])
      onSaved()
    } catch (err) {
      setErrorMsg(err.message ?? 'Failed to save.')
      setStatus('error')
    }
  }

  const busy = status === 'parsing' || status === 'saving'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-gray-900">Add a book</h2>
          <button onClick={onClose} className="text-gray-300 hover:text-gray-600 text-xl">✕</button>
        </div>

        {status === 'done' && report ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-gray-700 font-medium">
              ✓ {report.imported === report.spineTotal
                ? `${report.imported} sections imported.`
                : `${report.imported} of ${report.spineTotal} sections imported.`}
            </p>
            {report.warnings.length > 0 && (
              <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-xs text-amber-800 flex flex-col gap-1">
                {report.warnings.slice(0, 5).map((w, i) => <p key={i}>{w}</p>)}
                {report.warnings.length > 5 && <p>…and {report.warnings.length - 5} more.</p>}
              </div>
            )}
            <button onClick={onSaved}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-semibold text-sm transition-colors">
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="flex rounded-xl border border-gray-200 overflow-hidden mb-5 text-sm font-semibold">
              {['epub', 'text'].map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className={`flex-1 py-2 transition-colors ${tab === t ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-700'}`}>
                  {t === 'epub' ? 'EPUB file' : 'Paste text'}
                </button>
              ))}
            </div>

            {tab === 'epub' && (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-gray-500">Upload an .epub file (up to 35 MB). Content is stored locally in your browser — never sent to our servers.</p>
                <input ref={fileRef} type="file" accept=".epub" className="hidden" onChange={handleEpub} />
                <button onClick={() => fileRef.current?.click()} disabled={busy}
                  className="w-full py-3 border-2 border-dashed border-gray-200 hover:border-indigo-300 rounded-2xl text-sm text-gray-400 hover:text-indigo-500 transition-colors disabled:opacity-50">
                  {busy ? (status === 'parsing' ? 'Parsing…' : 'Saving…') : 'Choose .epub file'}
                </button>
              </div>
            )}

            {tab === 'text' && (
              <div className="flex flex-col gap-3">
                <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title"
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-400" />
                <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Paste your text here…" rows={8}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:border-indigo-400" />
                <button onClick={handleTextSave} disabled={busy || !title.trim() || !text.trim()}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-200 disabled:cursor-not-allowed text-white rounded-2xl font-semibold text-sm transition-colors">
                  {busy ? 'Saving…' : 'Save'}
                </button>
              </div>
            )}

            {status === 'error' && <p className="mt-3 text-sm text-red-500">{errorMsg}</p>}
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Swap the route, delete the old page, drop epubjs**

In `src/App.jsx` line 23 change `import Reader from './pages/Reader'` → `import Reader from './pages/reader'` (the route element on line 73 is unchanged).

```bash
rm src/pages/Reader.jsx
npm uninstall epubjs
```

- [ ] **Step 7: Build + manual smoke test**

```bash
npm run build
```

Expected: build passes with epubjs gone. Then `npm run dev`, open `/reader`: library is empty (clean slate). Import `~/Desktop/books/Carrie_by_Stephen_King.epub` → report shows sections imported, library shows a real cover, opening it shows the Task-7 placeholder.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(reader): new shell — bookshelf library with covers, honest epub import, epubjs removed"
```

---

### Task 6: Pagination math + `Block.jsx` + `Paginator.jsx`

**Files:**
- Modify: `src/lib/pagination.js` (add page math)
- Create: `src/lib/pagination.test.js`, `src/pages/reader/Block.jsx`, `src/pages/reader/Paginator.jsx`

**Interfaces:**
- Consumes: `tokenize`, `getSentence`, `blockPlainText`, `normalizeWordForm` (`src/lib/readerText.js`).
- Produces in `pagination.js`: `pageCount(scrollWidth, pageWidth, gap)`; `pageOffset(page, pageWidth, gap)`; `pageOfOffsetLeft(offsetLeft, pageWidth, gap)`; `clampPage(page, count)`; `tocLabelFor(toc, chapterIndex)` (label of last toc entry with `chapterIndex <= current`, `''` if none); `bookProgress` (already present).
- Produces `Block({ block, imageSrc, onWordTap, highlighted, knownWords })` — `imageSrc` = string URL for `block.imageId` (or undefined); word spans call `onWordTap(word, sentence)` and `stopPropagation`.
- Produces `Paginator` (forwardRef): props `{ blocks, imageSrcs, typography: { step, serif }, lang, page, anchorBlock, onMeasure, onAnchorResolve, onWordTap, highlighted, knownWords }`; ref method `firstBlockOfPage(page) → blockIndex`; constants `FONT_SIZES = [16, 17, 18, 20, 22]`, `COLUMN_GAP = 56` exported.

- [ ] **Step 1: Write failing tests for the math**

`src/lib/pagination.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pageCount, pageOffset, pageOfOffsetLeft, clampPage, bookProgress, tocLabelFor } from './pagination.js'

test('pageCount from scrollWidth', () => {
  // 3 columns of 600 + 2 gaps of 56 → scrollWidth 1912
  assert.equal(pageCount(1912, 600, 56), 3)
  assert.equal(pageCount(600, 600, 56), 1)
  assert.equal(pageCount(0, 600, 56), 1)
  assert.equal(pageCount(500, 0, 56), 1)
})

test('pageOffset and pageOfOffsetLeft are inverse', () => {
  assert.equal(pageOffset(2, 600, 56), 1312)
  assert.equal(pageOfOffsetLeft(1312, 600, 56), 2)
  assert.equal(pageOfOffsetLeft(1300, 600, 56), 2) // near-page offsets round
})

test('clampPage', () => {
  assert.equal(clampPage(-1, 3), 0)
  assert.equal(clampPage(5, 3), 2)
  assert.equal(clampPage(1, 3), 1)
})

test('bookProgress percent across chapters', () => {
  assert.equal(bookProgress([10, 10, 20], 1, 10), 50)
  assert.equal(bookProgress([], 0, 0), 0)
  assert.equal(bookProgress([10], 0, 0), 0)
})

test('tocLabelFor picks last entry at or before chapter', () => {
  const toc = [
    { label: 'One', chapterIndex: 0, depth: 0 },
    { label: 'Two', chapterIndex: 2, depth: 0 },
  ]
  assert.equal(tocLabelFor(toc, 0), 'One')
  assert.equal(tocLabelFor(toc, 1), 'One')  // continuation file
  assert.equal(tocLabelFor(toc, 3), 'Two')
  assert.equal(tocLabelFor([], 0), '')
})
```

- [ ] **Step 2: Run tests — expect FAIL on the new functions**

```bash
node --test src/lib/pagination.test.js
```

- [ ] **Step 3: Extend `src/lib/pagination.js`**

Append to the existing file (keep `bookProgress`):

```js
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
```

- [ ] **Step 4: Run tests — expect all PASS**

```bash
node --test src/lib/pagination.test.js
```

- [ ] **Step 5: Create `src/pages/reader/Block.jsx`**

```jsx
import { tokenize, getSentence, blockPlainText, normalizeWordForm } from '../../lib/readerText'

const BLOCK_CLASSES = {
  h1: 'text-2xl font-bold text-center mt-10 mb-6 [text-align:center]',
  h2: 'text-xl font-bold text-center mt-8 mb-4 [text-align:center]',
  h3: 'text-lg font-semibold mt-6 mb-3',
  h4: 'text-base font-semibold mt-5 mb-2',
  h5: 'text-base font-semibold mt-4 mb-2',
  h6: 'text-base font-semibold mt-4 mb-2',
  blockquote: 'pl-5 border-l-2 border-gray-300 my-4 text-gray-600',
  figcaption: 'text-center text-sm text-gray-500 my-2 [text-align:center]',
  verse: 'my-4 pl-4',
  p: 'mb-4',
}

function WordSpans({ text, plain, onWordTap, highlighted, knownWords }) {
  return tokenize(text).map(token =>
    token.isWord ? (
      <span
        key={token.key}
        onClick={(e) => { e.stopPropagation(); onWordTap(token.text, getSentence(plain, token.text)) }}
        className={`cursor-pointer rounded px-0.5 transition-colors select-none
          ${highlighted === token.text.toLowerCase()
            ? 'bg-yellow-200 text-gray-900'
            : knownWords?.has(normalizeWordForm(token.text))
            ? 'bg-indigo-50 text-indigo-800 hover:bg-yellow-100'
            : 'hover:bg-yellow-100'}`}
      >
        {token.text}
      </span>
    ) : (
      <span key={token.key}>{token.text}</span>
    )
  )
}

function Runs({ runs, plain, onWordTap, highlighted, knownWords }) {
  return runs.map((run, i) => {
    if (run.br) return <br key={i} />
    let node = <WordSpans text={run.text} plain={plain} onWordTap={onWordTap} highlighted={highlighted} knownWords={knownWords} />
    if (run.sup) return <sup key={i} className="text-xs text-gray-400 select-none">{run.text}</sup>
    if (run.em) node = <em key={i}>{node}</em>
    if (run.strong) node = <strong key={run.em ? `s${i}` : i}>{node}</strong>
    return run.em || run.strong ? node : <span key={i}>{node}</span>
  })
}

export default function Block({ block, imageSrc, onWordTap, highlighted, knownWords }) {
  if (block.type === 'hr') {
    return <div className="text-center text-gray-400 my-8 select-none tracking-[1em] [text-align:center]">✳</div>
  }
  if (block.type === 'image') {
    return (
      <div className="my-6 flex justify-center" style={{ breakInside: 'avoid' }}>
        {imageSrc
          ? <img src={imageSrc} alt={block.alt} className="max-w-full rounded" style={{ maxHeight: '70vh', objectFit: 'contain' }} />
          : <span className="text-xs text-gray-300">[image]</span>}
      </div>
    )
  }

  const plain = blockPlainText(block)
  const inner = <Runs runs={block.runs} plain={plain} onWordTap={onWordTap} highlighted={highlighted} knownWords={knownWords} />

  if (block.type === 'li') {
    return (
      <div className="flex gap-2 mb-1.5 ml-4">
        <span className="select-none text-gray-500 shrink-0">{block.listType === 'ol' ? `${block.listIndex}.` : '•'}</span>
        <span>{inner}</span>
      </div>
    )
  }

  const Tag = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote'].includes(block.type) ? block.type : 'p'
  const indent = block.quoteDepth ? { marginLeft: block.quoteDepth * 16 } : undefined
  return <Tag className={BLOCK_CLASSES[block.type] ?? BLOCK_CLASSES.p} style={indent}>{inner}</Tag>
}
```

- [ ] **Step 6: Create `src/pages/reader/Paginator.jsx`**

```jsx
import { useState, useRef, useLayoutEffect, useEffect, forwardRef, useImperativeHandle } from 'react'
import { pageCount, pageOffset, pageOfOffsetLeft, clampPage } from '../../lib/pagination'
import Block from './Block'

export const FONT_SIZES = [16, 17, 18, 20, 22]
export const COLUMN_GAP = 56
const SERIF = 'Georgia, "Times New Roman", serif'

const Paginator = forwardRef(function Paginator(
  { blocks, imageSrcs, typography, lang, page, anchorBlock, onMeasure, onAnchorResolve, onWordTap, highlighted, knownWords },
  ref
) {
  const viewportRef = useRef(null)
  const contentRef = useRef(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const countRef = useRef(1)

  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  function blockPage(blockIndex, w) {
    const el = contentRef.current?.querySelector(`[data-bi="${blockIndex}"]`)
    if (!el) return 0
    return pageOfOffsetLeft(el.offsetLeft, w, COLUMN_GAP)
  }

  // re-measure page count whenever layout inputs change
  useLayoutEffect(() => {
    if (!contentRef.current || size.w === 0) return
    const count = pageCount(contentRef.current.scrollWidth, size.w, COLUMN_GAP)
    countRef.current = count
    onMeasure(count)
    if (anchorBlock != null) {
      onAnchorResolve(clampPage(blockPage(anchorBlock, size.w), count))
    }
  }, [blocks, size, typography.step, typography.serif]) // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    firstBlockOfPage(p) {
      const els = contentRef.current?.querySelectorAll('[data-bi]') ?? []
      for (const el of els) {
        if (pageOfOffsetLeft(el.offsetLeft, size.w, COLUMN_GAP) >= p) return Number(el.dataset.bi)
      }
      return 0
    },
  }), [size])

  if (size.w === 0) return <div ref={viewportRef} className="flex-1 overflow-hidden" />

  return (
    <div ref={viewportRef} className="flex-1 overflow-hidden">
      <div
        ref={contentRef}
        lang={lang}
        className="text-gray-800"
        style={{
          columnWidth: size.w, columnGap: COLUMN_GAP, columnFill: 'auto',
          width: size.w, height: size.h,
          fontSize: FONT_SIZES[typography.step] ?? FONT_SIZES[2],
          fontFamily: typography.serif ? SERIF : 'inherit',
          lineHeight: 1.7, textAlign: 'justify',
          hyphens: 'auto', WebkitHyphens: 'auto',
          transform: `translateX(-${pageOffset(page, size.w, COLUMN_GAP)}px)`,
          transition: 'transform 200ms ease-out',
        }}
      >
        {blocks.map((block, i) => (
          <div key={i} data-bi={i}>
            <Block block={block} imageSrc={block.imageId ? imageSrcs[block.imageId] : undefined}
              onWordTap={onWordTap} highlighted={highlighted} knownWords={knownWords} />
          </div>
        ))}
      </div>
    </div>
  )
})

export default Paginator
```

Note: each block is wrapped in `<div data-bi>` so `firstBlockOfPage`/anchoring can measure `offsetLeft` per block. `columnFill: 'auto'` is required — without it columns balance heights instead of filling pages.

- [ ] **Step 7: Build**

```bash
npm run build
```

Expected: passes (Paginator/Block are not yet imported by ReadingView — the build checks them in Task 7; this build just confirms nothing else broke).

- [ ] **Step 8: Commit**

```bash
git add src/lib/pagination.js src/lib/pagination.test.js src/pages/reader/Block.jsx src/pages/reader/Paginator.jsx
git commit -m "feat(reader): CSS-column paginator + rich block renderer + page math"
```

---

### Task 7: `ReadingView.jsx` — chrome, tap zones, chapter flow, persistence

**Files:**
- Rewrite: `src/pages/reader/ReadingView.jsx` (replaces Task 5 placeholder)

**Interfaces:**
- Consumes: `Paginator` (+ `FONT_SIZES` via AaMenu later), `Block` (indirect); `getChapter`, `getImage`, `updateProgress` (`readerDb`); `bookProgress`, `tocLabelFor`, `clampPage` (`pagination`); `WordPopup` (Task 8 — this task wires a no-op `onWordTap`; word taps do nothing until Task 8).
- Produces: `ReadingView({ book, onClose })`; internal state contract used by Tasks 8–9: `aa` state `{ step, serif }` persisted under localStorage key `wordy-reader-aa`; `tocOpen`/`aaOpen` booleans; `jumpToChapter(chapterIndex)` resets page to 0 and clears anchor.

- [ ] **Step 1: Rewrite `src/pages/reader/ReadingView.jsx`**

```jsx
import { useState, useEffect, useRef, useCallback } from 'react'
import { getChapter, getImage, updateProgress } from '../../lib/readerDb'
import { bookProgress, tocLabelFor, clampPage } from '../../lib/pagination'
import Paginator from './Paginator'

const AA_KEY = 'wordy-reader-aa'

function loadAa() {
  try {
    const raw = JSON.parse(localStorage.getItem(AA_KEY) ?? '{}')
    return { step: raw.step ?? 2, serif: raw.serif ?? true }
  } catch { return { step: 2, serif: true } }
}

export default function ReadingView({ book, onClose }) {
  const [chapterIndex, setChapterIndex] = useState(book.lastChapterIndex ?? 0)
  const [chapter, setChapter] = useState(null)
  const [page, setPage] = useState(0)
  const [pages, setPages] = useState(1)
  const [anchorBlock, setAnchorBlock] = useState(book.lastBlockOffset ?? 0)
  const [imageSrcs, setImageSrcs] = useState({})
  const [aa, setAa] = useState(loadAa)
  const [tocOpen, setTocOpen] = useState(false)
  const [aaOpen, setAaOpen] = useState(false)
  const paginatorRef = useRef(null)
  const pendingLastPage = useRef(false)

  useEffect(() => { localStorage.setItem(AA_KEY, JSON.stringify(aa)) }, [aa])

  // load chapter + its image blobs
  useEffect(() => {
    let cancelled = false
    const urls = []
    async function load() {
      const ch = await getChapter(book.id, chapterIndex)
      if (cancelled || !ch) return
      const srcs = {}
      for (const b of ch.blocks) {
        if (b.type === 'image' && b.imageId && !srcs[b.imageId]) {
          const rec = await getImage(b.imageId)
          if (rec?.blob) { const u = URL.createObjectURL(rec.blob); urls.push(u); srcs[b.imageId] = u }
        }
      }
      if (cancelled) { for (const u of urls) URL.revokeObjectURL(u); return }
      setImageSrcs(srcs)
      setChapter(ch)
    }
    load()
    return () => { cancelled = true; for (const u of urls) URL.revokeObjectURL(u) }
  }, [book.id, chapterIndex])

  const handleMeasure = useCallback((count) => {
    setPages(count)
    if (pendingLastPage.current) { pendingLastPage.current = false; setPage(count - 1) }
    else setPage(p => clampPage(p, count))
  }, [])

  const handleAnchorResolve = useCallback((p) => { setPage(p); setAnchorBlock(null) }, [])

  // persist position (block offset survives reflow; page numbers do not)
  useEffect(() => {
    if (!chapter) return
    const blockOffset = paginatorRef.current?.firstBlockOfPage(page) ?? 0
    updateProgress(book.id, chapterIndex, blockOffset)
  }, [book.id, chapter, chapterIndex, page])

  function nextPage() {
    if (page < pages - 1) setPage(page + 1)
    else if (chapterIndex < book.chapterCount - 1) { setAnchorBlock(null); setChapter(null); setPage(0); setChapterIndex(chapterIndex + 1) }
  }

  function prevPage() {
    if (page > 0) setPage(page - 1)
    else if (chapterIndex > 0) { setAnchorBlock(null); setChapter(null); pendingLastPage.current = true; setChapterIndex(chapterIndex - 1) }
  }

  function jumpToChapter(i) {
    setTocOpen(false)
    if (i === chapterIndex) return
    setAnchorBlock(null); setChapter(null); setPage(0); setChapterIndex(i)
  }

  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextPage()
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') prevPage()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function handlePageClick(e) {
    if (tocOpen || aaOpen) { setTocOpen(false); setAaOpen(false); return }
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    if (x < 0.2) prevPage()
    else if (x > 0.8) nextPage()
  }

  // Task 8 wires the real word popup; until then taps are inert
  const handleWordTap = useCallback(() => {}, [])

  const pct = bookProgress(book.chapterBlockCounts ?? [], chapterIndex,
    paginatorRef.current?.firstBlockOfPage(page) ?? 0)
  const chapterLabel = tocLabelFor(book.toc ?? [], chapterIndex) || chapter?.title || `Chapter ${chapterIndex + 1}`

  return (
    <div className="h-screen bg-white flex flex-col overflow-hidden">
      <nav className="border-b border-gray-100 px-4 py-2.5 flex items-center justify-between gap-3 shrink-0">
        <button onClick={onClose} className="text-sm text-gray-400 hover:text-gray-700 transition-colors shrink-0">← Library</button>
        <div className="flex flex-col items-center min-w-0">
          <span className="text-sm font-semibold text-gray-800 truncate max-w-[220px]">{book.title}</span>
          <span className="text-xs text-gray-400 truncate max-w-[220px]">{chapterLabel}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => { setAaOpen(false); setTocOpen(o => !o) }} title="Contents"
            className="px-2.5 py-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50 text-base">☰</button>
          <button onClick={() => { setTocOpen(false); setAaOpen(o => !o) }} title="Typography"
            className="px-2.5 py-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50 text-sm font-semibold">Aa</button>
        </div>
      </nav>

      <div className="flex-1 flex flex-col min-h-0 max-w-3xl w-full mx-auto px-8 py-6 cursor-default" onClick={handlePageClick}>
        {chapter ? (
          <Paginator
            ref={paginatorRef}
            blocks={chapter.blocks}
            imageSrcs={imageSrcs}
            typography={aa}
            lang={book.language ?? 'en'}
            page={page}
            anchorBlock={anchorBlock}
            onMeasure={handleMeasure}
            onAnchorResolve={handleAnchorResolve}
            onWordTap={handleWordTap}
            highlighted={null}
            knownWords={null}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex gap-1">
              <span className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce [animation-delay:0ms]" />
              <span className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 px-8 pb-3 pt-1 max-w-3xl w-full mx-auto flex items-center justify-between text-xs text-gray-400">
        <span>{`page ${page + 1} of ${pages} in chapter`}</span>
        <span>{`${pct}%`}</span>
      </div>

      {/* TocDrawer and AaMenu mount here in Task 9 */}
    </div>
  )
}
```

- [ ] **Step 2: Build + manual verification with a corpus book**

```bash
npm run build && npm run dev
```

Open `/reader`, open the imported *Carrie*: true pages fill the viewport with no scrolling; edge clicks and arrow keys flip pages; page turns cross chapter boundaries both directions (prev from page 0 lands on the previous chapter's LAST page); position survives closing/reopening the book; italics/bold render; window resize reflows and keeps roughly the same spot; bottom bar shows page-in-chapter and %.

- [ ] **Step 3: Commit**

```bash
git add src/pages/reader/ReadingView.jsx
git commit -m "feat(reader): paged reading view — tap zones, keys, chapter flow, position persistence"
```

---

### Task 8: `WordPopup.jsx` + word lookup/add + known-word highlighting

**Files:**
- Create: `src/pages/reader/WordPopup.jsx`
- Modify: `src/pages/reader/ReadingView.jsx` (wire popup, lookup, knownWords)

**Interfaces:**
- Consumes: `identifyWord` (`src/lib/claude.js` — signature `identifyWord(word, targetLanguageName, translationLang, sentence, { topics })`); `supabase` (`src/lib/supabase.js`); `useAuth` (`src/lib/AuthContext.jsx`); `useLanguage` (`src/lib/i18n.jsx`); `useTargetLang` (`src/lib/TargetLangContext.jsx`); `displayTranslation` (`src/lib/senseDisplay.js`); `normalizeWordForm` (`src/lib/readerText.js`).
- Produces: `WordPopup({ tapped, lookup, onAdd, onClose, adding })` — behavior identical to the pre-overhaul Reader popup.

- [ ] **Step 1: Create `src/pages/reader/WordPopup.jsx`** — verbatim port of the old popup (constants + component), imports adjusted:

```jsx
import { useRef, useEffect } from 'react'
import { displayTranslation } from '../../lib/senseDisplay'

const POS_STYLES = {
  noun:        { label: 'noun',   className: 'bg-blue-50 text-blue-600 border border-blue-100' },
  verb:        { label: 'verb',   className: 'bg-green-50 text-green-700 border border-green-100' },
  adjective:   { label: 'adj.',   className: 'bg-purple-50 text-purple-700 border border-purple-100' },
  adverb:      { label: 'adv.',   className: 'bg-pink-50 text-pink-700 border border-pink-100' },
  preposition: { label: 'prep.',  className: 'bg-orange-50 text-orange-700 border border-orange-100' },
  conjunction: { label: 'conj.',  className: 'bg-teal-50 text-teal-700 border border-teal-100' },
}

const STAGE_LABELS = { new: 'new', early: 'early', mid: 'mid', late: 'late', known: 'known', mastered: 'mastered' }
const STAGE_COLORS = {
  new: 'bg-gray-100 text-gray-500',
  early: 'bg-yellow-50 text-yellow-700',
  mid: 'bg-yellow-100 text-yellow-800',
  late: 'bg-orange-50 text-orange-700',
  known: 'bg-green-50 text-green-700',
  mastered: 'bg-indigo-50 text-indigo-700',
}

export default function WordPopup({ tapped, lookup, onAdd, onClose, adding }) {
  const popupRef = useRef(null)

  useEffect(() => {
    function handleOutside(e) {
      if (popupRef.current && !popupRef.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [onClose])

  const sense = lookup?.result?.senses?.[0]
  const pos = sense ? (POS_STYLES[sense.pos] ?? POS_STYLES.preposition) : null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center pointer-events-none">
      <div ref={popupRef}
        className="pointer-events-auto w-full max-w-2xl bg-white rounded-t-3xl shadow-2xl border border-gray-100 px-6 py-5 pb-8 animate-slide-up">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs text-gray-400 truncate max-w-[80%] italic">"{tapped.sentence}"</p>
          <button onClick={onClose} className="text-gray-300 hover:text-gray-600 text-xl ml-3 shrink-0">✕</button>
        </div>

        {lookup?.status === 'loading' && (
          <div className="flex items-center gap-3 py-4">
            <div className="flex gap-1">
              <span className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce [animation-delay:0ms]" />
              <span className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce [animation-delay:300ms]" />
            </div>
            <span className="text-sm text-gray-400">Identifying <strong>{tapped.word}</strong>…</span>
          </div>
        )}

        {lookup?.status === 'error' && (
          <div className="py-4 text-sm text-red-500">Could not identify this word. Try again.</div>
        )}

        {(lookup?.status === 'ready' || lookup?.status === 'added') && sense && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-2xl font-bold text-gray-900">{lookup.result.word}</span>
              {pos && <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${pos.className}`}>{pos.label}</span>}
              {sense.cefr && <span className="text-xs font-bold px-2 py-0.5 rounded bg-indigo-600 text-white">{sense.cefr}</span>}
              {sense.register && sense.register !== 'neutral' && (
                <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-500 capitalize">{sense.register}</span>
              )}
            </div>

            <p className="text-lg text-gray-700 font-medium">{displayTranslation(sense.translation)}</p>

            {sense.grammarNote && !/^(countable|uncountable) noun/i.test(sense.grammarNote) && (
              <div className={`rounded-xl px-3 py-2 text-xs font-medium flex items-start gap-2 ${
                sense.isException ? 'bg-amber-50 text-amber-800 border border-amber-100' : 'bg-indigo-50 text-indigo-800 border border-indigo-100'
              }`}>
                <span>{sense.isException ? '⚠️' : 'ℹ️'}</span>
                <span>{sense.grammarNote}</span>
              </div>
            )}

            {sense.examples?.[0] && (
              <div className="bg-gray-50 rounded-xl px-4 py-3">
                <p className="text-sm text-gray-700 italic">"{sense.examples[0].target}"</p>
                <p className="text-xs text-gray-400 mt-1">{sense.examples[0].translation}</p>
              </div>
            )}

            {lookup.existing ? (
              <div className="flex items-center gap-2 py-2">
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${STAGE_COLORS[lookup.existing.stage] ?? STAGE_COLORS.new}`}>
                  {STAGE_LABELS[lookup.existing.stage] ?? lookup.existing.stage}
                </span>
                <span className="text-sm text-gray-400">Already in your dictionary</span>
              </div>
            ) : lookup.status === 'added' ? (
              <div className="flex items-center gap-2 py-2">
                <span className="text-green-600 font-semibold text-sm">✓ Added to dictionary</span>
              </div>
            ) : (
              <button onClick={onAdd} disabled={adding}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded-2xl font-semibold text-sm transition-colors">
                {adding ? 'Adding…' : '+ Add to dictionary'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire lookup/add/knownWords into `ReadingView.jsx`** — port the old page's logic verbatim, adjusted names. Add imports:

```jsx
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { useLanguage } from '../../lib/i18n'
import { useTargetLang } from '../../lib/TargetLangContext'
import { identifyWord } from '../../lib/claude'
import { normalizeWordForm } from '../../lib/readerText'
import WordPopup from './WordPopup'
```

Inside the component add (replacing the inert `handleWordTap`):

```jsx
  const { user, profile } = useAuth()
  const { lang } = useLanguage()
  const { targetLang, targetLanguageName } = useTargetLang()
  const interfaceLanguage = lang === 'uk' ? 'Ukrainian' : 'English'
  const [translationLang, setTranslationLang] = useState(interfaceLanguage)
  const [knownWords, setKnownWords] = useState(new Set())
  const [popup, setPopup] = useState(null)
  const [lookup, setLookup] = useState(null)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    if (!user) return
    supabase.from('word_senses').select('word_form')
      .eq('user_id', user.id).eq('target_language', targetLang)
      .then(({ data }) => { if (data) setKnownWords(new Set(data.map(r => normalizeWordForm(r.word_form)))) })
  }, [user, targetLang])

  const handleWordTap = useCallback(async (word, sentence) => {
    setPopup({ word, sentence })
    setLookup({ status: 'loading' })
    try {
      const result = await identifyWord(word, targetLanguageName, translationLang, sentence, { topics: profile?.topics ?? [] })
      if (!result.senses?.length) throw new Error('No senses returned')
      const { data: existing } = await supabase.from('words')
        .select('id, word, status').eq('user_id', user.id)
        .eq('target_language', targetLang).ilike('word', result.word).maybeSingle()
      const existingStage = existing
        ? await supabase.from('word_senses').select('learning_stage').eq('word_id', existing.id).limit(1).maybeSingle()
            .then(r => r.data?.learning_stage ?? 'new')
        : null
      setLookup({
        status: 'ready', result,
        existing: existing ? { id: existing.id, word: existing.word, stage: existingStage } : null,
      })
    } catch {
      setLookup({ status: 'error' })
    }
  }, [targetLanguageName, translationLang, targetLang, user, profile])

  async function handleAddWord() {
    if (!lookup?.result || !popup) return
    setAdding(true)
    const result = lookup.result
    const primary = result.senses[0]
    try {
      const { data: newWord } = await supabase.from('words').insert({
        user_id: user.id, word: result.word, translation: primary.translation,
        pos: primary.pos, form: primary.form || null, grammar_note: primary.grammarNote || null,
        explanation: primary.explanation || null, is_exception: primary.isException || false,
        conjugation: primary.conjugation || null, entry_type: result.entryType, status: 'new',
        date_added: new Date().toISOString().split('T')[0],
        target_language: targetLang, context_sentence: popup.sentence,
      }).select('id').single()

      // Reader adds the word as used in this sentence — save only the contextual sense.
      if (newWord?.id && primary) {
        await supabase.from('word_senses').insert([primary].map(s => ({
          word_id: newWord.id, user_id: user.id, target_language: targetLang,
          pos: s.pos, word_form: s.wordForm || result.word,
          aspect: s.aspect ?? null, gender: s.gender ?? null,
          translation: s.translation, form: s.form || null,
          grammar_note: s.grammarNote || null, explanation: s.explanation || null,
          is_exception: s.isException || false, register: s.register || 'neutral',
          cefr: s.cefr || null, conjugation: s.conjugation || null,
          examples: s.examples || [], learning_stage: 'new', correct_recall_count: 0,
        })))
      }

      setLookup(prev => ({ ...prev, status: 'added' }))
      setKnownWords(prev => {
        const next = new Set(prev)
        next.add(normalizeWordForm(primary.wordForm || result.word))
        next.add(normalizeWordForm(result.word))
        next.add(normalizeWordForm(popup.word))
        return next
      })
    } catch (e) {
      console.error('Add word error:', e)
    }
    setAdding(false)
  }
```

Pass real values to the Paginator: `onWordTap={handleWordTap}`, `highlighted={popup?.word?.toLowerCase() ?? null}`, `knownWords={knownWords}`. Close the popup on page turns — add `setPopup(null); setLookup(null)` at the top of `nextPage` and `prevPage`. Add the EN/UA translate toggle to the top nav (between the title and ☰):

```jsx
        <div className="flex rounded-full border border-gray-200 overflow-hidden text-xs font-semibold shrink-0">
          {[{ code: 'English', label: 'EN' }, { code: 'Ukrainian', label: 'UA' }].map(({ code, label }) => (
            <button key={code} onClick={() => setTranslationLang(code)}
              className={`px-2.5 py-1 transition-colors ${translationLang === code ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-700'}`}>
              {label}
            </button>
          ))}
        </div>
```

And render the popup before the closing `</div>` of the root:

```jsx
      {popup && lookup && (
        <WordPopup tapped={popup} lookup={lookup} adding={adding}
          onAdd={handleAddWord} onClose={() => { setPopup(null); setLookup(null) }} />
      )}
```

- [ ] **Step 3: Build + manual verification**

```bash
npm run build && npm run dev
```

In an open book: tap a word mid-page → popup identifies it with the containing sentence; add to dictionary → "✓ Added", word gets the indigo known-highlight everywhere; tapping a word does NOT flip the page (stopPropagation); already-known words show their stage pill; EN/UA toggle changes the translation language of the next lookup.

- [ ] **Step 4: Commit**

```bash
git add src/pages/reader/WordPopup.jsx src/pages/reader/ReadingView.jsx
git commit -m "feat(reader): word lookup popup + known-word highlighting in paged view"
```

---

### Task 9: `TocDrawer.jsx` + `AaMenu.jsx`

**Files:**
- Create: `src/pages/reader/TocDrawer.jsx`, `src/pages/reader/AaMenu.jsx`
- Modify: `src/pages/reader/ReadingView.jsx` (mount both; wire `jumpToChapter`)

**Interfaces:**
- Consumes: `FONT_SIZES` from `./Paginator`; ReadingView state from Task 7 (`aa`, `setAa`, `tocOpen`, `aaOpen`, `jumpToChapter`, `book.toc`, `chapterIndex`).
- Produces: `TocDrawer({ toc, currentChapter, onJump, onClose })`; `AaMenu({ aa, onChange, onClose })` where `onChange` receives the whole next `{step, serif}` object.

- [ ] **Step 1: Create `src/pages/reader/TocDrawer.jsx`**

```jsx
export default function TocDrawer({ toc, currentChapter, onJump, onClose }) {
  return (
    <div className="fixed inset-0 z-40" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20" />
      <aside
        onClick={e => e.stopPropagation()}
        className="absolute right-0 top-0 h-full w-80 max-w-[85vw] bg-white shadow-2xl flex flex-col animate-slide-up">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-bold text-gray-900 text-sm">Contents</h2>
          <button onClick={onClose} className="text-gray-300 hover:text-gray-600 text-xl">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {toc.map((entry, i) => {
            const active = entry.chapterIndex === currentChapter
            return (
              <button key={i} onClick={() => onJump(entry.chapterIndex)}
                style={{ paddingLeft: 20 + entry.depth * 16 }}
                className={`w-full text-left pr-5 py-2.5 text-sm leading-snug transition-colors ${
                  active ? 'text-indigo-700 font-semibold bg-indigo-50' : 'text-gray-600 hover:bg-gray-50'
                }`}>
                {entry.label}
              </button>
            )
          })}
        </div>
      </aside>
    </div>
  )
}
```

- [ ] **Step 2: Create `src/pages/reader/AaMenu.jsx`**

```jsx
import { FONT_SIZES } from './Paginator'

export default function AaMenu({ aa, onChange, onClose }) {
  return (
    <div className="fixed inset-0 z-40" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="absolute right-4 top-14 w-64 bg-white rounded-2xl shadow-2xl border border-gray-100 p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400 font-medium">Font size</span>
          <div className="flex items-center gap-2">
            <button onClick={() => onChange({ ...aa, step: Math.max(0, aa.step - 1) })} disabled={aa.step === 0}
              className="w-9 h-9 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-30">A</button>
            <span className="text-xs text-gray-400 w-8 text-center">{FONT_SIZES[aa.step]}px</span>
            <button onClick={() => onChange({ ...aa, step: Math.min(FONT_SIZES.length - 1, aa.step + 1) })}
              disabled={aa.step === FONT_SIZES.length - 1}
              className="w-9 h-9 rounded-xl border border-gray-200 text-lg text-gray-600 hover:bg-gray-50 disabled:opacity-30">A</button>
          </div>
        </div>
        <div className="flex rounded-xl border border-gray-200 overflow-hidden text-sm font-semibold">
          <button onClick={() => onChange({ ...aa, serif: true })}
            className={`flex-1 py-2 ${aa.serif ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-700'}`}
            style={{ fontFamily: 'Georgia, serif' }}>Serif</button>
          <button onClick={() => onChange({ ...aa, serif: false })}
            className={`flex-1 py-2 ${!aa.serif ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-700'}`}>Sans</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Mount both in `ReadingView.jsx`** — replace the `{/* TocDrawer and AaMenu mount here in Task 9 */}` comment with:

```jsx
      {tocOpen && (
        <TocDrawer toc={book.toc ?? []} currentChapter={chapterIndex}
          onJump={jumpToChapter} onClose={() => setTocOpen(false)} />
      )}
      {aaOpen && (
        <AaMenu aa={aa} onClose={() => setAaOpen(false)}
          onChange={(next) => {
            // capture the current position BEFORE reflow so the new layout re-anchors to it
            setAnchorBlock(paginatorRef.current?.firstBlockOfPage(page) ?? 0)
            setAa(next)
          }} />
      )}
```

Add imports `import TocDrawer from './TocDrawer'` and `import AaMenu from './AaMenu'`. When jumping while the popup is open, also clear it: add `setPopup(null); setLookup(null)` at the top of `jumpToChapter`.

- [ ] **Step 4: Build + manual verification**

```bash
npm run build && npm run dev
```

☰ opens the drawer with the book's real nested TOC, current chapter highlighted, tap → jumps, backdrop closes. Aa: size steps reflow pages instantly and the reading position (first block) is preserved; serif/sans toggles; settings survive a reload (localStorage).

- [ ] **Step 5: Commit**

```bash
git add src/pages/reader/TocDrawer.jsx src/pages/reader/AaMenu.jsx src/pages/reader/ReadingView.jsx
git commit -m "feat(reader): contents drawer + Aa typography menu"
```

---

### Task 10: Corpus pass + fix wave

**Files:**
- Modify: whatever the corpus pass surfaces (parser fixes belong in `src/lib/epub.js` with a regression test in `src/lib/epub.test.js` per fix).

**Interfaces:**
- Consumes: everything above. This task is verification + fixes, no new API.

- [ ] **Step 1: Full test suite + build**

```bash
node --test src/lib/readerText.test.js src/lib/epubPaths.test.js src/lib/epub.test.js src/lib/pagination.test.js src/lib/srs.test.js src/lib/sentenceSet.test.js
npm run build
```

Expected: all pass.

- [ ] **Step 2: Import every epub in `~/Desktop/books/`** (via the dev server UI) and record results for each in a table:

Corpus: `20180856.epub`, `Carrie_by_Stephen_King.epub`, `Incognito…471643.epub`, `Sapiens…Harari.epub` (14 MB), `Sorrowland - Rivers Solomon.epub`, `Twisted Love Ana Huang 2021.epub`, `dokumen.pub_determined….epub` (~33.7 MiB — must pass the size gate), `selindzher…lovets-u-zhyti133.epub` (Ukrainian), `Ольга Токарчук. Емпусіон (2023).epub` (Ukrainian, Cyrillic filename).

Per book verify: (a) import report — full section count, zero *silent* loss (warnings are fine, silence is not); (b) real cover in the library; (c) TOC drawer shows real chapter titles, jumps work; (d) italics/bold visible where the book has them; (e) any verse/poetry keeps line breaks; (f) images render in place (Sapiens has many); (g) word-tap → add works; (h) reopening restores position.

- [ ] **Step 3: Fix what the corpus surfaces.** Every parser fix gets a minimal regression test in `src/lib/epub.test.js` reproducing the pattern (not the whole book). Commit fixes individually:

```bash
git add -A && git commit -m "fix(reader): <specific pattern the corpus surfaced>"
```

- [ ] **Step 4: Paste-text regression check** — add a pasted text book, read it, delete it. Expected: unchanged behavior, generated cover tile.

- [ ] **Step 5: Final suite + build, then hand off**

```bash
node --test src/lib/readerText.test.js src/lib/epubPaths.test.js src/lib/epub.test.js src/lib/pagination.test.js src/lib/srs.test.js src/lib/sentenceSet.test.js
npm run build
```

Report the corpus table to Nika. **Do not push, do not merge** — Nika click-tests locally, then decides on the PR.
