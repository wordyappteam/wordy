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
