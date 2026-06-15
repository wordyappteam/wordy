import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { displayTranslation } from '../lib/senseDisplay'

// Each option carries the form used in the sentence + its translation shown after answering
const QUESTIONS = [
  {
    id: 1,
    before: 'Sie hat eine schwierige ',
    after:  ' getroffen und bereut sie nicht.',
    correct: 'Entscheidung',
    options: [
      { word: 'Entscheidung', translation: 'decision (die Entscheidung)' },
      { word: 'Sehnsucht',    translation: 'longing (die Sehnsucht)' },
      { word: 'Heimweh',      translation: 'homesickness (das Heimweh)' },
      { word: 'Mut',          translation: 'courage (der Mut)' },
    ],
    contextHint: 'treffen — to make (a decision)',
    explanation: {
      'Entscheidung': '"eine Entscheidung treffen" is the fixed phrase for making a decision. Feminine noun, accusative after "eine schwierige".',
      'Sehnsucht':    'Sehnsucht is a longing or yearning — an emotion, not something you "make." "Sehnsucht treffen" is not a natural German combination.',
      'Heimweh':      'Heimweh means homesickness. You "have" or "get" Heimweh (haben / bekommen), not "make" it. Doesn\'t fit here.',
      'Mut':          'Mut means courage. The collocations are: Mut haben, Mut zeigen — but "Mut treffen" is not used in German.',
    },
  },
  {
    id: 2,
    before: 'Es brauchte so viel ',
    after:  ', um das erste Wort zu sagen.',
    correct: 'Mut',
    options: [
      { word: 'Mut',          translation: 'courage (der Mut)' },
      { word: 'Entscheidung', translation: 'decision (die Entscheidung)' },
      { word: 'Sehnsucht',    translation: 'longing (die Sehnsucht)' },
      { word: 'Heimweh',      translation: 'homesickness (das Heimweh)' },
    ],
    contextHint: 'brauchen — to need · so viel + uncountable noun',
    explanation: {
      'Mut':          '"So viel Mut" (so much courage) — Mut is uncountable and used without an article after "viel". The sentence is about bravery needed to speak.',
      'Entscheidung': '"So viel Entscheidung" doesn\'t work — Entscheidung is a countable noun. You can\'t say "so much decision" in German.',
      'Sehnsucht':    'Sehnsucht is an emotion of longing, not something you need in order to speak a word. Doesn\'t fit the context.',
      'Heimweh':      'Heimweh is homesickness — something you experience passively, not something required to do an action.',
    },
  },
  {
    id: 3,
    before: 'Das Team hat alles versucht, aber das Projekt ist dennoch ',
    after:  '.',
    correct: 'gescheitert',
    options: [
      { word: 'gescheitert', translation: 'failed — past form of scheitern (to fail)' },
      { word: 'erreicht',    translation: 'achieved — past form of erreichen (to achieve)' },
      { word: 'trotzdem',    translation: 'nevertheless (adverb)' },
      { word: 'obwohl',      translation: 'although (conjunction)' },
    ],
    contextHint: 'ist ___ — Perfekt tense · scheitern uses sein, not haben',
    explanation: {
      'gescheitert': '"ist gescheitert" — scheitern uses sein in the Perfekt. Partizip II: gescheitert. The project fell through entirely despite all efforts.',
      'erreicht':    '"ist erreicht" would mean the project was successfully completed — the opposite of the intended meaning.',
      'trotzdem':    'Trotzdem is an adverb. It cannot fill a verb position — "ist trotzdem" makes no sense grammatically.',
      'obwohl':      'Obwohl is a conjunction that introduces a clause. It cannot be the past participle in a Perfekt construction.',
    },
  },
  {
    id: 4,
    before: 'Nach einem Jahr im Ausland hatte sie starkes ',
    after:  ' nach ihrer Familie.',
    correct: 'Heimweh',
    options: [
      { word: 'Heimweh',      translation: 'homesickness (das Heimweh)' },
      { word: 'Sehnsucht',    translation: 'longing (die Sehnsucht)' },
      { word: 'Mut',          translation: 'courage (der Mut)' },
      { word: 'Entscheidung', translation: 'decision (die Entscheidung)' },
    ],
    contextHint: 'nach — for (someone/something missed) · starkes — strong (neuter accusative)',
    explanation: {
      'Heimweh':      '"Starkes Heimweh haben nach" is the exact phrase for homesickness. Neuter noun, accusative: starkes Heimweh. It specifically means missing home and family while abroad.',
      'Sehnsucht':    'Close — "Sehnsucht nach" also works grammatically and means yearning for something. But "starkes Heimweh" is the more specific, natural phrase when missing home after living abroad.',
      'Mut':          '"Mut nach jemandem" is not a natural German expression. Mut is about facing challenges, not about missing people.',
      'Entscheidung': 'A decision is not something you feel "for" a person. "Entscheidung nach ihrer Familie" has no meaning in this context.',
    },
  },
  {
    id: 5,
    before: 'In seinem Blick lag eine tiefe ',
    after:  ' — als würde er etwas Verlorenes suchen.',
    correct: 'Sehnsucht',
    options: [
      { word: 'Sehnsucht',    translation: 'longing, yearning (die Sehnsucht)' },
      { word: 'Heimweh',      translation: 'homesickness (das Heimweh)' },
      { word: 'Entscheidung', translation: 'decision (die Entscheidung)' },
      { word: 'Mut',          translation: 'courage (der Mut)' },
    ],
    contextHint: 'als würde — as if he were · eine tiefe ___ — feminine accusative',
    explanation: {
      'Sehnsucht':    '"Eine tiefe Sehnsucht" — Sehnsucht is feminine, fits "eine tiefe ___". It describes a deep, abstract yearning for something lost or unattainable. The image of searching fits perfectly.',
      'Heimweh':      'Heimweh is specifically about missing home. The sentence points to something more abstract and existential — searching for something lost — which is Sehnsucht, not Heimweh.',
      'Entscheidung': 'A decision is an action, not an emotion you can see in someone\'s eyes. Doesn\'t fit.',
      'Mut':          '"Eine tiefe Mut" is also grammatically wrong — Mut is masculine (ein tiefer Mut, not eine tiefe). Courage is not an emotion visible as yearning in someone\'s gaze.',
    },
  },
  {
    id: 6,
    before: '',
    after:  ' er erschöpft war, wollte er das Gespräch nicht beenden.',
    correct: 'Obwohl',
    options: [
      { word: 'Obwohl',   translation: 'although, even though (conjunction)' },
      { word: 'Trotzdem', translation: 'nevertheless, still (adverb)' },
      { word: 'Weil',     translation: 'because (conjunction)' },
      { word: 'Dennoch',  translation: 'nonetheless, yet (adverb)' },
    ],
    contextHint: 'The verb "war" is at the end of its clause — a clue to the word type needed',
    explanation: {
      'Obwohl':   '"Obwohl er erschöpft war" — obwohl is a subordinating conjunction that sends the verb to the end of its clause. "War" at the end confirms this. Meaning: although he was exhausted.',
      'Trotzdem': 'Trotzdem connects two main clauses — the verb would not go to the end. It would need: "Er war erschöpft, trotzdem wollte er…" The verb-final structure rules it out here.',
      'Weil':     '"Weil er erschöpft war" would mean because he was exhausted — the opposite of the intended contrast. Wrong meaning.',
      'Dennoch':  'Dennoch (nonetheless) is an adverb like trotzdem — it connects main clauses and causes verb inversion, not subordinate clauses with verb-final order.',
    },
  },
  {
    id: 7,
    before: 'Sie wollte ihr Ziel um jeden Preis ',
    after:  '.',
    correct: 'erreichen',
    options: [
      { word: 'erreichen',   translation: 'to reach, to achieve (infinitive)' },
      { word: 'scheitern',   translation: 'to fail (infinitive)' },
      { word: 'gescheitert', translation: 'failed (past participle of scheitern)' },
      { word: 'trotzdem',    translation: 'nevertheless (adverb)' },
    ],
    contextHint: 'wollte — wanted to · modal verbs require the infinitive',
    explanation: {
      'erreichen':   '"Wollte … erreichen" — after a modal verb (wollen), the infinitive is required. Erreichen (to achieve) fits perfectly: she wanted to reach her goal at any cost.',
      'scheitern':   'Scheitern means to fail — the exact opposite of what the sentence intends. She wanted to succeed.',
      'gescheitert': 'The Partizip II cannot follow a modal verb. "Wollte gescheitert" is grammatically incorrect — you need the infinitive here.',
      'trotzdem':    'Trotzdem is an adverb, not a verb. It cannot fill the verb position required after a modal verb.',
    },
  },
  {
    id: 8,
    before: 'Es war schwierig, ',
    after:  ' machte sie weiter.',
    correct: 'trotzdem',
    options: [
      { word: 'trotzdem',    translation: 'nevertheless, anyway (adverb)' },
      { word: 'obwohl',      translation: 'although (conjunction)' },
      { word: 'Sehnsucht',   translation: 'longing (die Sehnsucht)' },
      { word: 'gescheitert', translation: 'failed (past participle of scheitern)' },
    ],
    contextHint: 'Two main clauses · "machte" immediately follows the blank — verb inversion',
    explanation: {
      'trotzdem':    '"Trotzdem machte sie weiter" — trotzdem connects two main clauses and triggers verb inversion (machte follows immediately). Meaning: nevertheless she kept going. Perfect fit.',
      'obwohl':      'Obwohl creates a subordinate clause with verb-final order: "obwohl es schwierig war" — the verb would go to the end, not stay as "machte" right after the conjunction.',
      'Sehnsucht':   'A noun cannot connect two clauses. Sehnsucht is an emotion, not a connective word.',
      'gescheitert': 'A past participle cannot connect two clauses or act as a sentence connector. It belongs in a verb phrase (ist gescheitert), not between two main clauses.',
    },
  },
]

