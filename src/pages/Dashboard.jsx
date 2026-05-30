import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useLanguage } from '../lib/i18n'
import { useTargetLang } from '../lib/TargetLangContext'
import { planSession } from '../lib/sessionEngine'
import NavBar from '../components/NavBar'
import {
  FlashcardsIcon, PrepositionsIcon, FillBlankIcon,
  WordOrderIcon, ActiveRecallIcon, SentenceWritingIcon, GrammarChatIcon
} from '../components/ExerciseIcons'

const STATUS_COLORS = {
  new:      'bg-gray-100 text-gray-500',
  learning: 'bg-yellow-100 text-yellow-700',
  known:    'bg-green-100 text-green-700',
  mastered: 'bg-indigo-100 text-indigo-700',
}

const STATUS_BAR_COLORS = {
  new:      'bg-gray-200',
  learning: 'bg-brand-yellow',
  known:    'bg-green-400',
  mastered: 'bg-indigo-600',
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { user, profile, updateProfile, signOut } = useAuth()
  const { t, lang } = useLanguage()
  const { targetLang, targetLanguageName, features } = useTargetLang()

  const [words,        setWords]        = useState([])
  const [loading,      setLoading]      = useState(true)
  const [editingName,  setEditingName]  = useState(false)
  const [nameInput,    setNameInput]    = useState('')
  const [profileOpen,  setProfileOpen]  = useState(false)
  const [profileName,  setProfileName]  = useState('')
  const [savingName,   setSavingName]   = useState(false)
  const nameRef    = useRef(null)
  const profileRef = useRef(null)

  useEffect(() => {
    if (!user) return
    supabase
      .from('words')
      .select('id, word, translation, status, date_added, pos')
      .eq('user_id', user.id)
      .eq('target_language', targetLang)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setWords(data ?? [])
        setLoading(false)
      })
  }, [user, targetLang])

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

  const recentWords = words.slice(0, 5)

  // ── Session plans ──────────────────────────────────────────────────────────
  const timeBudget = profile?.time_budget ?? 15
  const STATUS_TO_STAGE = { new: 0, learning: 1, known: 4, mastered: 5 }
  const wordsWithStage = words.map(w => ({
    ...w,
    learning_stage: w.learning_stage ?? STATUS_TO_STAGE[w.status] ?? 0,
  }))
  const sessionPlans = !loading && words.length > 0
    ? planSession(wordsWithStage, timeBudget, lang)
    : []

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

  // ── Profile dropdown ───────────────────────────────────────────────────────
  function openProfile() {
    setProfileName(profile?.full_name ?? '')
    setProfileOpen(true)
  }

  async function saveProfileName() {
    const trimmed = profileName.trim()
    if (!trimmed) return
    setSavingName(true)
    await updateProfile({ full_name: trimmed })
    setSavingName(false)
    setProfileOpen(false)
  }

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (profileRef.current && !profileRef.current.contains(e.target)) {
        setProfileOpen(false)
      }
    }
    if (profileOpen) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [profileOpen])

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
    { type: lang === 'uk' ? 'Граматичний чат'         : 'Grammar chat',        Icon: GrammarChatIcon,     path: '/chat',             count: null },
    { type: lang === 'uk' ? 'Флеш-картки'           : 'Flashcards',          Icon: FlashcardsIcon,      path: '/flashcards',       count: total },
    features.prepositionDrills && { type: lang === 'uk' ? 'Дієслова з прийменником': 'Verbs + prepositions', Icon: PrepositionsIcon,    path: '/prepositions',     count: prepVerbCount },
    features.fillBlank        && { type: lang === 'uk' ? 'Заповніть пропуск'      : 'Fill in the blank',   Icon: FillBlankIcon,       path: '/fill-blank',       count: total },
    { type: lang === 'uk' ? 'Порядок слів'           : 'Word order',          Icon: WordOrderIcon,       path: '/word-order',       count: total },
    { type: lang === 'uk' ? 'Активне відтворення'    : 'Active recall',       Icon: ActiveRecallIcon,    path: '/active-recall',    count: byStatus.learning + byStatus.known + byStatus.mastered },
    { type: lang === 'uk' ? 'Написання речень'       : 'Sentence writing',    Icon: SentenceWritingIcon, path: '/sentence-writing', count: total },
  ].filter(Boolean)

  return (
    <div className="min-h-screen bg-[#F7F7FB]">
      <NavBar slot={
        <div className="relative" ref={profileRef}>
          <button
            onClick={openProfile}
            className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 text-sm font-bold hover:bg-indigo-200 transition-colors"
          >
            {displayName[0]?.toUpperCase()}
          </button>
          {profileOpen && (
            <div className="absolute right-0 top-10 w-64 bg-white rounded-2xl border border-gray-100 shadow-lg p-4 z-50">
              <p className="text-xs text-gray-400 mb-1">Signed in as</p>
              <p className="text-xs font-medium text-gray-600 mb-4 truncate">{user?.email}</p>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                {lang === 'uk' ? "Ім'я" : 'Display name'}
              </label>
              <input
                autoFocus
                value={profileName}
                onChange={e => setProfileName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveProfileName(); if (e.key === 'Escape') setProfileOpen(false) }}
                placeholder={lang === 'uk' ? 'Введіть ім\'я' : 'Enter your name'}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-indigo-400 mb-3"
              />
              <div className="flex gap-2">
                <button
                  onClick={saveProfileName}
                  disabled={savingName || !profileName.trim()}
                  className="flex-1 bg-indigo-600 text-white text-xs font-semibold py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  {savingName ? '…' : (lang === 'uk' ? 'Зберегти' : 'Save')}
                </button>
                <button
                  onClick={() => setProfileOpen(false)}
                  className="flex-1 text-xs font-medium text-gray-500 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                >
                  {lang === 'uk' ? 'Скасувати' : 'Cancel'}
                </button>
              </div>
              <div className="border-t border-gray-100 mt-4 pt-3">
                <button
                  onClick={() => signOut()}
                  className="w-full text-xs text-red-500 hover:text-red-700 font-medium text-left transition-colors"
                >
                  {lang === 'uk' ? 'Вийти →' : 'Sign out →'}
                </button>
              </div>
            </div>
          )}
        </div>
      } />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10">

        {/* Greeting */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-indigo-600 flex items-center gap-2 flex-wrap">
            {greeting},{' '}
            {editingName ? (
              <input
                ref={nameRef}
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                onBlur={saveName}
                onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditingName(false) }}
                className="text-3xl font-bold text-indigo-600 bg-transparent border-b-2 border-indigo-400 outline-none w-36"
              />
            ) : (
              <button onClick={startEditName} className="hover:text-indigo-800" title="Click to edit name">
                {displayName}
              </button>
            )}
            <span>👋</span>
          </h1>
        </div>

        {/* Three-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Left (2 cols) — breakdown + exercises */}
          <div className="lg:col-span-2 h-full">
            <div id="exercises" className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm h-full">

              {/* Word breakdown */}
              {!loading && total > 0 && (
                <div className="mb-6 pb-6 border-b border-gray-100">
                  <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">{lbl.breakdown}</h2>
                  <div className="flex h-3 rounded-full overflow-hidden mb-3 gap-0.5">
                    {(['new','learning','known','mastered']).map((s) =>
                      byStatus[s] > 0 ? (
                        <div key={s} className={`${STATUS_BAR_COLORS[s]} transition-all`} style={{ width: `${(byStatus[s] / total) * 100}%` }} />
                      ) : null
                    )}
                  </div>
                  <div className="flex flex-wrap gap-4">
                    {(['new','learning','known','mastered']).map((s) => (
                      <div key={s} className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${STATUS_BAR_COLORS[s]}`} />
                        <span className="text-xs text-gray-500"><span className="font-semibold text-gray-700">{byStatus[s]}</span> {statusLabel[s]}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">{lbl.session}</h2>
              <div className="grid grid-cols-2 gap-3">
                {exercises.map((ex, i) => (
                  <button
                    key={ex.type}
                    onClick={() => navigate(ex.path)}
                    className={`bg-white border border-gray-100 rounded-2xl p-4 text-left md:hover:bg-gradient-to-br md:hover:from-brand-yellow/40 md:hover:to-indigo-200 hover:border-indigo-200 hover:shadow-md hover:-translate-y-0.5 transition-all group ${exercises.length % 2 !== 0 && i === 0 ? 'col-span-2' : ''}`}
                  >
                    <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center mb-3 text-indigo-600 group-hover:bg-indigo-100">
                      <ex.Icon size={20} />
                    </div>
                    <div className="text-sm font-semibold text-gray-900 group-hover:text-indigo-800">{ex.type}</div>
                    <div className="text-xs text-gray-400 group-hover:text-indigo-600 mt-0.5">
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
          <div className="flex flex-col gap-4 h-full order-first lg:order-none">

            {/* Session plans */}
            {sessionPlans.length > 0 && (
              <div className="flex flex-col gap-3">

                {sessionPlans.map((plan, i) => (
                  <div key={plan.id} className={`rounded-3xl p-4 ${
                    i === 0
                      ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200'
                      : 'bg-white border border-gray-100 shadow-sm'
                  }`}>
                    <div className={`text-xs font-semibold uppercase tracking-wider mb-1 ${i === 0 ? 'text-indigo-300' : 'text-gray-400'}`}>
                      {plan.durationMin} {lang === 'uk' ? 'хв' : 'min'}
                    </div>
                    <div className={`text-sm font-bold mb-1 ${i === 0 ? 'text-white' : 'text-gray-900'}`}>
                      {plan.title}
                    </div>
                    <div className={`text-xs mb-3 leading-relaxed ${i === 0 ? 'text-indigo-300' : 'text-gray-400'}`}>
                      {plan.description}
                    </div>
                    <button
                      onClick={() => {
                        sessionStorage.setItem('wordy_session', JSON.stringify(plan))
                        navigate('/session')
                      }}
                      className={`w-full text-xs font-semibold py-2.5 rounded-xl transition-colors ${
                        i === 0
                          ? 'bg-brand-yellow text-gray-900 hover:bg-yellow-300'
                          : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'
                      }`}
                    >
                      {lang === 'uk' ? 'Почати →' : 'Start →'}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Stat cards */}
            {[
              { label: lbl.totalWords, value: loading ? '…' : total,         sub: targetLanguageName,            path: '/dictionary' },
              { label: lbl.thisWeek,   value: loading ? '…' : addedThisWeek, sub: lang === 'uk' ? 'за останні 7 днів' : 'last 7 days', path: null },
            ].map((stat) => (
              <div
                key={stat.label}
                onClick={() => stat.path && navigate(stat.path)}
                className={`bg-white rounded-3xl border border-gray-100 p-5 shadow-sm ${stat.path ? 'cursor-pointer hover:border-indigo-200 hover:shadow-md transition-all' : ''}`}
              >
                <div className="text-3xl font-bold text-gray-900">{stat.value}</div>
                <div className="text-sm font-medium text-gray-700 mt-1">{stat.label}</div>
                <div className="text-xs text-gray-400 mt-0.5">{stat.sub}</div>
              </div>
            ))}

            {/* Recent words */}
            <div className="bg-white rounded-3xl border border-gray-100 p-6 flex-1 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-gray-900">{lbl.recentWords}</h2>
                {total > 5 && (
                  <button onClick={() => navigate('/dictionary')} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">
                    {lang === 'uk' ? `Переглянути ще ${total - 5}+` : `View ${total - 5}+ more`}
                  </button>
                )}
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
                </div>
              )}
            </div>
          </div>

        </div>
      </main>
    </div>
  )
}
