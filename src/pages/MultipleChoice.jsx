import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

const QUESTIONS = [
  {
    id: 1,
    sentence: ['Das Projekt ist leider ', ' — alle Mühe war umsonst.'],
    correct: 'gescheitert',
    options: ['gescheitert', 'scheiterte', 'gescheiternd', 'scheitern'],
    explanation: {
      gescheitert:    '✓ Correct. "scheitern" uses "sein" as auxiliary → ist gescheitert. The Partizip II is the right form in this perfect tense construction.',
      scheiterte:     '✗ "scheiterte" is the simple past (Präteritum). But the sentence uses "ist", pointing to the Perfekt — you need the Partizip II here.',
      gescheiternd:   '✗ "-nd" forms a present participle (like an adjective), not a past tense. "Gescheiternd" is not a standard German word.',
      scheitern:      '✗ The infinitive cannot follow "ist" in a past tense construction. "ist scheitern" is not grammatically valid.',
    },
  },
  {
    id: 2,
    sentence: ['Ich erinnere ', ' noch gut an unsere erste Begegnung.'],
    correct: 'mich',
    options: ['mich', 'mir', 'sich', 'uns'],
    explanation: {
      mich: '✓ Correct. "sich erinnern" is a reflexive verb. With the subject "ich", the reflexive pronoun in the accusative is "mich".',
      mir:  '✗ "mir" is the dative form of the first-person reflexive. "Sich erinnern" takes the accusative reflexive pronoun — "mich", not "mir".',
      sich: '✗ "sich" is the reflexive pronoun for er/sie/es/sie(pl.)/Sie. With "ich" as the subject, you need "mich".',
      uns:  '✗ "uns" would mean the subject is "wir" (we). The subject here is "ich", so "uns" doesn\'t agree.',
    },
  },
  {
    id: 3,
    sentence: ['Es regnete stark, ', ' gingen wir spazieren.'],
    correct: 'trotzdem',
    options: ['trotzdem', 'obwohl', 'weil', 'damit'],
    explanation: {
      trotzdem: '✓ Correct. "Trotzdem" (nevertheless) is a connective adverb — it joins two main clauses and causes verb inversion in the second clause: trotzdem gingen wir.',
      obwohl:   '✗ "Obwohl" is a subordinating conjunction that would send the verb to the end: "obwohl es stark regnete, gingen wir spazieren." Here the structure is two main clauses, so "trotzdem" fits better.',
      weil:     '✗ "Weil" means "because" — it would imply the rain is the reason for the walk, the opposite of the intended meaning.',
      damit:    '✗ "Damit" means "so that" and introduces a purpose clause. It doesn\'t express contrast.',
    },
  },
  {
    id: 4,
    sentence: ['Sie brauchte viel ', ', um die Entscheidung zu treffen.'],
    correct: 'Mut',
    options: ['Mut', 'Muts', 'Mute', 'Muten'],
    explanation: {
      Mut:   '✓ Correct. "der Mut" is used here without an article after "viel". Masculine nouns in this construction take no ending: viel Mut (not Muts or Mute).',
      Muts:  '✗ The genitive of "Mut" is "des Mutes" or "des Muts" in formal German, but after "viel" no genitive is used — just the plain noun.',
      Mute:  '✗ "Mute" would be an adjective ending added to the noun, which doesn\'t apply here. German nouns don\'t change their base form this way.',
      Muten: '✗ "-en" is an adjective or weak noun ending. "Mut" is not a weak noun and takes no such ending here.',
    },
  },
  {
    id: 5,
    sentence: ['Er war von dem Konzert absolut ', '.'],
    correct: 'begeistert',
    options: ['begeistert', 'begeisternd', 'begeistern', 'begeisterte'],
    explanation: {
      begeistert:   '✓ Correct. "begeistert sein von" — predicative adjective/participle used after "war". No ending needed in this position.',
      begeisternd:  '✗ "begeisternd" is the present participle meaning "inspiring" or "enthusing" (as an active quality). "Er war begeisternd" would mean he was the one doing the enthusing — wrong meaning.',
      begeistern:   '✗ The infinitive cannot follow "war" as an adjective. "War begeistern" is not grammatically valid.',
      begeisterte:  '✗ "begeisterte" with an "-e" ending is the adjective in attributive position (ein begeisterter Mann). After "war" (predicative), no ending is added.',
    },
  },
  {
    id: 6,
    sentence: ['', ' sie müde war, arbeitete sie bis Mitternacht.'],
    correct: 'Obwohl',
    options: ['Obwohl', 'Trotzdem', 'Weil', 'Wenn'],
    explanation: {
      Obwohl:  '✓ Correct. "Obwohl" (although) introduces a concessive subordinate clause — the verb goes to the end: obwohl sie müde war. The contrast with the main clause is clear.',
      Trotzdem: '✗ "Trotzdem" is a connective adverb that joins two main clauses. It would need a comma and a main clause after it: "Sie war müde, trotzdem arbeitete sie…"',
      Weil:    '✗ "Weil" means "because" — it would mean she worked because she was tired, which is the opposite of the intended meaning.',
      Wenn:    '✗ "Wenn" means "when" or "if" and introduces a conditional or temporal clause, not a contrast.',
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

export default function MultipleChoice() {
  const navigate = useNavigate()
  const [index, setIndex]       = useState(0)
  const [selected, setSelected] = useState(null)
  const [revealed, setRevealed] = useState(false)
  const [score, setScore]       = useState(0)
  const [done, setDone]         = useState(false)

  const q = QUESTIONS[index]
  const fullSentence = q.sentence[0] + (selected || '____') + (q.sentence[1] || '')

  const handleSelect = (opt) => {
    if (revealed) return
    setSelected(opt)
    setRevealed(true)
    if (opt === q.correct) setScore((s) => s + 1)
  }

  const handleNext = () => {
    if (index + 1 >= QUESTIONS.length) {
      setDone(true)
    } else {
      setIndex((i) => i + 1)
      setSelected(null)
      setRevealed(false)
    }
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
            {pct === 100 && <p className="text-sm text-green-600 font-medium mb-6">Perfect score! 🌟</p>}
            {pct >= 60 && pct < 100 && <p className="text-sm text-yellow-600 mb-6">Good work — review the missed ones below.</p>}
            {pct < 60 && <p className="text-sm text-red-500 mb-6">Keep practicing — these are tricky!</p>}
            <div className="flex flex-col gap-3">
              <button
                onClick={() => { setIndex(0); setSelected(null); setRevealed(false); setScore(0); setDone(false) }}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-2xl font-semibold text-sm transition-colors"
              >
                Try again
              </button>
              <button onClick={() => navigate('/dashboard')} className="w-full text-gray-500 hover:text-gray-900 py-2 text-sm transition-colors">
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
              {q.sentence[0]}
              <span className={`inline-block min-w-24 border-b-2 mx-1 font-bold transition-colors ${
                !revealed ? 'border-white/60 text-white/40' :
                selected === q.correct ? 'border-green-300 text-green-200' : 'border-red-300 text-red-200'
              }`}>
                {selected || '        '}
              </span>
              {q.sentence[1]}
            </p>
            <button
              onClick={() => speak(fullSentence)}
              className="mt-4 text-white/50 hover:text-white transition-colors text-sm"
            >
              🔈 Listen
            </button>
          </div>

          {/* Options */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            {q.options.map((opt) => {
              const isSelected = selected === opt
              const isCorrectOpt = opt === q.correct
              let style = 'bg-white border-gray-200 text-gray-700 hover:border-indigo-300 hover:bg-indigo-50'
              if (revealed) {
                if (isCorrectOpt) style = 'bg-green-50 border-green-400 text-green-800'
                else if (isSelected) style = 'bg-red-50 border-red-400 text-red-700'
                else style = 'bg-white border-gray-100 text-gray-400'
              }
              return (
                <button
                  key={opt}
                  onClick={() => handleSelect(opt)}
                  disabled={revealed}
                  className={`border rounded-2xl px-5 py-4 text-sm font-semibold text-left transition-all flex items-center justify-between ${style} ${!revealed ? 'hover:scale-[1.02]' : ''}`}
                >
                  <span>{opt}</span>
                  {revealed && isCorrectOpt && <span className="text-green-500 text-base">✓</span>}
                  {revealed && isSelected && !isCorrectOpt && <span className="text-red-400 text-base">✗</span>}
                </button>
              )
            })}
          </div>

          {/* Explanation — shown for ALL options after answering */}
          {revealed && (
            <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-6">
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-3">Why each option</p>
              <div className="flex flex-col gap-2.5">
                {q.options.map((opt) => (
                  <div key={opt} className="flex items-start gap-2.5">
                    <span className={`mt-0.5 w-4 h-4 rounded-full flex items-center justify-center text-xs font-bold shrink-0
                      ${opt === q.correct ? 'bg-green-100 text-green-600' : 'bg-red-50 text-red-400'}`}>
                      {opt === q.correct ? '✓' : '✗'}
                    </span>
                    <div>
                      <span className="text-sm font-semibold text-gray-800">{opt} </span>
                      <span className="text-sm text-gray-500">{q.explanation[opt]?.replace(/^[✓✗] /, '')}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {revealed && (
            <div className="flex justify-end">
              <button
                onClick={handleNext}
                className="px-8 py-3 rounded-2xl font-semibold text-sm bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
              >
                {index + 1 >= QUESTIONS.length ? 'See results →' : 'Next →'}
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
