import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

const LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'fr', name: 'French', flag: '🇫🇷' },
  { code: 'es', name: 'Spanish', flag: '🇪🇸' },
  { code: 'de', name: 'German', flag: '🇩🇪' },
  { code: 'it', name: 'Italian', flag: '🇮🇹' },
  { code: 'pt', name: 'Portuguese', flag: '🇵🇹' },
  { code: 'uk', name: 'Ukrainian', flag: '🇺🇦' },
  { code: 'ja', name: 'Japanese', flag: '🇯🇵' },
  { code: 'zh', name: 'Chinese', flag: '🇨🇳' },
  { code: 'ko', name: 'Korean', flag: '🇰🇷' },
]

const LEVELS = ['Beginner', 'Elementary', 'Intermediate', 'Upper-Intermediate', 'Advanced']

const GOALS = [
  { id: 'travel', label: '✈️ Travel', desc: 'Get by and connect while abroad' },
  { id: 'fluency', label: '💬 Fluency', desc: 'Speak naturally and confidently' },
  { id: 'work', label: '💼 Work', desc: 'Professional communication' },
  { id: 'study', label: '📚 Academic', desc: 'University or formal studies' },
  { id: 'culture', label: '🎭 Culture', desc: 'Books, films, music, people' },
  { id: 'curiosity', label: '🌍 Curiosity', desc: 'Just love languages' },
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
  { id: '45-60', label: '45–60 min / day', desc: 'Full commitment' },
]

const STUDY_SITUATIONS = [
  { id: 'exam', label: '📝 Exam preparation', desc: 'IELTS, DELF, JLPT, or any other exam' },
  { id: 'courses', label: '🏫 Language courses', desc: 'Group classes at a school or online' },
  { id: 'tutor', label: '👤 Private tutor', desc: 'One-on-one lessons' },
  { id: 'self', label: '📖 Self-study', desc: 'Learning independently' },
  { id: 'immersion', label: '🌍 Living abroad', desc: 'Immersed in the language daily' },
]

const STEPS = ['Language', 'Goal', 'Situation', 'Topics', 'Time', 'Done']

export default function Onboarding() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState({
    language: null,
    level: null,
    goals: [],
    goalCustom: '',
    situations: [],
    situationCustom: '',
    topics: [],
    topicCustom: '',
    time: null,
    timeCustom: '',
    hasMaterials: null,
  })

  const progress = (step / (STEPS.length - 1)) * 100

  const update = (key, value) => setAnswers((a) => ({ ...a, [key]: value }))

  const toggleTopic = (topic) => {
    setAnswers((a) => ({
      ...a,
      topics: a.topics.includes(topic)
        ? a.topics.filter((t) => t !== topic)
        : [...a.topics, topic],
    }))
  }

  const toggleSituation = (id) => {
    setAnswers((a) => ({
      ...a,
      situations: a.situations.includes(id)
        ? a.situations.filter((s) => s !== id)
        : [...a.situations, id],
    }))
  }

  const toggleGoal = (id) => {
    setAnswers((a) => {
      const selected = a.goals.includes(id)
        ? a.goals.filter((g) => g !== id)
        : a.goals.length < 3 ? [...a.goals, id] : a.goals
      return { ...a, goals: selected, goalCustom: '' }
    })
  }

  const canProceed = () => {
    if (step === 0) return answers.language && answers.level
    if (step === 1) return answers.goals.length > 0 || answers.goalCustom
    if (step === 2) return answers.situations.length > 0 || answers.situationCustom
    if (step === 3) return answers.topics.length > 0 || answers.topicCustom
    if (step === 4) return answers.time || answers.timeCustom
    return true
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex flex-col items-center justify-center px-4 py-10">
      {/* Progress */}
      <div className="w-full max-w-lg mb-8">
        <div className="flex justify-between text-xs text-gray-400 mb-2">
          {STEPS.map((s, i) => (
            <span key={s} className={i <= step ? 'text-indigo-600 font-medium' : ''}>{s}</span>
          ))}
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-indigo-500 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

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
                      selected
                        ? 'border-indigo-500 bg-indigo-50'
                        : maxed
                        ? 'border-gray-100 bg-gray-50 opacity-40 cursor-not-allowed'
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
            <p className="text-gray-400 text-xs mb-6">Taking an exam? Working with a tutor? We'll make sure the app fits your life — not the other way around. Select all that apply.</p>
            <div className="space-y-3 mb-4">
              {STUDY_SITUATIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => toggleSituation(s.id)}
                  className={`w-full text-left px-4 py-3.5 rounded-xl border text-sm transition-all flex items-center gap-4 ${
                    answers.situations.includes(s.id)
                      ? 'border-indigo-500 bg-indigo-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <span className="text-xl">{s.label.split(' ')[0]}</span>
                  <div>
                    <div className="font-medium text-gray-900">{s.label.split(' ').slice(1).join(' ')}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{s.desc}</div>
                  </div>
                  {answers.situations.includes(s.id) && (
                    <span className="ml-auto text-indigo-500 text-base">✓</span>
                  )}
                </button>
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

        {/* Step 3 — Topics (now index 3) */}
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
                    answers.time === opt.id
                      ? 'border-indigo-500 bg-indigo-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="font-semibold text-gray-900">{opt.label}</div>
                  <div className="text-gray-500 text-xs mt-0.5">{opt.desc}</div>
                </button>
              ))}
            </div>

            <div className="border border-gray-200 rounded-2xl p-4 bg-indigo-50/50">
              <p className="text-sm font-medium text-gray-800 mb-1">📎 Do you have study materials?</p>
              <p className="text-xs text-gray-500 mb-3">
                You can upload textbooks, PDFs, notes, articles — as many as you like.
                The more you share, the better the app adapts to your level and what you're already studying.
              </p>
              <div className="flex gap-2">
                {['Yes, I have materials', 'Not yet'].map((opt) => (
                  <button
                    key={opt}
                    onClick={() => update('hasMaterials', opt)}
                    className={`flex-1 py-2 rounded-xl border text-xs font-medium transition-all ${
                      answers.hasMaterials === opt
                        ? 'border-indigo-500 bg-white text-indigo-700'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
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

        {/* Step 5 — Done */}
        {step === 5 && (
          <div className="text-center py-4">
            <div className="text-5xl mb-4">🎉</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">You're all set!</h2>
            <p className="text-gray-500 text-sm mb-8">
              Your personalized learning path is ready. Let's start building your vocabulary.
            </p>
            <button
              onClick={() => navigate('/dashboard')}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3.5 rounded-2xl font-semibold transition-colors"
            >
              Go to my dashboard →
            </button>
          </div>
        )}

        {/* Navigation */}
        {step < 5 && (
          <div className="flex justify-between items-center mt-8">
            <button
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              className={`text-sm text-gray-400 hover:text-gray-600 transition-colors ${step === 0 ? 'invisible' : ''}`}
            >
              ← Back
            </button>
            <button
              onClick={() => setStep((s) => s + 1)}
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
    </div>
  )
}
