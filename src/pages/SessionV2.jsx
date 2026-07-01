// SRS v2 session runner (test harness on the srs-v2 branch).
// Self-contained: loads word_senses, plans with planSessionV2, runs each step,
// grades ONE outcome per sense, then calls completeSessionV2. Deliberately not
// wired into the live session flow — this is for validating the v2 loop.
import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useTargetLang } from '../lib/TargetLangContext'
import { useLanguage } from '../lib/i18n'
import { reviewSentence } from '../lib/claude'
import { planSessionV2, sentenceOutcome, firstFillBlank, gradeFillIn } from '../lib/srs'
import { startSession, completeSessionV2 } from '../lib/sessionEngine'
import { displayTranslation } from '../lib/senseDisplay'
import { getNewToday, addNewToday } from '../lib/dailyNew'

// ── grading helpers ──────────────────────────────────────────────────────────
const norm = (s) => (s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
function lev(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
  return dp[a.length][b.length]
}
// Compare a typed answer to the word form, tolerating a leading article ("das ", "to ").
function gradeTyped(input, answer) {
  const a = norm(input)
  if (!a) return 'wrong'
  const targets = [norm(answer), norm((answer || '').replace(/^(der|die|das|to)\s+/i, ''))].filter(Boolean)
  if (targets.includes(a)) return 'correct'
  if (targets.some((t) => lev(a, t) <= 1)) return 'almost'
  return 'wrong'
}
function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}
// Build multiple-choice options: correct value + distractors drawn from the deck.
function makeOptions(correct, pool, valueOf, excludeWordId, n = 3) {
  const seen = new Set([norm(correct)])
  const ds = []
  for (const s of shuffle(pool)) {
    if (s.word_id === excludeWordId) continue // skip the word itself AND its sibling senses
    const v = valueOf(s)
    if (!v || seen.has(norm(v))) continue
    seen.add(norm(v)); ds.push(v)
    if (ds.length >= n) break
  }
  return shuffle([correct, ...ds])
}
function speak(text, locale) {
  try {
    const u = new SpeechSynthesisUtterance(text)
    u.lang = locale || 'de-DE'
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(u)
  } catch { /* TTS unavailable */ }
}

const EX_LABEL = {
  flashcard: 'Flashcard', fill_blank: 'Fill in context', recognition: 'Recognise',
  word_choice: 'Choose the word', active_recall: 'Recall', sentence_writing: 'Write a sentence',
}

