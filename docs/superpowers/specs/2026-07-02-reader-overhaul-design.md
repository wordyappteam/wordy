# Reader Overhaul — Design Spec

**Date:** 2026-07-02
**Status:** Approved design, ready for implementation plan
**Branch:** new branch off `main` (independent of `srs-v2`)

## Goal

Turn the Reader into a real books app: robust epub parsing (no silently lost
chapters), faithful rendering of the book's text formats, true Kindle-style
pagination, chapter navigation from the book's actual table of contents, and
book-like typography — while keeping the Reader's core value untouched:
tap any word → identify → add to dictionary, with known-word highlighting.

## Decisions (Nika, 2026-07-02)

- **Reading model:** true screen-sized pages (Kindle-style), not scroll.
- **Images:** yes — cover art in the library + inline illustrations in text.
- **Existing library:** clean slate. DB v2 wipes stored books; re-add epubs.
  No legacy rendering path.
- **Aa menu:** small — font size stepper + serif/sans toggle. (Fuller
  themes/dark mode deferred until branding.)
- **Approach:** own parsing pipeline + own renderer (option A). epubjs is
  removed; jszip (already in the tree) is used directly. No iframe renderer —
  word-tap must stay first-class in our own DOM.

## Current problems (code review findings)

In `src/pages/Reader.jsx` (`parseEpub`/`extractBlocks`/`loadSectionDoc`):

1. Chapter files parsed as strict `application/xhtml+xml` — one stray
   `&nbsp;` or unclosed tag kills the whole chapter, silently skipped.
2. Zip entry lookup by exact/suffix match — URL-encoded hrefs (`%20`),
   `../` relatives, `#fragment` anchors → chapter silently skipped.
3. `querySelectorAll('p, …, blockquote, li')` double-extracts text when a
   `blockquote`/`li` contains `<p>` (very common) — duplicated passages.
4. All inline formatting destroyed (`textContent`): italics, bold, poetry
   line breaks, footnote markers. Whitespace collapse flattens verse.
5. Images dropped entirely (no covers, no illustrations); `hr` scene breaks,
   `ol` vs `ul`, tables, figures ignored.
6. Chapter titles guessed from first heading, not the epub's TOC; front
   matter pollutes the list; no chapter navigation UI at all (chapterList is
   loaded but never rendered).
7. "10 blocks per page" pagination; scroll area + Prev/Next buttons — neither
   a scroll reader nor a paged one.
8. All failures silent; epubjs 0.3.93 abandoned (already bypassed once).

## Design

### 1. Parser — `src/lib/epub.js` (new; epubjs removed)

`parseEpub(arrayBuffer) → { title, author, language, cover, chapters, toc, warnings }`

Pipeline, all via jszip + lenient DOM parsing:

0. **Size gate:** files over 35 MiB are rejected at import with a clear
   message before any parsing (the corpus's largest book, *Determined* at
   ~33.7 MiB, fits under it).
1. `META-INF/container.xml` → OPF path. `META-INF/encryption.xml` present →
   throw a clear "DRM-protected" error.
2. OPF: metadata (title, creator, `dc:language`), manifest (id → href,
   media-type, properties), spine (linear reading order), cover image
   (manifest `properties="cover-image"`, else `<meta name="cover">`).
3. TOC: EPUB3 nav doc (`properties="nav"`), fallback EPUB2 NCX. Parsed to
   `[{ label, href, anchor, depth }]`, then mapped to spine indices.
   Chapter titles come from the TOC; spine files without a TOC entry attach
   to the preceding entry as continuation pages.
4. Each linear spine file: resolve href against the OPF directory
   (URL-decode, collapse `../`, case-tolerant zip lookup), parse with
   `DOMParser` **`text/html`** (lenient — malformed XHTML no longer drops
   chapters), extract blocks via tree walk.
5. Images: `<img>`/`<svg><image>` sources resolved against the chapter path,
   extracted from the zip as blobs, deduplicated per book.
6. `warnings[]` collects every skipped section/missing image; the import UI
   reports honestly ("41 of 42 sections imported — 1 unreadable"), never
   silent loss.

Pure helpers (unit-testable in `node --test`, no DOM): zip path resolution
(decode + `../` + case), TOC→spine mapping, run merging/normalization,
pagination arithmetic (page count, offsets, anchor-block restore).

### 2. Block model

A tree walk (not a flat query — kills the double-extraction bug) emits:

```js
{ type: 'p'|'h1'..'h6'|'blockquote'|'li'|'figcaption'|'verse'|'hr'|'image',
  runs: [{ text, em?, strong?, sup? }],   // inline formatting survives
  // li only:    listType: 'ul'|'ol', listIndex
  // blockquote nesting via quoteDepth on inner blocks
  // image only: imageId, alt
  // verse: runs include explicit line breaks (from <br>/pre-formatted text)
}
```

- `em`/`i`/`cite` → `em`; `strong`/`b` → `strong`; `sup` kept for footnote
  markers (rendered, not tappable-word).
- `hr` → scene break (rendered as a centered ✳ divider).
- `<br>`-heavy paragraphs and `white-space: pre*` content → `verse` blocks
  preserving line structure (poetry, lyrics).
