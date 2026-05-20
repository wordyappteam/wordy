import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { useLanguage } from '../lib/i18n'
import { startSession, completeSession, logWordResult } from '../lib/sessionEngine'

const EXERCISE_LABELS = {
  flashcards:       { en: 'Flashcards',          uk: 'Флеш-картки',            icon: '🃏' },
  word_order:       { en: 'Word order',           uk: 'Порядок слів',           icon: '🔀' },
  fill_blank:       { en: 'Fill in the blank',    uk: 'Заповніть пропуск',      icon: '✏️' },
  active_recall:    { en: 'Active recall',        uk: 'Активне відтворення',    icon: '🧠' },
  sentence_writing: { en: 'Sentence writing',     uk: 'Написання речень',       icon: '✍️' },
}

export default function Session() {
  const navigate  = useNavigate()
  const { user }  = useAuth()
  const { lang }  = useLanguage()
  const uk = lang === 'uk'

  const [plan,       setPlan]       = useState(null)
  const [sessionId,  setSessionId]  = useState(null)
  const [step,       setStep]       = useState(0)   // index into plan.exercises
  const [results,    setResults]    = useState([])  // accumulated word results
  const [phase,      setPhase]      = useState('intro')  // 'intro' | 'exercise' | 'done'

  useEffect(() => {
    const raw = sessionStorage.getItem('wordy_session')
    if (!raw) { navigate('/dashboard'); return }
    const loadedPlan = JSON.parse(raw)
    setPlan(loadedPlan)

    const currentStep = parseInt(sessionStorage.getItem('wordy_session_current_step') ?? '0')
    const savedId     = sessionStorage.getItem('wordy_session_id')
    if (savedId) setSessionId(parseInt(savedId))

    if (currentStep === 0) {
      setPhase('intro')
    } else if (currentStep >= (loadedPlan.exercises?.length ?? 0)) {
      setPhase('done')
    } else {
      // Returning from an exercise — auto-launch next
      setStep(currentStep)
      setPhase('auto')
    }
  }, [])

  useEffect(() => {
    if (!plan || !user || sessionId) return
    startSession(user.id, plan.type, plan.words.length).then(id => {
      if (id) {
        setSessionId(id)
        sessionStorage.setItem('wordy_session_id', String(id))
      }
    })
  }, [plan, user])

  // Auto-launch next exercise when returning mid-session
  useEffect(() => {
    if (phase === 'auto' && plan) {
      goToExercise(plan.exercises[step])
    }
  }, [phase, plan])

  if (!plan) return null

  const exercises  = plan.exercises ?? []
  const totalSteps = exercises.length
  const wordIds    = plan.words.map(w => w.id)

  // ── Finish session ─────────────────────────────────────────────────────
  async function handleFinish(finalResults) {
    if (sessionId) {
      await completeSession(sessionId, user.id, finalResults)
    }
    sessionStorage.removeItem('wordy_session')
    setResults(finalResults)
    setPhase('done')
  }

  // ── Launch next exercise ───────────────────────────────────────────────
  function goToExercise(exerciseId) {
    const paths = {
      flashcards:       '/flashcards',
      word_order:       '/word-order',
      fill_blank:       '/fill-blank',
      active_recall:    '/active-recall',
      sentence_writing: '/sentence-writing',
    }
    navigate(paths[exerciseId] ?? '/dashboard')
  }

  // ── Intro screen ───────────────────────────────────────────────────────
  if (phase === 'intro') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex flex-col">
        <nav className="bg-white/80 backdrop-blur border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <div className="text-xl font-bold text-indigo-600">wordy</div>
          <button onClick={() => navigate('/dashboard')} className="text-sm text-gray-400 hover:text-gray-700">
            ✕ {uk ? 'Скасувати' : 'Cancel'}
          </button>
        </nav>

        <div className="flex-1 flex flex-col items-center justify-center px-4">
          <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8 w-full max-w-md">
            <div className="text-center mb-6">
              <div className="text-4xl mb-3">📋</div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">{plan.title}</h2>
              <p className="text-sm text-gray-500 leading-relaxed">{plan.description}</p>
            </div>

            {/* Exercise sequence */}
            <div className="flex flex-col gap-2 mb-6">
              <p className="text-xs text-gray-400 font-medium mb-1">
                {uk ? 'Послідовність вправ:' : 'Exercise sequence:'}
              </p>
              {exercises.map((ex, i) => {
                const label = EXERCISE_LABELS[ex]
                return (
                  <div key={ex} className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-2.5">
                    <span className="text-lg">{label?.icon}</span>
                    <span className="text-sm font-medium text-gray-700">
                      {i + 1}. {uk ? label?.uk : label?.en}
                    </span>
                  </div>
                )
              })}
            </div>

            <div className="flex items-center justify-between text-xs text-gray-400 mb-6 px-1">
              <span>{plan.words.length} {uk ? 'слів' : 'words'}</span>
              <span>≈ {plan.durationMin} {uk ? 'хвилин' : 'minutes'}</span>
            </div>

            <button
              onClick={() => { setPhase('exercise'); goToExercise(exercises[0]) }}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-2xl transition-colors"
            >
              {uk ? 'Почати сесію →' : 'Start session →'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Done screen ────────────────────────────────────────────────────────
  if (phase === 'done') {
    const correct   = results.filter(r => r.result === 'correct').length
    const almost    = results.filter(r => r.result === 'almost').length
    const incorrect = results.filter(r => r.result === 'incorrect').length

    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex flex-col">
        <nav className="bg-white/80 backdrop-blur border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <div className="text-xl font-bold text-indigo-600">wordy</div>
          <div />
        </nav>
        <div className="flex-1 flex flex-col items-center justify-center px-4">
          <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-10 w-full max-w-md text-center">
            <div className="text-5xl mb-4">🎉</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-1">
              {uk ? 'Сесію завершено!' : 'Session complete!'}
            </h2>
            <p className="text-gray-500 text-sm mb-8">
              {plan.words.length} {uk ? 'слів опрацьовано' : 'words worked on'}
            </p>

            <div className="grid grid-cols-3 gap-4 mb-8">
              <div className="bg-green-50 rounded-2xl p-4">
                <div className="text-2xl font-bold text-green-600">{correct}</div>
                <div className="text-xs text-green-700 font-medium mt-0.5">{uk ? 'Правильно' : 'Correct'}</div>
              </div>
              <div className="bg-yellow-50 rounded-2xl p-4">
                <div className="text-2xl font-bold text-yellow-500">{almost}</div>
                <div className="text-xs text-yellow-600 font-medium mt-0.5">{uk ? 'Майже' : 'Almost'}</div>
              </div>
              <div className="bg-red-50 rounded-2xl p-4">
                <div className="text-2xl font-bold text-red-500">{incorrect}</div>
                <div className="text-xs text-red-600 font-medium mt-0.5">{uk ? 'Важко' : 'Difficult'}</div>
              </div>
            </div>

            <button
              onClick={() => navigate('/dashboard')}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-2xl font-semibold text-sm transition-colors"
            >
              {uk ? 'На головну' : 'Back to dashboard'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return null
}
