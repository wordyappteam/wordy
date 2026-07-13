import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useLanguage } from '../lib/i18n'
import { SUPPORTED_LANGUAGES } from '../lib/TargetLangContext'
import { parseGoal } from '../lib/claude'
import { getWordPack } from '../data/wordPacks'

// Only languages the app actually supports — mirror TargetLangContext, keep flags.
const FLAGS = { de: '🇩🇪', en: '🇬🇧', uk: '🇺🇦' }
const LANGUAGES = SUPPORTED_LANGUAGES.map((l) => ({ code: l.code, name: l.name, flag: FLAGS[l.code] }))

const LEVELS = ['Beginner', 'Elementary', 'Intermediate', 'Upper-Intermediate', 'Advanced']

const GOALS = [
  { id: 'travel',    label: '✈️ Travel',   desc: 'Get by and connect while abroad' },
  { id: 'fluency',   label: '💬 Fluency',  desc: 'Speak naturally and confidently' },
  { id: 'work',      label: '💼 Work',     desc: 'Professional communication' },
  { id: 'study',     label: '📚 Academic', desc: 'University or formal studies' },
  { id: 'culture',   label: '🎭 Culture',  desc: 'Books, films, music, people' },
  { id: 'curiosity', label: '🌍 Curiosity',desc: 'Just love languages' },
]

const TOPICS = [
  'Travel', 'Food & Cooking', 'Business', 'Technology', 'Culture & Arts',
  'Nature & Science', 'Sports', 'Politics', 'History', 'Everyday life',
  'Literature', 'Music', 'Fashion', 'Health',
]

const TIME_OPTIONS = [
  { id: '10-15', label: '10–15 min / day', desc: 'A focused daily habit' },
  { id: '15-30', label: '15–30 min / day', desc: 'Steady progress' },
  { id: '30-45', label: '30–45 min / day', desc: 'Serious learning' },
]

const STUDY_SITUATIONS = [
  { id: 'exam',      label: '📝 Exam preparation', desc: 'IELTS, DELF, JLPT, or any other exam' },
  { id: 'courses',   label: '🏫 Language courses',  desc: 'Group classes at a school or online' },
  { id: 'tutor',     label: '👤 Private tutor',      desc: 'One-on-one lessons' },
  { id: 'self',      label: '📖 Self-study',          desc: 'Learning independently' },
  { id: 'immersion', label: '🌍 Living abroad',       desc: 'Immersed in the language daily' },
]

const STEPS = ['Language', 'Goal', 'Situation', 'Topics', 'Time', 'Words', 'Done']

const POS_COLORS = {
  verb:        'bg-violet-50 text-violet-700 border-violet-200',
  noun:        'bg-blue-50 text-blue-700 border-blue-200',
  adjective:   'bg-amber-50 text-amber-700 border-amber-200',
  adverb:      'bg-teal-50 text-teal-700 border-teal-200',
  conjunction: 'bg-rose-50 text-rose-700 border-rose-200',
  preposition: 'bg-gray-100 text-gray-600 border-gray-200',
}

