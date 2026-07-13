import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useLanguage } from '../lib/i18n'
import { useTargetLang } from '../lib/TargetLangContext'
import { generateWordBankExercises, generatePrepExercises } from '../lib/claude'

// ── Helpers ────────────────────────────────────────────────────────────────

const PREP_LIST = new Set(['an','auf','über','für','mit','zu','von','nach','bei','gegen','ohne','um','aus','in'])
function hasPrep(word) {
  return word.toLowerCase().split(/\s+/).some((t) => PREP_LIST.has(t))
}

function speak(text, locale = 'de-DE') {
  if (!window.speechSynthesis) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = locale; u.rate = 0.85
  window.speechSynthesis.speak(u)
}

const SESSION_SIZE = 12

// ── Phase indicator ────────────────────────────────────────────────────────

function PhaseBar({ phase }) {
  const phases = ['flashcards', 'wordbank', 'exercise']
  const labels = ['Flashcards', 'Word bank', 'Fill in blanks']
  const current = phases.indexOf(phase)
  return (
    <div className="flex items-center gap-2">
      {phases.map((p, i) => (
        <div key={p} className="flex items-center gap-2">
          <div className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full transition-colors ${
            i < current  ? 'bg-emerald-100 text-emerald-700' :
            i === current ? 'bg-indigo-600 text-white' :
                           'bg-gray-100 text-gray-400'
          }`}>
            {i < current && <span>✓</span>}
            {labels[i]}
          </div>
          {i < phases.length - 1 && <span className="text-gray-200 text-xs">›</span>}
        </div>
      ))}
    </div>
  )
}

// ── Phase 1: Flashcards ────────────────────────────────────────────────────

function FlashcardPhase({ verbs, onComplete }) {
  const [index, setIndex]   = useState(0)
  const [flipped, setFlipped] = useState(false)

  const card = verbs[index]
  const progress = ((index) / verbs.length) * 100

  function next() {
    if (index + 1 >= verbs.length) { onComplete() }
    else { setIndex((i) => i + 1); setFlipped(false) }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Progress */}
      <div>
        <div className="flex justify-between text-xs text-gray-400 mb-1.5">
          <span>{index + 1} / {verbs.length}</span>
          <span>Skim through — just recognise</span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-indigo-400 transition-all duration-500 rounded-full" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Card */}
      <div className="cursor-pointer" style={{ perspective: '1200px' }} onClick={() => setFlipped((f) => !f)}>
        <div className="relative transition-transform duration-500" style={{
          transformStyle: 'preserve-3d',
          transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
          minHeight: '260px',
        }}>
          {/* Front */}
          <div className="absolute inset-0 bg-indigo-600 rounded-3xl shadow-lg flex flex-col items-center justify-center p-8 gap-3"
            style={{ backfaceVisibility: 'hidden' }}>
            <p className="text-xs text-indigo-200 uppercase tracking-widest">Tap to reveal</p>
            <h2 className="text-3xl font-bold text-white text-center">
              {card.word}
              {card.caseLabel && (
                <span className="text-xl font-normal text-indigo-200"> + {card.caseLabel}</span>
              )}
            </h2>
            <button onClick={(e) => { e.stopPropagation(); speak(card.word.replace(/\(.*?\)/g, '').trim(), speechLocale) }}
              className="mt-1 text-xs text-indigo-200 hover:text-white border border-indigo-400 hover:border-white px-3 py-1 rounded-full transition-colors">
              🔈 Pronounce
            </button>
          </div>

          {/* Back */}
          <div className="absolute inset-0 bg-white rounded-3xl shadow-lg border border-gray-100 flex flex-col justify-center p-8 gap-4"
            style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Translation</p>
              <p className="text-2xl font-bold text-gray-900">{card.translation}</p>
            </div>
            {card.example && (
              <div className="bg-gray-50 rounded-2xl px-4 py-3">
                <p className="text-sm font-medium text-gray-800">"{card.example.target}"</p>
                <p className="text-xs text-gray-400 italic mt-1">{card.example.translation}</p>
              </div>
            )}
            {card.grammarNote && (
              <div className={`rounded-xl px-3 py-2 text-xs font-medium flex items-center gap-2 ${
                card.isException ? 'bg-amber-50 text-amber-800 border border-amber-100' : 'bg-indigo-50 text-indigo-800 border border-indigo-100'
              }`}>
                <span>{card.isException ? '⚠️' : 'ℹ️'}</span>
                {card.grammarNote}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Buttons */}
      <div className="flex gap-3">
        <button onClick={next}
          className="flex-1 py-3 rounded-2xl border border-gray-200 text-gray-500 text-sm font-medium hover:bg-gray-50 transition-colors">
          Skip →
        </button>
        <button onClick={next}
          className="flex-1 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors">
          Got it ✓
        </button>
      </div>

      {index + 1 === verbs.length && (
        <p className="text-center text-xs text-gray-400">Last card — tap "Got it" to continue to Phase 2</p>
      )}
    </div>
  )
}

// ── Phase 2: Word bank ─────────────────────────────────────────────────────

function WordBankPhase({ exercises, onComplete }) {
  // answers[sentenceIdx] = { verb: chipKey | null, prep: chipKey | null }
  const [answers,  setAnswers]  = useState(() =>
    Object.fromEntries(exercises.map((_, i) => [i, { verb: null, prep: null }]))
  )
  const [selected,  setSelected]  = useState(null) // chipKey e.g. 'verb-3'
  const [submitted, setSubmitted] = useState(false)

  // Build chip lists — shuffle so they don't align with sentences
  const verbChips = exercises.map((ex, i) => ({ key: `verb-${i}`, label: ex.verbAnswer, type: 'verb' }))
    .sort(() => Math.random() - 0.5)
  const prepChips = exercises.map((ex, i) => ({ key: `prep-${i}`, label: ex.prepAnswer, type: 'prep' }))
    .sort(() => Math.random() - 0.5)

  // Memoize shuffled chips so they don't re-shuffle on re-render
  const [shuffledVerbs] = useState(verbChips)
  const [shuffledPreps] = useState(prepChips)

  function isUsed(chipKey) {
    return Object.values(answers).some((a) => a.verb === chipKey || a.prep === chipKey)
  }

  function chipLabel(chipKey) {
    if (!chipKey) return ''
    const [type, idx] = chipKey.split('-')
    return type === 'verb' ? exercises[+idx].verbAnswer : exercises[+idx].prepAnswer
  }

  function handleChipClick(chipKey) {
    if (submitted) return
    if (isUsed(chipKey)) return
    setSelected((prev) => prev === chipKey ? null : chipKey)
  }

  function handleBlankClick(sentenceIdx, field) {
    if (submitted) return
    const current = answers[sentenceIdx][field]

    // Clear filled blank
    if (current) {
      setAnswers((prev) => ({ ...prev, [sentenceIdx]: { ...prev[sentenceIdx], [field]: null } }))
      setSelected(null)
      return
    }

    if (!selected) return
    const [type] = selected.split('-')
    if (type !== field) return // verb chip → verb blank only

    setAnswers((prev) => ({ ...prev, [sentenceIdx]: { ...prev[sentenceIdx], [field]: selected } }))
    setSelected(null)
  }

  const allFilled = Object.values(answers).every((a) => a.verb && a.prep)

  const score = submitted
    ? exercises.filter((ex, i) => {
        const [, vi] = (answers[i].verb ?? '').split('-')
        const [, pi] = (answers[i].prep ?? '').split('-')
        return chipLabel(answers[i].verb) === ex.verbAnswer &&
               chipLabel(answers[i].prep) === ex.prepAnswer
      }).length
    : 0

  function renderSentence(ex, sentenceIdx) {
    const parts = ex.sentence.split('___')
    const vKey  = answers[sentenceIdx].verb
    const pKey  = answers[sentenceIdx].prep

    const vOk = submitted && chipLabel(vKey) === ex.verbAnswer
    const pOk = submitted && chipLabel(pKey) === ex.prepAnswer

    function blankCls(filled, ok, field) {
      const base = 'inline-flex items-center justify-center min-w-[60px] px-2 py-0.5 rounded-lg border-b-2 text-sm font-medium cursor-pointer transition-all mx-0.5'
      if (!filled) {
        const active = selected && selected.split('-')[0] === field
        return `${base} ${active ? 'border-indigo-500 bg-indigo-50 text-indigo-400' : 'border-gray-300 text-gray-300'} hover:border-indigo-400`
      }
      if (!submitted) return `${base} border-indigo-400 bg-indigo-50 text-indigo-700`
      return ok
        ? `${base} border-emerald-400 bg-emerald-50 text-emerald-700`
        : `${base} border-red-400 bg-red-50 text-red-500 line-through`
    }

    return (
      <div key={sentenceIdx} className={`bg-white rounded-2xl border px-5 py-4 transition-colors ${
        submitted ? (vOk && pOk ? 'border-emerald-200' : 'border-red-200') : 'border-gray-100'
      }`}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-indigo-400 font-bold text-sm">{sentenceIdx + 1}.</span>
          <span className="text-xs text-indigo-500 font-semibold bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full">
            {ex.verbBase}
          </span>
        </div>
        <p className="text-base text-gray-800 leading-loose flex flex-wrap items-center gap-0.5">
          <span>{parts[0]}</span>
          <span className={blankCls(!!vKey, vOk, 'verb')} onClick={() => handleBlankClick(sentenceIdx, 'verb')}>
            {vKey ? chipLabel(vKey) : <span className="text-xs text-gray-300 italic">verb</span>}
          </span>
          <span>{parts[1] ?? ''}</span>
          <span className={blankCls(!!pKey, pOk, 'prep')} onClick={() => handleBlankClick(sentenceIdx, 'prep')}>
            {pKey ? chipLabel(pKey) : <span className="text-xs text-gray-300 italic">prep.</span>}
          </span>
          <span>{parts[2] ?? ''}</span>
        </p>
        {submitted && !(vOk && pOk) && (
          <p className="text-xs text-red-600 mt-2">
            ✗ {ex.verbAnswer} … {ex.prepAnswer}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Word bank</h2>
        <p className="text-xs text-gray-400 mt-0.5">Select a chip, then tap a blank to place it. Tap a filled blank to clear it.</p>
      </div>

      {/* Bank */}
      <div className="bg-gray-50 rounded-2xl border border-gray-100 p-4 flex flex-col gap-3">
        <div>
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-2">Verbs</p>
          <div className="flex flex-wrap gap-2">
            {shuffledVerbs.map((chip) => {
              const used = isUsed(chip.key)
              const sel  = selected === chip.key
              return (
                <button key={chip.key} disabled={used} onClick={() => handleChipClick(chip.key)}
                  className={`text-sm px-3 py-1 rounded-full border font-medium transition-all ${
                    used ? 'opacity-0 pointer-events-none' :
                    sel  ? 'bg-indigo-600 text-white border-indigo-600 shadow-md scale-105' :
                           'bg-white text-indigo-700 border-indigo-200 hover:border-indigo-400 hover:bg-indigo-50'
                  }`}>
                  {chip.label}
                </button>
              )
            })}
          </div>
        </div>
        <div className="border-t border-gray-200" />
        <div>
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-2">Prepositions</p>
          <div className="flex flex-wrap gap-2">
            {shuffledPreps.map((chip) => {
              const used = isUsed(chip.key)
              const sel  = selected === chip.key
              return (
                <button key={chip.key} disabled={used} onClick={() => handleChipClick(chip.key)}
                  className={`text-sm px-3 py-1 rounded-full border font-medium transition-all ${
                    used ? 'opacity-0 pointer-events-none' :
                    sel  ? 'bg-violet-600 text-white border-violet-600 shadow-md scale-105' :
                           'bg-white text-violet-700 border-violet-200 hover:border-violet-400 hover:bg-violet-50'
                  }`}>
                  {chip.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Sentences */}
      <div className="flex flex-col gap-3">
        {exercises.map((ex, i) => renderSentence(ex, i))}
      </div>

      {/* Action */}
      {!submitted ? (
        <button onClick={() => setSubmitted(true)} disabled={!allFilled}
          className="w-full py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-200 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors">
          {allFilled ? 'Check answers' : 'Fill all blanks to continue'}
        </button>
      ) : (
        <div className="bg-white border border-gray-100 rounded-2xl px-6 py-4 flex items-center justify-between">
          <div>
            <span className="text-2xl font-bold text-gray-900">{score}/{exercises.length}</span>
            <span className="text-sm text-gray-500 ml-3">
              {score === exercises.length ? 'Perfect! 🎉' : score >= exercises.length / 2 ? 'Good work! Keep going.' : 'Review the answers above.'}
            </span>
          </div>
          <button onClick={() => onComplete(score, exercises.length)}
            className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors">
            Phase 3 →
          </button>
        </div>
      )}
    </div>
  )
}

// ── Phase 3: Prep exercise ─────────────────────────────────────────────────

function ExercisePhase({ exercises, onComplete }) {
  const [answers,   setAnswers]   = useState({})
  const [submitted, setSubmitted] = useState(false)

  function inputCls(submitted, correct) {
    const base = 'border-b-2 text-center font-medium focus:outline-none px-1 bg-transparent'
    if (!submitted) return `${base} border-indigo-300 focus:border-indigo-600 text-gray-900`
    return correct
      ? `${base} border-emerald-400 bg-emerald-50 text-emerald-700 rounded`
      : `${base} border-red-400 bg-red-50 text-red-600 rounded line-through`
  }

  const allAnswered = exercises.length > 0 &&
    exercises.every((_, i) => answers[i]?.prep?.trim() && answers[i]?.article?.trim())

  const score = submitted
    ? exercises.filter((ex, i) =>
        answers[i]?.prep?.trim().toLowerCase()    === ex.preposition.toLowerCase() &&
        answers[i]?.article?.trim().toLowerCase() === ex.article.toLowerCase()
      ).length
    : 0

  const allPreps = [...new Set(exercises.map((ex) => ex.preposition))]

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Fill in: preposition + article</h2>
        <p className="text-xs text-gray-400 mt-0.5">Now add the correct article in the right grammatical case.</p>
      </div>

      {/* Preposition hint (if all same) */}
      {allPreps.length <= 5 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-400">Prepositions used:</span>
          {allPreps.map((p) => (
            <span key={p} className="text-xs bg-indigo-50 border border-indigo-200 text-indigo-600 font-semibold px-2 py-0.5 rounded-full">{p}</span>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-4">
        {exercises.map((ex, i) => {
          const prepOk    = submitted && answers[i]?.prep?.trim().toLowerCase()    === ex.preposition.toLowerCase()
          const articleOk = submitted && answers[i]?.article?.trim().toLowerCase() === ex.article.toLowerCase()
          const bothOk    = prepOk && articleOk
          const parts     = ex.sentence.split('___')

          return (
            <div key={i} className={`bg-white rounded-2xl border px-5 py-4 transition-colors ${
              submitted ? (bothOk ? 'border-emerald-200' : 'border-red-200') : 'border-gray-100'
            }`}>
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span className="text-indigo-400 font-bold text-sm">{i + 1}.</span>
                <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full">
                  {ex.verb}
                </span>
                {ex.translation && submitted && (
                  <span className="text-xs text-gray-400 italic">— {ex.translation}</span>
                )}
              </div>

              <p className="text-base text-gray-800 flex flex-wrap items-end gap-1 leading-loose">
                <span>{parts[0]}</span>
                <input value={answers[i]?.prep ?? ''} disabled={submitted}
                  onChange={(e) => setAnswers((p) => ({ ...p, [i]: { ...p[i], prep: e.target.value } }))}
                  className={`${inputCls(submitted, prepOk)} w-14`} placeholder="prep." />
                <span>{parts[1] ?? ''}</span>
                <input value={answers[i]?.article ?? ''} disabled={submitted}
                  onChange={(e) => setAnswers((p) => ({ ...p, [i]: { ...p[i], article: e.target.value } }))}
                  className={`${inputCls(submitted, articleOk)} w-16`} placeholder="art." />
                <span>{parts[2] ?? ''}</span>
              </p>

              {submitted && (
                <div className={`mt-3 text-xs px-3 py-2 rounded-xl ${bothOk ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                  {bothOk
                    ? <>✓ Correct!{ex.translation && <span className="opacity-70"> — {ex.verb} = {ex.translation}</span>}</>
                    : <>✗ Correct: <strong>{ex.preposition} {ex.article}</strong>{ex.translation && <span> · {ex.verb} = {ex.translation}</span>} — {ex.explanation}</>
                  }
                </div>
              )}
            </div>
          )
        })}
      </div>

      {!submitted ? (
        <button onClick={() => setSubmitted(true)} disabled={!allAnswered}
          className="w-full py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-200 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors">
          {allAnswered ? 'Check answers' : 'Fill all blanks'}
        </button>
      ) : (
        <div className="bg-white border border-gray-100 rounded-2xl px-6 py-4 flex items-center justify-between">
          <div>
            <span className="text-2xl font-bold text-gray-900">{score}/{exercises.length}</span>
            <span className="text-sm text-gray-500 ml-3">
              {score === exercises.length ? 'Perfect! 🎉' : score >= exercises.length / 2 ? 'Good work!' : 'Keep practising.'}
            </span>
          </div>
          <button onClick={() => onComplete(score, exercises.length)}
            className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors">
            See results →
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function PrepSession() {
  const navigate  = useNavigate()
  const location  = useLocation()
  const { user }  = useAuth()
  const { lang }  = useLanguage()
  const { targetLang, speechLocale } = useTargetLang()
  const interfaceLanguage = lang === 'uk' ? 'Ukrainian' : 'English'

  const sessionMode = location.state?.mode ?? 'mixed'

  const [phase,        setPhase]        = useState('loading')
  const [errorMsg,     setErrorMsg]     = useState(null)
  const [verbs,        setVerbs]        = useState([])
  const [wbExercises,  setWbExercises]  = useState([])
  const [prepExercises, setPrepExercises] = useState([])
  const [scores,       setScores]       = useState({ wb: null, prep: null })

  useEffect(() => { if (user) loadSession() }, [user])

  async function loadSession() {
    setPhase('loading')
    setErrorMsg(null)
    try {
      // 1 — fetch prep verbs from word_senses
      const { data: senseRows } = await supabase
        .from('word_senses').select('id, word_id, word_form, translation, pos, learning_stage, grammar_note, is_exception, examples')
        .eq('user_id', user.id).eq('pos', 'verb').eq('target_language', targetLang)

      // Deduplicate: one sense per word (prefer first sense if multiple verb senses exist)
      const seenWordIds = new Set()
      const dedupedRows = (senseRows ?? []).filter((s) => {
        if (seenWordIds.has(s.word_id)) return false
        seenWordIds.add(s.word_id)
        return true
      })
      // Map to word-like shape expected by rest of function
      const wordRows = dedupedRows.map((s) => ({
        id: s.word_id,
        word: s.word_form,
        translation: s.translation,
        pos: s.pos,
        status: s.learning_stage,
        grammar_note: s.grammar_note,
        is_exception: s.is_exception,
        _senseExamples: s.examples,
      }))

      let pool = wordRows.filter((w) => hasPrep(w.word))

      // filter by mode (learning_stage mapped to old status names for compat)
      const byMode = {
        new:       pool.filter((v) => v.status === 'new'),
        learning:  pool.filter((v) => ['early', 'mid', 'late'].includes(v.status)),
        review:    pool.filter((v) => v.status === 'known' || v.status === 'mastered'),
        suggested: [
          ...pool.filter((v) => ['early', 'mid', 'late'].includes(v.status)),
          ...pool.filter((v) => v.status === 'new'),
          ...pool.filter((v) => v.status === 'known' || v.status === 'mastered'),
        ],
      }
      const filtered = byMode[sessionMode] ?? pool
      if (filtered.length >= 3) pool = filtered

      if (pool.length === 0) {
        setErrorMsg('No prep verbs found. Add some to your dictionary first.')
        setPhase('error'); return
      }

      const selected = pool.sort(() => Math.random() - 0.5).slice(0, SESSION_SIZE)

      // 2 — build examples from sense jsonb (falls back to null if empty)
      const enriched = selected.map((w) => ({
        word:        w.word,
        translation: w.translation ?? '',
        grammarNote: w.grammar_note,
        isException: w.is_exception,
        status:      w.status,
        example:     w._senseExamples?.[0]
          ? { target: w._senseExamples[0].target, translation: w._senseExamples[0].translation }
          : null,
      }))

      // 3 — generate Phase 2 + Phase 3 in parallel
      const [wbResult, prepResult] = await Promise.all([
        generateWordBankExercises(enriched, interfaceLanguage),
        generatePrepExercises(enriched.slice(0, 5), interfaceLanguage),
      ])

      // attach translations to prep exercises
      const tMap = {}
      enriched.forEach((v) => { tMap[v.word.toLowerCase()] = v.translation })
      const enrichedPrep = prepResult.map((ex) => ({
        ...ex, translation: tMap[ex.verb.toLowerCase()] ?? null,
      }))

      // Build verb → case map from word bank results
      const caseMap = {}
      wbResult.forEach((ex) => {
        if (ex.verbBase && ex.case) caseMap[ex.verbBase.toLowerCase()] = ex.case
      })

      // Attach case to each verb for flashcards
      const verbsWithCase = enriched.map((v) => ({
        ...v,
        caseLabel: caseMap[v.word.toLowerCase()] ?? null,
      }))

      setVerbs(verbsWithCase)
      setWbExercises(wbResult)
      setPrepExercises(enrichedPrep)
      setPhase('flashcards')
    } catch (e) {
      console.error(e)
      setErrorMsg('Failed to load session. Please try again.')
      setPhase('error')
    }
  }

  function handleWbComplete(score, total) {
    setScores((s) => ({ ...s, wb: { score, total } }))
    setPhase('exercise')
  }

  function handlePrepComplete(score, total) {
    setScores((s) => ({ ...s, prep: { score, total } }))
    setPhase('results')
  }

  // ── Nav ──
  const nav = (
    <nav className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
      <div className="text-xl font-bold text-indigo-600">verba</div>
      {!['loading', 'error', 'results'].includes(phase) && <PhaseBar phase={phase} />}
      <button onClick={() => navigate('/prepositions')}
        className="text-sm text-gray-400 hover:text-gray-700 transition-colors">
        ✕ End session
      </button>
    </nav>
  )

  // ── Loading ──
  if (phase === 'loading') return (
    <div className="min-h-screen bg-gray-50">
      {nav}
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="w-8 h-8 border-2 border-indigo-600/30 border-t-indigo-600 rounded-full animate-spin" />
        <p className="text-sm text-gray-500">Preparing your session…</p>
      </div>
    </div>
  )

  // ── Error ──
  if (phase === 'error') return (
    <div className="min-h-screen bg-gray-50">{nav}
      <div className="max-w-lg mx-auto px-6 py-12 text-center">
        <p className="text-red-500 text-sm mb-4">{errorMsg}</p>
        <button onClick={() => navigate('/prepositions')} className="text-sm text-indigo-600 underline">
          ← Back to exercises
        </button>
      </div>
    </div>
  )

  // ── Results ──
  if (phase === 'results') {
    const wb   = scores.wb   ?? { score: 0, total: 0 }
    const prep = scores.prep ?? { score: 0, total: 0 }
    const total  = wb.total + prep.total
    const correct = wb.score + prep.score
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50">{nav}
        <div className="max-w-lg mx-auto px-6 py-12 flex flex-col items-center gap-6">
          <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-10 w-full text-center">
            <div className="text-5xl mb-4">🎉</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-1">Session complete!</h2>
            <p className="text-gray-500 text-sm mb-8">{verbs.length} verbs · 3 phases</p>
            <div className="grid grid-cols-2 gap-4 mb-8">
              <div className="bg-indigo-50 rounded-2xl p-4 text-left">
                <p className="text-xs text-indigo-500 font-medium mb-1">Word bank</p>
                <p className="text-2xl font-bold text-indigo-700">{wb.score}/{wb.total}</p>
              </div>
              <div className="bg-violet-50 rounded-2xl p-4 text-left">
                <p className="text-xs text-violet-500 font-medium mb-1">Fill in blanks</p>
                <p className="text-2xl font-bold text-violet-700">{prep.score}/{prep.total}</p>
              </div>
            </div>
            <div className="text-sm text-gray-600 mb-8">
              {correct === total
                ? 'Perfect session! You know these verbs well. 💪'
                : correct >= total * 0.75
                  ? 'Great work — almost there. A few more sessions and these will stick.'
                  : 'Keep going. Repeat this session to build up memory.'}
            </div>
            <div className="flex flex-col gap-3">
              <button onClick={loadSession}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-2xl font-semibold text-sm transition-colors">
                Practice again
              </button>
              <button onClick={() => navigate('/prepositions')}
                className="w-full text-gray-500 hover:text-gray-900 py-2 text-sm transition-colors">
                ← Back to exercises
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {nav}
      <main className="max-w-2xl mx-auto px-6 py-8">
        {phase === 'flashcards' && (
          <FlashcardPhase verbs={verbs} onComplete={() => setPhase('wordbank')} />
        )}
        {phase === 'wordbank' && (
          <WordBankPhase exercises={wbExercises} onComplete={handleWbComplete} />
        )}
        {phase === 'exercise' && (
          <ExercisePhase exercises={prepExercises} onComplete={handlePrepComplete} />
        )}
      </main>
    </div>
  )
}
