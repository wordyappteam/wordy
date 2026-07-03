const DB_NAME = 'wordy-reader'
const DB_VERSION = 2

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = e.target.result
      // v2 = clean slate (approved): the v1 flattened-text blocks cannot be
      // upgraded to rich blocks, so old stores are dropped and recreated.
      for (const name of ['books', 'chapters', 'images']) {
        if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name)
      }
      db.createObjectStore('books', { keyPath: 'id' })
      const cs = db.createObjectStore('chapters', { keyPath: 'id' })
      cs.createIndex('bookId', 'bookId', { unique: false })
      const is = db.createObjectStore('images', { keyPath: 'id' })
      is.createIndex('bookId', 'bookId', { unique: false })
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

export async function saveBook(book, chapters, images = []) {
  const db = await openDb()
  const t = db.transaction(['books', 'chapters', 'images'], 'readwrite')
  t.objectStore('books').put(book)
  for (const ch of chapters) t.objectStore('chapters').put(ch)
  for (const img of images) t.objectStore('images').put({ id: img.id, bookId: book.id, blob: img.blob })
  return txDone(t)
}

export async function getBooks() {
  const db = await openDb()
  const all = await idbReq(db.transaction('books', 'readonly').objectStore('books').getAll())
  return all.sort((a, b) => (b.lastReadAt ?? b.addedAt) - (a.lastReadAt ?? a.addedAt))
}

export async function getBook(id) {
  const db = await openDb()
  return idbReq(db.transaction('books', 'readonly').objectStore('books').get(id))
}

export async function getChapterList(bookId) {
  const db = await openDb()
  const all = await idbReq(db.transaction('chapters', 'readonly').objectStore('chapters').index('bookId').getAll(bookId))
  return all.sort((a, b) => a.index - b.index).map(({ id, index, title }) => ({ id, index, title }))
}

export async function getChapter(bookId, index) {
  const db = await openDb()
  return idbReq(db.transaction('chapters', 'readonly').objectStore('chapters').get(`${bookId}-${index}`))
}

export async function getImage(id) {
  const db = await openDb()
  return idbReq(db.transaction('images', 'readonly').objectStore('images').get(id))
}

export async function deleteBook(id) {
  const db = await openDb()
  const chapters = await idbReq(db.transaction('chapters', 'readonly').objectStore('chapters').index('bookId').getAll(id))
  const images = await idbReq(db.transaction('images', 'readonly').objectStore('images').index('bookId').getAll(id))
  const t = db.transaction(['books', 'chapters', 'images'], 'readwrite')
  t.objectStore('books').delete(id)
  for (const ch of chapters) t.objectStore('chapters').delete(ch.id)
  for (const img of images) t.objectStore('images').delete(img.id)
  return txDone(t)
}

export async function updateProgress(bookId, chapterIndex, blockOffset = 0) {
  const db = await openDb()
  const t = db.transaction('books', 'readwrite')
  const store = t.objectStore('books')
  const book = await idbReq(store.get(bookId))
  if (book) {
    book.lastChapterIndex = chapterIndex
    book.lastBlockOffset = blockOffset
    book.lastReadAt = Date.now()
    store.put(book)
  }
  return txDone(t)
}