export default function Onboarding() {
  const navigate   = useNavigate()
  const { user }   = useAuth()
  const { lang }   = useLanguage()
  const [step, setStep]   = useState(0)
  const [saving, setSaving] = useState(false)

  const [answers, setAnswers] = useState({
    language: null,
    level: null,
    goals: [],
    goalCustom: '',
    situations: [],
    situationCustom: '',
    examName: '',
    examDate: '',
    topics: [],
    topicCustom: '',
    time: null,
    timeCustom: '',
  })

  // ── Word pack state ──────────────────────────────────────────────────────
  const [packIndex,   setPackIndex]   = useState(0)
  const [wordChoices, setWordChoices] = useState([]) // [{...wordData, status}]

  // Build a balanced starter pack once when language/level are set:
  // group by POS, shuffle within each group, take up to 6 per POS, cap at 25, shuffle.
  const packWords = useMemo(() => {
    if (!answers.language || !answers.level) return []
    const pack = getWordPack(answers.language, answers.level)
    if (!pack) return []

    const shuffle = (list) => {
      const a = [...list]
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]]
      }
      return a
    }

    // Group by part of speech, shuffle within each group, take up to 6 per POS
    const byPos = {}
    for (const w of pack) (byPos[w.pos] ??= []).push(w)
    const balanced = Object.values(byPos).flatMap((group) => shuffle(group).slice(0, 6))

    // Cap the combined result at 25, then shuffle the final list
    return shuffle(balanced.slice(0, 25))
  }, [answers.language, answers.level])

  const hasPack = packWords.length > 0

  // ── Navigation ───────────────────────────────────────────────────────────
  const progress = (step / (STEPS.length - 1)) * 100

  const update       = (key, value) => setAnswers((a) => ({ ...a, [key]: value }))
  const toggleTopic  = (topic) => setAnswers((a) => ({
    ...a,
    topics: a.topics.includes(topic) ? a.topics.filter((t) => t !== topic) : [...a.topics, topic],
  }))
  const toggleSituation = (id) => setAnswers((a) => {
    const has = a.situations.includes(id)
    const situations = has ? a.situations.filter((s) => s !== id) : [...a.situations, id]
    // Clear the exam fields when the exam situation is deselected
    const examReset = id === 'exam' && has ? { examName: '', examDate: '' } : {}
    return { ...a, situations, ...examReset }
  })
  const toggleGoal = (id) => setAnswers((a) => {
    const selected = a.goals.includes(id)
      ? a.goals.filter((g) => g !== id)
      : a.goals.length < 3 ? [...a.goals, id] : a.goals
    return { ...a, goals: selected, goalCustom: '' }
  })

  const canProceed = () => {
    if (step === 0) return answers.language && answers.level
    if (step === 1) return answers.goals.length > 0 || answers.goalCustom
    if (step === 2) return answers.situations.length > 0 || answers.situationCustom
    if (step === 3) return answers.topics.length > 0 || answers.topicCustom
    if (step === 4) return answers.time || answers.timeCustom
    return true // step 5 (Words) is always skippable
  }

  async function handleContinue() {
    // Step 5 → save word choices to Supabase before advancing
    if (step === 5 && wordChoices.length > 0 && user) {
      setSaving(true)
      const today       = new Date().toISOString().slice(0, 10)
      const targetLangCode = answers.language
      const stageMap    = { known: 'known', learning: 'early', new: 'new' }

      const rows = wordChoices.map((w) => ({
        user_id:         user.id,
        word:            w.word,
        form:            w.form || null,
        pos:             w.pos,
        entry_type:      w.entryType,
        translation:     w.translation,
        grammar_note:    w.grammarNote || null,
        explanation:     null,
        is_exception:    false,
        conjugation:     null,
        status:          w.status,
        source:          'word-pack',
        date_added:      today,
        last_reviewed:   '—',
        target_language: targetLangCode,
      }))

      // Insert in chunks; capture IDs to build word_senses
      for (let i = 0; i < rows.length; i += 25) {
        const chunk    = rows.slice(i, i + 25)
        const srcChunk = wordChoices.slice(i, i + 25)
        const { data: inserted } = await supabase
          .from('words')
          .insert(chunk)
          .select('id')

        if (inserted?.length) {
          const senses = inserted.map((w, j) => ({
            word_id:              w.id,
            user_id:              user.id,
            target_language:      targetLangCode,
            pos:                  srcChunk[j].pos,
            word_form:            srcChunk[j].word,
            translation:          srcChunk[j].translation,
            form:                 srcChunk[j].form || null,
            grammar_note:         srcChunk[j].grammarNote || null,
            usage_note:           srcChunk[j].usageNote || null,
            is_exception:         false,
            register:             'neutral',
            learning_stage:       stageMap[srcChunk[j].status] ?? 'new',
            correct_recall_count: 0,
            aspect:               null,
            gender:               null,
            image_url:            null,
            examples:             [],
          }))
          await supabase.from('word_senses').insert(senses)
        }
      }
      setSaving(false)
    }
    setStep((s) => s + 1)
  }

  async function handleFinish() {
    setSaving(true)
    const interfaceLanguage = lang === 'uk' ? 'Ukrainian' : 'English'

    // ── Goals: predefined selection + custom free-text + AI-parsed tags ──
    let goals
    if (answers.goalCustom?.trim()) {
      let parsed = null
      try {
        parsed = await parseGoal(answers.goalCustom, interfaceLanguage)
      } catch (e) {
        // Parsing must never block onboarding completion.
        console.error('parseGoal failed:', e)
      }
      goals = { selected: answers.goals, custom: answers.goalCustom, parsed }
    } else {
      goals = { selected: answers.goals, custom: null, parsed: null }
    }
    // Exam details — only when the exam situation was selected
    if (answers.situations.includes('exam')) {
      goals.exam = { name: answers.examName || null, date: answers.examDate || null }
    }

    // ── Topics of interest: selected chips + custom topic as one string array ──
    const topics = [...answers.topics]
    if (answers.topicCustom?.trim()) topics.push(answers.topicCustom.trim())

    await supabase.from('profiles').upsert({
      id:                     user.id,
      active_target_language: answers.language,
      onboarding_complete:    true,
      goals,
      topics,
    })
    setSaving(false)
    navigate('/dashboard')
  }

  // ── Word pack card actions ───────────────────────────────────────────────
  function handleWordChoice(status) {
    const word = packWords[packIndex]
    setWordChoices((prev) => [...prev, { ...word, status }])
    advancePack()
  }

  function advancePack() {
    if (packIndex + 1 >= packWords.length) {
      // Auto-advance to Done step after last card
      handleContinue()
    } else {
      setPackIndex((i) => i + 1)
    }
  }

  const currentPackWord = packWords[packIndex]
  const packProgress    = packWords.length > 0 ? (packIndex / packWords.length) * 100 : 0

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex flex-col items-center justify-center px-4 py-10">

      {/* Progress bar */}
      <div className="w-full max-w-lg mb-8">
        <div className="flex justify-between text-xs text-gray-400 mb-2">
          {STEPS.map((s, i) => (
            <span key={s} className={i <= step ? 'text-indigo-600 font-medium' : ''}>{s}</span>
          ))}
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-indigo-500 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* ── Step 5: Word pack (fullscreen card mode) ── */}
      {step === 5 && hasPack && currentPackWord && (
        <div className="w-full max-w-lg">
          <button
            onClick={() => setStep(4)}
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors mb-4"
          >
            ← Back
          </button>
          {/* Header */}
          <div className="text-center mb-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-1">Build your starter vocabulary</h2>
            <p className="text-gray-500 text-sm">Tell us which words you already know. They'll go straight into your dictionary.</p>
          </div>

          {/* Pack progress bar */}
          <div className="mb-5">
            <div className="flex justify-between text-xs text-gray-400 mb-1.5">
              <span>{wordChoices.length} added so far</span>
              <span>{packIndex + 1} / {packWords.length}</span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-400 rounded-full transition-all duration-200" style={{ width: `${packProgress}%` }} />
            </div>
          </div>

          {/* Card */}
          <div className="bg-white rounded-3xl shadow-md border border-gray-100 px-8 py-10 mb-5 flex flex-col items-center text-center gap-3">
            <div className="flex gap-2 flex-wrap justify-center">
              <span className={`px-2 py-0.5 rounded-md text-xs font-semibold border ${POS_COLORS[currentPackWord.pos] || POS_COLORS.preposition}`}>
                {currentPackWord.pos}
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                {currentPackWord.category}
              </span>
            </div>
            <p className="text-3xl font-bold text-gray-900 leading-tight">{currentPackWord.word}</p>
            {currentPackWord.form && (
              <p className="text-sm text-gray-400 italic -mt-1">{currentPackWord.form}</p>
            )}
            <p className="text-lg text-gray-600">{currentPackWord.translation}</p>
            {currentPackWord.grammarNote && (
              <p className="text-xs text-gray-400 border-t border-gray-100 pt-3 w-full">{currentPackWord.grammarNote}</p>
            )}
          </div>

          {/* Choice buttons */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            <button
              onClick={() => handleWordChoice('new')}
              className="py-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-semibold transition-colors"
            >
              New to me
            </button>
            <button
              onClick={() => handleWordChoice('learning')}
              className="py-3 rounded-xl bg-yellow-100 hover:bg-yellow-200 text-yellow-700 text-sm font-semibold transition-colors"
            >
              Seen it 👀
            </button>
            <button
              onClick={() => handleWordChoice('known')}
              className="py-3 rounded-xl bg-green-100 hover:bg-green-200 text-green-700 text-sm font-semibold transition-colors"
            >
              Know it ✓
            </button>
          </div>
          <div className="flex justify-between items-center">
            <button
              onClick={handleContinue}
              disabled={saving}
              className="text-sm text-gray-400 hover:text-gray-600 transition-colors px-2 py-1 disabled:opacity-50"
            >
              Skip this step →
            </button>
            {wordChoices.length >= 10 && (
              <button
                onClick={handleContinue}
                disabled={saving}
                className="text-sm text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
              >
                {saving ? 'Saving…' : `Finish early (${wordChoices.length} words) →`}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Step 5: No pack available for this language ── */}
      {step === 5 && !hasPack && (
        <div className="bg-white rounded-3xl shadow-xl shadow-gray-100 border border-gray-100 p-8 w-full max-w-lg text-center">
          <div className="text-left">
            <button
              onClick={() => setStep(4)}
              className="text-sm text-gray-400 hover:text-gray-600 transition-colors mb-2"
            >
              ← Back
            </button>
          </div>
          <div className="text-4xl mb-4">📦</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Word packs coming soon</h2>
          <p className="text-gray-500 text-sm mb-8">We're building starter vocabulary packs for this language. For now, you can add words manually from your dashboard.</p>
          <button
            onClick={() => setStep(6)}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-2xl font-semibold text-sm transition-colors"
          >
            Continue →
          </button>
        </div>
      )}

      {/* ── All other steps ── */}
      {step !== 5 && (
        <div className="bg-white rounded-3xl shadow-xl shadow-gray-100 border border-gray-100 p-8 w-full max-w-lg">

          {/* Step 0 — Language & Level */}
          {step === 0 && (
            <div>
              <h2 className="text-2xl font-bold text-gray-900 mb-1">Which language are you learning?</h2>
              <p className="text-gray-500 text-sm mb-6">You can add more languages later.</p>
              <div className="grid grid-cols-2 gap-2 mb-6">
                {LANGUAGES.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => update('language', lang.code)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium transition-all ${
                      answers.language === lang.code
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-gray-200 text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <span className="text-xl">{lang.flag}</span>
                    {lang.name}
                  </button>
                ))}
              </div>
              <p className="text-gray-700 font-medium text-sm mb-3">What is your current level?</p>
              <div className="flex flex-wrap gap-2">
                {LEVELS.map((level) => (
                  <button
                    key={level}
                    onClick={() => update('level', level)}
                    className={`px-4 py-2 rounded-full border text-sm font-medium transition-all ${
                      answers.level === level
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 1 — Goal */}
          {step === 1 && (
            <div>
              <h2 className="text-2xl font-bold text-gray-900 mb-1">What is your goal?</h2>
              <p className="text-gray-500 text-sm mb-1">This shapes your learning path from day one.</p>
              <p className="text-gray-400 text-xs mb-6">
                Pick up to 3.{' '}
                {answers.goals.length > 0 && (
                  <span className="text-indigo-500 font-medium">{answers.goals.length}/3 selected</span>
                )}
              </p>
              <div className="grid grid-cols-2 gap-3 mb-4">
                {GOALS.map((goal) => {
                  const selected = answers.goals.includes(goal.id)
                  const maxed = answers.goals.length >= 3 && !selected
                  return (
                    <button
                      key={goal.id}
                      onClick={() => toggleGoal(goal.id)}
                      disabled={maxed}
                      className={`text-left px-4 py-3 rounded-xl border text-sm transition-all relative ${
                        selected ? 'border-indigo-500 bg-indigo-50'
                        : maxed ? 'border-gray-100 bg-gray-50 opacity-40 cursor-not-allowed'
                        : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="font-medium text-gray-900">{goal.label}</div>
                      <div className="text-gray-500 text-xs mt-0.5">{goal.desc}</div>
                      {selected && <span className="absolute top-2 right-3 text-indigo-500 text-xs font-bold">✓</span>}
                    </button>
                  )
                })}
              </div>
              <input
                type="text"
                placeholder="Or write your own goal..."
                value={answers.goalCustom}
                onChange={(e) => { update('goalCustom', e.target.value); update('goals', []) }}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-indigo-400 transition-colors"
              />
            </div>
          )}

          {/* Step 2 — Study situation */}
          {step === 2 && (
            <div>
              <h2 className="text-2xl font-bold text-gray-900 mb-1">How are you learning right now?</h2>
              <p className="text-gray-500 text-sm mb-1">We'd love to know your situation so we can support you better.</p>
              <p className="text-gray-400 text-xs mb-6">Select all that apply.</p>
              <div className="space-y-3 mb-4">
                {STUDY_SITUATIONS.map((s) => (
                  <div key={s.id}>
                    <button
                      onClick={() => toggleSituation(s.id)}
                      className={`w-full text-left px-4 py-3.5 rounded-xl border text-sm transition-all flex items-center gap-4 ${
                        answers.situations.includes(s.id) ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <span className="text-xl">{s.label.split(' ')[0]}</span>
                      <div>
                        <div className="font-medium text-gray-900">{s.label.split(' ').slice(1).join(' ')}</div>
                        <div className="text-xs text-gray-400 mt-0.5">{s.desc}</div>
                      </div>
                      {answers.situations.includes(s.id) && <span className="ml-auto text-indigo-500 text-base">✓</span>}
                    </button>

                    {/* Optional exam details — only while the exam situation is selected */}
                    {s.id === 'exam' && answers.situations.includes('exam') && (
                      <div className="mt-2 mx-1 space-y-2">
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Which exam?</label>
                          <input
                            type="text"
                            placeholder="e.g. IELTS, Goethe B2, ЗНО"
                            value={answers.examName}
                            onChange={(e) => update('examName', e.target.value)}
                            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-indigo-400 transition-colors"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">When is it?</label>
                          <input
                            type="month"
                            value={answers.examDate}
                            onChange={(e) => update('examDate', e.target.value)}
                            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-indigo-400 transition-colors"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <input
                type="text"
                placeholder="Something else? Tell us in your own words..."
                value={answers.situationCustom}
                onChange={(e) => update('situationCustom', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-indigo-400 transition-colors"
              />
            </div>
          )}

          {/* Step 3 — Topics */}
          {step === 3 && (
            <div>
              <h2 className="text-2xl font-bold text-gray-900 mb-1">What topics interest you?</h2>
              <p className="text-gray-500 text-sm mb-6">We'll include these words in your exercises. Pick as many as you like.</p>
              <div className="flex flex-wrap gap-2 mb-4">
                {TOPICS.map((topic) => (
                  <button
                    key={topic}
                    onClick={() => toggleTopic(topic)}
                    className={`px-4 py-2 rounded-full border text-sm font-medium transition-all ${
                      answers.topics.includes(topic)
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {topic}
                  </button>
                ))}
              </div>
              <input
                type="text"
                placeholder="Add your own topic..."
                value={answers.topicCustom}
                onChange={(e) => update('topicCustom', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-indigo-400 transition-colors"
              />
            </div>
          )}

          {/* Step 4 — Time */}
          {step === 4 && (
            <div>
              <h2 className="text-2xl font-bold text-gray-900 mb-1">How much time can you dedicate?</h2>
              <p className="text-gray-500 text-sm mb-6">We'll build a realistic plan around your schedule.</p>
              <div className="grid grid-cols-2 gap-3 mb-6">
                {TIME_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => { update('time', opt.id); update('timeCustom', '') }}
                    className={`text-left px-4 py-3 rounded-xl border text-sm transition-all ${
                      answers.time === opt.id ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="font-semibold text-gray-900">{opt.label}</div>
                    <div className="text-gray-500 text-xs mt-0.5">{opt.desc}</div>
                  </button>
                ))}
              </div>
              <input
                type="text"
                placeholder="Or describe your schedule in your own words..."
                value={answers.timeCustom}
                onChange={(e) => { update('timeCustom', e.target.value); update('time', null) }}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-indigo-400 transition-colors mt-4"
              />
            </div>
          )}

          {/* Step 6 — Done */}
          {step === 6 && (
            <div className="text-center py-4">
              <div className="text-left">
                <button
                  onClick={() => setStep(5)}
                  className="text-sm text-gray-400 hover:text-gray-600 transition-colors mb-2"
                >
                  ← Back
                </button>
              </div>
              <div className="text-5xl mb-4">🎉</div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">You're all set!</h2>
              <p className="text-gray-500 text-sm mb-2">
                Your personalized learning path is ready.
              </p>
              {wordChoices.length > 0 && (
                <p className="text-indigo-600 text-sm font-medium mb-6">
                  {wordChoices.length} words added to your dictionary ✓
                </p>
              )}
              {wordChoices.length === 0 && <div className="mb-6" />}
              <button
                onClick={handleFinish}
                disabled={saving}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white py-3.5 rounded-2xl font-semibold transition-colors"
              >
                {saving ? 'Setting up…' : 'Go to my dashboard →'}
              </button>
            </div>
          )}

          {/* Navigation — shown on all steps except 5 and 6 */}
          {step < 5 && (
            <div className="flex justify-between items-center mt-8">
              <button
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                className={`text-sm text-gray-400 hover:text-gray-600 transition-colors ${step === 0 ? 'invisible' : ''}`}
              >
                ← Back
              </button>
              <button
                onClick={handleContinue}
                disabled={!canProceed()}
                className={`px-6 py-2.5 rounded-full text-sm font-semibold transition-all ${
                  canProceed()
                    ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                }`}
              >
                Continue →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
