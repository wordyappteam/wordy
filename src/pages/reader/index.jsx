import { useState } from 'react'
import Library from './Library'
import ReadingView from './ReadingView'

export default function Reader() {
  const [book, setBook] = useState(null)
  return book
    ? <ReadingView book={book} onClose={() => setBook(null)} />
    : <Library onOpen={setBook} />
}
