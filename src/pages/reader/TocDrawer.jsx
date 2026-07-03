export default function TocDrawer({ toc, currentChapter, onJump, onClose }) {
  return (
    <div className="fixed inset-0 z-40" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20" />
      <aside
        onClick={e => e.stopPropagation()}
        className="absolute right-0 top-0 h-full w-80 max-w-[85vw] bg-white shadow-2xl flex flex-col animate-slide-up">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-bold text-gray-900 text-sm">Contents</h2>
          <button onClick={onClose} className="text-gray-300 hover:text-gray-600 text-xl">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {toc.map((entry, i) => {
            const active = entry.chapterIndex === currentChapter
            return (
              <button key={i} onClick={() => onJump(entry.chapterIndex)}
                style={{ paddingLeft: 20 + entry.depth * 16 }}
                className={`w-full text-left pr-5 py-2.5 text-sm leading-snug transition-colors ${
                  active ? 'text-indigo-700 font-semibold bg-indigo-50' : 'text-gray-600 hover:bg-gray-50'
                }`}>
                {entry.label}
              </button>
            )
          })}
        </div>
      </aside>
    </div>
  )
}
