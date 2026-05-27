import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useLanguage } from '../lib/i18n'
import { useTargetLang } from '../lib/TargetLangContext'

const SESSION_SIZE = 15

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function normalise(s) {
  return s.toLowerCase().trim()
    .replace(/\s+/g, ' ')
    .replace(/^(der|die|das)\s+/i, '')   // ignore article for comparison
}

function speak(text, locale = 'de-DE') {
  if (!window.speechSynthesis) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = locale
  u.rate = 0.85
  window.speechSynthesis.speak(u)
}

export default function ActiveRecall() {
  const navigate  = useNavigate()
  const { user }  = useAuth()
  const { lang }  = useLanguage()
  const { targetLang, targetLanguageName, speechLocale } = useTargetLang()
  const inputRef  = useRef(null)

  const [phase, setPhase]       = useState('picker')
  const [cards, setCards]       = useState([])
  const [counts, setCounts]     = useState({ new: 0, learning: 0, known: 0, mastered: 0 })
  const [loading, setLoading]   = useState(false)
  const [index, setIndex]       = useState(0)
  const [input, setInput]       = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [results, setResults]   = useState([])   // { correct: bool, typed: string }[]
  const [speaking, setSpeaking] = useState(false)

  // Load status counts
  useEffect(() => {
    if (!user) return
    supabase
      .from('words')
      .select('status')
      .eq('user_id', user.id)
      .eq('target_language', targetLang)
      .then(({ data }) => {
        if (!data) return
        const c = { new: 0, learning: 0, known: 0, mastered: 0 }
        data.forEach((w) => { if (c[w.status] !== undefined) c[w.status]++ })
        setCounts(c)
      })
  }, [user, targetLang])

  const loadCards = async (mode) => {
    setLoading(true)
    let query = supabase
      .from('words')
      .select('id, word, translation, pos, form, grammar_note, is_exception')
      .eq('user_id', user.id)
      .eq('target_language', targetLang)
      .not('translation', 'is', null)

    if (mode === 'learning') query = query.eq('status', 'learning')
    else if (mode === 'review')  query = query.in('status', ['known', 'mastered'])
    else query = query.in('status', ['learning', 'known', 'mastered'])  // 'all' = active only

    const { data } = await query
    if (!data?.length) { setCards([]); setLoading(false); setPhase('session'); return }

    const filtered = data.filter((w) => w.translation && w.translation.trim() !== '')
    const selected = shuffle(filtered).slice(0, SESSION_SIZE)
    setCards(selected)
    setIndex(0)
    setInput('')
    setSubmitted(false)
    setResults([])
    setLoading(false)
    setPhase('session')
  }

  // Auto-focus input when card changes
  useEffect(() => {
    if (phase === 'session' && !submitted) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [index, phase, submitted])

  const handleSubmit = () => {
    if (!input.trim() || submitted) return
    const card = cards[index]
    const correct = normalise(input) === normalise(card.word)
    setSubmitted(true)
    setResults((r) => [...r, { correct, typed: input.trim() }])
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      if (!submitted) handleSubmit()
      else handleNext()
    }
  }

  const handleNext = () => {
    setInput('')
    setSubmitted(false)
    if (index + 1 >= cards.length) setPhase('done')
    else setIndex((i) => i + 1)
  }

  const handleSpeak = (text) => {
    setSpeaking(true)
    speak(text, speechLocale)
    setTimeout(() => setSpeaking(false), 2500)
  }

  const restart = () => {
    setPhase('picker')
    setCards([])
    setIndex(0)
    setInput('')
    setSubmitted(false)
    setResults([])
  }

  // ── Picker ─────────────────────────────────────────────────────────────────
  if (phase === 'picker') {
    const activeTotal = counts.learning + counts.known + counts.mastered
    const modes = [
      { id: 'learning', label: lang === 'uk' ? 'Вивчаю'     : 'Learning',     count: counts.learning,                color: 'bg-yellow-50 border-yellow-200', dot: 'bg-yellow-400', desc: lang === 'uk' ? 'Слова, які зараз вивчаєш' : 'Words currently in progress' },
      { id: 'review',   label: lang === 'uk' ? 'Повторення' : 'Review',        count: counts.known + counts.mastered, color: 'bg-green-50 border-green-200',   dot: 'bg-green-400',  desc: lang === 'uk' ? 'Відомі та засвоєні слова' : 'Known & mastered words' },
      { id: 'all',      label: lang === 'uk' ? 'Всі активні' : 'All active',   count: activeTotal,                    color: 'bg-indigo-50 border-indigo-200', dot: 'bg-indigo-400', desc: lang === 'uk' ? 'Вивчаю + знаю + засвоїв' : 'Learning + known + mastered' },
    ]
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-teal-50 flex flex-col">
        <nav className="bg-white/80 backdrop-blur border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <div className="text-xl font-bold text-indigo-600">wordy</div>
          <button onClick={() => navigate('/dashboard')} className="text-sm text-gray-500 hover:text-gray-900 transition-colors">← Dashboard</button>
        </nav>
        <div className="flex-1 flex flex-col items-center justify-center px-4">
          <div className="w-full max-w-md">
            <div className="text-center mb-8">
              <div className="text-4xl mb-3">🧠</div>
              <h2 className="text-2xl font-bold text-gray-900 mb-1">{lang === 'uk' ? 'Активне згадування' : 'Active Recall'}</h2>
              <p className="text-sm text-gray-400">{lang === 'uk' ? `Побачиш переклад — напиши слово ${targetLanguageName === 'German' ? 'по-німецьки' : 'по-англійськи'}` : `See the translation — type the ${targetLanguageName} word from memory`}</p>
            </div>
            <div className="flex flex-col gap-3">
              {modes.map((m) => (
                <button
                  key={m.id}
                  onClick={() => loadCards(m.id)}
                  disabled={m.count === 0 || loading}
                  className={`flex items-center justify-between px-5 py-4 rounded-2xl border text-left transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed ${m.color}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${m.dot}`} />
                    <div>
                      <div className="font-semibold text-gray-900 text-sm">{m.label}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{m.desc}</div>
                    </div>
                  </div>
                  <span className="text-sm text-gray-500 font-medium shrink-0 ml-4">{m.count} {lang === 'uk' ? 'слів' : 'words'}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-teal-50 flex items-center justify-center">
        <div className="flex gap-1">
          <span className="w-2 h-2 bg-emerald-300 rounded-full animate-bounce [animation-delay:0ms]" />
          <span className="w-2 h-2 bg-emerald-300 rounded-full animate-bounce [animation-delay:150ms]" />
          <span className="w-2 h-2 bg-emerald-300 rounded-full animate-bounce [animation-delay:300ms]" />
        </div>
      </div>
    )
  }

  // ── Empty ──────────────────────────────────────────────────────────────────
  if (phase === 'session' && cards.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-teal-50 flex flex-col">
        <nav className="bg-white/80 backdrop-blur border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <div className="text-xl font-bold text-indigo-600">wordy</div>
          <button onClick={() => navigate('/dashboard')} className="text-sm text-gray-500 hover:text-gray-900">← Dashboard</button>
        </nav>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-gray-400 mb-4">{lang === 'uk' ? 'Немає слів у цій категорії.' : 'No words in this category.'}</p>
            <button onClick={restart} className="text-indigo-600 text-sm font-semibold hover:underline">← {lang === 'uk' ? 'Назад' : 'Back'}</button>
          </div>
        </div>
      </div>
    )
  }

  // ── Done ───────────────────────────────────────────────────────────────────
  if (phase === 'done') {
    const correct = results.filter((r) => r.correct).length
    const total   = results.length
    const missed  = results.map((r, i) => ({ ...r, card: cards[i] })).filter((r) => !r.correct)
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-teal-50 flex flex-col">
        <nav className="bg-white/80 backdrop-blur border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <div className="text-xl font-bold text-indigo-600">wordy</div>
          <button onClick={() => navigate('/dashboard')} className="text-sm text-gray-500 hover:text-gray-900 transition-colors">← Dashboard</button>
        </nav>
        <div className="flex-1 overflow-y-auto px-4 py-8">
          <div className="max-w-lg mx-auto flex flex-col gap-6">

            {/* Score */}
            <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8 text-center">
              <div className="text-5xl mb-4">{correct === total ? '🏆' : correct >= total * 0.7 ? '👍' : '💪'}</div>
              <h2 className="text-2xl font-bold text-gray-900 mb-1">{lang === 'uk' ? 'Сесію завершено!' : 'Session complete!'}</h2>
              <p className="text-gray-500 text-sm mb-6">{total} {lang === 'uk' ? 'слів' : 'words'}</p>
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-green-50 rounded-2xl p-4">
                  <div className="text-3xl font-bold text-green-600">{correct}</div>
                  <div className="text-xs text-green-700 mt-0.5 font-medium">{lang === 'uk' ? 'Правильно' : 'Correct'}</div>
                </div>
                <div className="bg-red-50 rounded-2xl p-4">
                  <div className="text-3xl font-bold text-red-500">{total - correct}</div>
                  <div className="text-xs text-red-600 mt-0.5 font-medium">{lang === 'uk' ? 'Помилок' : 'Missed'}</div>
                </div>
              </div>
              <div className="flex flex-col gap-3">
                <button onClick={restart} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-2xl font-semibold text-sm transition-colors">
                  {lang === 'uk' ? 'Практикувати знову' : 'Practice again'}
                </button>
                <button onClick={() => navigate('/dashboard')} className="w-full text-gray-500 hover:text-gray-900 py-2 text-sm transition-colors">
                  {lang === 'uk' ? 'На головну' : 'Back to dashboard'}
                </button>
              </div>
            </div>

            {/* Missed words review */}
            {missed.length > 0 && (
              <div className="bg-white rounded-3xl border border-gray-100 p-6">
                <h3 className="text-sm font-semibold text-gray-800 mb-1">
                  {lang === 'uk' ? '📝 Слова для повторення' : '📝 Words to review'}
                </h3>
                <p className="text-xs text-gray-400 mb-5">
                  {lang === 'uk' ? 'Слова, які не вийшло згадати цього разу' : 'Words you didn\'t get this time'}
                </p>
                <div className="flex flex-col gap-3">
                  {missed.map((r, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 py-2 border-b border-gray-50 last:border-0">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-gray-900">{r.card.word}</span>
                          <button
                            onClick={() => handleSpeak(r.card.word.replace(/\(.*?\)/g, '').trim())}
                            className="text-gray-300 hover:text-indigo-400 transition-colors"
                          >
                            {speaking ? '🔊' : '🔈'}
                          </button>
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">{r.card.translation}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs text-red-400">{lang === 'uk' ? 'ви написали:' : 'you typed:'}</div>
                        <div className="text-xs font-medium text-red-500 italic">"{r.typed}"</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    )
  }

  // ── Session ────────────────────────────────────────────────────────────────
  const card = cards[index]
  if (!card) return null
  const progress = (index / cards.length) * 100

  const isCorrect = submitted && normalise(input) === normalise(card.word)
  const isWrong   = submitted && !isCorrect

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-teal-50 flex flex-col">
      {/* Nav */}
      <nav className="bg-white/80 backdrop-blur border-b border-gray-100 px-6 py-4 flex items-center justify-between">
        <div className="text-xl font-bold text-indigo-600">wordy</div>
        <div className="text-sm text-gray-500">{index + 1} / {cards.length}</div>
        <button onClick={() => navigate('/dashboard')} className="text-sm text-gray-400 hover:text-gray-700 transition-colors">
          ✕ {lang === 'uk' ? 'Завершити' : 'End session'}
        </button>
      </nav>

      {/* Progress bar */}
      <div className="h-1 bg-gray-100">
        <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-4 py-8 gap-6">

        {/* POS badge */}
        <div className="text-center">
          {card.pos && (
            <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-white border border-gray-200 text-gray-500">
              {card.pos}
            </span>
          )}
        </div>

        {/* Translation prompt */}
        <div className="w-full max-w-lg bg-white rounded-3xl border border-gray-100 shadow-sm px-8 py-10 text-center">
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-3">
            {lang === 'uk' ? `Як це ${targetLanguageName === 'German' ? 'по-німецьки' : 'по-англійськи'}?` : `How do you say this in ${targetLanguageName}?`}
          </p>
          <p className="text-2xl font-bold text-gray-900 mb-2">{card.translation}</p>
          {card.pos === 'noun' && card.form && (
            <p className="text-xs text-gray-400 mt-1">{lang === 'uk' ? 'іменник' : 'noun'}</p>
          )}
        </div>

        {/* Input */}
        <div className="w-full max-w-lg">
          <div className={`flex items-center gap-3 bg-white rounded-2xl border-2 px-4 py-3 transition-colors ${
            !submitted ? 'border-gray-200 focus-within:border-emerald-400' :
            isCorrect  ? 'border-green-400 bg-green-50' :
                         'border-red-300 bg-red-50'
          }`}>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => !submitted && setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={lang === 'uk' ? `Напишіть ${targetLanguageName === 'German' ? 'по-німецьки' : 'по-англійськи'}…` : `Type in ${targetLanguageName}…`}
              disabled={submitted}
              className="flex-1 text-base font-medium text-gray-800 placeholder-gray-300 outline-none bg-transparent"
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
            />
            {submitted && (
              <span className="text-lg shrink-0">{isCorrect ? '✓' : '✗'}</span>
            )}
          </div>

          {/* Feedback */}
          {submitted && (
            <div className={`mt-3 rounded-2xl px-5 py-4 ${isCorrect ? 'bg-green-50 border border-green-200' : 'bg-white border border-gray-100'}`}>
              {isCorrect ? (
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-green-700">
                    {lang === 'uk' ? '✓ Правильно!' : '✓ Correct!'}
                  </p>
                  <button onClick={() => handleSpeak(card.word.replace(/\(.*?\)/g, '').trim())} className="text-xl ml-3">
                    {speaking ? '🔊' : '🔈'}
                  </button>
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs text-gray-400">{lang === 'uk' ? 'Правильна відповідь:' : 'Correct answer:'}</p>
                    <button onClick={() => handleSpeak(card.word.replace(/\(.*?\)/g, '').trim())} className="text-xl ml-3">
                      {speaking ? '🔊' : '🔈'}
                    </button>
                  </div>
                  <p className="text-lg font-bold text-gray-900">{card.word}</p>
                  {card.form && card.pos !== 'noun' && (
                    <p className="text-xs text-gray-400 italic mt-0.5">{card.form}</p>
                  )}
                  {card.grammar_note && (
                    <p className="text-xs text-gray-500 mt-2 border-t border-gray-100 pt-2">{card.grammar_note}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          {!submitted ? (
            <button
              onClick={handleSubmit}
              disabled={!input.trim()}
              className="px-10 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-200 disabled:cursor-not-allowed text-white rounded-2xl text-sm font-semibold transition-all shadow-sm shadow-emerald-200"
            >
              {lang === 'uk' ? 'Перевірити →' : 'Check →'}
            </button>
          ) : (
            <button
              onClick={handleNext}
              className="px-10 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-sm font-semibold transition-all shadow-sm shadow-emerald-200"
            >
              {index + 1 >= cards.length
                ? (lang === 'uk' ? 'Результати →' : 'Results →')
                : (lang === 'uk' ? 'Далі →' : 'Next →')}
            </button>
          )}
        </div>

        <p className="text-xs text-gray-300">
          {lang === 'uk' ? 'Enter — перевірити / далі' : 'Enter to check · Enter again to continue'}
        </p>

      </div>
    </div>
  )
}