- Tables: flattened to paragraphs per row in v1 (rare in fiction; noted as a
  future refinement).

### 3. Storage — `readerDb.js` v2 (clean slate)

- `DB_VERSION` 1→2; `onupgradeneeded` clears `books` + `chapters` (Nika's
  clean-slate call — old flattened books can't be upgraded anyway).
- Stores: `books` (adds `author`, `language`, `coverImageId`, `toc`),
  `chapters` (`{ id, bookId, index, title, blocks }`), **new `images`**
  (`{ id, bookId, blob }`, indexed by `bookId`, deleted with the book).
- Reading position: `{ chapterIndex, blockOffset }` — page numbers aren't
  stable across font/viewport changes; on open, show the page containing
  that block. Progress % computed from block position over the whole book.

### 4. Pagination — CSS columns (our DOM, no iframe)

The current chapter renders into a container with `column-width = pageWidth`,
`height = pageHeight`, clipped by the viewport; page N = container translated
N × (pageWidth + gap) left. Long paragraphs split across pages mid-line like
print; images (`max-height` capped to page) and headings flow correctly.
`pageCount = round(scrollWidth / (pageWidth + gap))`.

- On resize / font change: recompute, re-land on the page containing the
  anchor block (first visible block before reflow).
- Page turns: click/tap zones on left/right edges (~20% width), ArrowLeft/
  ArrowRight as today, subtle slide transition. Center zone belongs to
  word taps. Turning past a chapter edge loads the adjacent chapter
  (last page ↔ first page) — the book reads as one continuous thing.

### 5. Reading chrome (Kindle-minimal)

- Top bar: `← Library` + book title (left) · `☰ contents` + `Aa` (right).
- Bottom edge: `page 3 of 18 in chapter · 34%` (percent through book).
- **Contents drawer (☰):** slides in, real TOC with nesting (indent by
  `depth`), current chapter highlighted, tap → jump. This is the new
  chapter navigation.
- **Aa popover:** font size stepper (5 steps) + serif/sans toggle, persisted
  in localStorage, instant reflow with position kept.
- Typography: serif default (Georgia stack), justified with `hyphens: auto`
  and `lang` set from book metadata (German hyphenates as German, Ukrainian
  as Ukrainian). Book-styled headings, blockquotes, verse, scene breaks;
  runs render italics/bold.

### 6. Library — bookshelf

Cover grid (2:3 aspect, `object-fit: cover`), title + author beneath,
progress %. Books without covers and pasted texts get a generated cover
(title on a colored field derived from the title hash). Add-book modal and
paste-text flow unchanged in behavior (paste-text now also emits v2 blocks
with `runs`).

### 7. Word-tap integration (unchanged behavior)

Same tokenizer, popup, add-to-dictionary flow, and known-word highlighting,
now applied per run (an italic word is still a tappable word; token spans
inherit run styling). `getSentence` operates on the block's concatenated
plain text. Word spans `stopPropagation` so taps don't turn pages.

### 8. File structure

`Reader.jsx` (850 lines) splits into `src/pages/reader/`:
`index.jsx` (route/state), `Library.jsx`, `ReadingView.jsx`, `Paginator.jsx`,
`TocDrawer.jsx`, `AaMenu.jsx`, `WordPopup.jsx`, `AddBookModal.jsx` — plus
`src/lib/epub.js` (parser) and `readerDb.js` v2. `/reader` route unchanged.

## Error handling

- File over the 35 MiB cap → rejected at import with an explicit message.
- DRM → explicit message at import.
- Per-section parse failures → import completes with a warning count, book
  still readable; warnings listed in the import result.
- Oversized/missing images → skipped with warning, text unaffected.
- IndexedDB quota errors on save → clear message suggesting removing a book.

## Testing

- `node --test` units for the pure helpers: zip path resolution, TOC→spine
  mapping, run merging/normalization, pagination math, position restore.
- **Manual corpus pass — `~/Desktop/books/`** (Nika's real files): the 8
  epubs there span Standard-publisher, RuLit/dokumen.pub repackagings,
  35 MB image-heavy (*Determined*), and Ukrainian Cyrillic (Токарчук,
  Селінджер). Each must import with 0 silently-lost sections, show a cover,
  real TOC titles, working chapter jumps, and correct italics/verse
  rendering; word-tap + add-to-dictionary verified per book.
- Build + existing test suite stay green.

## Non-goals

- PDF and .azw3/Kindle formats (present in the corpus folder — out of scope;
  epub + pasted text only).
- Scroll mode toggle, dark/sepia themes, full font library (post-branding).
- Table fidelity, footnote popups (future refinements).
- Any change to SRS/session code (independent of the `srs-v2` branch work).

## Risks

- CSS-column pagination is the one genuinely fiddly piece (measurement
  timing, reflow anchoring). Mitigation: isolate it in `Paginator.jsx` with
  a narrow API (`blocks + typography in → pages + current page out`) so it
  can be debugged/replaced without touching anything else.
- Very large epubs (35 MB) stress IndexedDB and parse time: parse is async
  with a progress state in the modal; images stored as blobs (no base64
  bloat).
- Clean-slate wipe is destructive by design and approved; it only affects
  locally stored reader books, never dictionary data.