// ── One step ─────────────────────────────────────────────────────────────────
function StepCard({ step, pool, ifaceLang, targetLanguageName, speechLocale, onDone }) {
  const [revealed, setRevealed] = useState(false)
  const [input, setInput] = useState('')
  const [picked, setPicked] = useState(null)
  const [feedback, setFeedback] = useState(null) // { outcome, detail }
  const [busy, setBusy] = useState(false)

  const cleanTr = displayTranslation(step.translation)

  // Rotate through the sense's examples (anti-memorization). Cursor persists
  // per sense in localStorage; advances each time this card mounts.
  const fillBlank = useMemo(() => {
    if (step.exercise !== 'fill_in' && step.exercise !== 'fill_blank') return null
    const exs = step.examples || []
    if (!exs.length) return null
    const key = `wordy_ex_cursor_${step.senseId}`
    let cursor = 0
    try { cursor = parseInt(localStorage.getItem(key) || '0', 10) || 0 } catch { /* no storage */ }
    try { localStorage.setItem(key, String(cursor + 1)) } catch { /* no storage */ }
    return firstFillBlank(exs, step.word, cursor)
  }, [step.senseId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Compute the multiple-choice options ONCE per step (not every render), so they
  // don't reshuffle when you answer — and so your picked wrong option stays in the
  // list and can be highlighted red.
  const options = useMemo(() => {
    if (step.exercise === 'recognition') return makeOptions(cleanTr, pool, (s) => displayTranslation(s.translation), step.wordId)
    if (step.exercise === 'word_choice') return makeOptions(step.word, pool, (s) => s.word_form, step.wordId)
    return []
  }, [step.senseId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ----- ungraded scaffolds: flashcard / fill_blank -----
  if (!step.graded) {
    const isFill = step.exercise === 'fill_blank' && fillBlank
    return (
      <Shell step={step}>
        {!isFill ? (
          <>
            <p className="text-3xl font-bold text-gray-900 text-center">{step.word}</p>
            {revealed && <p className="text-lg text-gray-600 text-center mt-2">{cleanTr}</p>}
          </>
        ) : (
          <>
            <p className="text-xl text-gray-800 text-center">{revealed ? fillBlank.target : fillBlank.sentence}</p>
            <p className="text-sm text-gray-400 text-center mt-1">{cleanTr}</p>
          </>
        )}
        {!revealed ? (
          <button onClick={() => { setRevealed(true); speak(step.word, speechLocale) }} className="btn-primary mt-6">Reveal 🔈</button>
        ) : (
          <button onClick={() => onDone(null)} className="btn-primary mt-6">Continue →</button>
        )}
      </Shell>
    )
  }

  // ----- graded: recognition (L2->L1) -----
  if (step.exercise === 'recognition') {
    const choose = (opt) => {
      if (feedback) return
      const outcome = norm(opt) === norm(cleanTr) ? 'correct' : 'wrong'
      setPicked(opt); setFeedback({ outcome })
    }
    return (
      <Shell step={step}>
        <p className="text-3xl font-bold text-gray-900 text-center mb-1">{step.word}</p>
        {step.pos && <p className="text-xs text-gray-400 text-center mb-1 italic">{step.pos}</p>}
        <p className="text-xs text-gray-400 text-center mb-5">Which translation?</p>
        <div className="grid gap-2">
          {options.map((opt) => <Option key={opt} opt={opt} picked={picked} correct={cleanTr} disabled={!!feedback} onClick={() => choose(opt)} />)}
        </div>
        {feedback && <NextBtn outcome={feedback.outcome} onClick={() => onDone(feedback.outcome)} />}
      </Shell>
    )
  }

  // ----- graded: word_choice (L1->L2 assemble/recognise the form) -----
  if (step.exercise === 'word_choice') {
    const choose = (opt) => {
      if (feedback) return
      const outcome = norm(opt) === norm(step.word) ? 'correct' : 'wrong'
      setPicked(opt); setFeedback({ outcome })
    }
    return (
      <Shell step={step}>
        <p className="text-2xl font-bold text-gray-900 text-center mb-1">{cleanTr}</p>
        <p className="text-xs text-gray-400 text-center mb-5">Pick the {targetLanguageName} word</p>
        <div className="grid gap-2">
          {options.map((opt) => <Option key={opt} opt={opt} picked={picked} correct={step.word} disabled={!!feedback} onClick={() => choose(opt)} />)}
        </div>
        {feedback && <NextBtn outcome={feedback.outcome} onClick={() => onDone(feedback.outcome)} />}
      </Shell>
    )
  }

  // ----- graded: fill_in (type the word into its own example sentence) -----
  if (step.exercise === 'fill_in') {
    // No usable example → fall back to a plain translation→type prompt.
    const submit = () => {
      if (feedback) return
      const outcome = fillBlank
        ? gradeFillIn(input, { answer: fillBlank.answer, lemma: step.word })
        : (norm(input) === norm(step.word) ? 'correct' : 'wrong')
      setFeedback({ outcome })
    }
    return (
      <Shell step={step}>
        <p className="text-sm text-gray-500 text-center mb-1">{cleanTr}</p>
        {fillBlank
          ? <p className="text-lg text-gray-800 text-center mb-4 leading-relaxed">{fillBlank.sentence}</p>
          : <p className="text-xs text-gray-400 text-center mb-4">Type the {targetLanguageName} word</p>}
        <input
          autoFocus value={input} disabled={!!feedback}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          className="w-full border border-gray-200 rounded-xl px-4 py-3 text-center text-lg focus:outline-none focus:border-indigo-400"
          placeholder="…"
        />
        {!feedback ? (
          <button onClick={submit} className="btn-primary mt-4">Check</button>
        ) : (
          <>
            {feedback.outcome === 'correct' && (
              <p className="text-center mt-4 text-sm text-green-600">✓ Correct</p>
            )}
            {feedback.outcome === 'almost' && (
              <p className="text-center mt-4 text-sm text-amber-600">≈ Almost — you were on the right path · <strong>{fillBlank?.answer ?? step.word}</strong></p>
            )}
            {feedback.outcome === 'wrong' && (
              <p className="text-center mt-4 text-sm text-rose-400">The word was <strong>{fillBlank?.answer ?? step.word}</strong></p>
            )}
            <NextBtn outcome={feedback.outcome} onClick={() => onDone(feedback.outcome)} />
          </>
        )}
      </Shell>
    )
  }

  // ----- graded: active_recall (type the word, L1->L2) -----
  if (step.exercise === 'active_recall') {
    const submit = () => {
      if (feedback) return
      setFeedback({ outcome: gradeTyped(input, step.word) })
    }
    return (
      <Shell step={step}>
        <p className="text-2xl font-bold text-gray-900 text-center mb-1">{cleanTr}</p>
        <p className="text-xs text-gray-400 text-center mb-5">Type the {targetLanguageName} word</p>
        <input
          autoFocus value={input} disabled={!!feedback}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          className="w-full border border-gray-200 rounded-xl px-4 py-3 text-center text-lg focus:outline-none focus:border-indigo-400"
          placeholder="…"
        />
        {!feedback ? (
          <button onClick={submit} className="btn-primary mt-4">Check</button>
        ) : (
          <>
            <p className={`text-center mt-4 text-sm ${feedback.outcome === 'wrong' ? 'text-red-500' : 'text-green-600'}`}>
              {feedback.outcome === 'correct' ? '✓ Correct' : feedback.outcome === 'almost' ? '≈ Almost — ' : '✗ '}
              {feedback.outcome !== 'correct' && <strong>{step.word}</strong>}
            </p>
            <NextBtn outcome={feedback.outcome} onClick={() => onDone(feedback.outcome)} />
          </>
        )}
      </Shell>
    )
  }

  // ----- graded: sentence_writing (AI review) -----
  if (step.exercise === 'sentence_writing') {
    const submit = async () => {
      if (feedback || busy || !input.trim()) return
      setBusy(true)
      try {
        const r = await reviewSentence(step.word, cleanTr, input, ifaceLang, targetLanguageName)
        // meaning wrong = FAIL; meaning ok but form wrong = HOLD ("almost"); both = PASS.
        // A grammar slip on a known word no longer demotes it.
        setFeedback({ outcome: sentenceOutcome(r), detail: r.feedback, corrected: r.corrected })
      } catch (e) {
        setFeedback({ outcome: e?.overloaded ? null : 'wrong', detail: e?.overloaded ? 'AI is busy — skipping scoring.' : 'Could not review.' })
      } finally { setBusy(false) }
    }
    return (
      <Shell step={step}>
        <p className="text-xl font-bold text-gray-900 text-center">{step.word}</p>
        <p className="text-sm text-gray-500 text-center mb-4">{cleanTr}</p>
        <textarea
          autoFocus value={input} disabled={!!feedback}
          onChange={(e) => setInput(e.target.value)}
          className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-400 min-h-[90px]"
          placeholder={`Write a sentence using ${step.word}…`}
        />
        {!feedback ? (
          <button onClick={submit} disabled={busy || !input.trim()} className="btn-primary mt-4 disabled:opacity-50">{busy ? 'Reviewing…' : 'Check'}</button>
        ) : (
          <>
            {feedback.detail && <p className="text-sm text-gray-600 mt-3">{feedback.detail}</p>}
            <NextBtn outcome={feedback.outcome} onClick={() => onDone(feedback.outcome)} />
          </>
        )}
      </Shell>
    )
  }

  // Unknown exercise — skip gracefully
  return <Shell step={step}><button onClick={() => onDone(null)} className="btn-primary">Continue →</button></Shell>
}

// ── small presentational helpers ─────────────────────────────────────────────
function Shell({ step, children }) {
  return (
    <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8 w-full max-w-md">
      <div className="flex items-center justify-between text-xs text-gray-400 mb-6">
        <span className="uppercase tracking-wide">{EX_LABEL[step.exercise] ?? step.exercise}{step.remedial ? ' · review' : ''}</span>
        <span className="px-2 py-0.5 rounded-full bg-gray-100">{step.stage}</span>
      </div>
      {children}
    </div>
  )
}
function Option({ opt, picked, correct, disabled, onClick }) {
  const isPicked = picked === opt
  const isCorrect = norm(opt) === norm(correct)
  let cls = 'border-gray-200 hover:border-indigo-300'
  if (disabled) cls = isCorrect ? 'border-green-400 bg-green-50' : isPicked ? 'border-red-300 bg-red-50' : 'border-gray-100 opacity-60'
  return <button onClick={onClick} disabled={disabled} className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition-colors ${cls}`}>{opt}</button>
}
function NextBtn({ outcome, onClick }) {
  return <button onClick={onClick} className="btn-primary mt-5">Next →</button>
}

// ── page ─────────────────────────────────────────────────────────────────────
export default function SessionV2() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { targetLang, targetLanguageName, speechLocale } = useTargetLang()
  const { lang } = useLanguage()
  const ifaceLang = lang === 'uk' ? 'Ukrainian' : 'English'

  const [phase, setPhase] = useState('loading') // loading | running | saving | done | empty | error
  const [pool, setPool] = useState([])
  const [steps, setSteps] = useState([])
  const [idx, setIdx] = useState(0)
  const [outcomes, setOutcomes] = useState({})
  const [sessionId, setSessionId] = useState(null)
  const [summary, setSummary] = useState([])
  const [remainingDue, setRemainingDue] = useState(0)
  const uk = lang === 'uk'
  // Guards addNewToday from double-incrementing if the completion handler
  // ever fires twice for the same session (reset whenever a fresh session loads).
  const countedRef = useRef(false)

  // Fresh DB read + plan — never the stale in-memory `pool`/`steps`. Senses that
  // were just reviewed get a future next_review_date, so only a re-query knows
  // what's still actually due right now.
  async function fetchDuePlan() {
    const { data, error } = await supabase.from('word_senses').select('*').eq('user_id', user.id).eq('target_language', targetLang)
    if (error) { console.error('[v2] load error:', error.message); return { error } }
    const senses = (data ?? []).filter((s) => s.translation?.trim() && s.word_form?.trim())
    const todayISO = new Date().toISOString().split('T')[0]
    const plan = planSessionV2(senses, {
      today: todayISO,
      gradedCap: 18,
      blockSize: 5,
      newPerDay: 7,
      newToday: getNewToday(todayISO),
    })
    return { senses, plan }
  }

  // Shared by the initial mount and "Keep going": re-query, re-plan, start a
  // fresh session row, and drop the runner into 'running'. `isCancelled` guards
  // against setting state after the owning effect has been cleaned up.
  async function loadAndPlan(isCancelled) {
    const { error, senses, plan } = await fetchDuePlan()
    if (isCancelled?.()) return
    if (error) { setPhase('error'); return }
    if (!plan.length) { setPhase('empty'); return }
    const gradedCount = new Set(plan.filter((s) => s.graded).map((s) => s.senseId)).size
    const id = await startSession(user.id, 'v2', gradedCount)
    if (isCancelled?.()) return
    countedRef.current = false
    setPool(senses); setSteps(plan); setSessionId(id); setPhase('running')
  }

  useEffect(() => {
    if (!user) return
    let cancelled = false
    setPhase('loading'); setIdx(0); setOutcomes({}); setSummary([]); setRemainingDue(0)
    loadAndPlan(() => cancelled)
    return () => { cancelled = true }
  }, [user, targetLang]) // eslint-disable-line react-hooks/exhaustive-deps

  // "Keep going": reset the runner state and re-run the load+plan path so the
  // next batch is capped fresh (new words still throttled by the updated newToday).
  function restart() {
    setPhase('loading'); setIdx(0); setOutcomes({}); setSummary([]); setRemainingDue(0)
    loadAndPlan()
  }

  async function handleDone(outcome) {
    const step = steps[idx]
    const nextOutcomes = step.graded && outcome ? { ...outcomes, [step.senseId]: outcome } : outcomes
    if (step.graded && outcome) setOutcomes(nextOutcomes)
    if (idx + 1 < steps.length) { setIdx(idx + 1); return }

    setPhase('saving')
    const todayISO = new Date().toISOString().split('T')[0]
    const results = Object.entries(nextOutcomes).map(([senseId, o]) => ({ senseId, outcome: o }))
    await completeSessionV2(sessionId, user.id, results, todayISO)
    if (!countedRef.current) {
      countedRef.current = true
      const newGraded = steps.filter((s) => s.graded && s.newIntake).length
      if (newGraded > 0) addNewToday(todayISO, newGraded)
    }
    const { data } = await supabase
      .from('word_senses')
      .select('id, word_form, translation, interval_step, learning_stage, next_review_date')
      .in('id', results.map((r) => r.senseId))
    setSummary((data ?? []).map((s) => ({ ...s, outcome: nextOutcomes[s.id] })))

    // Fresh re-query for what's still due — the senses above were just rescheduled
    // to a future next_review_date, so they must not count toward "remaining due".
    const { plan: nextPlan } = await fetchDuePlan()
    setRemainingDue(new Set((nextPlan ?? []).filter((s) => s.graded).map((s) => s.senseId)).size)

    setPhase('done')
  }

  const wrap = (inner) => (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex flex-col items-center justify-center px-4 py-10">
      <style>{`.btn-primary{width:100%;padding:.75rem;border-radius:.75rem;background:#4f46e5;color:#fff;font-weight:600;font-size:.875rem}.btn-primary:hover{background:#4338ca}.btn-secondary{width:100%;padding:.75rem;border-radius:.75rem;background:#eef2ff;color:#4338ca;font-weight:600;font-size:.875rem}.btn-secondary:hover{background:#e0e7ff}`}</style>
      {inner}
    </div>
  )

  if (phase === 'loading' || phase === 'saving')
    return wrap(<p className="text-gray-400 text-sm">{phase === 'saving' ? 'Saving your progress…' : 'Planning your session…'}</p>)
  if (phase === 'error')
    return wrap(<div className="text-center"><p className="text-red-500 text-sm mb-4">Couldn't load senses. Has migration 0008 been applied?</p><button onClick={() => navigate('/dashboard')} className="btn-primary max-w-xs">Back</button></div>)
  if (phase === 'empty')
    return wrap(<div className="text-center"><p className="text-gray-500 text-sm mb-4">Nothing due today. Add words, or come back later.</p><button onClick={() => navigate('/dashboard')} className="btn-primary max-w-xs">Back to dashboard</button></div>)

  if (phase === 'done') {
    return wrap(
      <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8 w-full max-w-md">
        <div className="text-4xl text-center mb-3">🎉</div>
        <h2 className="text-xl font-bold text-gray-900 text-center mb-1">Session complete</h2>
        <p className="text-sm text-gray-400 text-center mb-5">{summary.length} words reviewed</p>
        <div className="space-y-2 mb-6 max-h-80 overflow-y-auto">
          {summary.map((s) => (
            <div key={s.id} className="flex items-center justify-between text-sm border-b border-gray-50 py-1.5">
              <span className="font-medium text-gray-800">{s.word_form}</span>
              <span className="flex items-center gap-2 text-xs">
                <span className={s.outcome === 'correct' ? 'text-green-600' : s.outcome === 'almost' ? 'text-amber-500' : 'text-red-500'}>
                  {s.outcome === 'correct' ? 'PASS' : s.outcome === 'almost' ? 'HOLD' : 'FAIL'}
                </span>
                <span className="text-gray-400">→ {s.learning_stage} · next {s.next_review_date ?? '—'}</span>
              </span>
            </div>
          ))}
        </div>
        <button onClick={() => navigate('/dashboard')} className="btn-primary">Done</button>
        {remainingDue > 0 && (
          <button onClick={restart} className="btn-secondary mt-3">
            {uk ? 'Продовжити →' : 'Keep going →'} ({remainingDue})
          </button>
        )}
      </div>
    )
  }

  // running
  const step = steps[idx]
  const graded = steps.filter((s) => s.graded).length
  const gradedSoFar = Object.keys(outcomes).length
  return wrap(
    <>
      <div className="w-full max-w-md mb-5">
        <div className="flex justify-between text-xs text-gray-400 mb-1.5"><span>Step {idx + 1} / {steps.length}</span><span>{gradedSoFar} / {graded} graded</span></div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-indigo-500 transition-all" style={{ width: `${((idx + 1) / steps.length) * 100}%` }} /></div>
      </div>
      <StepCard
        key={idx}
        step={step}
        pool={pool}
        ifaceLang={ifaceLang}
        targetLanguageName={targetLanguageName}
        speechLocale={speechLocale}
        onDone={handleDone}
      />
    </>
  )
}
