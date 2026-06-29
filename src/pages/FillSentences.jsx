import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useTargetLang } from '../lib/TargetLangContext'
import { useLanguage } from '../lib/i18n'
import { displayTranslation } from '../lib/senseDisplay'
import { gradeFillIn } from '../lib/srs'
import { generateSentenceSet } from '../lib/claude'

const BLANKABLE = new Set(['mid', 'late', 'known', 'mastered'])

export default function FillSentences() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { targetLang, targetLanguageName } = useTargetLang()
  const { lang } = useLanguage()
  const uk = lang === 'uk'
  const ifaceLang = uk ? 'Ukrainian' : 'English'

  const [phase, setPhase] = useState('loading') // loading | locked | ready | generating | playing | error
  const [pool, setPool] = useState([])
  const [set, setSet] = useState(null)          // { bank, sentences }
  const [answers, setAnswers] = useState({})     // idx -> typed string
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    if (!user) return
    setPhase('loading')
    supabase.from('word_senses').select('id, word_form, translation, pos, learning_stage')
      .eq('user_id', user.id).eq('target_language', targetLang)
      .then(({ data, error }) => {
        if (error) { setPhase('error'); return }
        const blankable = (data ?? []).filter(s => BLANKABLE.has(s.learning_stage) && s.word_form && s.translation)
        setPool(blankable)
        setPhase(blankable.length >= 10 ? 'ready' : 'locked')
      })
  }, [user, targetLang])

  const generate = useCallback(async () => {
    setPhase('generating'); setChecked(false); setAnswers({})
    try {
      const pick = [...pool].sort(() => Math.random() - 0.5).slice(0, 7)
      const words = pick.map(s => ({ senseId: s.id, lemma: s.word_form, translation: displayTranslation(s.translation), pos: s.pos, stage: s.learning_stage }))
      const result = await generateSentenceSet(words, { targetLanguage: targetLanguageName, interfaceLanguage: ifaceLang })
      setSet(result); setPhase('playing')
    } catch (e) {
      setPhase(pool.length >= 10 ? 'ready' : 'locked')
      alert(uk ? 'Не вдалося згенерувати. Спробуйте ще раз.' : 'Could not generate a set. Try again.')
    }
  }, [pool, targetLanguageName, ifaceLang, uk])

  const wrap = (inner) => (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex flex-col items-center justify-center px-4 py-10">{inner}</div>
  )

  if (phase === 'loading' || phase === 'generating')
    return wrap(<p className="text-gray-400 text-sm">{phase === 'generating' ? (uk ? 'Готуємо речення…' : 'Building your sentences…') : '…'}</p>)
  if (phase === 'error')
    return wrap(<button onClick={() => navigate('/exercises')} className="text-sm text-indigo-600">{uk ? 'Назад' : 'Back'}</button>)
  if (phase === 'locked')
    return wrap(
      <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8 max-w-md text-center">
        <div className="text-4xl mb-3">🔒</div>
        <h2 className="text-lg font-bold text-gray-900 mb-2">{uk ? 'Відкриється згодом' : 'Unlocks as your words mature'}</h2>
        <p className="text-sm text-gray-500 mb-6">{uk ? `Потрібно щонайменше 10 слів рівня «mid» або вище. Зараз: ${pool.length}.` : `Needs at least 10 words at mid stage or above. You have ${pool.length}.`}</p>
        <button onClick={() => navigate('/exercises')} className="text-sm font-semibold text-indigo-600">{uk ? 'Назад до вправ' : 'Back to exercises'}</button>
      </div>
    )
  if (phase === 'ready')
    return wrap(
      <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8 max-w-md text-center">
        <div className="text-4xl mb-3">📝</div>
        <h2 className="text-lg font-bold text-gray-900 mb-2">{uk ? 'Заповніть речення' : 'Fill the sentences'}</h2>
        <p className="text-sm text-gray-500 mb-6">{uk ? 'Доберіть слово до кожного речення та введіть правильну форму.' : 'Match a word to each sentence, then type the correct form.'}</p>
        <button onClick={generate} className="w-full py-3 rounded-2xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700">{uk ? 'Почати →' : 'Start →'}</button>
      </div>
    )

  // playing
  const outcomeFor = (s, i) => gradeFillIn(answers[i] || '', { answer: s.answerForm, lemma: s.answerLemma })
  return wrap(
    <div className="w-full max-w-2xl">
      {/* Word bank */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-4 flex flex-wrap gap-2 justify-center">
        {(set.bank || []).map((b, i) => (
          <span key={i} className="px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-sm font-medium">{b.lemma}</span>
        ))}
      </div>
      {/* Sentences */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        {set.sentences.map((s, i) => {
          const oc = checked ? outcomeFor(s, i) : null
          const parts = s.text.split('___')
          return (
            <div key={i}>
              <p className="text-base text-gray-800 leading-relaxed flex flex-wrap items-center gap-1">
                <span>{parts[0]}</span>
                <input
                  value={answers[i] || ''} disabled={checked}
                  onChange={(e) => setAnswers(a => ({ ...a, [i]: e.target.value }))}
                  className={`inline-block min-w-[6rem] border-b-2 px-1 text-center focus:outline-none ${
                    !checked ? 'border-indigo-300'
                    : oc === 'correct' ? 'border-green-400 text-green-700'
                    : oc === 'almost' ? 'border-amber-400 text-amber-700'
                    : 'border-rose-300 text-rose-500'}`}
                  placeholder="…"
                />
                <span>{parts[1] || ''}</span>
              </p>
              {checked && oc !== 'correct' && (
                <p className="text-xs text-gray-500 mt-1">
                  {oc === 'almost' ? (uk ? '≈ Майже — правильне слово, перевірте форму: ' : '≈ Almost — right word, check the form: ') : '→ '}
                  <strong>{s.answerForm}</strong>{s.explanation ? ` · ${s.explanation}` : ''}
                </p>
              )}
            </div>
          )
        })}
      </div>
      {/* Controls */}
      <div className="flex gap-2 mt-4">
        {!checked
          ? <button onClick={() => setChecked(true)} className="flex-1 py-3 rounded-2xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700">{uk ? 'Перевірити' : 'Check'}</button>
          : <button onClick={generate} className="flex-1 py-3 rounded-2xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700">{uk ? 'Новий набір →' : 'New set →'}</button>}
        <button onClick={() => navigate('/exercises')} className="py-3 px-4 rounded-2xl border border-gray-200 text-gray-500 text-sm">{uk ? 'Вийти' : 'Exit'}</button>
      </div>
    </div>
  )
}
