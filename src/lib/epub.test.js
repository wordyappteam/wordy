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