function speak(text) {
  if (!window.speechSynthesis) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'de-DE'
  u.rate = 0.85
  window.speechSynthesis.speak(u)
}

export default function WordChoice() {
  const navigate = useNavigate()
  const [index, setIndex]       = useState(0)
  const [selected, setSelected] = useState(null)
  const [revealed, setRevealed] = useState(false)
  const [score, setScore]       = useState(0)
  const [done, setDone]         = useState(false)

  const q = QUESTIONS[index]

  const handleSelect = (word) => {
    if (revealed) return
    setSelected(word)
    setRevealed(true)
    if (word === q.correct) setScore((s) => s + 1)
  }

  const handleNext = () => {
    if (index + 1 >= QUESTIONS.length) setDone(true)
    else { setIndex((i) => i + 1); setSelected(null); setRevealed(false) }
  }

  if (done) {
    const pct = Math.round((score / QUESTIONS.length) * 100)
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex flex-col">
        <nav className="bg-white/80 backdrop-blur border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <div className="text-xl font-bold text-indigo-600">wordy</div>
          <button onClick={() => navigate('/dashboard')} className="text-sm text-gray-500 hover:text-gray-900">← Dashboard</button>
        </nav>
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-10 w-full max-w-md text-center">
            <div className="text-5xl mb-4">🎯</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-1">Session complete!</h2>
            <p className="text-gray-500 text-sm mb-6">{QUESTIONS.length} questions</p>
            <div className="bg-indigo-50 rounded-2xl p-6 mb-4">
              <div className="text-4xl font-bold text-indigo-600">{score} / {QUESTIONS.length}</div>
              <div className="text-sm text-indigo-700 mt-1">{pct}% correct</div>
            </div>
            {pct === 100 && <p className="text-sm text-green-600 font-medium mb-6">Perfect — you know this pack! 🌟</p>}
            {pct >= 60 && pct < 100 && <p className="text-sm text-yellow-600 mb-6">Good work — a few more sessions and these will stick.</p>}
            {pct < 60 && <p className="text-sm text-red-500 mb-6">Keep going — repetition is how these become yours.</p>}
            <div className="flex flex-col gap-3">
              <button onClick={() => { setIndex(0); setSelected(null); setRevealed(false); setScore(0); setDone(false) }}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-2xl font-semibold text-sm">
                Try again
              </button>
              <button onClick={() => navigate('/dashboard')} className="w-full text-gray-500 hover:text-gray-900 py-2 text-sm">
                Back to dashboard
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex flex-col">
      <nav className="bg-white/80 backdrop-blur border-b border-gray-100 px-6 py-4 flex items-center justify-between">
        <div className="text-xl font-bold text-indigo-600">wordy</div>
        <div className="text-sm text-gray-500">{index + 1} / {QUESTIONS.length}</div>
        <button onClick={() => navigate('/dashboard')} className="text-sm text-gray-400 hover:text-gray-700">✕ End</button>
      </nav>

      <div className="h-1 bg-gray-100">
        <div className="h-full bg-indigo-500 transition-all duration-500"
          style={{ width: `${(index / QUESTIONS.length) * 100}%` }} />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-xl">

          {/* Sentence card */}
          <div className="bg-indigo-600 rounded-3xl shadow-xl p-8 mb-6 text-center">
            <p className="text-lg text-white leading-relaxed font-medium">
              {q.before}
              <span className={`inline-block min-w-28 border-b-2 mx-1 font-bold transition-colors ${
                !revealed ? 'border-white/50 text-white/30' :
                selected === q.correct ? 'border-green-300 text-green-200' : 'border-red-300 text-red-200'
              }`}>
                {selected || '          '}
              </span>
              {q.after}
            </p>
            {q.contextHint && (
              <p className="text-indigo-300 text-xs mt-3 italic">{q.contextHint}</p>
            )}
            <button
              onClick={() => speak((q.before + (selected || '') + q.after).trim())}
              className="mt-4 text-white/40 hover:text-white transition-colors text-sm"
            >
              🔈 Listen
            </button>
          </div>

          {/* Options */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            {q.options.map(({ word, translation }) => {
              const isSelected   = selected === word
              const isCorrectOpt = word === q.correct
              let style = 'bg-white border-gray-200 text-gray-800 hover:border-indigo-300 hover:bg-indigo-50'
              if (revealed) {
                if (isCorrectOpt)        style = 'bg-green-50 border-green-400 text-green-800'
                else if (isSelected)     style = 'bg-red-50 border-red-400 text-red-700'
                else                     style = 'bg-white border-gray-100 text-gray-400'
              }
              return (
                <button
                  key={word}
                  onClick={() => handleSelect(word)}
                  disabled={revealed}
                  className={`border rounded-2xl px-4 py-4 text-sm font-semibold text-left transition-all ${style} ${!revealed ? 'hover:scale-[1.02]' : ''}`}
                >
                  <div className="flex items-center justify-between">
                    <span>{word}</span>
                    {revealed && isCorrectOpt && <span className="text-green-500">✓</span>}
                    {revealed && isSelected && !isCorrectOpt && <span className="text-red-400">✗</span>}
                  </div>
                  {revealed && (
                    <div className="text-xs font-normal mt-1 opacity-70 italic">{displayTranslation(translation)}</div>
                  )}
                </button>
              )
            })}
          </div>

          {/* Explanations for all options */}
          {revealed && (
            <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-6">
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-3">Why each word</p>
              <div className="flex flex-col gap-3">
                {q.options.map(({ word }) => (
                  <div key={word} className="flex items-start gap-2.5">
                    <span className={`mt-0.5 w-4 h-4 rounded-full flex items-center justify-center text-xs font-bold shrink-0
                      ${word === q.correct ? 'bg-green-100 text-green-600' : 'bg-red-50 text-red-400'}`}>
                      {word === q.correct ? '✓' : '✗'}
                    </span>
                    <div>
                      <span className="text-sm font-semibold text-gray-800">{word} </span>
                      <p className="text-sm text-gray-500 leading-relaxed mt-0.5">
                        {q.explanation[word]}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {revealed && (
            <div className="flex justify-end">
              <button onClick={handleNext}
                className="px-8 py-3 rounded-2xl font-semibold text-sm bg-indigo-600 hover:bg-indigo-700 text-white transition-colors">
                {index + 1 >= QUESTIONS.length ? 'See results →' : 'Next →'}
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
