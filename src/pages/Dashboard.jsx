import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useLanguage } from '../lib/i18n'

const STATUS_COLORS = {
  new:      'bg-gray-100 text-gray-500',
  learning: 'bg-yellow-50 text-yellow-700',
  known:    'bg-green-50 text-green-700',
  mastered: 'bg-indigo-50 text-indigo-700',
}

const STATUS_BAR_COLORS = {
  new:      'bg-gray-200',
  learning: 'bg-yellow-400',
  known:    'bg-green-400',
  mastered: 'bg-indigo-500',
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { user, profile, updateProfile } = useAuth()
  const { t, lang, switchLang } = useLanguage()

  const [words,      setWords]      = useState([])
  const [loading,    setLoading]    = useState(true)
  const [editingName, setEditingName] = useState(false)
  const [nameInput,   setNameInput]   = useState('')
  const nameRef = useRef(null)

  useEffect(() => {
    if (!user) return
    supabase
      .from('words')
      .select('id, word, translation, status, date_added, pos')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setWords(data ?? [])
        setLoading(false)
      })
  }, [user])

  // ── Derived stats ──────────────────────────────────────────────────────────
  const total    = words.length
  const byStatus = {
    new:      words.filter((w) => w.status === 'new').length,
    learning: words.filter((w) => w.status === 'learning').length,
    known:    words.filter((w) => w.status === 'known').length,
    mastered: words.filter((w) => w.status === 'mastered').length,
  }
  const activeWords = byStatus.learning + byStatus.known + byStatus.mastered

  const PREP_LIST = new Set(['an','auf','über','für','mit','zu','von','nach','bei','gegen','ohne','um','aus','in'])
  const prepVerbCount = words.filter(
    (w) => w.pos === 'verb' && w.word.toLowerCase().split(/\s+/).some((t) => PREP_LIST.has(t))
  ).length

  const oneWeekAgo = new Date()
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7)
  const addedThisWeek = words.filter(
    (w) => w.date_added && new Date(w.date_added) >= oneWeekAgo
  ).length

  const recentWords = words.slice(0, 6)

  // ── User display name ──────────────────────────────────────────────────────
  const displayName = profile?.full_name?.split(' ')[0]
    ?? user?.email?.split('@')[0]
    ?? 'there'

  function startEditName() {
    setNameInput(profile?.full_name ?? '')
    setEditingName(true)
    setTimeout(() => nameRef.current?.focus(), 50)
  }

  async function saveName() {
    const trimmed = nameInput.trim()
    if (trimmed) await updateProfile({ full_name: trimmed })
    setEditingName(false)
  }

  // ── Hour-based greeting ────────────────────────────────────────────────────
  const hour = new Date().getHours()
  const greetingKey = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'
  const greeting = {
    en: { morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening' },
    uk: { morning: 'Доброго ранку', afternoon: 'Доброго дня', evening: 'Доброго вечора' },
  }[lang][greetingKey]

  // ── Labels ─────────────────────────────────────────────────────────────────
  const lbl = {
    totalWords:    lang === 'uk' ? 'Слів у словнику' : 'Words in dictionary',
    learning:      lang === 'uk' ? 'Вивчаю' : 'Learning',
    known:         lang === 'uk' ? 'Знаю / Засвоїв' : 'Known / Mastered',
    thisWeek:      lang === 'uk' ? 'Додано цього тижня' : 'Added this week',
    newWords:      lang === 'uk' ? 'нових' : 'new this week',
    session:       lang === 'uk' ? 'Вправи' : 'Exercises',
    recentWords:   lang === 'uk' ? 'Останні слова' : 'Recent words',
    viewAll:       lang === 'uk' ? 'Переглянути всі →' : 'View all →',
    emptyDict:     lang === 'uk' ? 'Ваш словник порожній. Додайте перше слово!' : 'Your dictionary is empty. Add your first word!',
    goToDict:      lang === 'uk' ? 'Відкрити словник →' : 'Open dictionary →',
    breakdown:     lang === 'uk' ? 'Розподіл слів' : 'Word breakdown',
    noActivity:    lang === 'uk' ? 'Почніть додавати слова, щоб побачити прогрес.' : 'Start adding words to see your progress here.',
    statusNew:     lang === 'uk' ? 'нові' : 'new',
    statusLearning:lang === 'uk' ? 'вивчаю' : 'learning',
    statusKnown:   lang === 'uk' ? 'знаю' : 'known',
    statusMastered:lang === 'uk' ? 'засвоїв' : 'mastered',
  }

  const statusLabel = { new: lbl.statusNew, learning: lbl.statusLearning, known: lbl.statusKnown, mastered: lbl.statusMastered }

  const exercises = [
    { type: lang === 'uk' ? 'Флеш-картки'           : 'Flashcards',          icon: '🃏', color: 'bg-indigo-50 border-indigo-100',  path: '/flashcards',    count: total },
    { type: lang === 'uk' ? 'Дієслова з прийменником': 'Verbs + prepositions', icon: '🔗', color: 'bg-violet-50 border-violet-100',  path: '/prepositions',  count: prepVerbCount },
    { type: lang === 'uk' ? 'Заповніть пропуск'      : 'Fill in the blank',   icon: '✏️', color: 'bg-purple-50 border-purple-100',  path: '/fill-blank',    count: total },
    { type: lang === 'uk' ? 'Порядок слів'           : 'Word order',          icon: '🔀', color: 'bg-teal-50 border-teal-100',      path: '/word-order',    count: total },
    { type: lang === 'uk' ? 'Активне відтворення'    : 'Active recall',       icon: '🧠', color: 'bg-amber-50 border-amber-100',    path: '/active-recall', count: byStatus.learning + byStatus.known + byStatus.mastered },
    { type: lang === 'uk' ? 'Написання речень'       : 'Sentence writing',    icon: '✍️', color: 'bg-rose-50 border-rose-100',      path: '/sentence-writing', count: total },
    { type: lang === 'uk' ? 'Граматичний чат'         : 'Grammar chat',        icon: '💬', color: 'bg-green-50 border-green-100',    path: '/chat',          count: null },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Nav */}
      <nav className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
        <div className="text-xl font-bold text-indigo-600">wordy</div>
        <div className="flex items-center gap-6 text-sm font-medium text-gray-500">
          <button className="text-indigo-600">{t('nav.dashboard')}</button>
          <button onClick={() => navigate('/dictionary')} className="hover:text-gray-900 transition-colors">{t('nav.dictionary')}</button>
          <button onClick={() => navigate('/exercises')} className="hover:text-gray-900 transition-colors">{t('nav.exercises')}</button>
          <button onClick={() => navigate('/chat')} className="hover:text-gray-900 transition-colors">{t('nav.chat')}</button>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-semibold">
            <button onClick={() => switchLang('en')} className={`px-2.5 py-1 transition-colors ${lang === 'en' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-700'}`}>EN</button>
            <button onClick={() => switchLang('uk')} className={`px-2.5 py-1 transition-colors ${lang === 'uk' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-700'}`}>UA</button>
          </div>
          <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 text-sm font-bold">
            {displayName[0]?.toUpperCase()}
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-8">

        {/* Greeting — full width */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2 flex-wrap">
            {greeting},{' '}
            {editingName ? (
              <input
                ref={nameRef}
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                onBlur={saveName}
                onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditingName(false) }}
                className="text-2xl font-bold text-gray-900 bg-transparent border-b-2 border-indigo-400 outline-none w-36"
              />
            ) : (
              <button onClick={startEditName} className="hover:text-indigo-600 transition-colors" title="Click to edit name">
                {displayName}
              </button>
            )}
            👋
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            {loading ? '…' : total === 0
              ? lbl.emptyDict
              : lang === 'uk'
                ? `${total} слів у словнику · ${activeWords} в роботі`
                : `${total} words in your dictionary · ${activeWords} in progress`
            }
          </p>
        </div>

        {/* Three-column layout */}
        <div className="grid grid-cols-3 gap-6">

          {/* Left (2 cols) — breakdown + exercises */}
          <div className="col-span-2">
            <div id="exercises" className="bg-white rounded-2xl border border-gray-100 p-6">

              {/* Word breakdown */}
              {!loading && total > 0 && (
                <div className="mb-5 pb-5 border-b border-gray-100">
                  <h2 className="text-base font-semibold text-gray-900 mb-3">{lbl.breakdown}</h2>
                  <div className="flex h-2.5 rounded-full overflow-hidden mb-3 gap-0.5">
                    {(['new','learning','known','mastered']).map((s) =>
                      byStatus[s] > 0 ? (
                        <div key={s} className={`${STATUS_BAR_COLORS[s]} transition-all`} style={{ width: `${(byStatus[s] / total) * 100}%` }} />
                      ) : null
                    )}
                  </div>
                  <div className="flex flex-wrap gap-4">
                    {(['new','learning','known','mastered']).map((s) => (
                      <div key={s} className="flex items-center gap-2">
                        <div className={`w-2.5 h-2.5 rounded-full ${STATUS_BAR_COLORS[s]}`} />
                        <span className="text-xs text-gray-600"><span className="font-semibold">{byStatus[s]}</span> {statusLabel[s]}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <h2 className="text-base font-semibold text-gray-900 mb-4">{lbl.session}</h2>
              <div className="grid grid-cols-2 gap-3">
                {exercises.map((ex) => (
                  <button
                    key={ex.type}
                    onClick={() => navigate(ex.path)}
                    className={`${ex.color} border rounded-xl p-4 text-left hover:scale-[1.02] transition-transform`}
                  >
                    <div className="text-2xl mb-2">{ex.icon}</div>
                    <div className="text-sm font-semibold text-gray-900">{ex.type}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {ex.count === null
                        ? (lang === 'uk' ? 'Запитайте будь-що' : 'Ask anything')
                        : ex.count > 0
                          ? (lang === 'uk' ? `${ex.count} слів` : `${ex.count} words`)
                          : (lang === 'uk' ? 'Додайте слова' : 'Add words first')
                      }
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right (1 col) — stat cards + recent words */}
          <div className="flex flex-col gap-4">

            {/* Stat cards */}
            {[
              { label: lbl.totalWords, value: loading ? '…' : total,         sub: lang === 'uk' ? 'German' : 'German' },
              { label: lbl.thisWeek,   value: loading ? '…' : addedThisWeek, sub: lang === 'uk' ? 'за останні 7 днів' : 'last 7 days' },
            ].map((stat) => (
              <div key={stat.label} className="bg-white rounded-2xl border border-gray-100 p-5">
                <div className="text-2xl font-bold text-gray-900">{stat.value}</div>
                <div className="text-sm font-medium text-gray-700 mt-0.5">{stat.label}</div>
                <div className="text-xs text-gray-400">{stat.sub}</div>
              </div>
            ))}

            {/* Recent words */}
            <div className="bg-white rounded-2xl border border-gray-100 p-6 flex-1">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-gray-900">{lbl.recentWords}</h2>
                <button onClick={() => navigate('/dictionary')} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">
                  {lbl.viewAll}
                </button>
              </div>

              {loading ? (
                <div className="flex gap-1 justify-center py-8">
                  <span className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce [animation-delay:0ms]" />
                  <span className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce [animation-delay:150ms]" />
                  <span className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce [animation-delay:300ms]" />
                </div>
              ) : recentWords.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-xs text-gray-400 mb-3">{lbl.noActivity}</p>
                  <button onClick={() => navigate('/dictionary')} className="text-xs text-indigo-600 font-semibold hover:underline">
                    {lbl.goToDict}
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {recentWords.map((w) => (
                    <div key={w.id} className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">{w.word}</div>
                        <div className="text-xs text-gray-400 truncate">{w.translation}</div>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_COLORS[w.status]}`}>
                        {statusLabel[w.status]}
                      </span>
                    </div>
                  ))}
                  {total > 6 && (
                    <button onClick={() => navigate('/dictionary')} className="text-xs text-indigo-500 hover:text-indigo-700 font-medium pt-1">
                      +{total - 6} {lang === 'uk' ? 'більше →' : 'more →'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

        </div>
      </main>
    </div>
  )
}
