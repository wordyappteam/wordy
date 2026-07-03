export default function ReadingView({ book, onClose }) {
  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-4">
      <p className="text-gray-500">Reading view for "{book.title}" lands in Task 7.</p>
      <button onClick={onClose} className="px-4 py-2 rounded-2xl border border-gray-200 text-sm text-gray-500">← Library</button>
    </div>
  )
}
