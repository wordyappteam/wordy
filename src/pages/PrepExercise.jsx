import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useLanguage } from '../lib/i18n'
import { generatePrepExercises } from '../lib/claude'

// ── Constants ─────────────────────────────────────────────────────────────────

const FALLBACK_VERBS = [
  { word: 'sich erinnern an',       translation: 'to remember' },
  { word: 'warten auf',             translation: 'to wait for' },
  { word: 'träumen von',            translation: 'to dream of' },
  { word: 'sich freuen auf',        translation: 'to look forward to' },
  { word: 'denken an',              translation: 'to think of' },
  { word: 'sich kümmern um',        translation: 'to take care of' },
  { word: 'sprechen über',          translation: 'to talk about' },
  { word: 'sich interessieren für', translation: 'to be interested in' },
]

const PREP_LIST = new Set(['an','auf','über','für','mit','zu','von','nach','bei','gegen','ohne','um','aus','in'])

function hasPreposition(word) {
  return word.toLowerCase().split(/\s+/).some((t) => PREP_LIST.has(t))
}

const SETTINGS_KEY = 'wordy_prep_settings'

const DEFAULT_SETTINGS = { prepHints: true, caseHints: false, genderHints: false }

// ── Live preview (hardcoded sample exercise) ──────────────────────────────────

const PREVIEW_EXERCISE = {
  verb: 'warten auf',
  sentence: 'Er wartet ___ ___ nächsten Zug.',
  preposition: 'auf',
  article: 'den',
  nounGender: 'der',
  nominativeNoun: 'der Zug',
  caseLabel: 'Akkusativ · maskulin',
}

const ALL_PREVIEW_PREPS = ['auf', 'an', 'von', 'für']

