import { useRef, useEffect } from 'react'
import { displayTranslation } from '../../lib/senseDisplay'

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

export default function WordPopup({ tapped, lookup, onAdd, onClose, adding }) {
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
      <div ref={popupRef}
        className="pointer-events-auto w-full max-w-2xl bg-white rounded-t-3xl shadow-2xl border border-gray-100 px-6 py-5 pb-8 animate-slide-up">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs text-gray-400 truncate max-w-[80%] italic">"{tapped.sentence}"</p>
          <button onClick={onClose} className="text-gray-300 hover:text-gray-600 text-xl ml-3 shrink-0">✕</button>
        </div>

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

        {lookup?.status === 'error' && (
          <div className="py-4 text-sm text-red-500">Could not identify this word. Try again.</div>
        )}

        {(lookup?.status === 'ready' || lookup?.status === 'added') && sense && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-2xl font-bold text-gray-900">{lookup.result.word}</span>
              {pos && <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${pos.className}`}>{pos.label}</span>}
              {sense.cefr && <span className="text-xs font-bold px-2 py-0.5 rounded bg-indigo-600 text-white">{sense.cefr}</span>}
              {sense.register && sense.register !== 'neutral' && (
                <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-500 capitalize">{sense.register}</span>
              )}
            </div>

            <p className="text-lg text-gray-700 font-medium">{displayTranslation(sense.translation)}</p>

            {sense.grammarNote && !/^(countable|uncountable) noun/i.test(sense.grammarNote) && (
              <div className={`rounded-xl px-3 py-2 text-xs font-medium flex items-start gap-2 ${
                sense.isException ? 'bg-amber-50 text-amber-800 border border-amber-100' : 'bg-indigo-50 text-indigo-800 border border-indigo-100'
              }`}>
                <span>{sense.isException ? '⚠️' : 'ℹ️'}</span>
                <span>{sense.grammarNote}</span>
              </div>
            )}

            {sense.examples?.[0] && (
              <div className="bg-gray-50 rounded-xl px-4 py-3">
                <p className="text-sm text-gray-700 italic">"{sense.examples[0].target}"</p>
                <p className="text-xs text-gray-400 mt-1">{sense.examples[0].translation}</p>
              </div>
            )}

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
              <button onClick={onAdd} disabled={adding}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded-2xl font-semibold text-sm transition-colors">
                {adding ? 'Adding…' : '+ Add to dictionary'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
