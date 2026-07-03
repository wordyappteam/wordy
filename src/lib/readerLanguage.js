// Decide which language the Reader should identify and save tapped words in
// for a given book. A reader is intrinsically about its book's language, so
// when the book declares a language we support, route to it — regardless of
// the app's active target language — and flag the mismatch so the UI can say
// so. When the book's language is missing or unsupported, fall back to the
// active target language (today's behavior), with no mismatch flag.
//
// Pure and DOM-free: pass SUPPORTED_LANGUAGES in so this stays node-testable.
export function resolveReaderLanguage(bookLanguageCode, activeCode, supportedLangs) {
  const book = supportedLangs.find(l => l.code === bookLanguageCode)
  if (book && book.code !== activeCode) {
    return { code: book.code, name: book.name, isMismatch: true }
  }
  const active = supportedLangs.find(l => l.code === activeCode) ?? supportedLangs[0]
  return { code: active.code, name: active.name, isMismatch: false }
}
