import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

const CARDS = [
  {
    id: 1,
    word: 'scheitern',
    form: 'gescheitert',
    pos: 'verb',
    translation: 'to fail, to fall through',
    example: 'Das Projekt ist gescheitert.',
    exampleTranslation: 'The project has failed.',
    explanation: 'Used when something collapses or falls through entirely — a plan, a relationship, a negotiation. Stronger than simply "not working." The past participle "gescheitert" is used with the auxiliary verb "sein", not "haben".',
    grammarNote: 'sein + gescheitert (not haben)',
    isException: false,
  },
  {
    id: 2,
    word: 'die Sehnsucht (-süchte)',
    form: null,
    pos: 'noun',
    translation: 'longing, yearning',
    example: 'Er hat eine tiefe Sehnsucht nach seiner Heimat.',
    exampleTranslation: 'He has a deep longing for his homeland.',
    explanation: 'A specifically German concept — a profound, melancholic longing for something distant or perhaps unattainable. Often used in poetry and literature. Feminine noun: die Sehnsucht.',
    grammarNote: 'feminine · die Sehnsucht · plural rare',
    isException: false,
  },
  {
    id: 3,
    word: 'trotzdem',
    form: null,
    pos: 'adverb',
    translation: 'nevertheless, still, anyway',
    example: 'Es regnete, aber sie gingen trotzdem spazieren.',
    exampleTranslation: 'It was raining, but they went for a walk anyway.',
    explanation: '"Trotzdem" expresses a contrast — something happens despite an obstacle or expected outcome. Similar to "dennoch" but more conversational. Note: as a conjunction it causes verb inversion.',
    grammarNote: 'adverb · triggers verb inversion when used as a conjunction',
    isException: false,
  },
  {
    id: 4,
    word: 'sich erinnern',
    form: 'erinnert',
    pos: 'verb',
    translation: 'to remember',
    example: 'Ich erinnere mich an unseren ersten Tag.',
    exampleTranslation: 'I remember our first day.',
    explanation: 'A reflexive verb — always used with a reflexive pronoun (mich, dich, sich…). Followed by "an + accusative" for the thing being remembered. Cannot be used without the reflexive pronoun.',
    grammarNote: '⚠ reflexive verb · sich erinnern an + Akkusativ',
    isException: true,
  },
  {
    id: 5,
    word: 'das Heimweh',
    form: null,
    pos: 'noun',
    translation: 'homesickness',
    example: 'Nach einem Monat in Berlin hatte sie starkes Heimweh.',
    exampleTranslation: 'After a month in Berlin she was very homesick.',
    explanation: 'Literally "home-pain." A compound noun: Heim (home) + Weh (pain, ache). Neuter gender, no plural form exists — you cannot have multiple "homesicknesses." Used with "haben" or "bekommen."',
    grammarNote: 'neuter · no plural · Heimweh haben / bekommen',
    isException: false,
  },
  {
    id: 6,
    word: 'obwohl',
    form: null,
    pos: 'conjunction',
    translation: 'although, even though',
    example: 'Obwohl er müde war, arbeitete er weiter.',
    exampleTranslation: 'Although he was tired, he kept working.',
    explanation: '"Obwohl" introduces a subordinate clause and sends the verb to the end of that clause. This is a key rule for all subordinating conjunctions in German. The main clause that follows uses normal word order.',
    grammarNote: '⚠ subordinating conjunction · verb goes to end of clause',
    isException: true,
  },
]

const POS_STYLES = {
  verb:        'bg-violet-50 text-violet-700 border border-violet-200',
  noun:        'bg-blue-50 text-blue-700 border border-blue-200',
  adjective:   'bg-amber-50 text-amber-700 border border-amber-200',
  adverb:      'bg-teal-50 text-teal-700 border border-teal-200',
  conjunction: 'bg-rose-50 text-rose-700 border border-rose-200',
  preposition: 'bg-gray-100 text-gray-600 border border-gray-200',
}

const POS_LABELS = {
  verb: 'verb', noun: 'noun', adjective: 'adj.',
  adverb: 'adv.', conjunction: 'conj.', preposition: 'prep.',
}

