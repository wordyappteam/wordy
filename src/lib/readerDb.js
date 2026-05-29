const DB_NAME = 'wordy-reader'
const DB_VERSION = 1

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = e.target.result
      if (!db.objectStoreNames.contains('books'))
        db.createObjectStore('books', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('chapters')) {
        const cs = db.createObjectStore('chapters', { keyPath: 'id' })
        cs.createIndex('bookId', 'bookId', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function idbReq(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

function txDone(t) {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}

export async function saveBook(book, chapters) {
  const db = await openDb()
  const t = db.transaction(['books', 'chapters'], 'readwrite')
  t.objectStore('books').put(book)
  for (const ch of chapters) t.objectStore('chapters').put(ch)
  return txDone(t)
}

export async function getBooks() {
  const db = await openDb()
  const t = db.transaction('books', 'readonly')
  const all = await idbReq(t.objectStore('books').getAll())
  return all.sort((a, b) => (b.lastReadAt ?? b.addedAt) - (a.lastReadAt ?? a.addedAt))
}

export async function getBook(id) {
  const db = await openDb()
  const t = db.transaction('books', 'readonly')
  return idbReq(t.objectStore('books').get(id))
}

export async function getChapterList(bookId) {
  const db = await openDb()
  const t = db.transaction('chapters', 'readonly')
  const all = await idbReq(t.objectStore('chapters').index('bookId').getAll(bookId))
  return all.sort((a, b) => a.index - b.index).map(({ id, bookId: _b, index, title }) => ({ id, index, title }))
}

export async function getChapter(bookId, index) {
  const db = await openDb()
  const t = db.transaction('chapters', 'readonly')
  return idbReq(t.objectStore('chapters').get(`${bookId}-${index}`))
}

export async function deleteBook(id) {
  const db = await openDb()
  const t1 = db.transaction('chapters', 'readonly')
  const chapters = await idbReq(t1.objectStore('chapters').index('bookId').getAll(id))
  const t2 = db.transaction(['books', 'chapters'], 'readwrite')
  t2.objectStore('books').delete(id)
  for (const ch of chapters) t2.objectStore('chapters').delete(ch.id)
  return txDone(t2)
}

export async function updateProgress(bookId, chapterIndex) {
  const db = await openDb()
  const t = db.transaction('books', 'readwrite')
  const store = t.objectStore('books')
  const book = await idbReq(store.get(bookId))
  if (book) { book.lastChapterIndex = chapterIndex; book.lastReadAt = Date.now(); store.put(book) }
  return txDone(t)
}
