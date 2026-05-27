import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useLanguage } from '../lib/i18n'
import { useTargetLang } from '../lib/TargetLangContext'
import { reviewSentence } from '../lib/claude'

function renderFeedback(text) {
  const lines = text.split('\n').filter((l) => l.trim())
  return lines.map((line, i) => {
    const parts = line.split(/\*\*(.*?)\*\*/g)
    const rendered = parts.map((part, j) =>
      j % 2 === 1
        ? <strong key={j} className="font-semibold text-gray-900">{part}</strong>
        : part
    )
    return (
      <p key={i} className={`text-sm text-gray-600 leading-relaxed ${i > 0 ? 'mt-2' : ''}`}>
        {rendered}
      </p>
    )
  })
}

const SESSION_SIZE = 8

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function speak(text, locale = 'de-DE') {
  if (!window.speechSynthesis) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = locale
  u.rate = 0.85
  window.speechSynthesis.speak(u)
}

export default function SentenceWriting() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { lang } = useLanguage()
  const { targetLang, targetLanguageName, speechLocale } = useTargetLang()
  const interfaceLanguage = lang === 'uk' ? 'Ukrainian' : 'English'
  const textareaRef = useRef(null)

  const [phase, setPhase]       = useState('picker')
  const [cards, setCards]       = useState([])
  const [counts, setCounts]     = useState({ new: 0, learning: 0, known: 0, mastered: 0 })
  const [loading, setLoading]   = useState(false)
  const [index, setIndex]       = useState(0)
  const [input, setInput]       = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [feedback, setFeedback] = useState(null)   // { isCorrect, corrected, feedback }
  const [results, setResults]   = useState([])
  const [speaking, setSpeaking] = useState(false)

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
      .select('id, word, translation, pos, grammar_note')
      .eq('user_id', user.id)
      .eq('target_language', targetLang)
      .not('translation', 'is', null)

    if (mode === 'learning') query = query.eq('status', 'learning')
    else if (mode === 'review')  query = query.in('status', ['known', 'mastered'])
    else query = query.in('status', ['learning', 'known', 'mastered'])

    const { data } = await query
    if (!data?.length) { setCards([]); setLoading(false); setPhase('session'); return }

    const filtered = data.filter((w) => w.translation?.trim())
    const selected = shuffle(filtered).slice(0, SESSION_SIZE)
    setCards(selected)
    setIndex(0)
    setInput('')
    setFeedback(null)
    setResults([])
    setLoading(false)
    setPhase('session')
  }

  useEffect(() => {
    if (phase === 'session' && !feedback) {
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }, [index, phase, feedback])

  const handleSubmit = async () => {
    if (!input.trim() || reviewing) return
    setReviewing(true)
    const card = cards[index]
    try {
      const result = await reviewSentence(card.word, card.translation, input.trim(), interfaceLanguage, targetLanguageName)
      setFeedback(result)
      setResults((r) => [...r, { correct: result.isCorrect, word: card.word, sentence: input.trim(), corrected: result.corrected }])
    } catch (e) {
      setFeedback({ isCorrect: false, corrected: '', feedback: lang === 'uk' ? 'Помилка перевірки. Спробуйте ще раз.' : 'Review failed. Please try again.' })
    }
    setReviewing(false)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit()
  }

  const handleNext = () => {
    setInput('')
    setFeedback(null)
    if (index + 1 >= cards.length) setPhase('done')
    else setIndex((i) => i + 1)
  }

  const handleTryAgain = () => {
    setInput('')
    setFeedback(null)
    setResults((r) => r.slice(0, -1))   // remove last result so it can be retried
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  const handleSpeak = (text) => {
    setSpeaking(true)
    speak(text, speechLocale)
    setTimeout(() => setSpeaking(false), 3000)
  }

  const restart = () => {
    setPhase('picker')
    setCards([])
    setIndex(0)
    setInput('')
    setFeedback(null)
    setResults([])
  }

  // ── Picker ─────────────────────────────────────────────────────────────────
  if (phase === 'picker') {
    const activeTotal = counts.learning + counts.known + counts.mastered
    const modes = [
      { id: 'learning', label: lang === 'uk' ? 'Вивчаю'      : 'Learning',    count: counts.learning,                color: 'bg-yellow-50 border-yellow-200', dot: 'bg-yellow-400', desc: lang === 'uk' ? 'Слова, які зараз вивчаєш' : 'Words currently in progress' },
      { id: 'review',   label: lang === 'uk' ? 'Повторення'  : 'Review',      count: counts.known + counts.mastered, color: 'bg-green-50 border-green-200',   dot: 'bg-green-400',  desc: lang === 'uk' ? 'Відомі та засвоєні слова' : 'Known & mastered words' },
      { id: 'all',      label: lang === 'uk' ? 'Всі активні' : 'All active',  count: activeTotal,                    color: 'bg-indigo-50 border-indigo-200', dot: 'bg-indigo-400', desc: lang === 'uk' ? 'Вивчаю + знаю + засвоїв' : 'Learning + known + mastered' },
    ]
    return (
      <div className="min-h-screen bg-gradient-to-br from-rose-50 via-white to-orange-50 flex flex-col">
        <nav className="bg-white/80 backdrop-blur border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <div className="text-xl font-bold text-indigo-600">wordy</div>
          <button onClick={() => navigate('/dashboard')} className="text-sm text-gray-500 hover:text-gray-900 transition-colors">← Dashboard</button>
        </nav>
        <div className="flex-1 flex flex-col items-center justify-center px-4">
          <div className="w-full max-w-md">
            <div className="text-center mb-8">
              <div className="text-4xl mb-3">✍️</div>
              <h2 className="text-2xl font-bold text-gray-900 mb-1">{lang === 'uk' ? 'Написання речень' : 'Sentence Writing'}</h2>
              <p className="text-sm text-gray-400">{lang === 'uk' ? 'Напиши речення — Claude перевірить і поясне помилки' : 'Write a sentence — Claude will correct and explain any mistakes'}</p>
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
      <div className="min-h-screen bg-gradient-to-br from-rose-50 via-white to-orange-50 flex items-center justify-center">
        <div className="flex gap-1">
          <span className="w-2 h-2 bg-rose-300 rounded-full animate-bounce [animation-delay:0ms]" />
          <span className="w-2 h-2 bg-rose-300 rounded-full animate-bounce [animation-delay:150ms]" />
          <span className="w-2 h-2 bg-rose-300 rounded-full animate-bounce [animation-delay:300ms]" />
        </div>
      </div>
    )
  }

  // ── Empty ──────────────────────────────────────────────────────────────────
  if (phase === 'session' && cards.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-rose-50 via-white to-orange-50 flex flex-col">
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
    return (
      <div className="min-h-screen bg-gradient-to-br from-rose-50 via-white to-orange-50 flex flex-col">
        <nav className="bg-white/80 backdrop-blur border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <div className="text-xl font-bold text-indigo-600">wordy</div>
          <button onClick={() => navigate('/dashboard')} className="text-sm text-gray-500 hover:text-gray-900 transition-colors">← Dashboard</button>
        </nav>
        <div className="flex-1 overflow-y-auto px-4 py-8">
          <div className="max-w-lg mx-auto flex flex-col gap-6">

            <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8 text-center">
              <div className="text-5xl mb-4">{correct === total ? '🏆' : correct >= total * 0.6 ? '👍' : '💪'}</div>
              <h2 className="text-2xl font-bold text-gray-900 mb-1">{lang === 'uk' ? 'Сесію завершено!' : 'Session complete!'}</h2>
              <p className="text-gray-500 text-sm mb-6">{total} {lang === 'uk' ? 'речень написано' : 'sentences written'}</p>
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-green-50 rounded-2xl p-4">
                  <div className="text-3xl font-bold text-green-600">{correct}</div>
                  <div className="text-xs text-green-700 mt-1 font-medium">{lang === 'uk' ? 'Правильно' : 'Correct'}</div>
                </div>
                <div className="bg-red-50 rounded-2xl p-4">
                  <div className="text-3xl font-bold text-red-500">{total - correct}</div>
                  <div className="text-xs text-red-600 mt-1 font-medium">{lang === 'uk' ? 'З помилками' : 'Had errors'}</div>
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

            {/* Session review */}
            <div className="bg-white rounded-3xl border border-gray-100 p-6">
              <h3 className="text-sm font-semibold text-gray-800 mb-5">
                {lang === 'uk' ? '📝 Огляд сесії' : '📝 Session review'}
              </h3>
              <div className="flex flex-col gap-5">
                {results.map((r, i) => (
                  <div key={i} className={`rounded-2xl p-4 ${r.correct ? 'bg-green-50 border border-green-100' : 'bg-gray-50 border border-gray-100'}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-xs font-bold ${r.correct ? 'text-green-600' : 'text-red-400'}`}>{r.correct ? '✓' : '✗'}</span>
                      <span className="text-xs font-semibold text-gray-700">{r.word}</span>
                    </div>
                    <p className="text-sm text-gray-600 italic mb-1">"{r.sentence}"</p>
                    {!r.correct && r.corrected && (
                      <div className="flex items-center gap-2 mt-2">
                        <p className="text-sm font-medium text-gray-800">→ "{r.corrected}"</p>
                        <button onClick={() => handleSpeak(r.corrected)} className="text-gray-300 hover:text-indigo-400 transition-colors">
                          {speaking ? '🔊' : '🔈'}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      </div>
    )
  }

  // ── Session ────────────────────────────────────────────────────────────────
  const card = cards[index]
  if (!card) return null
  const progress = (index / cards.length) * 100

  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 via-white to-orange-50 flex flex-col">
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
        <div className="h-full bg-rose-400 transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-4 py-8 gap-5">

        {/* Word card */}
        <div className="w-full max-w-lg bg-white rounded-3xl border border-gray-100 shadow-sm px-8 py-8 text-center">
          {card.pos && (
            <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-500 mb-4 inline-block">
              {card.pos}
            </span>
          )}
          <div className="text-3xl font-bold text-gray-900 mt-2 mb-2">{card.word}</div>
          <div className="text-base text-gray-500">{card.translation}</div>
          {card.grammar_note && (
            <div className="mt-3 text-xs text-indigo-500 bg-indigo-50 rounded-xl px-3 py-2 inline-block">
              {card.grammar_note}
            </div>
          )}
        </div>

        {/* Text input */}
        <div className="w-full max-w-lg">
          <p className="text-xs text-gray-400 text-center mb-2">
            {lang === 'uk' ? `Напиши речення з цим словом ${targetLanguageName === 'German' ? 'по-німецьки' : 'по-англійськи'}` : `Write a ${targetLanguageName} sentence using this word`}
          </p>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => !feedback && setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!!feedback}
            placeholder={lang === 'uk' ? 'Напишіть речення…' : 'Write your sentence…'}
            rows={3}
            className={`w-full resize-none rounded-2xl border-2 px-4 py-3 text-sm text-gray-800 placeholder-gray-300 outline-none transition-colors ${
              !feedback ? 'border-gray-200 focus:border-rose-300 bg-white' :
              feedback.isCorrect ? 'border-green-300 bg-green-50' :
              'border-orange-200 bg-orange-50'
            }`}
          />
          <p className="text-xs text-gray-300 mt-1 text-right">
            {lang === 'uk' ? 'Cmd+Enter — надіслати' : 'Cmd+Enter to submit'}
          </p>
        </div>

        {/* Feedback box */}
        {feedback && (
          <div className={`w-full max-w-lg rounded-2xl px-5 py-4 border ${
            feedback.isCorrect ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'
          }`}>
            {feedback.isCorrect ? (
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-green-700">
                  {lang === 'uk' ? '✓ Відмінно!' : '✓ Great sentence!'}
                </p>
                <button onClick={() => handleSpeak(input)} className="text-gray-300 hover:text-indigo-400 text-lg transition-colors ml-3">
                  {speaking ? '🔊' : '🔈'}
                </button>
              </div>
            ) : (
              <div className="mb-3">
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-xs text-gray-400">{lang === 'uk' ? 'Виправлено:' : 'Corrected:'}</p>
                  <button onClick={() => handleSpeak(feedback.corrected)} className="text-gray-300 hover:text-indigo-400 text-lg transition-colors">
                    {speaking ? '🔊' : '🔈'}
                  </button>
                </div>
                <p className="text-base font-semibold text-gray-900 mb-3">{feedback.corrected}</p>
              </div>
            )}
            <div className="space-y-1">{renderFeedback(feedback.feedback)}</div>

            {/* Ask Claude button */}
            {!feedback.isCorrect && (
              <button
                onClick={() => {
                  const context = `I was doing a sentence writing exercise for the word "${card.word}" (${card.translation}).\n\nI wrote: "${input}"\n\nThe corrected version is: "${feedback.corrected}"\n\nCan you explain the mistake in more detail?`
                  localStorage.setItem('wordy_chat_prefill', context)
                  localStorage.setItem('wordy_exercise_return', JSON.stringify({
                    path: '/sentence-writing',
                    label: lang === 'uk' ? 'Повернутись до вправи' : 'Resume sentence writing',
                  }))
                  navigate('/chat')
                }}
                className="mt-4 w-full py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 border border-indigo-100 rounded-xl text-xs font-medium transition-colors"
              >
                💬 {lang === 'uk' ? 'Не зрозуміло — запитати Claude' : 'Still confused? Ask Claude →'}
              </button>
            )}
          </div>
        )}

        {/* Actions */}
        {!feedback ? (
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || reviewing}
            className="px-10 py-2.5 bg-rose-500 hover:bg-rose-600 disabled:bg-gray-200 disabled:cursor-not-allowed text-white rounded-2xl text-sm font-semibold transition-all shadow-sm"
          >
            {reviewing
              ? (lang === 'uk' ? 'Перевіряю…' : 'Reviewing…')
              : (lang === 'uk' ? 'Перевірити →' : 'Submit →')}
          </button>
        ) : (
          <div className="flex gap-3">
            {!feedback.isCorrect && (
              <button
                onClick={handleTryAgain}
                className="px-6 py-2.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-600 rounded-2xl text-sm font-medium transition-all"
              >
                {lang === 'uk' ? '↩ Спробувати ще' : '↩ Try again'}
              </button>
            )}
            <button
              onClick={handleNext}
              className="px-8 py-2.5 bg-rose-500 hover:bg-rose-600 text-white rounded-2xl text-sm font-semibold transition-all shadow-sm"
            >
              {index + 1 >= cards.length
                ? (lang === 'uk' ? 'Результати →' : 'Results →')
                : (lang === 'uk' ? 'Далі →' : 'Next word →')}
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
