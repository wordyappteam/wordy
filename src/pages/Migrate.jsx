import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useTargetLang } from '../lib/TargetLangContext'
import { identifyWord } from '../lib/claude'

export default function Migrate() {
  const navigate   = useNavigate()
  const { user }   = useAuth()
  const { targetLang, targetLanguageName } = useTargetLang()

  const [phase, setPhase]       = useState('idle') // idle | running | done
  const [words, setWords]       = useState([])
  const [current, setCurrent]   = useState(null)
  const [index, setIndex]       = useState(0)
  const [succeeded, setSucceeded] = useState([])
  const [failed, setFailed]     = useState([])

  async function loadWords() {
    const { data } = await supabase
      .from('words')
      .select('id, word, target_language')
      .eq('user_id', user.id)
      .in('target_language', ['de', 'en'])
      .order('target_language', { ascending: true })
      .order('created_at', { ascending: true })
    setWords(data || [])
  }

  const LANG_NAME = { de: 'German', en: 'English' }

  async function handleStart() {
    await loadWords()
    setPhase('running')
    setSucceeded([])
    setFailed([])
    setIndex(0)

    const { data: allWords } = await supabase
      .from('words')
      .select('id, word, target_language')
      .eq('user_id', user.id)
      .in('target_language', ['de', 'en'])
      .order('target_language', { ascending: true })
      .order('created_at', { ascending: true })

    if (!allWords?.length) { setPhase('done'); return }
    setWords(allWords)

    const ok = []
    const fail = []

    for (let i = 0; i < allWords.length; i++) {
      const w = allWords[i]
      setCurrent(w.word)
      setIndex(i)
      try {
        const langName = LANG_NAME[w.target_language] ?? w.target_language
        const result = await identifyWord(w.word, langName, 'English')
        if (!result.senses?.length) throw new Error('no senses returned')

        // Delete existing senses for this word (idempotent re-run)
        await supabase.from('word_senses').delete().eq('word_id', w.id)

        // Insert new senses
        await supabase.from('word_senses').insert(
          result.senses.map(s => ({
            word_id: w.id,
            user_id: user.id,
            target_language: w.target_language,
            pos: s.pos,
            word_form: s.wordForm || result.word,
            aspect: s.aspect ?? null,
            gender: s.gender ?? null,
            translation: s.translation,
            form: s.form || null,
            grammar_note: s.grammarNote || null,
            explanation: s.explanation || null,
            is_exception: s.isException || false,
            register: s.register || 'neutral',
            cefr: s.cefr || null,
            conjugation: s.conjugation || null,
            examples: s.examples || [],
            learning_stage: 'new',
            correct_recall_count: 0,
          }))
        )

        // Keep legacy cols in sync
        const primary = result.senses[0]
        await supabase.from('words').update({
          translation: primary.translation,
          pos: primary.pos,
          form: primary.form || null,
          grammar_note: primary.grammarNote || null,
          explanation: primary.explanation || null,
          is_exception: primary.isException || false,
          conjugation: primary.conjugation || null,
        }).eq('id', w.id)

        ok.push(w.word)
      } catch (e) {
        console.error('Migration failed for', w.word, e)
        fail.push(w.word)
      }
      setSucceeded([...ok])
      setFailed([...fail])
    }

    setCurrent(null)
    setPhase('done')
  }

  const total = words.length
  const pct   = total > 0 ? Math.round(((succeeded.length + failed.length) / total) * 100) : 0

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6">
      <div className="bg-white rounded-3xl shadow-xl w-full max-w-lg p-8">
        <button onClick={() => navigate('/dictionary')} className="text-sm text-gray-400 hover:text-gray-700 mb-6 block">← Back to Dictionary</button>

        <h1 className="text-2xl font-bold text-gray-900 mb-1">Senses Migration</h1>
        <p className="text-sm text-gray-500 mb-6">
          Re-identifies your <strong>German and English</strong> words with Claude (German first) and creates a sense row for each distinct meaning.
          Existing senses are replaced. Learning progress resets to <em>new</em> for these words.
        </p>

        {phase === 'idle' && (
          <>
            <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-sm text-amber-800 mb-6">
              Calls the Claude API once per word (~5–12s each), German words first then English. Keep this tab open until it finishes.
            </div>
            <button
              onClick={handleStart}
              className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm transition-colors"
            >
              Start migration
            </button>
          </>
        )}

        {phase === 'running' && (
          <div className="flex flex-col gap-4">
            <div className="w-full bg-gray-100 rounded-full h-2">
              <div
                className="h-2 bg-indigo-500 rounded-full transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-sm text-gray-500">
              <span>{succeeded.length + failed.length} / {total}</span>
              <span>{pct}%</span>
            </div>
            {current && (
              <div className="bg-indigo-50 rounded-xl px-4 py-3 text-center">
                <p className="text-xs text-indigo-400 mb-1">Identifying</p>
                <p className="text-lg font-semibold text-indigo-700">{current}</p>
              </div>
            )}
            {failed.length > 0 && (
              <p className="text-xs text-red-500">Failed so far: {failed.join(', ')}</p>
            )}
            <p className="text-xs text-gray-400 text-center">Please don't close this tab.</p>
          </div>
        )}

        {phase === 'done' && (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="text-4xl">{failed.length === 0 ? '✨' : '⚠️'}</div>
            <p className="text-xl font-bold text-gray-900">
              {succeeded.length} of {total} migrated
            </p>
            {failed.length > 0 && (
              <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 w-full text-left">
                <p className="text-xs text-red-600 font-semibold mb-1">Failed ({failed.length}):</p>
                <p className="text-xs text-red-500">{failed.join(', ')}</p>
                <p className="text-xs text-red-400 mt-1">You can re-run to retry failed words.</p>
              </div>
            )}
            <div className="flex gap-2 w-full">
              {failed.length > 0 && (
                <button
                  onClick={() => { setPhase('idle'); setWords([]); setSucceeded([]); setFailed([]) }}
                  className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50"
                >
                  Re-run
                </button>
              )}
              <button
                onClick={() => navigate('/dictionary')}
                className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold"
              >
                Go to Dictionary
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
