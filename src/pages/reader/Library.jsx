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
