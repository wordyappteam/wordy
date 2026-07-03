import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveReaderLanguage } from './readerLanguage.js'

// Minimal stand-in for SUPPORTED_LANGUAGES (code + name are all this helper uses).
const LANGS = [
  { code: 'de', name: 'German' },
  { code: 'en', name: 'English' },
  { code: 'uk', name: 'Ukrainian' },
]

test("routes to the book's language when supported and different from active", () => {
  const r = resolveReaderLanguage('uk', 'en', LANGS)
  assert.deepEqual(r, { code: 'uk', name: 'Ukrainian', isMismatch: true })
})

test("no mismatch when the book's language equals the active language", () => {
  const r = resolveReaderLanguage('en', 'en', LANGS)
  assert.deepEqual(r, { code: 'en', name: 'English', isMismatch: false })
})

test('falls back to active language when the book language is unsupported', () => {
  const r = resolveReaderLanguage('fr', 'en', LANGS)
  assert.deepEqual(r, { code: 'en', name: 'English', isMismatch: false })
})

test('falls back to active language when the book language is missing', () => {
  const r = resolveReaderLanguage(undefined, 'uk', LANGS)
  assert.deepEqual(r, { code: 'uk', name: 'Ukrainian', isMismatch: false })
})

test('falls back to the first supported language when active is somehow unknown', () => {
  const r = resolveReaderLanguage('xx', 'zz', LANGS)
  assert.deepEqual(r, { code: 'de', name: 'German', isMismatch: false })
})
