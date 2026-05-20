import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { inSession, advanceSession, nextExerciseName } from '../lib/sessionFlow'

// Parts: { text } = plain text | { blank: 'answer', baseWord, explanation }
// wordBank = all words shown above the text (correct answers + optional distractors)

const EXERCISES = [
  {
    id: 1,
    title: 'A journey abroad',
    difficulty: 'medium',
    wordBank: ['Heimweh', 'Mut', 'Entscheidung', 'trotzdem', 'erreichen', 'obwohl', 'gescheitert'],
    parts: [
      { text: 'Es war eine schwierige ' },
      { blank: 'Entscheidung', baseWord: 'die Entscheidung', explanation: '"Eine Entscheidung treffen" is the fixed phrase for making a decision. Feminine noun, accusative here after "eine".' },
      { text: ', ins Ausland zu ziehen. Es brauchte viel ' },
      { blank: 'Mut', baseWord: 'der Mut', explanation: '"Viel Mut" — courage used without an article after "viel". Masculine noun with no plural. The collocations are: Mut haben, Mut brauchen, Mut zeigen.' },
      { text: ', aber sie hat es ' },
      { blank: 'trotzdem', baseWord: 'trotzdem', explanation: '"Trotzdem" (nevertheless/anyway) expresses contrast — she did it despite the difficulty. It triggers verb inversion: trotzdem hat sie es getan.' },
      { text: ' getan. Anfangs hatte sie starkes ' },
      { blank: 'Heimweh', baseWord: 'das Heimweh', explanation: '"Heimweh haben" — to be homesick. Neuter noun, no plural. Specifically about missing home, family, and familiar surroundings.' },
      { text: ', ' },
      { blank: 'obwohl', baseWord: 'obwohl', explanation: '"Obwohl" is a subordinating conjunction meaning "although/even though." It sends the verb to the end of its clause: obwohl sie viel Neues erlebte.' },
      { text: ' sie viel Neues erlebte. Mit der Zeit begann sie, ihr neues Leben zu ' },
      { blank: 'erreichen', baseWord: 'erreichen', explanation: '"Ihr Ziel/Leben erreichen" — to reach, to build, to get to. Here it means she started to embrace and build her new life. Used in the infinitive after "beginnen zu".' },
      { text: '.' },
    ],
  },
  {
    id: 2,
    title: 'An ambitious project',
    difficulty: 'hard',
    wordBank: ['scheitern', 'Sehnsucht', 'begeistert', 'Entscheidung', 'trotzdem', 'obwohl', 'wunderschön'],
    parts: [
      { text: 'Das Team war von Anfang an ' },
      { blank: 'begeistert', baseWord: 'begeistert', explanation: '"Begeistert sein von" — to be enthusiastic about. Predicative adjective after "war", so no ending is added. "Von Anfang an" means from the very beginning.' },
      { text: '. Die Idee war ' },
      { blank: 'wunderschön', baseWord: 'wunderschön', explanation: '"Wunderschön" (beautiful, wonderful) — predicative adjective after "war", no ending needed. Compound: Wunder (wonder) + schön (beautiful). Stronger than plain "schön".' },
      { text: ', und jeder wollte daran teilnehmen. Dann kam die erste ' },
      { blank: 'Entscheidung', baseWord: 'die Entscheidung', explanation: 'Feminine noun in the nominative — "die erste Entscheidung" (the first decision). Subject of the sentence.' },
      { text: ': mehr Zeit oder mehr Budget? ' },
      { blank: 'Trotzdem', baseWord: 'trotzdem', explanation: '"Trotzdem" starts the next main clause, expressing that work continued despite the difficult choice. Triggers verb inversion: Trotzdem arbeiteten alle weiter.' },
      { text: ' arbeiteten alle weiter. Am Ende ist das Projekt leider ' },
      { blank: 'gescheitert', baseWord: 'scheitern', explanation: '"Ist gescheitert" — scheitern uses "sein" as its auxiliary in the Perfekt (not haben). Partizip II is "gescheitert". The project collapsed entirely.' },
      { text: '. Im Team blieb eine tiefe ' },
      { blank: 'Sehnsucht', baseWord: 'die Sehnsucht', explanation: '"Eine tiefe Sehnsucht" — a deep longing. Here the team longs for what could have been. Sehnsucht is used for abstract, even existential yearning, not only for places.' },
      { text: ' nach dem, was hätte sein können.' },
    ],
  },
  {
    id: 3,
    title: 'Finding courage',
    difficulty: 'easy',
    wordBank: ['Mut', 'obwohl', 'Heimweh', 'wunderschön', 'erreicht', 'trotzdem', 'Entscheidung'],
    parts: [
      { text: 'Sie hat eine wichtige ' },
      { blank: 'Entscheidung', baseWord: 'die Entscheidung', explanation: '"Eine wichtige Entscheidung" — an important decision. Feminine accusative after "eine". The collocation "eine Entscheidung treffen" (to make a decision) is one of the most common in German.' },
      { text: ' getroffen: Sie wollte ihren Traum verwirklichen, ' },
      { blank: 'obwohl', baseWord: 'obwohl', explanation: '"Obwohl" (although) introduces a subordinate clause. The verb goes to the end: obwohl sie Angst hatte. Expresses that she pursued the dream despite the fear.' },
      { text: ' sie Angst hatte. Es brauchte viel ' },
      { blank: 'Mut', baseWord: 'der Mut', explanation: '"Viel Mut brauchen" — to need a lot of courage. "Mut" without an article after "viel" — masculine noun. No plural form.' },
      { text: '. Das Ziel war ' },
      { blank: 'wunderschön', baseWord: 'wunderschön', explanation: '"Das Ziel war wunderschön" — the goal was beautiful/wonderful. Predicative adjective after "war", no inflection ending.' },
      { text: ', und ' },
      { blank: 'trotzdem', baseWord: 'trotzdem', explanation: '"Trotzdem" (nevertheless) — she struggled but kept going. Connects the difficulty with the continuation. Verb inversion follows: trotzdem kämpfte sie weiter.' },
      { text: ' kämpfte sie weiter. Am Ende hat sie alles ' },
      { blank: 'erreicht', baseWord: 'erreichen', explanation: '"Hat erreicht" — Perfekt of erreichen with haben. Partizip II is "erreicht". She has achieved everything she set out to do.' },
      { text: ', was sie sich gewünscht hatte.' },
    ],
  },
]