function LivePreview({ settings, lang }) {
  const parts = PREVIEW_EXERCISE.sentence.split('___')
  const lbl = {
    preview:    lang === 'uk' ? 'Попередній перегляд' : 'Preview',
    available:  lang === 'uk' ? 'Доступні прийменники:' : 'Available prepositions:',
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-gray-50 overflow-hidden">
      <div className="px-4 py-2 bg-white border-b border-gray-100 text-xs text-gray-400 font-medium uppercase tracking-wide">
        {lbl.preview}
      </div>
      <div className="px-4 py-4">
        {/* Preposition hint chips */}
        {settings.prepHints && (
          <div className="mb-3 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-400">{lbl.available}</span>
            {ALL_PREVIEW_PREPS.map((p) => (
              <span key={p} className="text-xs bg-indigo-50 border border-indigo-200 text-indigo-600 font-semibold px-2 py-0.5 rounded-full">{p}</span>
            ))}
          </div>
        )}

        {/* Verb badge + case hint */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full">
            {settings.prepHints ? PREVIEW_EXERCISE.verb : PREVIEW_EXERCISE.verb.replace(` ${PREVIEW_EXERCISE.preposition}`, '').trim()}
          </span>
          {settings.caseHints && (
            <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full font-medium">
              → {PREVIEW_EXERCISE.caseLabel.split('·')[0].trim()}
            </span>
          )}
        </div>

        {/* Sentence */}
        <p className="text-sm text-gray-800 flex flex-wrap items-end gap-1 leading-loose">
          <span>{parts[0]}</span>
          <span className="border-b-2 border-indigo-300 w-10 text-center text-indigo-400 text-xs italic">prep.</span>
          <span>{parts[1]}</span>
          <span className="border-b-2 border-indigo-300 w-12 text-center text-indigo-400 text-xs italic">art.</span>
          <span>{parts[2]}</span>
          {settings.genderHints && (
            <span className="text-xs text-violet-400 italic ml-1">({PREVIEW_EXERCISE.nominativeNoun})</span>
          )}
        </p>
      </div>
    </div>
  )
}

// ── Toggle component ──────────────────────────────────────────────────────────

function Toggle({ label, description, value, onChange }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`w-full flex items-start gap-4 px-4 py-3.5 rounded-2xl border text-left transition-all ${
        value
          ? 'bg-indigo-50 border-indigo-200'
          : 'bg-white border-gray-100 hover:border-gray-200'
      }`}
    >
      <div className={`mt-0.5 w-10 h-6 rounded-full flex items-center transition-colors flex-shrink-0 ${value ? 'bg-indigo-500' : 'bg-gray-200'}`}>
        <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform mx-1 ${value ? 'translate-x-4' : 'translate-x-0'}`} />
      </div>
      <div>
        <p className={`text-sm font-semibold ${value ? 'text-indigo-800' : 'text-gray-700'}`}>{label}</p>
        <p className="text-xs text-gray-400 mt-0.5">{description}</p>
      </div>
    </button>
  )
}

// ── Sentence with inline inputs ───────────────────────────────────────────────

function SentenceWithBlanks({ sentence, answers, onChange, submitted, exercise, index, settings }) {
  const parts = sentence.split('___')

  const prepCorrect    = submitted && answers.prep?.trim().toLowerCase()    === exercise.preposition.toLowerCase()
  const articleCorrect = submitted && answers.article?.trim().toLowerCase() === exercise.article.toLowerCase()

  function inputCls(correct) {
    const base = 'border-b-2 text-center font-medium focus:outline-none px-1'
    if (!submitted) return `${base} border-indigo-300 bg-transparent focus:border-indigo-600 text-gray-900`
    return correct
      ? `${base} border-emerald-400 bg-emerald-50 text-emerald-700 rounded`
      : `${base} border-red-400 bg-red-50 text-red-600 rounded line-through`
  }

  return (
    <div>
      <p className="text-base text-gray-800 flex flex-wrap items-end gap-1 leading-loose">
        <span>{parts[0]}</span>
        <input
          value={answers.prep ?? ''}
          onChange={(e) => onChange(index, 'prep', e.target.value)}
          disabled={submitted}
          className={`${inputCls(prepCorrect)} w-14`}
          placeholder="prep."
        />
        <span>{parts[1] ?? ' '}</span>
        <input
          value={answers.article ?? ''}
          onChange={(e) => onChange(index, 'article', e.target.value)}
          disabled={submitted}
          className={`${inputCls(articleCorrect)} w-16`}
          placeholder="art."
        />
        <span>{parts[2] ?? ''}</span>
      </p>
      {settings.genderHints && !submitted && exercise.nominativeNoun && (
        <p className="text-xs text-violet-400 italic mt-1">({exercise.nominativeNoun})</p>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PrepExercise() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { t, lang, switchLang } = useLanguage()
  const interfaceLanguage = lang === 'uk' ? 'Ukrainian' : 'English'

  const [phase, setPhase]     = useState('settings') // 'settings' | 'session' | 'exercises'
  const [settings, setSettings] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) ?? DEFAULT_SETTINGS }
    catch { return DEFAULT_SETTINGS }
  })

  // All prep verbs from dictionary with status
  const [prepVerbs,     setPrepVerbs]     = useState([])
  const [loadingVerbs,  setLoadingVerbs]  = useState(true)

  useEffect(() => {
    if (!user) return
    supabase
      .from('words')
      .select('word, translation, pos, status, last_reviewed')
      .eq('user_id', user.id)
      .eq('pos', 'verb')
      .then(({ data }) => {
        setPrepVerbs((data ?? []).filter((w) => hasPreposition(w.word)))
        setLoadingVerbs(false)
      })
  }, [user])

  const [exercises,  setExercises]  = useState([])
  const [answers,    setAnswers]    = useState({})
  const [submitted,  setSubmitted]  = useState(false)
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState(null)
  const [source,     setSource]     = useState('dictionary')

  function updateSetting(key, val) {
    const next = { ...settings, [key]: val }
    setSettings(next)
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
  }

  async function startExercise(mode = 'mixed') {
    setPhase('exercises')
    setLoading(true)
    setError(null)
    setSubmitted(false)
    setAnswers({})

    try {
      let pool = []

      if (prepVerbs.length >= 3) {
        if (mode === 'new')       pool = prepVerbs.filter((v) => v.status === 'new')
        else if (mode === 'learning') pool = prepVerbs.filter((v) => v.status === 'learning')
        else if (mode === 'review')   pool = prepVerbs.filter((v) => v.status === 'known' || v.status === 'mastered')
        else if (mode === 'suggested') {
          const learning = prepVerbs.filter((v) => v.status === 'learning')
          const newW     = prepVerbs.filter((v) => v.status === 'new')
          const review   = prepVerbs.filter((v) => v.status === 'known' || v.status === 'mastered')
          pool = [...learning, ...newW, ...review]
        }
        else pool = prepVerbs // mixed

        // If selected mode pool is too small, top up from full list
        if (pool.length < 3) pool = prepVerbs
      }

      if (pool.length < 3) {
        pool = FALLBACK_VERBS
        setSource('fallback')
      } else {
        setSource('dictionary')
      }

      const verbs = pool.sort(() => Math.random() - 0.5).slice(0, 5)
      const result = await generatePrepExercises(verbs, interfaceLanguage)

      // Attach translation by matching verb name back to pool
      const translationMap = {}
      verbs.forEach((v) => { translationMap[v.word.toLowerCase()] = v.translation })
      const enriched = result.map((ex) => ({
        ...ex,
        translation: translationMap[ex.verb.toLowerCase()] ?? null,
      }))
      setExercises(enriched)
    } catch (e) {
      console.error(e)
      const busy = e?.overloaded
      setError(lang === 'uk'
        ? (busy ? 'AI зараз зайнятий. Будь ласка, спробуйте ще раз за хвилинку.' : 'Не вдалося згенерувати вправи. Спробуйте ще раз.')
        : (busy ? 'The AI is busy right now. Please try again in a moment.' : 'Could not generate exercises. Please try again.'))
    } finally {
      setLoading(false)
    }
  }

  function handleChange(index, field, value) {
    setAnswers((prev) => ({ ...prev, [index]: { ...prev[index], [field]: value } }))
  }

  function reset() {
    setPhase('session')
    setExercises([])
    setAnswers({})
    setSubmitted(false)
    setError(null)
  }

  const allAnswered = exercises.length > 0 &&
    exercises.every((_, i) => answers[i]?.prep?.trim() && answers[i]?.article?.trim())

  const score = submitted
    ? exercises.filter((ex, i) =>
        answers[i]?.prep?.trim().toLowerCase()    === ex.preposition.toLowerCase() &&
        answers[i]?.article?.trim().toLowerCase() === ex.article.toLowerCase()
      ).length
    : 0

  // ── Labels ──
  const lbl = {
    title:         lang === 'uk' ? 'Дієслова з прийменниками' : 'Verbs with Prepositions',
    subtitle:      lang === 'uk' ? 'Вставте прийменник і артикль у правильному відмінку.' : 'Fill in the preposition and article in the correct case.',
    customise:     lang === 'uk' ? 'Налаштуйте складність' : 'Customise difficulty',
    customiseHint: lang === 'uk' ? 'Оберіть, скільки підказок ви хочете бачити.' : 'Choose how much help you want. You can change this any time.',
    toggle1label:  lang === 'uk' ? 'Показувати доступні прийменники' : 'Show available prepositions',
    toggle1desc:   lang === 'uk' ? 'Список усіх прийменників у цій вправі — над завданнями' : 'A chip list of all prepositions used in this set — shown above the exercises',
    toggle2label:  lang === 'uk' ? 'Показувати відмінок для кожного дієслова' : 'Show case for each verb',
    toggle2desc:   lang === 'uk' ? 'Наприклад: → Akkusativ' : 'e.g. → Akkusativ next to each verb badge',
    toggle3label:  lang === 'uk' ? 'Показувати рід іменника' : 'Show noun gender',
    toggle3desc:   lang === 'uk' ? 'Рід іменника у називному відмінку (der/die/das) під полем артикля' : 'Nominative article of the noun (der/die/das) shown below the article blank',
    start:         lang === 'uk' ? 'Почати вправу →' : 'Start exercise →',
    fromDict:      lang === 'uk' ? '✦ Вправи зі вашого словника' : '✦ Exercises from your dictionary',
    fromFallback:  lang === 'uk' ? '✦ Загальні приклади (додайте дієслова з прийменниками до словника!)' : '✦ Common examples (add prep. verbs to your dictionary for personalised sets!)',
    available:     lang === 'uk' ? 'Доступні прийменники:' : 'Available prepositions:',
    submit:        lang === 'uk' ? 'Перевірити відповіді' : 'Check answers',
    fillAll:       lang === 'uk' ? 'Заповніть усі поля' : 'Fill in all blanks',
    newSet:        lang === 'uk' ? 'Нові вправи' : 'New exercises',
    changeSettings:lang === 'uk' ? 'Змінити складність' : 'Change difficulty',
    correct:       lang === 'uk' ? 'Правильно!' : 'Correct!',
    wrongPrefix:   lang === 'uk' ? 'Правильно:' : 'Correct answer:',
    perfect:       lang === 'uk' ? 'Чудово! 🎉' : 'Perfect! 🎉',
    good:          lang === 'uk' ? 'Добре! Продовжуйте.' : 'Good work! Keep going.',
    review:        lang === 'uk' ? 'Перегляньте пояснення.' : 'Review the explanations above.',
    generating:    lang === 'uk' ? 'Claude генерує вправи…' : 'Claude is generating exercises…',
    back:          lang === 'uk' ? '← Налаштування' : '← Settings',
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Nav */}
      <nav className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
        <div className="text-xl font-bold text-indigo-600">verba</div>
        <div className="flex items-center gap-6 text-sm font-medium text-gray-500">
          <button onClick={() => navigate('/dashboard')}  className="hover:text-gray-900 transition-colors">{t('nav.dashboard')}</button>
          <button onClick={() => navigate('/dictionary')} className="hover:text-gray-900 transition-colors">{t('nav.dictionary')}</button>
          <button className="text-indigo-600">{t('nav.exercises')}</button>
          <button onClick={() => navigate('/chat')}       className="hover:text-gray-900 transition-colors">{t('nav.chat')}</button>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-semibold">
            <button onClick={() => switchLang('en')} className={`px-2.5 py-1 transition-colors ${lang === 'en' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-700'}`}>EN</button>
            <button onClick={() => switchLang('uk')} className={`px-2.5 py-1 transition-colors ${lang === 'uk' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-700'}`}>UA</button>
          </div>
          <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 text-sm font-bold">{(user?.email?.[0] ?? 'U').toUpperCase()}</div>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-6 py-10">

        {/* Page title */}
        <div className="mb-8 flex items-center gap-3">
          <span className="text-2xl">🔗</span>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{lbl.title}</h1>
            <p className="text-sm text-gray-500 mt-0.5">{lbl.subtitle}</p>
          </div>
        </div>

        {/* ── SETTINGS PHASE ── */}
        {phase === 'settings' && (
          <div className="flex flex-col gap-5">
            <div>
              <h2 className="text-sm font-bold text-gray-700 mb-0.5">{lbl.customise}</h2>
              <p className="text-xs text-gray-400">{lbl.customiseHint}</p>
            </div>

            <div className="flex flex-col gap-3">
              <Toggle
                label={lbl.toggle1label}
                description={lbl.toggle1desc}
                value={settings.prepHints}
                onChange={(v) => updateSetting('prepHints', v)}
              />
              <Toggle
                label={lbl.toggle2label}
                description={lbl.toggle2desc}
                value={settings.caseHints}
                onChange={(v) => updateSetting('caseHints', v)}
              />
              <Toggle
                label={lbl.toggle3label}
                description={lbl.toggle3desc}
                value={settings.genderHints}
                onChange={(v) => updateSetting('genderHints', v)}
              />
            </div>

            {/* Live preview */}
            <LivePreview settings={settings} lang={lang} />

            <button
              onClick={() => setPhase('session')}
              className="w-full py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm transition-colors"
            >
              {lbl.start}
            </button>
          </div>
        )}

        {/* ── SESSION SELECTION PHASE ── */}
        {phase === 'session' && (
          <div className="flex flex-col gap-5">
            <div>
              <button onClick={() => setPhase('settings')} className="text-sm text-gray-400 hover:text-gray-600 transition-colors mb-4 flex items-center gap-1">
                ← {lbl.back}
              </button>
              <h2 className="text-base font-semibold text-gray-900">
                {lang === 'uk' ? 'Що практикуємо сьогодні?' : 'What do you want to practise today?'}
              </h2>
              <p className="text-xs text-gray-400 mt-1">
                {lang === 'uk'
                  ? `У вашому словнику ${prepVerbs.length} дієслів з прийменниками`
                  : `You have ${prepVerbs.length} prep. verb${prepVerbs.length !== 1 ? 's' : ''} in your dictionary`}
              </p>
            </div>

            {(() => {
              const counts = {
                new:       prepVerbs.filter((v) => v.status === 'new').length,
                learning:  prepVerbs.filter((v) => v.status === 'learning').length,
                review:    prepVerbs.filter((v) => v.status === 'known' || v.status === 'mastered').length,
                mixed:     prepVerbs.length,
              }

              const modes = [
                {
                  key: 'new',
                  icon: '🆕',
                  label: lang === 'uk' ? 'Нові' : 'New',
                  desc: lang === 'uk' ? 'Слова, які ви щойно додали' : 'Words you just added',
                  count: counts.new,
                  color: 'border-gray-200 hover:border-indigo-300',
                },
                {
                  key: 'learning',
                  icon: '📚',
                  label: lang === 'uk' ? 'Вивчаю' : 'Learning',
                  desc: lang === 'uk' ? 'Слова в активній роботі' : 'Words you\'re actively working on',
                  count: counts.learning,
                  color: 'border-yellow-200 hover:border-yellow-400',
                },
                {
                  key: 'review',
                  icon: '🔁',
                  label: lang === 'uk' ? 'Повторення' : 'Review',
                  desc: lang === 'uk' ? 'Засвоєні слова — для довгострокової пам\'яті' : 'Mastered words — keep them fresh',
                  count: counts.review,
                  color: 'border-green-200 hover:border-green-400',
                },
                {
                  key: 'mixed',
                  icon: '🎲',
                  label: lang === 'uk' ? 'Змішаний' : 'Mixed',
                  desc: lang === 'uk' ? 'Випадкова вибірка з усього словника' : 'Random mix from everything',
                  count: counts.mixed,
                  color: 'border-violet-200 hover:border-violet-400',
                },
                {
                  key: 'suggested',
                  icon: '✨',
                  label: lang === 'uk' ? 'Рекомендую' : 'Suggested',
                  desc: lang === 'uk' ? 'Спочатку «вивчаю», потім нові, потім повторення' : 'Learning first, then new, then review',
                  count: counts.mixed,
                  color: 'border-indigo-200 hover:border-indigo-400',
                },
              ]

              return (
                <div className="flex flex-col gap-2">
                  {modes.map((m) => {
                    const usable = m.key === 'suggested' ? prepVerbs.length >= 3 : m.count >= 3
                    const tooFew = !usable && prepVerbs.length >= 3
                    return (
                      <button
                        key={m.key}
                        disabled={!usable && prepVerbs.length >= 3}
                        onClick={() => startExercise(m.key)}
                        className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl border text-left transition-all
                          ${usable ? `bg-white ${m.color} hover:bg-gray-50` : 'bg-gray-50 border-gray-100 opacity-50 cursor-not-allowed'}`}
                      >
                        <span className="text-2xl">{m.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-gray-800">{m.label}</p>
                            {m.key !== 'suggested' && (
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                usable ? 'bg-indigo-50 text-indigo-600' : 'bg-gray-100 text-gray-400'
                              }`}>
                                {m.count} {lang === 'uk' ? 'сл.' : 'verbs'}
                              </span>
                            )}
                            {m.count > 0 && m.count < 10 && usable && m.key !== 'suggested' && (
                              <span className="text-xs text-amber-500">
                                {lang === 'uk' ? '(мало різноманіття)' : '(limited variety)'}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-400 mt-0.5">{m.desc}</p>
                          {tooFew && (
                            <p className="text-xs text-gray-400 mt-0.5 italic">
                              {lang === 'uk' ? 'Додайте більше слів' : 'Add more verbs to unlock'}
                            </p>
                          )}
                        </div>
                        {usable && <span className="text-gray-300 text-lg">›</span>}
                      </button>
                    )
                  })}
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <p className="text-xs text-gray-400 mb-2">
                      {lang === 'uk' ? 'Хочете більше практики?' : 'Want a deeper workout?'}
                    </p>
                    <button
                      onClick={() => navigate('/prep-session', { state: { mode: 'suggested' } })}
                      disabled={prepVerbs.length < 3}
                      className="w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl border border-indigo-300 bg-indigo-50 hover:bg-indigo-100 text-left transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <span className="text-2xl">🎯</span>
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-indigo-800">
                          {lang === 'uk' ? 'Глибока практика' : 'Deep practice'}
                        </p>
                        <p className="text-xs text-indigo-500 mt-0.5">
                          {lang === 'uk'
                            ? 'Флеш-картки → банк слів → вправа з відмінками'
                            : 'Flashcards → word bank → case exercise — all in one session'}
                        </p>
                      </div>
                      <span className="text-indigo-300 text-lg">›</span>
                    </button>
                  </div>
                </div>
              )
            })()}
          </div>
        )}

        {/* ── EXERCISE PHASE ── */}
        {phase === 'exercises' && (
          <>
            {/* Back to settings */}
            {!loading && (
              <button onClick={reset} className="text-xs text-gray-400 hover:text-indigo-600 transition-colors mb-5 flex items-center gap-1">
                {lbl.back}
              </button>
            )}

            {/* Loading */}
            {loading && (
              <div className="flex flex-col items-center gap-4 py-20 text-gray-400">
                <div className="flex gap-1.5">
                  <span className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce [animation-delay:0ms]" />
                  <span className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce [animation-delay:150ms]" />
                  <span className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce [animation-delay:300ms]" />
                </div>
                <p className="text-sm">{lbl.generating}</p>
              </div>
            )}

            {/* Error */}
            {error && !loading && (
              <div className="bg-red-50 border border-red-100 rounded-2xl px-5 py-4 text-center">
                <p className="text-sm text-red-600 mb-3">{error}</p>
                <button onClick={reset} className="text-sm font-semibold text-indigo-600 hover:underline">{lbl.back}</button>
              </div>
            )}

            {/* Exercises */}
            {!loading && !error && exercises.length > 0 && (
              <>
                {/* Source badge */}
                <p className="text-xs text-indigo-500 font-medium mb-4">
                  {source === 'dictionary' ? lbl.fromDict : lbl.fromFallback}
                </p>

                {/* Preposition hint chips */}
                {settings.prepHints && (
                  <div className="flex items-center gap-2 flex-wrap mb-5 bg-indigo-50 border border-indigo-100 rounded-2xl px-4 py-3">
                    <span className="text-xs text-indigo-400 font-medium">{lbl.available}</span>
                    {[...new Set(exercises.map((e) => e.preposition))].map((p) => (
                      <span key={p} className="text-xs bg-white border border-indigo-200 text-indigo-600 font-semibold px-2.5 py-1 rounded-full">
                        {p}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex flex-col gap-5">
                  {exercises.map((ex, i) => {
                    const prepOk    = submitted && answers[i]?.prep?.trim().toLowerCase()    === ex.preposition.toLowerCase()
                    const articleOk = submitted && answers[i]?.article?.trim().toLowerCase() === ex.article.toLowerCase()
                    const bothOk    = prepOk && articleOk

                    return (
                      <div key={i} className={`bg-white rounded-2xl border px-6 py-5 transition-colors ${
                        submitted ? (bothOk ? 'border-emerald-200' : 'border-red-200') : 'border-gray-100'
                      }`}>
                        <div className="flex items-center gap-2 mb-3 flex-wrap">
                          <span className="text-indigo-400 font-bold text-sm">{i + 1}.</span>
                          <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full">
                            {settings.prepHints ? ex.verb : ex.verb.replace(` ${ex.preposition}`, '').trim()}
                          </span>
                          {settings.caseHints && (
                            <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full font-medium">
                              → {ex.caseLabel.split('·')[0].trim()}
                            </span>
                          )}
                        </div>

                        <SentenceWithBlanks
                          sentence={ex.sentence}
                          answers={answers[i] ?? {}}
                          onChange={handleChange}
                          submitted={submitted}
                          exercise={ex}
                          index={i}
                          settings={settings}
                        />

                        {/* Feedback */}
                        {submitted && (
                          <div className={`mt-3 text-xs px-3 py-2 rounded-xl ${bothOk ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                            {bothOk
                              ? <>✓ {lbl.correct}{ex.translation && <span className="opacity-70"> — {ex.verb} = {ex.translation}</span>}</>
                              : <>✗ {lbl.wrongPrefix} <strong>{ex.preposition} {ex.article}</strong>{ex.translation && <span> · {ex.verb} = {ex.translation}</span>} — {ex.explanation}</>
                            }
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Submit / Score */}
                <div className="mt-8">
                  {!submitted ? (
                    <button
                      onClick={() => setSubmitted(true)}
                      disabled={!allAnswered}
                      className="w-full py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-200 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors"
                    >
                      {allAnswered ? lbl.submit : lbl.fillAll}
                    </button>
                  ) : (
                    <div className="bg-white border border-gray-100 rounded-2xl px-6 py-4 flex items-center justify-between">
                      <div>
                        <span className="text-2xl font-bold text-gray-900">{score}/{exercises.length}</span>
                        <span className="text-sm text-gray-500 ml-3">
                          {score === exercises.length ? lbl.perfect : score >= exercises.length / 2 ? lbl.good : lbl.review}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => setPhase('settings')} className="px-4 py-2 rounded-xl border border-gray-200 text-gray-500 text-sm font-medium hover:bg-gray-50 transition-colors">
                          {lbl.changeSettings}
                        </button>
                        <button onClick={reset} className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors">
                          {lbl.newSet}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  )
}
