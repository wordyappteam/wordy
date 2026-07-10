import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useLanguage } from '../lib/i18n'
import { useTargetLang } from '../lib/TargetLangContext'
import { inSession, advanceSession, nextExerciseName } from '../lib/sessionFlow'
import { identifyWord, translateSentences } from '../lib/claude'

const SESSION_SIZE = 10

// Rough check: do two sentences look like they're in the same language?
// Used to detect a degenerate prompt (e.g. an English example shown to an
// English learner) so we can re-translate it into a language they know.
function sameLanguage(a, b) {
  const words = (s) => new Set(
    s.toLowerCase().replace(/[.,!?;:"""„»«''()\-–—]/g, '').split(/\s+/).filter(Boolean)
  )
  const A = words(a), B = words(b)
  if (!A.size || !B.size) return false
  let common = 0
  for (const w of A) if (B.has(w)) common++
  return common / Math.min(A.size, B.size) >= 0.5
}

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function normalise(w) {
  return w.toLowerCase().replace(/[.,!?;:"""„»«'']/g, '').trim()
}

function speak(text, locale = 'de-DE') {
  if (!window.speechSynthesis) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = locale
  u.rate = 0.85
  window.speechSynthesis.speak(u)
}

export default function WordOrder() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { lang } = useLanguage()
  const { targetLang, targetLanguageName, speechLocale } = useTargetLang()
  const interfaceLanguage = lang === 'uk' ? 'Ukrainian' : 'English'

  const [phase, setPhase]       = useState('picker')   // picker | session | done
  const [cards, setCards]       = useState([])
  const [counts, setCounts]     = useState({ new: 0, learning: 0, known: 0, mastered: 0 })
  const [loading, setLoading]   = useState(false)
  const [index, setIndex]       = useState(0)
  const [placed, setPlaced]     = useState([])          // { key, word }[]
  const [bank, setBank]         = useState([])          // { key, word }[]
  const [checked, setChecked]       = useState(false)
  const [results, setResults]       = useState([])   // { correct: bool }[]
  const [speaking, setSpeaking]     = useState(false)
  const [wordStatuses, setWordStatuses] = useState({}) // key → 'loading'|'added'|'error'

  // Load sense counts on mount
  useEffect(() => {
    if (!user) return
    supabase
      .from('word_senses')
      .select('learning_stage, word_id')
      .eq('user_id', user.id)
      .eq('target_language', targetLang)
      .then(({ data }) => {
        if (!data) return
        const c = { new: 0, learning: 0, known: 0, mastered: 0 }
        data.forEach(({ learning_stage: s }) => {
          if (s === 'new') c.new++
          else if (s === 'early' || s === 'mid' || s === 'late') c.learning++
          else if (s === 'known') c.known++
          else if (s === 'mastered') c.mastered++
        })
        setCounts(c)
      })
  }, [user, targetLang])

  const loadCards = async (mode) => {
    setLoading(true)

    let query = supabase
      .from('word_senses')
      .select('word_id, word_form, examples')
      .eq('user_id', user.id)
      .eq('target_language', targetLang)

    if (mode === 'new')           query = query.eq('learning_stage', 'new')
    else if (mode === 'learning') query = query.in('learning_stage', ['early', 'mid', 'late'])
    else if (mode === 'review')   query = query.in('learning_stage', ['known', 'mastered'])

    const { data: senseData } = await query
    if (!senseData?.length) { setCards([]); setLoading(false); setPhase('session'); return }

    // Primary source: inline examples on each sense (JSONB { target, translation }).
    const allCards = []
    const headwordById = {}
    const wordsNeedingLegacy = []

    for (const s of senseData) {
      if (!headwordById[s.word_id]) headwordById[s.word_id] = s.word_form
      const exs = Array.isArray(s.examples) ? s.examples : []
      if (exs.length === 0) { wordsNeedingLegacy.push(s.word_id); continue }
      for (const ex of exs) {
        const target = (ex.target ?? ex.sentence_target ?? '').trim()
        const translation = ex.translation ?? ex.sentence_translation ?? ''
        if (!target || !translation) continue
        const words = target.split(/\s+/)
        if (words.length < 3) continue
        allCards.push({ id: s.word_id, headword: s.word_form, german: target, english: translation, words })
      }
    }

    // Fallback: legacy `examples` table for words whose senses carry no inline examples.
    if (wordsNeedingLegacy.length) {
      const { data: legacy } = await supabase
        .from('examples')
        .select('word_id, sentence_target, sentence_translation')
        .in('word_id', wordsNeedingLegacy)
      for (const ex of legacy ?? []) {
        const target = (ex.sentence_target ?? '').trim()
        if (!target || !ex.sentence_translation) continue
        const words = target.split(/\s+/)
        if (words.length < 3) continue
        allCards.push({ id: ex.word_id, headword: headwordById[ex.word_id], german: target, english: ex.sentence_translation, words })
      }
    }

    if (!allCards.length) { setCards([]); setLoading(false); setPhase('session'); return }

    const selected = shuffle(allCards).slice(0, SESSION_SIZE)

    // The prompt must be in a language the learner knows but isn't learning.
    // Use the interface language; if that IS the target language, fall back to
    // the other supported interface language.
    let promptLang = interfaceLanguage
    if (promptLang === targetLanguageName) {
      promptLang = interfaceLanguage === 'English' ? 'Ukrainian' : 'English'
    }

    // Re-translate any card whose stored prompt is in the target language
    // (degenerate: e.g. an English example shown to an English learner).
    const degenerate = selected.filter((c) => sameLanguage(c.english, c.german))
    if (degenerate.length) {
      try {
        const translated = await translateSentences(degenerate.map((c) => c.german), promptLang)
        degenerate.forEach((c, i) => { if (translated[i]) c.english = translated[i] })
      } catch (e) {
        console.error('WordOrder prompt translation failed:', e)
      }
    }

    setCards(selected)
    setIndex(0)
    setResults([])
    setLoading(false)
    setPhase('session')
  }

  // Initialise chip state whenever index or cards change
  useEffect(() => {
    if (!cards.length || phase !== 'session') return
    const card = cards[index]
    const chips = shuffle(card.words.map((w, i) => ({ key: `${i}-${w}`, word: w })))
    setPlaced([])
    setBank(chips)
    setChecked(false)
  }, [index, cards, phase])

  const placeWord = (chip) => {
    if (checked) return
    setBank((b) => b.filter((c) => c.key !== chip.key))
    setPlaced((p) => [...p, chip])
  }

  const returnWord = (chip) => {
    if (checked) return
    setPlaced((p) => p.filter((c) => c.key !== chip.key))
    setBank((b) => [...b, chip])
  }

  const handleCheck = () => {
    const card = cards[index]
    if (placed.length !== card.words.length) return
    const correct = placed.every((chip, i) => normalise(chip.word) === normalise(card.words[i]))
    setResults((r) => [...r, { correct }])
    setChecked(true)
  }

  const handleSpeak = () => {
    if (!card) return
    setSpeaking(true)
    speak(card.german, speechLocale)
    setTimeout(() => setSpeaking(false), 3000)
  }

  const handleNext = () => {
    setPlaced([])
    setBank([])
    setChecked(false)
    if (index + 1 >= cards.length) setPhase('done')
    else setIndex((i) => i + 1)
  }

  const handleAddWord = async (rawWord, key) => {
    const word = rawWord.replace(/[.,!?;:"""„»«'']/g, '').trim()
    if (!word) return
    setWordStatuses((s) => ({ ...s, [key]: 'loading' }))
    try {
      // Check if already in dictionary
      const { data: existing } = await supabase
        .from('words')
        .select('id')
        .eq('user_id', user.id)
        .ilike('word', `%${word}%`)
        .maybeSingle()
      if (existing) { setWordStatuses((s) => ({ ...s, [key]: 'added' })); return }

      // Identify with AI
      const result = await identifyWord(word, targetLanguageName, interfaceLanguage)
      const primary = result.senses?.[0] ?? result

      // Save word header
      const { data: inserted } = await supabase
        .from('words')
        .insert({
          user_id: user.id,
          word: result.word,
          translation: primary.translation,
          pos: primary.pos,
          form: primary.form,
          grammar_note: primary.grammarNote,
          explanation: primary.explanation,
          is_exception: primary.isException,
          conjugation: primary.conjugation ?? null,
          entry_type: result.entryType,
          status: 'new',
          date_added: new Date().toISOString().split('T')[0],
          target_language: targetLang,
        })
        .select('id')
        .single()

      // Save senses
      if (inserted?.id && result.senses?.length) {
        await supabase.from('word_senses').insert(
          result.senses.map(s => ({
            word_id: inserted.id,
            user_id: user.id,
            target_language: targetLang,
            pos: s.pos,
            word_form: s.wordForm || result.word,
            aspect: s.aspect ?? null,
            gender: s.gender ?? null,
            translation: s.translation,
            form: s.form || null,
            grammar_note: s.grammarNote || null,
            explanation: s.explanation || null,
            is_exception: s.isException || false,
            conjugation: s.conjugation || null,
            examples: s.examples || [],
            learning_stage: 'new',
            correct_recall_count: 0,
          }))
        )
      }
      setWordStatuses((s) => ({ ...s, [key]: 'added' }))
    } catch (e) {
      console.error('handleAddWord error:', e)
      setWordStatuses((s) => ({ ...s, [key]: 'error' }))
    }
  }

  const restart = () => {
    setPhase('picker')
    setCards([])
    setIndex(0)
    setResults([])
    setWordStatuses({})
  }

  // ── Picker ─────────────────────────────────────────────────────────────────
  if (phase === 'picker') {
    const total = counts.new + counts.learning + counts.known + counts.mastered
    const modes = [
      { id: 'new',      label: lang === 'uk' ? 'Нові'       : 'New',        count: counts.new,                     color: 'bg-gray-50 border-gray-200',     dot: 'bg-gray-400',    desc: lang === 'uk' ? 'Слова, які ви ще не вивчали' : 'Words you haven\'t studied yet' },
      { id: 'learning', label: lang === 'uk' ? 'Вивчаю'     : 'Learning',   count: counts.learning,                color: 'bg-yellow-50 border-yellow-200', dot: 'bg-yellow-400',  desc: lang === 'uk' ? 'Слова в процесі вивчення' : 'Words in progress' },
      { id: 'review',   label: lang === 'uk' ? 'Повторення' : 'Review',     count: counts.known + counts.mastered, color: 'bg-green-50 border-green-200',   dot: 'bg-green-400',   desc: lang === 'uk' ? 'Відомі та засвоєні слова' : 'Known & mastered words' },
      { id: 'all',      label: lang === 'uk' ? 'Всі слова'  : 'All words',  count: total,                          color: 'bg-indigo-50 border-indigo-200', dot: 'bg-indigo-400',  desc: lang === 'uk' ? 'Повний словник' : 'Your full dictionary' },
    ]
    return (
      <div className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-indigo-50 flex flex-col">
        <nav className="bg-white/80 backdrop-blur border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <div className="text-xl font-bold text-indigo-600">verba</div>
          <button onClick={() => navigate('/dashboard')} className="text-sm text-gray-500 hover:text-gray-900 transition-colors">← Dashboard</button>
        </nav>
        <div className="flex-1 flex flex-col items-center justify-center px-4">
          <div className="w-full max-w-md">
            <div className="text-center mb-8">
              <div className="text-4xl mb-3">🔀</div>
              <h2 className="text-2xl font-bold text-gray-900 mb-1">{lang === 'uk' ? 'Порядок слів' : 'Word Order'}</h2>
              <p className="text-sm text-gray-400">{lang === 'uk' ? 'Склади речення з розкиданих слів' : 'Put the scrambled sentence back in order'}</p>
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
      <div className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-indigo-50 flex items-center justify-center">
        <div className="flex gap-1">
          <span className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce [animation-delay:0ms]" />
          <span className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce [animation-delay:150ms]" />
          <span className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce [animation-delay:300ms]" />
        </div>
      </div>
    )
  }

  // ── Empty ──────────────────────────────────────────────────────────────────
  if (phase === 'session' && cards.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-indigo-50 flex flex-col">
        <nav className="bg-white/80 backdrop-blur border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <div className="text-xl font-bold text-indigo-600">verba</div>
          <button onClick={() => navigate('/dashboard')} className="text-sm text-gray-500 hover:text-gray-900">← Dashboard</button>
        </nav>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-gray-400 mb-2">{lang === 'uk' ? 'Немає речень для цієї категорії.' : 'No sentences found for this category.'}</p>
            <p className="text-xs text-gray-300 mb-4">{lang === 'uk' ? 'Спробуйте ідентифікувати слова за допомогою AI, щоб додати приклади.' : 'Try identifying words with AI to add example sentences.'}</p>
            <button onClick={restart} className="text-indigo-600 text-sm font-semibold hover:underline">← {lang === 'uk' ? 'Назад' : 'Back'}</button>
          </div>
        </div>
      </div>
    )
  }

  // ── Done ───────────────────────────────────────────────────────────────────
  if (phase === 'done') {
    const correct = results.filter((r) => r.correct).length
    const total = results.length
    return (
      <div className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-indigo-50 flex flex-col">
        <nav className="bg-white/80 backdrop-blur border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <div className="text-xl font-bold text-indigo-600">verba</div>
          <button onClick={() => navigate('/dashboard')} className="text-sm text-gray-500 hover:text-gray-900 transition-colors">← Dashboard</button>
        </nav>
        <div className="flex-1 overflow-y-auto px-4 py-8">
          <div className="max-w-lg mx-auto flex flex-col gap-6">

            {/* Score card */}
            <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8 text-center">
              <div className="text-5xl mb-4">{correct === total ? '🏆' : correct >= total / 2 ? '👍' : '💪'}</div>
              <h2 className="text-2xl font-bold text-gray-900 mb-1">{lang === 'uk' ? 'Сесію завершено!' : 'Session complete!'}</h2>
              <p className="text-gray-500 text-sm mb-6">{total} {lang === 'uk' ? 'речень' : 'sentences'}</p>
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-green-50 rounded-2xl p-4">
                  <div className="text-3xl font-bold text-green-600">{correct}</div>
                  <div className="text-xs text-green-700 mt-0.5 font-medium">{lang === 'uk' ? 'Правильно' : 'Correct'}</div>
                </div>
                <div className="bg-red-50 rounded-2xl p-4">
                  <div className="text-3xl font-bold text-red-500">{total - correct}</div>
                  <div className="text-xs text-red-600 mt-0.5 font-medium">{lang === 'uk' ? 'Помилок' : 'Incorrect'}</div>
                </div>
              </div>
              <div className="flex flex-col gap-3">
                {inSession() ? (
                  <button onClick={() => advanceSession(navigate)} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-2xl font-semibold text-sm transition-colors">
                    {nextExerciseName(lang)
                      ? `${lang === 'uk' ? 'Далі' : 'Next'}: ${nextExerciseName(lang)} →`
                      : (lang === 'uk' ? 'Завершити сесію →' : 'Finish session →')}
                  </button>
                ) : (
                  <button onClick={restart} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-2xl font-semibold text-sm transition-colors">
                    {lang === 'uk' ? 'Практикувати знову' : 'Practice again'}
                  </button>
                )}
                <button onClick={() => navigate('/dashboard')} className="w-full text-gray-500 hover:text-gray-900 py-2 text-sm transition-colors">
                  {lang === 'uk' ? 'На головну' : 'Back to dashboard'}
                </button>
              </div>
            </div>

            {/* Sentence review + word adding */}
            <div className="bg-white rounded-3xl border border-gray-100 p-6">
              <h3 className="text-sm font-semibold text-gray-800 mb-1">
                {lang === 'uk' ? '📝 Слова з цієї сесії' : '📝 Words from this session'}
              </h3>
              <p className="text-xs text-gray-400 mb-5">
                {lang === 'uk' ? 'Натисни на будь-яке слово, щоб додати його до словника' : 'Tap any word to identify it and add to your dictionary'}
              </p>
              <div className="flex flex-col gap-5">
                {cards.map((card, cardIdx) => (
                  <div key={cardIdx}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-xs font-bold ${results[cardIdx]?.correct ? 'text-green-500' : 'text-red-400'}`}>
                        {results[cardIdx]?.correct ? '✓' : '✗'}
                      </span>
                      <span className="text-xs text-gray-400 italic">"{card.english}"</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {card.words.map((word, wordIdx) => {
                        const key = `${cardIdx}-${wordIdx}`
                        const status = wordStatuses[key]
                        return (
                          <button
                            key={key}
                            onClick={() => handleAddWord(word, key)}
                            disabled={status === 'loading' || status === 'added'}
                            className={`px-2.5 py-1 rounded-lg text-sm font-medium border transition-all ${
                              status === 'loading'
                                ? 'bg-indigo-50 text-indigo-400 border-indigo-100 animate-pulse cursor-wait'
                                : status === 'added'
                                  ? 'bg-green-50 text-green-600 border-green-200 cursor-default'
                                  : status === 'error'
                                    ? 'bg-red-50 text-red-500 border-red-200 hover:bg-red-100'
                                    : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-violet-50 hover:text-violet-700 hover:border-violet-200 active:scale-95'
                            }`}
                          >
                            {status === 'loading' ? `${word} …` : status === 'added' ? `✓ ${word}` : word}
                          </button>
                        )
                      })}
                    </div>
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
  const allPlaced = placed.length === card.words.length
  const isCorrect = checked && placed.every((chip, i) => normalise(chip.word) === normalise(card.words[i]))

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-indigo-50 flex flex-col">
      {/* Nav */}
      <nav className="bg-white/80 backdrop-blur border-b border-gray-100 px-6 py-4 flex items-center justify-between">
        <div className="text-xl font-bold text-indigo-600">verba</div>
        <div className="text-sm text-gray-500">{index + 1} / {cards.length}</div>
        <button onClick={() => navigate('/dashboard')} className="text-sm text-gray-400 hover:text-gray-700 transition-colors">
          ✕ {lang === 'uk' ? 'Завершити' : 'End session'}
        </button>
      </nav>

      {/* Progress bar */}
      <div className="h-1 bg-gray-100">
        <div className="h-full bg-violet-500 transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-4 py-8 gap-6">

        {/* Headword + translation */}
        <div className="w-full max-w-lg text-center">
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{lang === 'uk' ? 'Переклад' : 'Translation'}</p>
          <p className="text-lg font-semibold text-gray-800 italic">"{card.english}"</p>
          <p className="text-xs text-indigo-400 mt-1">{card.headword}</p>
        </div>

        {/* Answer area */}
        <div className="w-full max-w-lg">
          <p className="text-xs text-gray-400 mb-2 text-center">{lang === 'uk' ? 'Твоя відповідь' : 'Your answer'}</p>
          <div className="min-h-[56px] bg-white rounded-2xl border-2 border-dashed border-gray-200 px-4 py-3 flex flex-wrap gap-2 items-center">
            {placed.length === 0 && (
              <span className="text-sm text-gray-300">{lang === 'uk' ? 'Натисни слова нижче…' : 'Tap words below…'}</span>
            )}
            {placed.map((chip, i) => {
              let chipStyle = 'bg-indigo-100 text-indigo-800 border-indigo-200'
              if (checked) {
                chipStyle = normalise(chip.word) === normalise(card.words[i])
                  ? 'bg-green-100 text-green-800 border-green-300'
                  : 'bg-red-100 text-red-700 border-red-300'
              }
              return (
                <button
                  key={chip.key}
                  onClick={() => returnWord(chip)}
                  className={`px-3 py-1.5 rounded-xl border text-sm font-medium transition-all ${chipStyle} ${!checked ? 'hover:scale-105 active:scale-95' : 'cursor-default'}`}
                >
                  {chip.word}
                </button>
              )
            })}
          </div>
        </div>

        {/* Correct sentence shown after check */}
        {checked && !isCorrect && (
          <div className="w-full max-w-lg bg-green-50 border border-green-200 rounded-2xl px-4 py-3">
            <p className="text-xs text-green-600 font-medium mb-1 text-center">{lang === 'uk' ? 'Правильний порядок:' : 'Correct order:'}</p>
            <div className="flex items-center justify-center gap-3">
              <p className="text-sm font-semibold text-green-800">{card.german}</p>
              <button
                onClick={handleSpeak}
                className={`shrink-0 text-lg transition-transform ${speaking ? 'scale-110' : 'hover:scale-110'}`}
                title="Listen"
              >
                {speaking ? '🔊' : '🔈'}
              </button>
            </div>
          </div>
        )}
        {checked && isCorrect && (
          <div className="w-full max-w-lg bg-green-50 border border-green-200 rounded-2xl px-4 py-3">
            <div className="flex items-center justify-center gap-3">
              <p className="text-sm font-semibold text-green-700">{lang === 'uk' ? '✓ Правильно!' : '✓ Perfect!'}</p>
              <button
                onClick={handleSpeak}
                className={`shrink-0 text-lg transition-transform ${speaking ? 'scale-110' : 'hover:scale-110'}`}
                title="Listen"
              >
                {speaking ? '🔊' : '🔈'}
              </button>
            </div>
          </div>
        )}

        {/* Word bank */}
        {!checked && (
          <div className="w-full max-w-lg">
            <p className="text-xs text-gray-400 mb-2 text-center">{lang === 'uk' ? 'Слова' : 'Words'}</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {bank.map((chip) => (
                <button
                  key={chip.key}
                  onClick={() => placeWord(chip)}
                  className="px-3 py-1.5 bg-white border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 rounded-xl text-sm font-medium text-gray-700 transition-all hover:scale-105 active:scale-95 shadow-sm"
                >
                  {chip.word}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          {!checked ? (
            <>
              <button
                onClick={() => { setPlaced([]); setBank(shuffle(card.words.map((w, i) => ({ key: `${i}-${w}`, word: w })))); }}
                className="px-5 py-2.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-500 rounded-2xl text-sm font-medium transition-all"
              >
                {lang === 'uk' ? 'Скинути' : 'Reset'}
              </button>
              <button
                onClick={handleCheck}
                disabled={!allPlaced}
                className="px-8 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-200 disabled:cursor-not-allowed text-white rounded-2xl text-sm font-semibold transition-all shadow-sm shadow-violet-200"
              >
                {lang === 'uk' ? 'Перевірити →' : 'Check →'}
              </button>
            </>
          ) : (
            <button
              onClick={handleNext}
              className="px-10 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-2xl text-sm font-semibold transition-all shadow-sm shadow-violet-200"
            >
              {index + 1 >= cards.length
                ? (lang === 'uk' ? 'Результати →' : 'Results →')
                : (lang === 'uk' ? 'Далі →' : 'Next →')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
