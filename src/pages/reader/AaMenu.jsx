import { FONT_SIZES } from './Paginator'

export default function AaMenu({ aa, onChange, onClose }) {
  return (
    <div className="fixed inset-0 z-40" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="absolute right-4 top-14 w-64 bg-white rounded-2xl shadow-2xl border border-gray-100 p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400 font-medium">Font size</span>
          <div className="flex items-center gap-2">
            <button onClick={() => onChange({ ...aa, step: Math.max(0, aa.step - 1) })} disabled={aa.step === 0}
              className="w-9 h-9 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-30">A</button>
            <span className="text-xs text-gray-400 w-8 text-center">{FONT_SIZES[aa.step]}px</span>
            <button onClick={() => onChange({ ...aa, step: Math.min(FONT_SIZES.length - 1, aa.step + 1) })}
              disabled={aa.step === FONT_SIZES.length - 1}
              className="w-9 h-9 rounded-xl border border-gray-200 text-lg text-gray-600 hover:bg-gray-50 disabled:opacity-30">A</button>
          </div>
        </div>
        <div className="flex rounded-xl border border-gray-200 overflow-hidden text-sm font-semibold">
          <button onClick={() => onChange({ ...aa, serif: true })}
            className={`flex-1 py-2 ${aa.serif ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-700'}`}
            style={{ fontFamily: 'Georgia, serif' }}>Serif</button>
          <button onClick={() => onChange({ ...aa, serif: false })}
            className={`flex-1 py-2 ${!aa.serif ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-700'}`}>Sans</button>
        </div>
      </div>
    </div>
  )
}