const DIFFICULTY_STYLES = {
  easy:   'bg-green-50 text-green-700 border border-green-200',
  medium: 'bg-yellow-50 text-yellow-700 border border-yellow-200',
  hard:   'bg-red-50 text-red-600 border border-red-200',
}

function speak(text) {
  if (!window.speechSynthesis) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'de-DE'
  u.rate = 0.85
  window.speechSynthesis.speak(u)
}

function buildFullText(parts) {
  return parts.map((p) => p.text || p.blank || '').join('')
}

export default function FillBlank() {
  const navigate = useNavigate()
  const [exIndex, setExIndex]   = useState(0)
  const [filled, setFilled]     = useState({})   // blankIndex → word placed
  const [activeBlank, setActiveBlank] = useState(null) // which blank is focused
  const [checked, setChecked]   = useState(false)
  const [openExpl, setOpenExpl] = useState(null)
  const [score, setScore]       = useState(0)
  const [done, setDone]         = useState(false)

  const ex = EXERCISES[exIndex]
  const blanks = ex.parts.filter((p) => p.blank !== undefined)
  const usedWords = Object.values(filled)
  const availableWords = ex.wordBank.filter((w) => !usedWords.includes(w))

  const isCorrect = (i) => filled[i]?.trim().toLowerCase() === blanks[i].blank.toLowerCase()
  const allFilled = blanks.every((_, i) => filled[i])

  // Click a word from bank: place it into activeBlank or first empty blank
  const handleWordClick = (word) => {
    if (checked) return
    let targetBlank = activeBlank
    if (targetBlank === null || filled[targetBlank]) {
      // find first empty blank
      const firstEmpty = blanks.findIndex((_, i) => !filled[i])
      if (firstEmpty === -1) return
      targetBlank = firstEmpty
    }
    setFilled((f) => ({ ...f, [targetBlank]: word }))
    // advance focus to next empty blank
    const nextEmpty = blanks.findIndex((_, i) => i > targetBlank && !filled[i])
    setActiveBlank(nextEmpty === -1 ? null : nextEmpty)
  }

  // Click a filled blank: return word to bank
  const handleBlankClick = (i) => {
    if (checked) return
    if (filled[i]) {
      setFilled((f) => { const next = { ...f }; delete next[i]; return next })
      setActiveBlank(i)
    } else {
      setActiveBlank(i)
    }
  }

  const handleCheck = () => {
    setChecked(true)
    setActiveBlank(null)
    const correct = blanks.filter((_, i) => isCorrect(i)).length
    setScore((s) => s + correct)
  }

  const handleNext = () => {
    if (exIndex + 1 >= EXERCISES.length) { setDone(true); return }
    setExIndex((i) => i + 1)
    setFilled({})
    setActiveBlank(null)
    setChecked(false)
    setOpenExpl(null)
  }

  const totalBlanks = EXERCISES.reduce((s, e) => s + e.parts.filter((p) => p.blank !== undefined).length, 0)

  if (done) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex flex-col">
        <nav className="bg-white/80 backdrop-blur border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <div className="text-xl font-bold text-indigo-600">wordy</div>
          <button onClick={() => navigate('/dashboard')} className="text-sm text-gray-500 hover:text-gray-900">← Dashboard</button>
        </nav>
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-10 w-full max-w-md text-center">
            <div className="text-5xl mb-4">✏️</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-1">Session complete!</h2>
            <p className="text-gray-500 text-sm mb-6">{EXERCISES.length} texts · {totalBlanks} blanks</p>
            <div className="bg-indigo-50 rounded-2xl p-6 mb-6">
              <div className="text-4xl font-bold text-indigo-600">{score} / {totalBlanks}</div>
              <div className="text-sm text-indigo-700 mt-1">blanks correct</div>
            </div>
            <div className="flex flex-col gap-3">
              {inSession() ? (
                <button onClick={() => advanceSession(navigate)} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-2xl font-semibold text-sm">
                  {nextExerciseName() ? `Next: ${nextExerciseName()} →` : 'Finish session →'}
                </button>
              ) : (
                <button
                  onClick={() => { setExIndex(0); setFilled({}); setChecked(false); setDone(false); setScore(0) }}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-2xl font-semibold text-sm"
                >
                  Try again
                </button>
              )}
              <button onClick={() => navigate('/dashboard')} className="w-full text-gray-500 hover:text-gray-900 py-2 text-sm">
                Back to dashboard
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  let blankIndex = -1

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex flex-col">
      <nav className="bg-white/80 backdrop-blur border-b border-gray-100 px-6 py-4 flex items-center justify-between">
        <div className="text-xl font-bold text-indigo-600">wordy</div>
        <div className="text-sm text-gray-500">{exIndex + 1} / {EXERCISES.length}</div>
        <button onClick={() => navigate('/dashboard')} className="text-sm text-gray-400 hover:text-gray-700">✕ End</button>
      </nav>

      <div className="h-1 bg-gray-100">
        <div className="h-full bg-indigo-500 transition-all duration-500"
          style={{ width: `${(exIndex / EXERCISES.length) * 100}%` }} />
      </div>

      <div className="flex-1 flex flex-col items-center justify-start px-4 py-8">
        <div className="w-full max-w-2xl">

          {/* Header */}
          <div className="flex items-center gap-3 mb-5">
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${DIFFICULTY_STYLES[ex.difficulty]}`}>
              {ex.difficulty.charAt(0).toUpperCase() + ex.difficulty.slice(1)}
            </span>
            <span className="text-sm font-medium text-gray-600">{ex.title}</span>
            <button onClick={() => speak(buildFullText(ex.parts))}
              className="ml-auto text-gray-300 hover:text-indigo-500 transition-colors" title="Listen">
              🔈
            </button>
          </div>

          {/* Word bank */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4 mb-5">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-3">Word bank — click a word to place it</p>
            <div className="flex flex-wrap gap-2 min-h-8">
              {availableWords.map((word) => (
                <button
                  key={word}
                  onClick={() => handleWordClick(word)}
                  disabled={checked}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition-all hover:scale-105 shadow-sm shadow-indigo-200"
                >
                  {word}
                </button>
              ))}
              {availableWords.length === 0 && !checked && (
                <span className="text-xs text-gray-400 italic">All words placed — check your answers or click a blank to swap</span>
              )}
              {checked && (
                <span className="text-xs text-gray-400 italic">Check the explanations below</span>
              )}
            </div>
          </div>

          {/* Text card */}
          <div className="bg-white rounded-3xl shadow-lg border border-gray-100 p-8 mb-5">
            <p className="text-base leading-9 text-gray-800">
              {ex.parts.map((part, i) => {
                if (part.text !== undefined) return <span key={i}>{part.text}</span>

                blankIndex++
                const bi = blankIndex
                const word = filled[bi]
                const isActive = activeBlank === bi
                const correct = checked && isCorrect(bi)
                const wrong   = checked && !isCorrect(bi)

                return (
                  <span key={i} className="inline-flex flex-col items-center align-bottom mx-1">
                    <button
                      onClick={() => handleBlankClick(bi)}
                      disabled={checked}
                      className={`
                        min-w-28 px-3 py-0.5 rounded-lg border-2 text-sm font-semibold transition-all text-center
                        ${correct  ? 'border-green-400 bg-green-50 text-green-700' :
                          wrong    ? 'border-red-400 bg-red-50 text-red-600' :
                          isActive ? 'border-indigo-500 bg-indigo-50 text-indigo-700 shadow-sm' :
                          word     ? 'border-indigo-300 bg-indigo-50 text-indigo-700 hover:border-indigo-400' :
                                     'border-dashed border-gray-300 text-gray-300 hover:border-indigo-300'}
                      `}
                    >
                      {word || (isActive ? '▸' : '___')}
                    </button>
                    {wrong && (
                      <span className="text-xs text-green-600 font-medium mt-0.5">{blanks[bi].blank}</span>
                    )}
                  </span>
                )
              })}
            </p>
          </div>

          {/* Hint */}
          {!checked && (
            <p className="text-xs text-gray-400 text-center mb-5">
              Click a blank to select it · Click a filled blank to return a word to the bank
            </p>
          )}

          {/* Explanations */}
          {checked && (
            <div className="flex flex-col gap-2 mb-6">
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Why each answer</p>
              {blanks.map((b, i) => (
                <div key={i} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                  <button
                    onClick={() => setOpenExpl(openExpl === i ? null : i)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left"
                  >
                    <div className="flex items-center gap-3">
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0
                        ${isCorrect(i) ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-500'}`}>
                        {isCorrect(i) ? '✓' : '✗'}
                      </span>
                      <span className="text-sm font-semibold text-gray-800">{b.blank}</span>
                      <span className="text-xs text-gray-400">({b.baseWord})</span>
                    </div>
                    <span className="text-gray-400 text-xs">{openExpl === i ? '▴' : '▾'}</span>
                  </button>
                  {openExpl === i && (
                    <div className="px-4 pb-4 text-sm text-gray-600 leading-relaxed border-t border-gray-50 pt-3">
                      {b.explanation}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end">
            {!checked ? (
              <button
                onClick={handleCheck}
                disabled={!allFilled}
                className={`px-8 py-3 rounded-2xl font-semibold text-sm transition-all ${
                  allFilled ? 'bg-indigo-600 hover:bg-indigo-700 text-white' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                }`}
              >
                Check answers
              </button>
            ) : (
              <button
                onClick={handleNext}
                className="px-8 py-3 rounded-2xl font-semibold text-sm bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
              >
                {exIndex + 1 >= EXERCISES.length ? 'See results →' : 'Next →'}
              </button>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