function speak(text, lang = 'de-DE') {
  if (!window.speechSynthesis) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = lang
  u.rate = 0.85
  window.speechSynthesis.speak(u)
}

export default function Flashcards() {
  const navigate = useNavigate()
  const [index, setIndex]       = useState(0)
  const [flipped, setFlipped]   = useState(false)
  const [results, setResults]   = useState([])   // 'easy' | 'hard' | 'again'
  const [done, setDone]         = useState(false)
  const [speaking, setSpeaking] = useState(false)

  const card = CARDS[index]
  const progress = (index / CARDS.length) * 100

  useEffect(() => { setFlipped(false) }, [index])

  const handleSpeak = (text, e) => {
    e.stopPropagation()
    setSpeaking(true)
    speak(text)
    setTimeout(() => setSpeaking(false), 1500)
  }

  const handleResult = (result) => {
    const next = [...results, { id: card.id, result }]
    setResults(next)
    if (index + 1 >= CARDS.length) {
      setDone(true)
    } else {
      setIndex((i) => i + 1)
    }
  }

  const restart = () => {
    setIndex(0)
    setResults([])
    setDone(false)
    setFlipped(false)
  }

  if (done) {
    const easy  = results.filter((r) => r.result === 'easy').length
    const hard  = results.filter((r) => r.result === 'hard').length
    const again = results.filter((r) => r.result === 'again').length
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex flex-col">
        <nav className="bg-white/80 backdrop-blur border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <div className="text-xl font-bold text-indigo-600">wordy</div>
          <button onClick={() => navigate('/dashboard')} className="text-sm text-gray-500 hover:text-gray-900 transition-colors">← Dashboard</button>
        </nav>
        <div className="flex-1 flex flex-col items-center justify-center px-4">
          <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-10 w-full max-w-md text-center">
            <div className="text-5xl mb-4">🎉</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-1">Session complete!</h2>
            <p className="text-gray-500 text-sm mb-8">{CARDS.length} cards reviewed</p>
            <div className="grid grid-cols-3 gap-4 mb-8">
              <div className="bg-green-50 rounded-2xl p-4">
                <div className="text-2xl font-bold text-green-600">{easy}</div>
                <div className="text-xs text-green-700 mt-0.5 font-medium">Easy</div>
              </div>
              <div className="bg-yellow-50 rounded-2xl p-4">
                <div className="text-2xl font-bold text-yellow-600">{hard}</div>
                <div className="text-xs text-yellow-700 mt-0.5 font-medium">Hard</div>
              </div>
              <div className="bg-red-50 rounded-2xl p-4">
                <div className="text-2xl font-bold text-red-500">{again}</div>
                <div className="text-xs text-red-600 mt-0.5 font-medium">Again</div>
              </div>
            </div>
            {again > 0 && (
              <p className="text-sm text-gray-500 mb-6">
                {again} word{again > 1 ? 's' : ''} marked "again" — we'll bring {again > 1 ? 'them' : 'it'} back in your next session.
              </p>
            )}
            <div className="flex flex-col gap-3">
              <button onClick={restart} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-2xl font-semibold text-sm transition-colors">
                Review again
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
      {/* Nav */}
      <nav className="bg-white/80 backdrop-blur border-b border-gray-100 px-6 py-4 flex items-center justify-between">
        <div className="text-xl font-bold text-indigo-600">wordy</div>
        <div className="text-sm text-gray-500">
          {index + 1} / {CARDS.length}
        </div>
        <button onClick={() => navigate('/dashboard')} className="text-sm text-gray-400 hover:text-gray-700 transition-colors">✕ End session</button>
      </nav>

      {/* Progress bar */}
      <div className="h-1 bg-gray-100">
        <div className="h-full bg-indigo-500 transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-4 py-8">

        {/* Flip hint */}
        {!flipped && (
          <p className="text-xs text-gray-400 mb-4 tracking-wide">Tap the card to reveal</p>
        )}

        {/* Card */}
        <div
          className="w-full max-w-lg cursor-pointer"
          style={{ perspective: '1200px' }}
          onClick={() => setFlipped((f) => !f)}
        >
          <div
            className="relative transition-transform duration-500"
            style={{
              transformStyle: 'preserve-3d',
              transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
              minHeight: '340px',
            }}
          >
            {/* Front */}
            <div
              className="absolute inset-0 bg-indigo-600 rounded-3xl shadow-xl flex flex-col items-center justify-center p-8"
              style={{ backfaceVisibility: 'hidden' }}
            >
              <span className="px-2.5 py-0.5 rounded-md text-xs font-semibold mb-6 bg-white/20 text-white border border-white/30">
                {POS_LABELS[card.pos]}
              </span>
              <div className="text-4xl font-bold text-white text-center mb-3">{card.word}</div>
              {card.form && card.pos !== 'noun' && (
                <div className="text-sm text-indigo-200 italic mb-4">{card.form}</div>
              )}
              <button
                onClick={(e) => handleSpeak(card.word.replace(/\(.*?\)/g, '').trim(), e)}
                className={`mt-2 flex items-center gap-2 px-4 py-2 rounded-full border text-sm transition-all ${
                  speaking
                    ? 'border-white bg-white/20 text-white'
                    : 'border-white/30 text-indigo-200 hover:border-white hover:text-white'
                }`}
              >
                <span>{speaking ? '🔊' : '🔈'}</span>
                {speaking ? 'Playing…' : 'Pronounce'}
              </button>
            </div>

            {/* Back */}
            <div
              className="absolute inset-0 bg-white rounded-3xl shadow-xl border border-gray-100 flex flex-col p-8 overflow-y-auto"
              style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
            >
              {/* Translation */}
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Translation</div>
                  <div className="text-2xl font-bold text-gray-900">{card.translation}</div>
                </div>
                <button
                  onClick={(e) => handleSpeak(card.word.replace(/\(.*?\)/g, '').trim(), e)}
                  className="text-gray-300 hover:text-indigo-500 transition-colors text-xl ml-4 mt-1"
                  title="Pronounce"
                >
                  🔈
                </button>
              </div>

              {/* Example */}
              <div className="bg-gray-50 rounded-2xl p-4 mb-4">
                <div className="text-sm font-medium text-gray-800 mb-1">
                  "{card.example}"
                  <button
                    onClick={(e) => handleSpeak(card.example, e)}
                    className="ml-2 text-gray-300 hover:text-indigo-400 transition-colors"
                  >
                    🔈
                  </button>
                </div>
                <div className="text-xs text-gray-400 italic">{card.exampleTranslation}</div>
              </div>

              {/* Grammar note */}
              <div className={`rounded-xl px-4 py-3 mb-4 text-xs font-medium flex items-center gap-2 ${
                card.isException
                  ? 'bg-amber-50 text-amber-800 border border-amber-100'
                  : 'bg-indigo-50 text-indigo-800 border border-indigo-100'
              }`}>
                <span>{card.isException ? '⚠️' : 'ℹ️'}</span>
                {card.grammarNote}
              </div>

            </div>
          </div>
        </div>

        {/* Result buttons — only after flip */}
        <div className={`mt-8 flex gap-3 transition-all duration-300 ${flipped ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'}`}>
          <button
            onClick={() => handleResult('again')}
            className="flex flex-col items-center gap-1 px-6 py-3 bg-white border border-red-200 hover:bg-red-50 text-red-500 rounded-2xl text-sm font-semibold transition-all hover:scale-105"
          >
            <span className="text-lg">↩️</span>
            Again
          </button>
          <button
            onClick={() => handleResult('hard')}
            className="flex flex-col items-center gap-1 px-6 py-3 bg-white border border-yellow-200 hover:bg-yellow-50 text-yellow-600 rounded-2xl text-sm font-semibold transition-all hover:scale-105"
          >
            <span className="text-lg">😅</span>
            Hard
          </button>
          <button
            onClick={() => handleResult('easy')}
            className="flex flex-col items-center gap-1 px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-sm font-semibold transition-all hover:scale-105 shadow-md shadow-indigo-200"
          >
            <span className="text-lg">✓</span>
            Easy
          </button>
        </div>

        {/* Flip again hint */}
        {flipped && (
          <button
            onClick={() => setFlipped(false)}
            className="mt-4 text-xs text-gray-300 hover:text-gray-500 transition-colors"
          >
            ↩ Flip back
          </button>
        )}
      </div>
    </div>
  )
}
