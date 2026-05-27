import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useLanguage } from '../lib/i18n'
import { useTargetLang } from '../lib/TargetLangContext'
import { inSession, advanceSession, nextExerciseName } from '../lib/sessionFlow'

const POS_LABELS = {
  verb: 'verb', noun: 'noun', adjective: 'adj.',
  adverb: 'adv.', conjunction: 'conj.', preposition: 'prep.',
}

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function speak(text, lang = 'de-DE') {
  if (!window.speechSynthesis) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = lang
  u.rate = 0.85
  window.speechSynthesis.speak(u)
}

// ── Spaced repetition helpers ──────────────────────────────────────────────

function addDays(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString().split('T')[0]
}

function computeReview(interval, result) {
  const i = interval ?? 1
  switch (result) {
    case 'difficult':
    case 'practice':
      return { next_review_date: addDays(1), review_interval: 1 }
    case 'almost':
      return { next_review_date: addDays(Math.max(1, i)), review_interval: Math.max(1, i) }
    case 'easy': {
      const next = Math.min(i <= 1 ? 2 : Math.round(i * 2), 30)
      return { next_review_date: addDays(next), review_interval: next }
    }
    default:
      return { next_review_date: addDays(1), review_interval: 1 }
  }
}

function computeStatus(status, result, newInterval) {
  if (result === 'easy') {
    if (newInterval >= 21) return 'mastered'
    if (newInterval >= 7)  return 'known'
    if (status === 'new')  return 'learning'
  }
  if (result === 'difficult') {
    if (status === 'mastered') return 'known'
    if (status === 'known')    return 'learning'
  }
  return status
}

// ── Component ──────────────────────────────────────────────────────────────

