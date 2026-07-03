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
    updateProgress(book.id, chapterIndex, blockOffset)
  }, [book.id, chapter, chapterIndex, page])

  function nextPage() {
    if (!chapter) return
    if (page < pages - 1) setPage(page + 1)
    else if (chapterIndex < book.chapterCount - 1) { setAnchorBlock(null); setChapter(null); setPage(0); setChapterIndex(chapterIndex + 1) }
  }

  function prevPage() {
    if (!chapter) return
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
