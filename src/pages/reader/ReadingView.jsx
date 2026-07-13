import { useState, useEffect, useRef, useCallback } from 'react'
import { getChapter, getImage, updateProgress } from '../../lib/readerDb'
import { bookProgress, tocLabelFor, clampPage } from '../../lib/pagination'
import Paginator from './Paginator'
import TocDrawer from './TocDrawer'
import AaMenu from './AaMenu'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { useLanguage } from '../../lib/i18n'
import { useTargetLang, SUPPORTED_LANGUAGES } from '../../lib/TargetLangContext'
import { identifyWord } from '../../lib/claude'
import { normalizeWordForm } from '../../lib/readerText'
import { resolveReaderLanguage } from '../../lib/readerLanguage'
import WordPopup from './WordPopup'

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
  const currentBlockRef = useRef(book.lastBlockOffset ?? 0)

  const { user, profile } = useAuth()
  const { lang } = useLanguage()
  const { targetLang } = useTargetLang()
  // A reader is about its book's language: route word identify/save/highlight to
  // the book's language when we support it, regardless of the app's active target.
  const readerLang = resolveReaderLanguage(book.language, targetLang, SUPPORTED_LANGUAGES)
  const interfaceLanguage = lang === 'uk' ? 'Ukrainian' : 'English'
  const [translationLang, setTranslationLang] = useState(interfaceLanguage)
  const [knownWords, setKnownWords] = useState(new Set())
  const [langBannerDismissed, setLangBannerDismissed] = useState(false)
  const [displayPct, setDisplayPct] = useState(0)
  const [popup, setPopup] = useState(null)
  const [lookup, setLookup] = useState(null)
  const [adding, setAdding] = useState(false)

  useEffect(() => { localStorage.setItem(AA_KEY, JSON.stringify(aa)) }, [aa])

  useEffect(() => {
    if (!user) return
    supabase.from('word_senses').select('word_form')
      .eq('user_id', user.id).eq('target_language', readerLang.code)
      .then(({ data }) => { if (data) setKnownWords(new Set(data.map(r => normalizeWordForm(r.word_form)))) })
  }, [user, readerLang.code])

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
          if (cancelled) break
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
    currentBlockRef.current = blockOffset
    setDisplayPct(bookProgress(book.chapterBlockCounts ?? [], chapterIndex, blockOffset))
    updateProgress(book.id, chapterIndex, blockOffset)
  }, [book.id, chapter, chapterIndex, page])

  function nextPage() {
    if (!chapter) return
    setPopup(null); setLookup(null)
    if (page < pages - 1) setPage(page + 1)
    else if (chapterIndex < book.chapterCount - 1) { setAnchorBlock(null); setChapter(null); setPage(0); setChapterIndex(chapterIndex + 1) }
  }

  function prevPage() {
    if (!chapter) return
    setPopup(null); setLookup(null)
    if (page > 0) setPage(page - 1)
    else if (chapterIndex > 0) { setAnchorBlock(null); setChapter(null); pendingLastPage.current = true; setChapterIndex(chapterIndex - 1) }
  }

  function jumpToChapter(i) {
    setPopup(null); setLookup(null)
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
    if (popup) { setPopup(null); setLookup(null); return }
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    if (x < 0.2) prevPage()
    else if (x > 0.8) nextPage()
  }

  const handleWordTap = useCallback(async (word, sentence) => {
    setPopup({ word, sentence })
    setLookup({ status: 'loading' })
    try {
      const result = await identifyWord(word, readerLang.name, translationLang, sentence, { topics: profile?.topics ?? [] })
      if (!result.senses?.length) throw new Error('No senses returned')
      const { data: existing, error: existErr } = await supabase.from('words')
        // No `status`: the legacy column is dead. The real stage comes from the
        // word's senses, queried just below.
        .select('id, word').eq('user_id', user.id)
        .eq('target_language', readerLang.code).ilike('word', result.word).maybeSingle()
      if (existErr) console.warn("existing-word lookup failed:", existErr)
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
  }, [readerLang.name, readerLang.code, translationLang, user, profile])

  async function handleAddWord() {
    if (!lookup?.result || !popup) return
    setAdding(true)
    const result = lookup.result
    const primary = result.senses[0]
    try {
      const { data: newWord, error: wordErr } = await supabase.from('words').insert({
        user_id: user.id, word: result.word, translation: primary.translation,
        pos: primary.pos, form: primary.form || null, grammar_note: primary.grammarNote || null,
        explanation: primary.explanation || null, is_exception: primary.isException || false,
        conjugation: primary.conjugation || null, entry_type: result.entryType, status: 'new',
        date_added: new Date().toISOString().split('T')[0],
        target_language: readerLang.code, context_sentence: popup.sentence,
      }).select('id').single()
      if (wordErr || !newWord?.id) throw (wordErr || new Error("words insert returned no id"))

      // Reader adds the word as used in this sentence — save only the contextual sense.
      if (newWord?.id && primary) {
        const { error: senseErr } = await supabase.from('word_senses').insert([primary].map(s => ({
          word_id: newWord.id, user_id: user.id, target_language: readerLang.code,
          pos: s.pos, word_form: s.wordForm || result.word,
          aspect: s.aspect ?? null, gender: s.gender ?? null,
          translation: s.translation, form: s.form || null,
          grammar_note: s.grammarNote || null, usage_note: s.usageNote || null, explanation: s.explanation || null,
          is_exception: s.isException || false, register: s.register || 'neutral',
          cefr: s.cefr || null, conjugation: s.conjugation || null,
          examples: s.examples || [], learning_stage: 'new', correct_recall_count: 0,
        })))
        if (senseErr) throw senseErr
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

  const chapterLabel = tocLabelFor(book.toc ?? [], chapterIndex) || chapter?.title || `Chapter ${chapterIndex + 1}`

  return (
    <div className="h-screen bg-white flex flex-col overflow-hidden">
      <nav className="border-b border-gray-100 px-4 py-2.5 flex items-center justify-between gap-3 shrink-0">
        <button onClick={onClose} className="text-sm text-gray-400 hover:text-gray-700 transition-colors shrink-0">← Library</button>
        <div className="flex flex-col items-center min-w-0">
          <span className="text-sm font-semibold text-gray-800 truncate max-w-[220px]">{book.title}</span>
          <span className="text-xs text-gray-400 truncate max-w-[220px]">{chapterLabel}</span>
        </div>
        <div className="flex rounded-full border border-gray-200 overflow-hidden text-xs font-semibold shrink-0">
          {[{ code: 'English', label: 'EN' }, { code: 'Ukrainian', label: 'UA' }].map(({ code, label }) => (
            <button key={code} onClick={() => setTranslationLang(code)}
              className={`px-2.5 py-1 transition-colors ${translationLang === code ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-700'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => { setAaOpen(false); setTocOpen(o => !o) }} title="Contents"
            className="px-2.5 py-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50 text-base">☰</button>
          <button onClick={() => { setTocOpen(false); setAaOpen(o => !o) }} title="Typography"
            className="px-2.5 py-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50 text-sm font-semibold">Aa</button>
        </div>
      </nav>

      {readerLang.isMismatch && !langBannerDismissed && (
        <div className="shrink-0 bg-indigo-50 border-b border-indigo-100 px-4 py-2 flex items-center justify-center gap-3 text-xs text-indigo-800">
          <span>This book is in <strong>{readerLang.name}</strong> — tapped words go to your {readerLang.name} dictionary.</span>
          <button onClick={() => setLangBannerDismissed(true)} className="text-indigo-400 hover:text-indigo-700 font-semibold shrink-0">Got it</button>
        </div>
      )}

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
            highlighted={popup?.word?.toLowerCase() ?? null}
            knownWords={knownWords}
            onResize={() => setAnchorBlock(currentBlockRef.current)}
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
        {chapter && (
          <>
            <span>{`page ${page + 1} of ${pages} in chapter`}</span>
            <span>{`${displayPct}%`}</span>
          </>
        )}
      </div>

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

      {popup && lookup && (
        <WordPopup tapped={popup} lookup={lookup} adding={adding}
          onAdd={handleAddWord} onClose={() => { setPopup(null); setLookup(null) }} />
      )}
    </div>
  )
}
