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

test('findZipEntry returns null when suffix is not unique', () => {
  const names = ['OEBPS/a/ch1.xhtml', 'OEBPS/b/ch1.xhtml']
  assert.equal(findZipEntry(names, 'ch1.xhtml'), null)
})

test('normalizePath keeps raw segment on malformed escape', () => {
  assert.equal(normalizePath('OEBPS/ch%zz.xhtml'), 'OEBPS/ch%zz.xhtml')
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
