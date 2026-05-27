import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useLanguage } from '../lib/i18n'
import { useTargetLang } from '../lib/TargetLangContext'
import NavBar from '../components/NavBar'
import {
  FlashcardsIcon, PrepositionsIcon, FillBlankIcon,
  WordOrderIcon, ActiveRecallIcon, SentenceWritingIcon, GrammarChatIcon
} from '../components/ExerciseIcons'

const PREP_LIST = new Set(['an','auf','über','für','mit','zu','von','nach','bei','gegen','ohne','um','aus','in'])

export default function Exercises() {
  const navigate = useNavigate()
  const { user }              = useAuth()
  const { lang }              = useLanguage()
  const { targetLang, features } = useTargetLang()

  const [words,   setWords]   = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    supabase
      .from('words')
      .select('id, status, pos, word')
      .eq('user_id', user.id)
      .eq('target_language', targetLang)
      .then(({ data }) => { setWords(data ?? []); setLoading(false) })
  }, [user])

  // ── Derived counts ──────────────────────────────────────────────────────
  const total       = words.length
  const active      = words.filter(w => w.status !== 'new').length
  const prepVerbs   = words.filter(w => w.pos === 'verb' && w.word.toLowerCase().split(/\s+/).some(t => PREP_LIST.has(t))).length
  const recallReady = words.filter(w => ['learning','known','mastered'].includes(w.status)).length

  // ── Exercise catalogue ──────────────────────────────────────────────────
  const uk = lang === 'uk'

  const EXERCISES = [
    {
      id: 'flashcards',
      Icon: FlashcardsIcon,
      name:        uk ? 'Флеш-картки'              : 'Flashcards',
      desc:        uk ? 'Гортайте картки зі словами та оцінюйте, наскільки добре їх знаєте.'
                      : 'Flip through your word cards and rate how well you know each one.',
      level:       uk ? 'Початковий' : 'Beginner',
      levelColor:  'bg-green-50 text-green-700 border-green-100',
      stat:        loading ? '…' : `${total} ${uk ? 'слів' : 'words'}`,
      statEmpty:   uk ? 'Додайте слова до словника' : 'Add words to your dictionary',
      path:        '/flashcards',
      color:       'border-indigo-100 hover:border-indigo-300',
      iconBg:      'bg-indigo-50',
      disabled:    total === 0,
    },
    {
      id: 'fill-blank',
      hidden:      !features.fillBlank,
      Icon: FillBlankIcon,
      name:        uk ? 'Заповніть пропуск'         : 'Fill in the blank',
      desc:        uk ? 'Оберіть правильне слово, щоб заповнити пропуск у реченні.'
                      : 'Choose the right word to complete each sentence.',
      level:       uk ? 'Початковий' : 'Beginner',
      levelColor:  'bg-green-50 text-green-700 border-green-100',
      stat:        loading ? '…' : `${total} ${uk ? 'слів' : 'words'}`,
      statEmpty:   uk ? 'Додайте слова до словника' : 'Add words to your dictionary',
      path:        '/fill-blank',
      color:       'border-purple-100 hover:border-purple-300',
      iconBg:      'bg-purple-50',
      disabled:    total === 0,
    },
    {
      id: 'word-order',
      Icon: WordOrderIcon,
      name:        uk ? 'Порядок слів'              : 'Word order',
      desc:        uk ? 'Складіть перемішані чіпи в правильному порядку, щоб утворити речення.'
                      : 'Tap scrambled word chips into the correct German sentence order.',
      level:       uk ? 'Середній' : 'Intermediate',
      levelColor:  'bg-amber-50 text-amber-700 border-amber-100',
      stat:        loading ? '…' : `${total} ${uk ? 'слів' : 'words'}`,
      statEmpty:   uk ? 'Додайте слова до словника' : 'Add words to your dictionary',
      path:        '/word-order',
      color:       'border-teal-100 hover:border-teal-300',
      iconBg:      'bg-teal-50',
      disabled:    total === 0,
    },
    {
      id: 'active-recall',
      Icon: ActiveRecallIcon,
      name:        uk ? 'Активне відтворення'       : 'Active recall',
      desc:        uk ? 'Побачте переклад — введіть німецьке слово по памʼяті.'
                      : 'See the translation, type the German word from memory.',
      level:       uk ? 'Середній' : 'Intermediate',
      levelColor:  'bg-amber-50 text-amber-700 border-amber-100',
      stat:        loading ? '…' : recallReady > 0
        ? `${recallReady} ${uk ? 'слів готові' : 'words ready'}`
        : null,
      statEmpty:   uk ? 'Потрібні слова зі статусом «вивчаю» або вище' : 'Need words with learning status or above',
      path:        '/active-recall',
      color:       'border-amber-100 hover:border-amber-300',
      iconBg:      'bg-amber-50',
      disabled:    recallReady === 0,
    },
    {
      id: 'sentence-writing',
      Icon: SentenceWritingIcon,
      name:        uk ? 'Написання речень'          : 'Sentence writing',
      desc:        uk ? 'Напишіть власне речення з цільовим словом і отримайте AI-відгук.'
                      : 'Write your own sentence with the target word and get instant AI feedback.',
      level:       uk ? 'Просунутий' : 'Advanced',
      levelColor:  'bg-rose-50 text-rose-700 border-rose-100',
      stat:        loading ? '…' : `${total} ${uk ? 'слів' : 'words'}`,
      statEmpty:   uk ? 'Додайте слова до словника' : 'Add words to your dictionary',
      path:        '/sentence-writing',
      color:       'border-rose-100 hover:border-rose-300',
      iconBg:      'bg-rose-50',
      disabled:    total === 0,
    },
    {
      id: 'prepositions',
      hidden:      !features.prepositionDrills,
      Icon: PrepositionsIcon,
      name:        uk ? 'Дієслова з прийменником'  : 'Verbs + prepositions',
      desc:        uk ? 'Відпрацьовуйте фіксовані прийменники та відмінкові закінчення з цільовими вправами.'
                      : 'Drill fixed prepositions and their case endings with targeted exercises.',
      level:       uk ? 'Просунутий' : 'Advanced',
      levelColor:  'bg-rose-50 text-rose-700 border-rose-100',
      stat:        loading ? '…' : prepVerbs > 0
        ? `${prepVerbs} ${uk ? 'дієслів з прийменником' : 'prep verbs'}`
        : null,
      statEmpty:   uk ? 'Потрібні дієслова з прийменниками у словнику' : 'Add verbs with prepositions to your dictionary',
      path:        '/prepositions',
      color:       'border-violet-100 hover:border-violet-300',
      iconBg:      'bg-violet-50',
      disabled:    prepVerbs === 0,
    },
    {
      id: 'chat',
      Icon: GrammarChatIcon,
      name:        uk ? 'Граматичний чат'           : 'Grammar chat',
      desc:        uk ? 'Запитайте AI-репетитора про граматику, вживання слів або будь-що, що вас бентежить.'
                      : "Ask your AI tutor about grammar rules, tricky sentences, or anything you're unsure about.",
      level:       'AI',
      levelColor:  'bg-indigo-50 text-indigo-700 border-indigo-100',
      stat:        null,
      statEmpty:   null,
      path:        '/chat',
      color:       'border-green-100 hover:border-green-300',
      iconBg:      'bg-green-50',
      disabled:    false,
    },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />

      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">
            {uk ? 'Вправи' : 'Exercises'}
          </h1>
          <p className="text-sm text-gray-500">
            {loading ? '…' : uk
              ? `${total} слів у вашому словнику · оберіть вправу нижче`
              : `${total} words in your dictionary · choose an exercise below`
            }
          </p>
        </div>

        {/* Difficulty legend */}
        <div className="flex gap-3 mb-6 flex-wrap">
          {[
            { label: uk ? 'Початковий' : 'Beginner',     color: 'bg-green-50 text-green-700 border-green-100' },
            { label: uk ? 'Середній'   : 'Intermediate', color: 'bg-amber-50 text-amber-700 border-amber-100' },
            { label: uk ? 'Просунутий' : 'Advanced',     color: 'bg-rose-50 text-rose-700 border-rose-100'   },
            { label: 'AI',                                color: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
          ].map(({ label, color }) => (
            <span key={label} className={`px-2.5 py-1 rounded-full text-xs font-medium border ${color}`}>
              {label}
            </span>
          ))}
        </div>

        {/* Exercise grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {EXERCISES.filter(ex => !ex.hidden).map((ex) => (
            <button
              key={ex.id}
              onClick={() => !ex.disabled && navigate(ex.path)}
              disabled={ex.disabled}
              className={`text-left bg-white rounded-2xl border-2 p-5 flex flex-col gap-3 transition-all group ${
                ex.disabled
                  ? 'opacity-50 cursor-not-allowed border-gray-100'
                  : `${ex.color} cursor-pointer hover:shadow-md hover:-translate-y-0.5`
              }`}
            >
              {/* Icon + level */}
              <div className="flex items-start justify-between">
                <div className={`w-12 h-12 rounded-xl ${ex.iconBg} flex items-center justify-center text-indigo-600`}>
                  <ex.Icon size={24} />
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${ex.levelColor}`}>
                  {ex.level}
                </span>
              </div>

              {/* Name + description */}
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900 mb-1">{ex.name}</h3>
                <p className="text-xs text-gray-500 leading-relaxed">{ex.desc}</p>
              </div>

              {/* Stat + CTA */}
              <div className="flex items-center justify-between pt-1 border-t border-gray-50">
                <span className="text-xs text-gray-400">
                  {ex.stat ?? ex.statEmpty}
                </span>
                {!ex.disabled && (
                  <span className="text-xs font-semibold text-indigo-600 group-hover:text-indigo-800 transition-colors">
                    {uk ? 'Почати →' : 'Start →'}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      </main>
    </div>
  )
}
