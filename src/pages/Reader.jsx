import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import Epub from 'epubjs'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useLanguage } from '../lib/i18n'
import { useTargetLang } from '../lib/TargetLangContext'
import { identifyWord } from '../lib/claude'
import { saveBook, getBooks, getChapterList, getChapter, deleteBook, updateProgress } from '../lib/readerDb'
import NavBar from '../components/NavBar'

// ── Helpers ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 10  // blocks per page

function genId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

// Tokenize text into word/non-word tokens, handles Unicode (umlauts etc.)
function tokenize(text) {
  return text.split(/([\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*)/gu).map((t, i) => ({
    text: t,
    isWord: /[\p{L}]/u.test(t),
    key: i,
  }))
}

// Strip leading article so "das Buch" → "buch" for text matching
function normalizeWordForm(w) {
  return w.toLowerCase().replace(/^(der|die|das|ein|eine)\s+/i, '').trim()
}

// Extract the sentence containing `word` from `blockText`
function getSentence(blockText, word) {
  const sentences = blockText.match(/[^.!?…]+[.!?…]*/g) ?? [blockText]
  const target = word.toLowerCase()
  for (const s of sentences) {
    if (s.toLowerCase().includes(target)) return s.trim()
  }
  return blockText.slice(0, 300).trim()
}

// Extract blocks from an epub section document
function extractBlocks(doc) {
  if (!doc?.body) return []
  const blocks = []

  const blockEls = doc.querySelectorAll('p, h1, h2, h3, h4, h5, h6, blockquote, li')
  if (blockEls.length > 0) {
    for (const el of blockEls) {
      const text = el.textContent?.replace(/\s+/g, ' ').trim()
      if (text && text.length > 1) blocks.push({ type: el.tagName.toLowerCase(), text })
    }
  } else {
    // Fallback for div-based epubs (Kindle, some older formats)
    for (const el of doc.querySelectorAll('div')) {
      if (el.querySelector('div, p, h1, h2, h3, h4, h5, h6')) continue // skip containers
      const text = el.textContent?.replace(/\s+/g, ' ').trim()
      if (text && text.length > 10) blocks.push({ type: 'p', text })
    }
  }

  return blocks
}

// Load an epub section document directly from the zip (handles path prefix differences)
async function loadSectionDoc(item, book) {
  const href = item.href
  if (!href) return null

  const zip = book.archive.zip
  const entries = Object.keys(zip.files)

  // The href may be relative (e.g. "ch1.html") while zip stores "OEBPS/ch1.html"
  const entry = entries.find(e => e === href || e.endsWith('/' + href))
  if (!entry) return null

  const text = await zip.file(entry).async('text')
  return new DOMParser().parseFromString(text, 'application/xhtml+xml')
}

// Parse epub ArrayBuffer → { title, author, chapters[] }
async function parseEpub(arrayBuffer, bookId) {
  const book = new Epub(arrayBuffer)
  await book.ready

  const meta = await book.loaded.metadata
  const title = meta.title?.trim() || 'Untitled'
  const author = meta.creator?.trim() || ''

  const chapters = []
  for (const item of book.spine.items) {
    try {
      const doc = await loadSectionDoc(item, book)
      if (!doc) continue

      const blocks = extractBlocks(doc)
      if (blocks.length < 1) continue

      const headingEl = blocks.find(b => ['h1','h2','h3'].includes(b.type))
      const chTitle = headingEl?.text || `Chapter ${chapters.length + 1}`
      chapters.push({
        id: `${bookId}-${chapters.length}`,
        bookId,
        index: chapters.length,
        title: chTitle,
        blocks,
      })
    } catch {
      // skip unreadable sections
    }
  }

  return { title, author, chapters }
}

// ── Block component ────────────────────────────────────────────────────────

const BLOCK_CLASSES = {
  h1: 'text-2xl font-bold text-gray-900 mt-8 mb-3',
  h2: 'text-xl font-bold text-gray-800 mt-6 mb-2',
  h3: 'text-lg font-semibold text-gray-700 mt-5 mb-2',
  h4: 'text-base font-semibold text-gray-700 mt-4 mb-1',
  blockquote: 'border-l-4 border-gray-200 pl-5 italic text-gray-500 my-4',
  li: 'ml-5 list-disc text-gray-700',
  p: 'text-gray-700',
}

function Block({ type, text, onWordTap, highlighted, knownWords }) {
  const Tag = ['h1','h2','h3','h4','h5','h6'].includes(type) ? type : type === 'blockquote' ? 'blockquote' : type === 'li' ? 'li' : 'p'
  const tokens = tokenize(text)
  return (
    <Tag className={BLOCK_CLASSES[type] ?? BLOCK_CLASSES.p}>
      {tokens.map((token) =>
        token.isWord ? (
          <span
            key={token.key}
            onClick={() => onWordTap(token.text, getSentence(text, token.text))}
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
      )}
    </Tag>
  )
}

// ── POS badge styles (reused from Dictionary) ──────────────────────────────

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

// ── Word popup (bottom sheet) ──────────────────────────────────────────────

function WordPopup({ tapped, lookup, onAdd, onClose, adding }) {
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
      <div
        ref={popupRef}
        className="pointer-events-auto w-full max-w-2xl bg-white rounded-t-3xl shadow-2xl border border-gray-100 px-6 py-5 pb-8 animate-slide-up"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs text-gray-400 truncate max-w-[80%] italic">"{tapped.sentence}"</p>
          <button onClick={onClose} className="text-gray-300 hover:text-gray-600 text-xl ml-3 shrink-0">✕</button>
        </div>

        {/* Loading */}
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

        {/* Error */}
        {lookup?.status === 'error' && (
          <div className="py-4 text-sm text-red-500">Could not identify this word. Try again.</div>
        )}

        {/* Result */}
        {(lookup?.status === 'ready' || lookup?.status === 'added') && sense && (
          <div className="flex flex-col gap-3">
            {/* Word + badges */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-2xl font-bold text-gray-900">{lookup.result.word}</span>
              {pos && <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${pos.className}`}>{pos.label}</span>}
              {sense.cefr && <span className="text-xs font-bold px-2 py-0.5 rounded bg-indigo-600 text-white">{sense.cefr}</span>}
              {sense.register && sense.register !== 'neutral' && (
                <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-500 capitalize">{sense.register}</span>
              )}
            </div>

            {/* Translation */}
            <p className="text-lg text-gray-700 font-medium">{sense.translation}</p>

            {/* Grammar note */}
            {sense.grammarNote && !/^(countable|uncountable) noun/i.test(sense.grammarNote) && (
              <div className={`rounded-xl px-3 py-2 text-xs font-medium flex items-start gap-2 ${
                sense.isException ? 'bg-amber-50 text-amber-800 border border-amber-100' : 'bg-indigo-50 text-indigo-800 border border-indigo-100'
              }`}>
                <span>{sense.isException ? '⚠️' : 'ℹ️'}</span>
                <span>{sense.grammarNote}</span>
              </div>
            )}

            {/* Example */}
            {sense.examples?.[0] && (
              <div className="bg-gray-50 rounded-xl px-4 py-3">
                <p className="text-sm text-gray-700 italic">"{sense.examples[0].target}"</p>
                <p className="text-xs text-gray-400 mt-1">{sense.examples[0].translation}</p>
              </div>
            )}

            {/* Action */}
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
              <button
                onClick={onAdd}
                disabled={adding}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded-2xl font-semibold text-sm transition-colors"
              >
                {adding ? 'Adding…' : '+ Add to dictionary'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Add book modal ─────────────────────────────────────────────────────────

function AddBookModal({ onClose, onSaved }) {
  const [tab, setTab] = useState('epub') // 'epub' | 'text'
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [status, setStatus] = useState('idle') // idle | parsing | saving | error
  const [errorMsg, setErrorMsg] = useState('')
  const fileRef = useRef(null)

  async function handleEpub(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setStatus('parsing')
    setErrorMsg('')
    try {
      const buf = await file.arrayBuffer()
      const bookId = genId()
      const { title: epubTitle, author, chapters } = await parseEpub(buf, bookId)
      if (chapters.length === 0) throw new Error('No readable chapters found. The file may be DRM-protected or use an unsupported format.')
      setStatus('saving')
      const book = { id: bookId, title: epubTitle, author, format: 'epub', chapterCount: chapters.length, addedAt: Date.now(), lastReadAt: null, lastChapterIndex: 0 }
      await saveBook(book, chapters)
      onSaved()
    } catch (err) {
      setErrorMsg(err.message ?? 'Failed to parse epub.')
      setStatus('error')
    }
  }

  async function handleTextSave() {
    if (!text.trim() || !title.trim()) return
    setStatus('saving')
    try {
      const bookId = genId()
      // Split plain text into paragraphs
      const paragraphs = text.split(/\n{2,}/).map(p => p.replace(/\n/g, ' ').trim()).filter(Boolean)
      const blocks = paragraphs.map(p => ({ type: 'p', text: p }))

      // Split into chapters of ~50 paragraphs each
      const PARA_PER_CHAPTER = 50
      const chunkCount = Math.ceil(blocks.length / PARA_PER_CHAPTER)
      const chapters = Array.from({ length: chunkCount }, (_, i) => ({
        id: `${bookId}-${i}`,
        bookId,
        index: i,
        title: chunkCount === 1 ? title : `Part ${i + 1}`,
        blocks: blocks.slice(i * PARA_PER_CHAPTER, (i + 1) * PARA_PER_CHAPTER),
      }))
      const book = { id: bookId, title: title.trim(), author: '', format: 'text', chapterCount: chapters.length, addedAt: Date.now(), lastReadAt: null, lastChapterIndex: 0 }
      await saveBook(book, chapters)
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

        {/* Tabs */}
        <div className="flex rounded-xl border border-gray-200 overflow-hidden mb-5 text-sm font-semibold">
          {['epub','text'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-2 transition-colors ${tab === t ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-700'}`}>
              {t === 'epub' ? 'EPUB file' : 'Paste text'}
            </button>
          ))}
        </div>

        {tab === 'epub' && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-gray-500">Upload an .epub file. Content is stored locally in your browser — never sent to our servers.</p>
            <input ref={fileRef} type="file" accept=".epub" className="hidden" onChange={handleEpub} />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="w-full py-3 border-2 border-dashed border-gray-200 hover:border-indigo-300 rounded-2xl text-sm text-gray-400 hover:text-indigo-500 transition-colors disabled:opacity-50"
            >
              {busy ? (status === 'parsing' ? 'Parsing…' : 'Saving…') : 'Choose .epub file'}
            </button>
          </div>
        )}

        {tab === 'text' && (
          <div className="flex flex-col gap-3">
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Title"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-400"
            />
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Paste your text here…"
              rows={8}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:border-indigo-400"
            />
            <button
              onClick={handleTextSave}
              disabled={busy || !title.trim() || !text.trim()}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-200 disabled:cursor-not-allowed text-white rounded-2xl font-semibold text-sm transition-colors"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}

        {status === 'error' && (
          <p className="mt-3 text-sm text-red-500">{errorMsg}</p>
        )}
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function Reader() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { lang } = useLanguage()
  const { targetLang, targetLanguageName } = useTargetLang()
  const interfaceLanguage = lang === 'uk' ? 'Ukrainian' : 'English'

  const [view, setView] = useState('library') // 'library' | 'reading'
  const [books, setBooks] = useState([])
  const [currentBook, setCurrentBook] = useState(null)
  const [chapterList, setChapterList] = useState([])
  const [chapterIndex, setChapterIndex] = useState(0)
  const [pageIndex, setPageIndex] = useState(0)
  const [chapter, setChapter] = useState(null)
  const [loadingChapter, setLoadingChapter] = useState(false)
  const pendingLastPage = useRef(false)

  const [translationLang, setTranslationLang] = useState(interfaceLanguage)
  const [knownWords, setKnownWords] = useState(new Set())

  const [popup, setPopup] = useState(null)     // { word, sentence }
  const [lookup, setLookup] = useState(null)   // { status, result, existing }
  const [adding, setAdding] = useState(false)

  const [showAddModal, setShowAddModal] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null) // bookId

  const contentRef = useRef(null)

  // Load library
  async function loadBooks() {
    const all = await getBooks()
    setBooks(all)
  }

  useEffect(() => { loadBooks() }, [])

  // Load known words for highlighting
  useEffect(() => {
    if (!user) return
    supabase
      .from('word_senses')
      .select('word_form')
      .eq('user_id', user.id)
      .eq('target_language', targetLang)
      .then(({ data }) => {
        if (data) setKnownWords(new Set(data.map(r => normalizeWordForm(r.word_form))))
      })
  }, [user, targetLang])

  // Split chapter blocks into pages
  const pages = useMemo(() => {
    if (!chapter?.blocks?.length) return []
    const result = []
    for (let i = 0; i < chapter.blocks.length; i += PAGE_SIZE)
      result.push(chapter.blocks.slice(i, i + PAGE_SIZE))
    return result
  }, [chapter])

  const currentBlocks = pages[pageIndex] ?? []
  const totalPages = pages.length

  // Load chapter when index changes; if pendingLastPage, jump to last page after load
  useEffect(() => {
    if (!currentBook) return
    setLoadingChapter(true)
    getChapter(currentBook.id, chapterIndex).then(ch => {
      setChapter(ch ?? null)
      setLoadingChapter(false)
      if (pendingLastPage.current && ch?.blocks?.length) {
        setPageIndex(Math.max(0, Math.ceil(ch.blocks.length / PAGE_SIZE) - 1))
        pendingLastPage.current = false
      }
      contentRef.current?.scrollTo(0, 0)
    })
  }, [currentBook, chapterIndex])

  // Save progress whenever chapter or page changes
  useEffect(() => {
    if (currentBook) updateProgress(currentBook.id, chapterIndex, pageIndex)
  }, [currentBook, chapterIndex, pageIndex])

  async function openBook(book) {
    const list = await getChapterList(book.id)
    setCurrentBook(book)
    setChapterList(list)
    setChapterIndex(book.lastChapterIndex ?? 0)
    setPageIndex(book.lastPageIndex ?? 0)
    setView('reading')
  }

  function closeBook() {
    setCurrentBook(null)
    setChapter(null)
    setChapterList([])
    setPopup(null)
    setLookup(null)
    setView('library')
    loadBooks()
  }

  function nextPage() {
    setPopup(null); setLookup(null)
    if (pageIndex < totalPages - 1) {
      setPageIndex(pi => pi + 1)
      contentRef.current?.scrollTo(0, 0)
    } else if (chapterIndex < chapterList.length - 1) {
      setPageIndex(0)
      setChapterIndex(ci => ci + 1)
    }
  }

  function prevPage() {
    setPopup(null); setLookup(null)
    if (pageIndex > 0) {
      setPageIndex(pi => pi - 1)
      contentRef.current?.scrollTo(0, 0)
    } else if (chapterIndex > 0) {
      pendingLastPage.current = true
      setChapterIndex(ci => ci - 1)
    }
  }

  // Keyboard navigation
  useEffect(() => {
    if (view !== 'reading') return
    function onKey(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextPage()
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   prevPage()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, pageIndex, totalPages, chapterIndex, chapterList.length])

  async function handleDeleteBook(bookId) {
    await deleteBook(bookId)
    setDeleteConfirm(null)
    loadBooks()
  }

  // Word tap
  const handleWordTap = useCallback(async (word, sentence) => {
    setPopup({ word, sentence })
    setLookup({ status: 'loading' })

    try {
      const result = await identifyWord(word, targetLanguageName, translationLang, sentence)
      if (!result.senses?.length) throw new Error('No senses returned')

      // Check if base form already in dictionary
      const { data: existing } = await supabase
        .from('words')
        .select('id, word, status')
        .eq('user_id', user.id)
        .eq('target_language', targetLang)
        .ilike('word', result.word)
        .maybeSingle()

      const existingStage = existing
        ? await supabase.from('word_senses').select('learning_stage').eq('word_id', existing.id).limit(1).maybeSingle()
            .then(r => r.data?.learning_stage ?? 'new')
        : null

      setLookup({
        status: 'ready',
        result,
        existing: existing ? { id: existing.id, word: existing.word, stage: existingStage } : null,
      })
    } catch {
      setLookup({ status: 'error' })
    }
  }, [targetLanguageName, translationLang, targetLang, user])

  async function handleAddWord() {
    if (!lookup?.result || !popup) return
    setAdding(true)
    const result = lookup.result
    const primary = result.senses[0]

    try {
      const { data: newWord } = await supabase
        .from('words')
        .insert({
          user_id: user.id,
          word: result.word,
          translation: primary.translation,
          pos: primary.pos,
          form: primary.form || null,
          grammar_note: primary.grammarNote || null,
          explanation: primary.explanation || null,
          is_exception: primary.isException || false,
          conjugation: primary.conjugation || null,
          entry_type: result.entryType,
          status: 'new',
          date_added: new Date().toISOString().split('T')[0],
          target_language: targetLang,
          context_sentence: popup.sentence,
        })
        .select('id')
        .single()

      if (newWord?.id && result.senses?.length) {
        await supabase.from('word_senses').insert(
          result.senses.map(s => ({
            word_id: newWord.id,
            user_id: user.id,
            target_language: targetLang,
            pos: s.pos,
            word_form: s.wordForm || result.word,
            translation: s.translation,
            form: s.form || null,
            grammar_note: s.grammarNote || null,
            explanation: s.explanation || null,
            is_exception: s.isException || false,
            register: s.register || 'neutral',
            cefr: s.cefr || null,
            conjugation: s.conjugation || null,
            examples: s.examples || [],
            learning_stage: 'new',
            correct_recall_count: 0,
          }))
        )
      }

      setLookup(prev => ({ ...prev, status: 'added' }))
      setKnownWords(prev => {
        const next = new Set(prev)
        result.senses.forEach(s => next.add(normalizeWordForm(s.wordForm || result.word)))
        return next
      })
    } catch (e) {
      console.error('Add word error:', e)
    }
    setAdding(false)
  }

  // ── Library view ───────────────────────────────────────────────────────────

  if (view === 'library') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <NavBar />

        <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-10">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Reader</h1>
              <p className="text-sm text-gray-400 mt-0.5">Tap any word to look it up and add it to your dictionary.</p>
            </div>
            <button
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-sm font-semibold transition-colors"
            >
              + Add book
            </button>
          </div>

          {books.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="text-5xl mb-4">📚</div>
              <p className="text-gray-500 font-medium mb-1">No books yet</p>
              <p className="text-gray-400 text-sm mb-6">Upload an epub or paste any text to start reading.</p>
              <button
                onClick={() => setShowAddModal(true)}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-sm font-semibold transition-colors"
              >
                Add your first book
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {books.map(book => (
                <div
                  key={book.id}
                  className="group bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow overflow-hidden"
                >
                  <button
                    onClick={() => openBook(book)}
                    className="w-full text-left p-5 flex flex-col gap-2"
                  >
                    <div className="text-3xl mb-1">{book.format === 'epub' ? '📖' : '📄'}</div>
                    <p className="font-semibold text-gray-900 text-sm leading-snug line-clamp-2">{book.title}</p>
                    {book.author && <p className="text-xs text-gray-400">{book.author}</p>}
                    <p className="text-xs text-gray-300">{book.chapterCount} chapter{book.chapterCount !== 1 ? 's' : ''}</p>
                    {book.lastReadAt && (
                      <p className="text-xs text-indigo-400 font-medium">
                        Ch. {(book.lastChapterIndex ?? 0) + 1} / {book.chapterCount}
                      </p>
                    )}
                  </button>
                  <div className="px-5 pb-4">
                    <button
                      onClick={() => setDeleteConfirm(book.id)}
                      className="text-xs text-gray-300 hover:text-red-400 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>

        {showAddModal && (
          <AddBookModal
            onClose={() => setShowAddModal(false)}
            onSaved={() => { setShowAddModal(false); loadBooks() }}
          />
        )}

        {deleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
            <div className="bg-white rounded-3xl shadow-2xl p-6 w-full max-w-sm text-center">
              <p className="font-semibold text-gray-900 mb-2">Remove this book?</p>
              <p className="text-sm text-gray-400 mb-6">It will be deleted from your browser. Words you added remain in your dictionary.</p>
              <div className="flex gap-3">
                <button onClick={() => setDeleteConfirm(null)} className="flex-1 py-2.5 rounded-2xl border border-gray-200 text-sm text-gray-500 hover:bg-gray-50">Cancel</button>
                <button onClick={() => handleDeleteBook(deleteConfirm)} className="flex-1 py-2.5 rounded-2xl bg-red-500 hover:bg-red-600 text-white text-sm font-semibold">Remove</button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Reading view ───────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Reading nav */}
      <nav className="bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between sticky top-0 z-10 shadow-sm gap-3">
        <button onClick={closeBook} className="text-sm text-gray-400 hover:text-gray-700 transition-colors shrink-0">
          ← Library
        </button>

        <div className="flex flex-col items-center min-w-0">
          <span className="text-sm font-semibold text-gray-800 truncate max-w-[180px]">{currentBook?.title}</span>
          <span className="text-xs text-gray-400 truncate max-w-[180px]">
            {chapterList[chapterIndex]?.title ?? `Chapter ${chapterIndex + 1}`}
            {totalPages > 1 && ` · p. ${pageIndex + 1}/${totalPages}`}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-gray-400 hidden sm:inline">Translate</span>
          <div className="flex rounded-full border border-gray-200 overflow-hidden text-xs font-semibold">
            {[{ code: 'English', label: 'EN' }, { code: 'Ukrainian', label: 'UA' }].map(({ code, label }) => (
              <button
                key={code}
                onClick={() => setTranslationLang(code)}
                className={`px-3 py-1 transition-colors ${translationLang === code ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-700'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Chapter content */}
      <div
        ref={contentRef}
        className="flex-1 overflow-y-auto"
      >
        {loadingChapter ? (
          <div className="flex items-center justify-center py-32">
            <div className="flex gap-1">
              <span className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce [animation-delay:0ms]" />
              <span className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        ) : chapter ? (
          <div className="max-w-2xl mx-auto px-6 py-10 flex flex-col gap-4 text-[1.0625rem] leading-[1.85]">
            {currentBlocks.map((block, i) => (
              <Block
                key={i}
                type={block.type}
                text={block.text}
                onWordTap={handleWordTap}
                highlighted={popup?.word?.toLowerCase()}
                knownWords={knownWords}
              />
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center py-32 text-gray-400 text-sm">Chapter not found.</div>
        )}

        {/* Page navigation */}
        <div className="max-w-2xl mx-auto px-6 pb-12 pt-4 flex items-center justify-between gap-4">
          <button
            onClick={prevPage}
            disabled={chapterIndex === 0 && pageIndex === 0}
            className="px-5 py-2.5 rounded-2xl border border-gray-200 text-sm text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            ← Previous
          </button>

          <span className="text-xs text-gray-400 text-center">
            {totalPages > 1
              ? `p. ${pageIndex + 1} / ${totalPages}`
              : chapterList.length > 1
              ? `Ch. ${chapterIndex + 1} / ${chapterList.length}`
              : null}
          </span>

          <button
            onClick={nextPage}
            disabled={chapterIndex >= chapterList.length - 1 && pageIndex >= totalPages - 1}
            className="px-5 py-2.5 rounded-2xl border border-gray-200 text-sm text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Next →
          </button>
        </div>
      </div>

      {/* Word popup */}
      {popup && lookup && (
        <WordPopup
          tapped={popup}
          lookup={lookup}
          adding={adding}
          onAdd={handleAddWord}
          onClose={() => { setPopup(null); setLookup(null) }}
        />
      )}
    </div>
  )
}