export default function Flashcards() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { lang } = useLanguage()
  const { targetLang, speechLocale } = useTargetLang()

  const [phase, setPhase]       = useState('picker')   // 'picker' | 'session' | 'done'
  const [cards, setCards]       = useState([])
  const [counts, setCounts]     = useState({ new: 0, learning: 0, known: 0, mastered: 0, due: 0 })
  const [loading, setLoading]   = useState(false)
  const [index, setIndex]       = useState(0)
  const [flipped, setFlipped]   = useState(false)
  const [results, setResults]   = useState([])
  const [speaking, setSpeaking] = useState(false)

  // Load status counts + today's due count on mount
  useEffect(() => {
    if (!user) return
    const today = new Date().toISOString().split('T')[0]

    Promise.all([
      supabase.from('words').select('status').eq('user_id', user.id).eq('target_language', targetLang),
      supabase.from('words').select('id').eq('user_id', user.id).eq('target_language', targetLang)
        .lte('next_review_date', today).neq('status', 'new'),
    ]).then(([{ data: statusData }, { data: dueData }]) => {
      if (!statusData) return
      const c = { new: 0, learning: 0, known: 0, mastered: 0 }
      statusData.forEach((w) => { if (c[w.status] !== undefined) c[w.status]++ })
      setCounts({ ...c, due: dueData?.length ?? 0 })
    })
  }, [user, targetLang])

  const loadCards = async (mode) => {
    setLoading(true)
    const today = new Date().toISOString().split('T')[0]

    let wordData = []

    if (mode === 'today') {
      const [{ data: dueWords }, { data: newWords }] = await Promise.all([
        supabase
          .from('words')
          .select('id, word, form, pos, translation, grammar_note, is_exception, status, review_interval')
          .eq('user_id', user.id).eq('target_language', targetLang)
          .lte('next_review_date', today)
          .neq('status', 'new')
          .order('next_review_date', { ascending: true })
          .limit(15),
        supabase
          .from('words')
          .select('id, word, form, pos, translation, grammar_note, is_exception, status, review_interval')
          .eq('user_id', user.id).eq('target_language', targetLang)
          .eq('status', 'new')
          .limit(5),
      ])
      wordData = [...(dueWords ?? []), ...(newWords ?? [])]
    } else {
      let query = supabase
        .from('words')
        .select('id, word, form, pos, translation, grammar_note, is_exception, status, review_interval')
        .eq('user_id', user.id).eq('target_language', targetLang)
        .order('created_at', { ascending: false })

      if (mode === 'new')           query = query.eq('status', 'new')
      else if (mode === 'learning') query = query.eq('status', 'learning')
      else if (mode === 'review')   query = query.in('status', ['known', 'mastered'])
      // 'all' — no filter

      const { data } = await query
      wordData = data ?? []
    }

    if (wordData.length === 0) {
      setCards([])
      setLoading(false)
      setPhase('session')
      return
    }

    // Fetch one example per word
    const wordIds = wordData.map((w) => w.id)
    const { data: exampleData } = await supabase
      .from('examples')
      .select('word_id, sentence_target, sentence_translation')
      .in('word_id', wordIds)

    const exampleMap = {}
    if (exampleData) {
      exampleData.forEach((ex) => {
        if (!exampleMap[ex.word_id]) exampleMap[ex.word_id] = ex
      })
    }

    const mapped = wordData
      .filter((w) => w.translation && w.translation.trim() !== '')
      .map((w) => ({
        id:                 w.id,
        word:               w.word,
        form:               w.form,
        pos:                w.pos || 'noun',
        translation:        w.translation,
        grammarNote:        w.grammar_note,
        isException:        w.is_exception,
        status:             w.status,
        reviewInterval:     w.review_interval ?? 1,
        example:            exampleMap[w.id]?.sentence_target ?? null,
        exampleTranslation: exampleMap[w.id]?.sentence_translation ?? null,
      }))

    setCards(shuffle(mapped))
    setIndex(0)
    setResults([])
    setFlipped(false)
    setLoading(false)
    setPhase('session')
  }

  useEffect(() => { setFlipped(false) }, [index])

  const handleSpeak = (text, e) => {
    e.stopPropagation()
    setSpeaking(true)
    speak(text, speechLocale)
    setTimeout(() => setSpeaking(false), 1500)
  }

  const handleResult = async (result) => {
    const card = cards[index]
    const next = [...results, { id: card.id, result }]
    setResults(next)

    // Compute and save spaced rep
    const { next_review_date, review_interval } = computeReview(card.reviewInterval, result)
    const newStatus = computeStatus(card.status, result, review_interval)
    const updates = { next_review_date, review_interval }
    if (newStatus !== card.status) updates.status = newStatus
    supabase.from('words').update(updates).eq('id', card.id).then()

    if (index + 1 >= cards.length) {
      setPhase('done')
    } else {
      setIndex((i) => i + 1)
    }
  }

  const restart = () => {
    setPhase('picker')
    setCards([])
    setIndex(0)
    setResults([])
    setFlipped(false)
  }

  // ── Session picker ─────────────────────────────────────────────────────────
  if (phase === 'picker') {
    const total    = counts.new + counts.learning + counts.known + counts.mastered
    const newToday   = Math.min(counts.new, 5)
    const dueToday   = Math.min(counts.due, 15)
    const todayTotal = dueToday + newToday

    const modes = [
      ...(todayTotal > 0 ? [{
        id: 'today',
        label:   lang === 'uk' ? 'План на сьогодні' : "Today's plan",
        count:   todayTotal,
        color:   'bg-indigo-50 border-indigo-300',
        dot:     'bg-indigo-500',
        desc:    lang === 'uk'
          ? `${dueToday} до повторення · ${newToday} нових`
          : `${dueToday} due for review · ${newToday} new`,
        highlight: true,
      }] : []),
      {
        id: 'new',
        label:   lang === 'uk' ? 'Нові'       : 'New',
        count:   counts.new,
        color:   'bg-gray-50 border-gray-200',
        dot:     'bg-gray-400',
        desc:    lang === 'uk' ? 'Слова, які ви ще не вивчали' : "Words you haven't studied yet",
      },
      {
        id: 'learning',
        label:   lang === 'uk' ? 'Вивчаю'     : 'Learning',
        count:   counts.learning,
        color:   'bg-yellow-50 border-yellow-200',
        dot:     'bg-yellow-400',
        desc:    lang === 'uk' ? 'Слова в процесі вивчення' : 'Words in progress',
      },
      {
        id: 'review',
        label:   lang === 'uk' ? 'Повторення' : 'Review',
        count:   counts.known + counts.mastered,
        color:   'bg-green-50 border-green-200',
        dot:     'bg-green-400',
        desc:    lang === 'uk' ? 'Відомі та засвоєні слова' : 'Known & mastered words',
      },
      {
        id: 'all',
        label:   lang === 'uk' ? 'Всі слова'  : 'All words',
        count:   total,
        color:   'bg-purple-50 border-purple-200',
        dot:     'bg-purple-400',
        desc:    lang === 'uk' ? 'Повний словник' : 'Your full dictionary',
      },
    ]

    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex flex-col">
        <nav className="bg-white/80 backdrop-blur border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <div className="text-xl font-bold text-indigo-600">wordy</div>
          <button onClick={() => navigate('/dashboard')} className="text-sm text-gray-500 hover:text-gray-900 transition-colors">← Dashboard</button>
        </nav>
        <div className="flex-1 flex flex-col items-center justify-center px-4">
          <div className="w-full max-w-md">
            <div className="text-center mb-8">
              <div className="text-4xl mb-3">🃏</div>
              <h2 className="text-2xl font-bold text-gray-900 mb-1">
                {lang === 'uk' ? 'Флеш-картки' : 'Flashcards'}
              </h2>
              <p className="text-sm text-gray-400">
                {lang === 'uk' ? 'Які слова практикувати сьогодні?' : 'Which words do you want to practice today?'}
              </p>
            </div>

            <div className="flex flex-col gap-3">
              {modes.map((m) => (
                <button
                  key={m.id}
                  onClick={() => loadCards(m.id)}
                  disabled={m.count === 0 || loading}
                  className={`flex items-center justify-between px-5 py-4 rounded-2xl border-2 text-left transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed ${m.color} ${m.highlight ? 'shadow-md shadow-indigo-100' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${m.dot}`} />
                    <div>
                      <div className="font-semibold text-gray-900 text-sm flex items-center gap-2">
                        {m.label}
                        {m.highlight && (
                          <span className="text-xs bg-indigo-600 text-white px-2 py-0.5 rounded-full font-medium">
                            {lang === 'uk' ? 'рекомендовано' : 'recommended'}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">{m.desc}</div>
                    </div>
                  </div>
                  <span className="text-sm text-gray-500 font-medium shrink-0 ml-4">
                    {m.count} {lang === 'uk' ? 'слів' : 'words'}
                  </span>
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
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center">
        <div className="flex gap-1">
          <span className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce [animation-delay:0ms]" />
          <span className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce [animation-delay:150ms]" />
          <span className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce [animation-delay:300ms]" />
        </div>
      </div>
    )
  }

  // ── Empty state ────────────────────────────────────────────────────────────
  if (phase === 'session' && cards.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex flex-col">
        <nav className="bg-white/80 backdrop-blur border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <div className="text-xl font-bold text-indigo-600">wordy</div>
          <button onClick={() => navigate('/dashboard')} className="text-sm text-gray-500 hover:text-gray-900">← Dashboard</button>
        </nav>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-4xl mb-4">✅</div>
            <p className="text-gray-700 font-semibold mb-1">
              {lang === 'uk' ? 'Все повторено на сьогодні!' : "You're all caught up!"}
            </p>
            <p className="text-gray-400 text-sm mb-4">
              {lang === 'uk' ? 'Немає слів у цій категорії.' : 'No words in this category.'}
            </p>
            <button onClick={restart} className="text-indigo-600 text-sm font-semibold hover:underline">
              ← {lang === 'uk' ? 'Назад' : 'Back'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Done screen ────────────────────────────────────────────────────────────
  if (phase === 'done') {
    const easy      = results.filter((r) => r.result === 'easy').length
    const almost    = results.filter((r) => r.result === 'almost').length
    const difficult = results.filter((r) => r.result === 'difficult').length
    const practice  = results.filter((r) => r.result === 'practice').length
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex flex-col">
        <nav className="bg-white/80 backdrop-blur border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <div className="text-xl font-bold text-indigo-600">wordy</div>
          <button onClick={() => navigate('/dashboard')} className="text-sm text-gray-500 hover:text-gray-900 transition-colors">← Dashboard</button>
        </nav>
        <div className="flex-1 flex flex-col items-center justify-center px-4">
          <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-10 w-full max-w-md text-center">
            <div className="text-5xl mb-4">🎉</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-1">
              {lang === 'uk' ? 'Сесію завершено!' : 'Session complete!'}
            </h2>
            <p className="text-gray-500 text-sm mb-8">
              {cards.length} {lang === 'uk' ? 'карток переглянуто' : 'cards reviewed'}
            </p>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="bg-red-50 rounded-2xl p-4">
                <div className="text-2xl font-bold text-red-500">{difficult}</div>
                <div className="text-xs text-red-600 mt-0.5 font-medium">{lang === 'uk' ? 'Важко' : 'Difficult'}</div>
              </div>
              <div className="bg-yellow-50 rounded-2xl p-4">
                <div className="text-2xl font-bold text-yellow-500">{almost}</div>
                <div className="text-xs text-yellow-600 mt-0.5 font-medium">{lang === 'uk' ? 'Майже' : 'Almost'}</div>
              </div>
              <div className="bg-green-50 rounded-2xl p-4">
                <div className="text-2xl font-bold text-green-600">{easy}</div>
                <div className="text-xs text-green-700 mt-0.5 font-medium">{lang === 'uk' ? 'Знаю' : 'Got it'}</div>
              </div>
            </div>
            {practice > 0 && (
              <div className="bg-indigo-50 rounded-2xl px-4 py-3 mb-6 text-sm text-indigo-700 font-medium">
                {practice} {lang === 'uk'
                  ? `слів${practice > 1 ? '' : 'о'} додано до наступної сесії`
                  : `word${practice > 1 ? 's' : ''} added to next session`}
              </div>
            )}
            <div className="flex flex-col gap-3 mt-4">
              {inSession() ? (
                <button
                  onClick={() => advanceSession(navigate)}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-2xl font-semibold text-sm transition-colors"
                >
                  {nextExerciseName(lang)
                    ? `${lang === 'uk' ? 'Далі' : 'Next'}: ${nextExerciseName(lang)} →`
                    : (lang === 'uk' ? 'Завершити сесію →' : 'Finish session →')}
                </button>
              ) : (
                <button
                  onClick={restart}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-2xl font-semibold text-sm transition-colors"
                >
                  {lang === 'uk' ? 'Практикувати знову' : 'Practice again'}
                </button>
              )}
              <button
                onClick={() => navigate('/dashboard')}
                className="w-full text-gray-500 hover:text-gray-900 py-2 text-sm transition-colors"
              >
                {lang === 'uk' ? 'На головну' : 'Back to dashboard'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Session ────────────────────────────────────────────────────────────────
  const card = cards[index]
  const progress = (index / cards.length) * 100

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex flex-col">
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
        <div className="h-full bg-indigo-500 transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-4 py-8">
        {!flipped && (
          <p className="text-xs text-gray-400 mb-4 tracking-wide">
            {lang === 'uk' ? 'Натисніть, щоб перевернути' : 'Tap the card to reveal'}
          </p>
        )}

        {/* Card */}
        <div
          className="w-full max-w-lg cursor-pointer"
          style={{ perspective: '1200px' }}
          onClick={() => setFlipped((f) => !f)}
        >
          <div
            className="relative transition-transform duration-500"
            style={{
              transformStyle: 'preserve-3d',
              transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
              minHeight: '340px',
            }}
          >
            {/* Front */}
            <div
              className="absolute inset-0 bg-indigo-600 rounded-3xl shadow-xl flex flex-col items-center justify-center p-8"
              style={{ backfaceVisibility: 'hidden' }}
            >
              <span className="px-2.5 py-0.5 rounded-md text-xs font-semibold mb-6 bg-white/20 text-white border border-white/30">
                {POS_LABELS[card.pos] || card.pos}
              </span>
              <div className="text-4xl font-bold text-white text-center mb-3">{card.word}</div>
              {card.form && card.pos !== 'noun' && (
                <div className="text-sm text-indigo-200 italic mb-4">{card.form}</div>
              )}
              <button
                onClick={(e) => handleSpeak(card.word.replace(/\(.*?\)/g, '').trim(), e)}
                className={`mt-2 flex items-center gap-2 px-4 py-2 rounded-full border text-sm transition-all ${
                  speaking
                    ? 'border-white bg-white/20 text-white'
                    : 'border-white/30 text-indigo-200 hover:border-white hover:text-white'
                }`}
              >
                <span>{speaking ? '🔊' : '🔈'}</span>
                {speaking
                  ? (lang === 'uk' ? 'Грає…' : 'Playing…')
                  : (lang === 'uk' ? 'Вимова' : 'Pronounce')}
              </button>
            </div>

            {/* Back */}
            <div
              className="absolute inset-0 bg-white rounded-3xl shadow-xl border border-gray-100 flex flex-col p-8 overflow-y-auto"
              style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
            >
              {/* Translation */}
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">
                    {lang === 'uk' ? 'Переклад' : 'Translation'}
                  </div>
                  <div className="text-2xl font-bold text-gray-900">{card.translation}</div>
                </div>
                <button
                  onClick={(e) => handleSpeak(card.word.replace(/\(.*?\)/g, '').trim(), e)}
                  className="text-gray-300 hover:text-indigo-500 transition-colors text-xl ml-4 mt-1"
                  title="Pronounce"
                >
                  🔈
                </button>
              </div>

              {/* Example */}
              {card.example && (
                <div className="bg-gray-50 rounded-2xl p-4 mb-4">
                  <div className="text-sm font-medium text-gray-800 mb-1">
                    "{card.example}"
                    <button
                      onClick={(e) => handleSpeak(card.example, e)}
                      className="ml-2 text-gray-300 hover:text-indigo-400 transition-colors"
                    >
                      🔈
                    </button>
                  </div>
                  {card.exampleTranslation && (
                    <div className="text-xs text-gray-400 italic">{card.exampleTranslation}</div>
                  )}
                </div>
              )}

              {/* Grammar note */}
              {card.grammarNote && (
                <div className={`rounded-xl px-4 py-3 mb-4 text-xs font-medium flex items-center gap-2 ${
                  card.isException
                    ? 'bg-amber-50 text-amber-800 border border-amber-100'
                    : 'bg-indigo-50 text-indigo-800 border border-indigo-100'
                }`}>
                  <span>{card.isException ? '⚠️' : 'ℹ️'}</span>
                  {card.grammarNote}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Result buttons — only after flip */}
        <div className={`mt-8 w-full max-w-lg flex flex-col gap-2 transition-all duration-300 ${flipped ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'}`}>
          <div className="flex gap-2">
            <button
              onClick={() => handleResult('difficult')}
              className="flex-1 py-3 bg-red-500 hover:bg-red-600 active:scale-95 text-white rounded-2xl text-sm font-semibold transition-all"
            >
              {lang === 'uk' ? 'Важко' : 'Difficult'}
            </button>
            <button
              onClick={() => handleResult('almost')}
              className="flex-1 py-3 bg-yellow-400 hover:bg-yellow-500 active:scale-95 text-white rounded-2xl text-sm font-semibold transition-all"
            >
              {lang === 'uk' ? 'Майже' : 'Almost'}
            </button>
            <button
              onClick={() => handleResult('easy')}
              className="flex-1 py-3 bg-green-500 hover:bg-green-600 active:scale-95 text-white rounded-2xl text-sm font-semibold transition-all shadow-sm shadow-green-200"
            >
              {lang === 'uk' ? 'Знаю' : 'Got it'}
            </button>
          </div>

          <button
            onClick={() => handleResult('practice')}
            className="w-full py-2.5 bg-indigo-50 hover:bg-indigo-100 active:scale-95 text-indigo-600 border border-indigo-100 rounded-2xl text-sm font-medium transition-all"
          >
            + {lang === 'uk' ? 'Додати до наступної сесії' : 'Add to next session'}
          </button>
        </div>

        {flipped && (
          <button
            onClick={() => setFlipped(false)}
            className="mt-3 text-xs text-gray-300 hover:text-gray-500 transition-colors"
          >
            ↩ {lang === 'uk' ? 'Перевернути' : 'Flip back'}
          </button>
        )}
      </div>
    </div>
  )
}
