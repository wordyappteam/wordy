import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { chatWithTutor, generateSessionMemory, identifyWord, extractVocabFromChat, primaryEntry } from '../lib/claude'
import { useLanguage, targetGenitiveUk } from '../lib/i18n'
import { useTargetLang } from '../lib/TargetLangContext'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'
import { fetchCollectionsData, createCollection, addWordToCollection, nextColor } from '../lib/collections'
import NavBar from '../components/NavBar'

function buildGreeting(lang, targetLanguageName) {
  if (lang === 'uk') return `Привіт! Я ваш репетитор з ${targetGenitiveUk(targetLanguageName)} граматики. Запитуйте будь-що — граматичні правила, складні речення, вживання слів або все, що зустріли під час навчання.\n\nЯ також можу допомогти додати нові слова або фрази до вашого словника прямо з нашої розмови.`
  return `Hi! I'm your ${targetLanguageName} tutor. Ask me anything — grammar rules, tricky sentences, word usage, or anything you've encountered while learning.\n\nI can also help you add new words or phrases directly to your dictionary from our conversation.`
}

// ─── Simulated AI responses ───────────────────────────────────────────────────

const SIMULATED_RESPONSES = [
  {
    match: ['konjunktiv', 'subjunctive', 'würde'],
    topicKey: 'konjunktiv',
    response: `The **Konjunktiv II** (subjunctive mood) is used in German for hypothetical situations, polite requests, and indirect speech.

**Formation:**
- Modal verbs and common verbs use their own Konjunktiv II forms: *wäre, hätte, könnte, würde, müsste*
- Most other verbs use **würde + infinitive**: *ich würde gehen* (I would go)

**Examples:**
- *Wenn ich Zeit hätte, würde ich mehr lesen.* — If I had time, I would read more.
- *Das wäre schön.* — That would be nice.
- *Könntest du mir helfen?* — Could you help me? (polite)

💡 **Tip:** Prefer *wäre/hätte/könnte* over *würde sein/würde haben* — the latter sounds clunky in spoken German.`,
    words: [{ word: 'würde', translation: 'would (auxiliary)', pos: 'verb' }],
  },
  {
    match: ['dativ', 'akkusativ', 'case', 'cases', 'kasus'],
    topicKey: 'cases',
    response: `German has **four grammatical cases** that determine how nouns and articles change form.

| Case | Use | Example |
|------|-----|---------|
| **Nominativ** | Subject (who does the action) | *Der Mann* liest. |
| **Akkusativ** | Direct object (what is affected) | Ich sehe *den Mann*. |
| **Dativ** | Indirect object (to/for whom) | Ich gebe *dem Mann* ein Buch. |
| **Genitiv** | Possession | Das Auto *des Mannes*. |

**Key prepositions by case:**
- Always Akkusativ: *durch, für, gegen, ohne, um*
- Always Dativ: *aus, bei, mit, nach, seit, von, zu, gegenüber*
- Two-way (location=Dativ, direction=Akkusativ): *an, auf, hinter, in, neben, über, unter, vor, zwischen*`,
    words: [],
  },
  {
    match: ['perfect', 'perfekt', 'haben', 'sein', 'past tense', 'vergangenheit'],
    topicKey: 'perfekt',
    response: `The **Perfekt** (present perfect) is the most common past tense in spoken German.

**Structure:** subject + *haben/sein* + past participle (Partizip II)

**When to use *sein* instead of *haben*:**
1. Verbs of **motion** with a destination: *gehen, fahren, fliegen, laufen*
2. Verbs of **change of state**: *aufwachen, einschlafen, sterben, werden*
3. The verbs *sein, bleiben, passieren*

**Examples:**
- *Ich **habe** das Buch gelesen.* — I read the book.
- *Sie **ist** nach Berlin gefahren.* — She drove/went to Berlin.
- *Er **ist** früh aufgewacht.* — He woke up early.

💡 **Memory trick:** Think "did it involve *movement* or *change*?" → use *sein*.`,
    words: [
      { word: 'aufwachen', translation: 'to wake up', pos: 'verb' },
      { word: 'einschlafen', translation: 'to fall asleep', pos: 'verb' },
    ],
  },
  {
    match: ['gender', 'genus', 'der die das', 'artikel', 'article'],
    topicKey: 'gender',
    response: `German noun gender (*Genus*) is one of the trickiest parts — but there are helpful patterns!

**Typical masculine (*der*):** male people/animals, days/months/seasons, weather elements, alcoholic drinks (except *das Bier*)

**Typical feminine (*die*):** female people/animals, many flowers/trees, nouns ending in *-ung, -heit, -keit, -schaft, -ion, -tät*

**Typical neuter (*das*):** diminutives (*-chen, -lein*), infinitives used as nouns, most metals, most scientific units

**Useful suffixes:**
| Ending | Gender | Example |
|--------|--------|---------|
| -ung | die | *die Entscheidung* |
| -keit / -heit | die | *die Möglichkeit* |
| -er (agent) | der | *der Lehrer* |
| -chen / -lein | das | *das Mädchen* |
| -ment | das | *das Argument* |

💡 Always learn the article *with* the noun — it's part of the word!`,
    words: [],
  },
  {
    match: ['reflexive', 'sich', 'reflexiv'],
    topicKey: 'reflexive',
    response: `**Reflexive verbs** in German use a reflexive pronoun (*mich, dich, sich, uns, euch, sich*) referring back to the subject.

**True reflexive verbs** (the pronoun is mandatory, no separate meaning):
- *sich beeilen* — to hurry
- *sich befinden* — to be located
- *sich erinnern (an +Akk)* — to remember
- *sich freuen (auf/über)* — to look forward to / to be happy about

**Accusative vs. Dative reflexive:**
- *Ich wasche **mich**.* — I wash (myself). → Akk, no other object
- *Ich wasche **mir** die Hände.* — I wash my hands. → Dat, because *die Hände* is already the Akk object

**Examples:**
- *Erinnerst du **dich** an unseren ersten Tag?* — Do you remember our first day?
- *Wir freuen **uns** auf den Urlaub.* — We're looking forward to the holiday.`,
    words: [
      { word: 'sich beeilen', translation: 'to hurry', pos: 'verb' },
      { word: 'sich erinnern an', translation: 'to remember (sb/sth)', pos: 'verb' },
    ],
  },
]

// ─── Practice exercise sets ───────────────────────────────────────────────────

const PRACTICE_SETS_UK = {
  perfekt: {
    label: 'Perfekt — haben чи sein?',
    intro: 'Оберіть правильне допоміжне дієслово для кожного речення.',
    questions: [
      { sentence: 'Er ___ nach Hause gegangen.', options: ['hat', 'ist'], correct: 1, explanation: 'gehen — дієслово руху з напрямком → sein' },
      { sentence: 'Wir ___ den ganzen Tag gearbeitet.', options: ['haben', 'sind'], correct: 0, explanation: 'arbeiten не виражає руху чи зміни стану → haben' },
      { sentence: 'Das Kind ___ eingeschlafen.', options: ['hat', 'ist'], correct: 1, explanation: 'einschlafen — зміна стану (не спить → спить) → sein' },
      { sentence: 'Sie ___ ein Buch gelesen.', options: ['hat', 'ist'], correct: 0, explanation: 'lesen — звичайне перехідне дієслово без руху чи зміни → haben' },
    ],
  },
  konjunktiv: {
    label: 'Konjunktiv II',
    intro: 'Оберіть правильну форму Konjunktiv II.',
    questions: [
      { sentence: 'Wenn ich reich ___, würde ich viel reisen.', options: ['wäre', 'sein', 'würde sein'], correct: 0, explanation: 'sein → wäre у Konjunktiv II. «würde sein» граматично можливо, але звучить незручно.' },
      { sentence: 'Er ___ dir gerne helfen.', options: ['würde', 'wäre', 'hätte'], correct: 0, explanation: 'würde + інфінітив — стандартна конструкція Konjunktiv II для більшості дієслів.' },
      { sentence: 'Wenn wir mehr Zeit ___, würden wir ins Kino gehen.', options: ['hätten', 'wären', 'haben'], correct: 0, explanation: 'haben → hätten у Konjunktiv II. Це одна з поширених нерегулярних форм.' },
    ],
  },
  cases: {
    label: 'Відмінки в німецькій',
    intro: 'Оберіть правильний артикль або форму.',
    questions: [
      { sentence: 'Ich sehe ___ Mann.', options: ['der', 'den', 'dem'], correct: 1, explanation: 'Прямий додаток = Akkusativ. Чоловічий артикль: der → den.' },
      { sentence: 'Ich gebe ___ Kind ein Geschenk.', options: ['das', 'dem', 'den'], correct: 1, explanation: 'Непрямий додаток (кому?) = Dativ. Середній артикль: das → dem.' },
      { sentence: 'Er hilft ___ Frau.', options: ['die', 'der', 'dem'], correct: 1, explanation: 'helfen вимагає Dativ. Жіночий артикль у Dativ: die → der.' },
      { sentence: 'Das Buch gehört ___ Kind.', options: ['das', 'dem', 'den'], correct: 1, explanation: 'gehören вимагає Dativ. Середній артикль у Dativ: das → dem.' },
    ],
  },
  gender: {
    label: 'Рід іменника — der, die чи das?',
    intro: 'Оберіть правильний означений артикль.',
    questions: [
      { sentence: '___ Entscheidung war schwierig.', options: ['Der', 'Die', 'Das'], correct: 1, explanation: 'Іменники на -ung завжди жіночого роду → die.' },
      { sentence: '___ Mädchen lacht laut.', options: ['Der', 'Die', 'Das'], correct: 2, explanation: 'Зменшувальні форми на -chen завжди середнього роду → das.' },
      { sentence: '___ Lehrer erklärt die Grammatik.', options: ['Der', 'Die', 'Das'], correct: 0, explanation: 'Іменники на -er (особа, яка щось робить) — зазвичай чоловічого роду → der.' },
      { sentence: '___ Möglichkeit gefällt mir sehr.', options: ['Der', 'Die', 'Das'], correct: 1, explanation: 'Іменники на -keit або -heit — жіночого роду → die.' },
    ],
  },
  reflexive: {
    label: 'Зворотні дієслова',
    intro: 'Оберіть правильний зворотний займенник.',
    questions: [
      { sentence: 'Ich erinnere ___ an den Urlaub.', options: ['mir', 'mich', 'sich'], correct: 1, explanation: 'sich erinnern вимагає займенника Akkusativ. Для ich → mich.' },
      { sentence: 'Er freut ___ auf das Wochenende.', options: ['sich', 'ihm', 'ihn'], correct: 0, explanation: 'sich freuen — для 3-ї особи однини зворотний займенник — sich.' },
      { sentence: 'Ich wasche ___ die Hände.', options: ['mich', 'mir', 'sich'], correct: 1, explanation: 'Якщо вже є Akkusativ-об\'єкт (die Hände), зворотний займенник — Dativ → mir.' },
    ],
  },
}

const PRACTICE_SETS = {
  perfekt: {
    label: 'Perfekt — haben or sein?',
    intro: 'Choose the correct auxiliary verb for each sentence.',
    questions: [
      {
        sentence: 'Er ___ nach Hause gegangen.',
        options: ['hat', 'ist'],
        correct: 1,
        explanation: 'gehen is a verb of motion with a destination → sein',
      },
      {
        sentence: 'Wir ___ den ganzen Tag gearbeitet.',
        options: ['haben', 'sind'],
        correct: 0,
        explanation: 'arbeiten has no movement or change of state → haben',
      },
      {
        sentence: 'Das Kind ___ eingeschlafen.',
        options: ['hat', 'ist'],
        correct: 1,
        explanation: 'einschlafen is a change of state (awake → asleep) → sein',
      },
      {
        sentence: 'Sie ___ ein Buch gelesen.',
        options: ['hat', 'ist'],
        correct: 0,
        explanation: 'lesen is a regular transitive verb with no motion or change → haben',
      },
    ],
  },
  konjunktiv: {
    label: 'Konjunktiv II',
    intro: 'Choose the correct Konjunktiv II form.',
    questions: [
      {
        sentence: 'Wenn ich reich ___, würde ich viel reisen.',
        options: ['wäre', 'sein', 'würde sein'],
        correct: 0,
        explanation: 'sein → wäre in Konjunktiv II. "würde sein" is grammatically possible but sounds unnatural.',
      },
      {
        sentence: 'Er ___ dir gerne helfen.',
        options: ['würde', 'wäre', 'hätte'],
        correct: 0,
        explanation: 'würde + infinitive is the standard Konjunktiv II construction for most regular verbs.',
      },
      {
        sentence: 'Wenn wir mehr Zeit ___, würden wir ins Kino gehen.',
        options: ['hätten', 'wären', 'haben'],
        correct: 0,
        explanation: 'haben → hätten in Konjunktiv II. This is one of the common irregular forms to memorise.',
      },
    ],
  },
  cases: {
    label: 'German Cases',
    intro: 'Choose the correct article or form.',
    questions: [
      {
        sentence: 'Ich sehe ___ Mann.',
        options: ['der', 'den', 'dem'],
        correct: 1,
        explanation: 'Direct object = Akkusativ. Masculine article: der → den.',
      },
      {
        sentence: 'Ich gebe ___ Kind ein Geschenk.',
        options: ['das', 'dem', 'den'],
        correct: 1,
        explanation: 'Indirect object (to whom?) = Dativ. Neuter article: das → dem.',
      },
      {
        sentence: 'Er hilft ___ Frau.',
        options: ['die', 'der', 'dem'],
        correct: 1,
        explanation: 'helfen takes Dativ. Feminine article in Dativ: die → der.',
      },
      {
        sentence: 'Das Buch gehört ___ Kind.',
        options: ['das', 'dem', 'den'],
        correct: 1,
        explanation: 'gehören takes Dativ. Neuter article in Dativ: das → dem.',
      },
    ],
  },
  gender: {
    label: 'Noun Gender — der, die or das?',
    intro: 'Choose the correct definite article.',
    questions: [
      {
        sentence: '___ Entscheidung war schwierig.',
        options: ['Der', 'Die', 'Das'],
        correct: 1,
        explanation: 'Nouns ending in -ung are always feminine → die.',
      },
      {
        sentence: '___ Mädchen lacht laut.',
        options: ['Der', 'Die', 'Das'],
        correct: 2,
        explanation: 'Diminutives ending in -chen are always neuter → das.',
      },
      {
        sentence: '___ Lehrer erklärt die Grammatik.',
        options: ['Der', 'Die', 'Das'],
        correct: 0,
        explanation: '-er agent nouns (a person doing something) are typically masculine → der.',
      },
      {
        sentence: '___ Möglichkeit gefällt mir sehr.',
        options: ['Der', 'Die', 'Das'],
        correct: 1,
        explanation: 'Nouns ending in -keit or -heit are feminine → die.',
      },
    ],
  },
  reflexive: {
    label: 'Reflexive Verbs',
    intro: 'Choose the correct reflexive pronoun.',
    questions: [
      {
        sentence: 'Ich erinnere ___ an den Urlaub.',
        options: ['mir', 'mich', 'sich'],
        correct: 1,
        explanation: 'sich erinnern takes an Akkusativ reflexive pronoun. For ich → mich.',
      },
      {
        sentence: 'Er freut ___ auf das Wochenende.',
        options: ['sich', 'ihm', 'ihn'],
        correct: 0,
        explanation: 'sich freuen — for 3rd person singular the reflexive pronoun is sich.',
      },
      {
        sentence: 'Ich wasche ___ die Hände.',
        options: ['mich', 'mir', 'sich'],
        correct: 1,
        explanation: 'When there is already an Akkusativ object (die Hände), the reflexive pronoun is Dativ → mir.',
      },
    ],
  },
}

const SUGGESTED_QUESTIONS = [
  'When do I use haben vs. sein in Perfekt?',
  'Explain Konjunktiv II with examples',
  'How do German cases work?',
  'When do I use reflexive verbs?',
  'What determines noun gender in German?',
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSimulatedResponse(text) {
  const lower = text.toLowerCase()
  for (const entry of SIMULATED_RESPONSES) {
    if (entry.match.some((kw) => lower.includes(kw))) {
      return entry
    }
  }
  return {
    topicKey: null,
    response: `That's a great question about German!

In a real session, the AI tutor would give you a detailed, personalised answer based on your learning history and current level.

For now, try asking about:
- **Cases** (Nominativ, Akkusativ, Dativ)
- **Perfekt tense** (haben vs. sein)
- **Konjunktiv II** (conditional mood)
- **Noun gender** (der, die, das)
- **Reflexive verbs** (sich erinnern, sich freuen…)`,
    words: [],
  }
}

function renderContent(text) {
  const blocks = []
  const lines = text.split('\n')
  let i = 0
  while (i < lines.length) {
    if (lines[i].startsWith('|')) {
      const tableLines = []
      while (i < lines.length && lines[i].startsWith('|')) {
        tableLines.push(lines[i])
        i++
      }
      const rows = tableLines.filter((l) => !l.match(/^\|[\s\-|]+\|$/))
      blocks.push(
        <div key={`table-${i}`} className="overflow-x-auto my-3">
          <table className="text-sm w-full border-collapse">
            <tbody>
              {rows.map((row, ri) => {
                const cells = row.split('|').slice(1, -1).map((c) => c.trim())
                const Tag = ri === 0 ? 'th' : 'td'
                return (
                  <tr key={ri} className={ri === 0 ? 'bg-indigo-50' : ri % 2 === 0 ? 'bg-gray-50' : ''}>
                    {cells.map((cell, ci) => (
                      <Tag
                        key={ci}
                        className="border border-gray-200 px-3 py-1.5 text-left font-normal"
                        dangerouslySetInnerHTML={{
                          __html: cell
                            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                            .replace(/\*(.*?)\*/g, '<em>$1</em>'),
                        }}
                      />
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )
    } else {
      let line = lines[i]
      line = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      line = line.replace(/\*(.*?)\*/g, '<em>$1</em>')
      line = line.replace(/`(.*?)`/g, '<code class="bg-gray-100 px-1 rounded text-sm font-mono">$1</code>')
      blocks.push(
        <p
          key={i}
          className={line === '' ? 'mt-2' : 'leading-relaxed'}
          dangerouslySetInnerHTML={{ __html: line }}
        />
      )
      i++
    }
  }
  return blocks
}

// ─── Inline exercise component ────────────────────────────────────────────────

function InlineExercise({ msg, onAnswer, onSubmit }) {
  const { t, lang } = useLanguage()
  const sets = lang === 'uk' ? PRACTICE_SETS_UK : PRACTICE_SETS
  const set = sets[msg.topicKey]
  if (!set) return null

  const allAnswered = set.questions.every((_, qi) => msg.answers[qi] !== undefined)
  const score = msg.submitted
    ? set.questions.filter((q, qi) => msg.answers[qi] === q.correct).length
    : 0

  return (
    <div className="flex gap-3 items-start">
      <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 text-xs font-bold flex-shrink-0 mt-0.5">
        AI
      </div>
      <div className="flex-1 min-w-0">
        <div className="bg-white border border-gray-100 rounded-2xl rounded-tl-sm shadow-sm overflow-hidden">
          {/* Header */}
          <div className="bg-indigo-600 px-4 py-3 flex items-center justify-between">
            <div>
              <div className="text-white font-semibold text-sm">{set.label}</div>
              <div className="text-indigo-200 text-xs mt-0.5">{set.intro}</div>
            </div>
            <div className="text-indigo-200 text-xs">{set.questions.length} {t('chat.questions')}</div>
          </div>

          {/* Questions */}
          <div className="p-4 space-y-5">
            {set.questions.map((q, qi) => {
              const chosen = msg.answers[qi]
              const isCorrect = chosen === q.correct

              return (
                <div key={qi}>
                  <p className="text-sm text-gray-700 mb-2 font-medium">
                    <span className="text-indigo-400 font-bold mr-1">{qi + 1}.</span>
                    {q.sentence}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {q.options.map((opt, oi) => {
                      let style =
                        'border text-sm px-3 py-1.5 rounded-xl font-medium transition-colors cursor-pointer '
                      if (!msg.submitted) {
                        style +=
                          chosen === oi
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-gray-50 text-gray-700 border-gray-200 hover:border-indigo-300 hover:bg-indigo-50'
                      } else {
                        if (oi === q.correct) {
                          style += 'bg-green-50 text-green-700 border-green-300'
                        } else if (chosen === oi && !isCorrect) {
                          style += 'bg-red-50 text-red-600 border-red-300 line-through'
                        } else {
                          style += 'bg-gray-50 text-gray-400 border-gray-200'
                        }
                      }
                      return (
                        <button
                          key={oi}
                          className={style}
                          disabled={msg.submitted}
                          onClick={() => !msg.submitted && onAnswer(msg.id, qi, oi)}
                        >
                          {opt}
                        </button>
                      )
                    })}
                  </div>

                  {/* Explanation after submit */}
                  {msg.submitted && (
                    <div
                      className={`mt-2 text-xs px-3 py-2 rounded-xl ${
                        isCorrect
                          ? 'bg-green-50 text-green-700'
                          : 'bg-red-50 text-red-700'
                      }`}
                    >
                      {isCorrect ? '✓ ' : '✗ '}
                      {q.explanation}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Footer */}
          <div className="px-4 pb-4">
            {!msg.submitted ? (
              <button
                onClick={() => onSubmit(msg.id)}
                disabled={!allAnswered}
                className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-200 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
              >
                {allAnswered ? t('chat.checkAnswers') : t('chat.answerAll')(set.questions.length)}
              </button>
            ) : (
              <div className="bg-gray-50 rounded-xl px-4 py-3 flex items-center justify-between">
                <div>
                  <span className="text-lg font-bold text-gray-900">
                    {score}/{set.questions.length}
                  </span>
                  <span className="text-sm text-gray-500 ml-2">
                    {score === set.questions.length
                      ? t('chat.perfect')
                      : score >= set.questions.length / 2
                      ? t('chat.goodWork')
                      : t('chat.reviewMore')}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg, onAddWord, onAcceptPractice, onDeclinePractice, onStartAdd }) {
  const { t } = useLanguage()
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[70%] bg-indigo-600 text-white rounded-2xl rounded-tr-sm px-4 py-3 text-sm">
          {msg.text}
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-3 items-start">
      <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 text-xs font-bold flex-shrink-0 mt-0.5">
        AI
      </div>
      <div className="flex-1 min-w-0">
        <div className="bg-white border border-gray-100 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-gray-800 shadow-sm">
          <div className="space-y-1">{renderContent(msg.text)}</div>

          {/* Add to dictionary */}
          {!msg.greeting && (
            <div className="mt-3 pt-2.5 border-t border-gray-100">
              <button
                onClick={() => onStartAdd(msg)}
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors flex items-center gap-1"
              >
                📥 {t('chat.addToDict')}
              </button>
            </div>
          )}

          {/* Words to add */}
          {msg.words && msg.words.length > 0 && (
            <div className="mt-4 pt-3 border-t border-gray-100">
              <p className="text-xs text-gray-400 font-medium mb-2">{t('chat.wordsToAdd')}</p>
              <div className="flex flex-wrap gap-2">
                {msg.words.map((w) => (
                  <button
                    key={w.word}
                    onClick={() => onAddWord(w)}
                    className="flex items-center gap-1.5 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 text-xs font-medium px-2.5 py-1 rounded-full transition-colors"
                  >
                    <span>+</span>
                    <span>{w.word}</span>
                    <span className="text-indigo-400">— {w.translation}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Practice offer */}
          {msg.topicKey && msg.practiceState === 'offered' && (
            <div className="mt-4 pt-3 border-t border-gray-100">
              <p className="text-xs text-gray-700 font-medium mb-2.5">
                {t('chat.practiceOffer')}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => onAcceptPractice(msg.id, msg.topicKey)}
                  className="text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-xl transition-colors"
                >
                  {t('chat.yesLetsGo')}
                </button>
                <button
                  onClick={() => onDeclinePractice(msg.id)}
                  className="text-xs font-medium text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-xl hover:bg-gray-100 transition-colors"
                >
                  {t('chat.maybeLater')}
                </button>
              </div>
            </div>
          )}

          {msg.topicKey && msg.practiceState === 'declined' && (
            <div className="mt-4 pt-3 border-t border-gray-100">
              <p className="text-xs text-gray-400">{t('chat.declinedNote')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function AddedWordToast({ word, onDismiss }) {
  const { t } = useLanguage()
  useEffect(() => {
    const t = setTimeout(onDismiss, 3000)
    return () => clearTimeout(t)
  }, [onDismiss])

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-sm px-4 py-2.5 rounded-full shadow-lg flex items-center gap-2 z-50">
      <span className="text-green-400">✓</span>
      <span>
        <strong>{word.word}</strong> {t('chat.addedToDict')}
      </span>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Chat() {
  const navigate = useNavigate()
  const { t, lang } = useLanguage()
  const { user, profile } = useAuth()
  const { targetLang, targetLanguageName } = useTargetLang()
  const interfaceLanguage = lang === 'uk' ? 'Ukrainian' : 'English'

  const [messages, setMessages] = useState(() => {
    try {
      const saved = localStorage.getItem(`wordy_chat_history_${targetLang}`)
      if (saved) return JSON.parse(saved)
    } catch {}
    return [
      {
        id: 0,
        role: 'assistant',
        text: buildGreeting(lang, targetLanguageName),
        greeting: true,
        words: [],
        topicKey: null,
        practiceState: null,
      },
    ]
  })
  const [input, setInput]           = useState(() => {
    const prefill = localStorage.getItem('wordy_chat_prefill')
    if (prefill) { localStorage.removeItem('wordy_chat_prefill'); return prefill }
    return ''
  })
  const [loading, setLoading]       = useState(false)
  const [toast, setToast]           = useState(null)
  const [addPanel, setAddPanel]     = useState(null) // add-to-dictionary flow state
  const [memory, setMemory]         = useState(null)   // { profile, last_session, updated_at }
  const [exerciseReturn, setExerciseReturn] = useState(() => {
    try {
      const saved = localStorage.getItem('wordy_exercise_return')
      if (saved) return JSON.parse(saved)
    } catch {}
    return null
  })
  const [memorySaving, setMemorySaving] = useState(false)
  const [memorySaved, setMemorySaved]   = useState(false)
  const bottomRef = useRef(null)
  const inputRef  = useRef(null)

  // Load learner memory on mount
  useEffect(() => {
    if (!user) return
    supabase
      .from('learner_memory')
      .select('profile, last_session, updated_at')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => { if (data) setMemory(data) })
  }, [user])

  // Ref always holds current targetLang so persist effect doesn't depend on it
  const targetLangForStorage = useRef(targetLang)
  useEffect(() => { targetLangForStorage.current = targetLang }, [targetLang])

  // Persist chat history (only fires when messages change, not on lang switch)
  useEffect(() => {
    try {
      localStorage.setItem(`wordy_chat_history_${targetLangForStorage.current}`, JSON.stringify(messages))
    } catch {}
  }, [messages])

  // Reload history when switching target language
  const isFirstLangRender = useRef(true)
  useEffect(() => {
    if (isFirstLangRender.current) { isFirstLangRender.current = false; return }
    try {
      const saved = localStorage.getItem(`wordy_chat_history_${targetLang}`)
      if (saved) { setMessages(JSON.parse(saved)); return }
    } catch {}
    setMessages([{
      id: Date.now(),
      role: 'assistant',
      text: buildGreeting(lang, targetLanguageName),
      greeting: true,
      words: [],
      topicKey: null,
      practiceState: null,
    }])
  }, [targetLang])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  function handleNewChat() {
    const fresh = [
      {
        id: Date.now(),
        role: 'assistant',
        text: buildGreeting(lang, targetLanguageName),
        greeting: true,
        words: [],
        topicKey: null,
        practiceState: null,
      },
    ]
    setMessages(fresh)
    localStorage.removeItem(`wordy_chat_history_${targetLang}`)
  }

  async function handleSaveSession() {
    const realMessages = messages.filter((m) => m.role === 'user' || m.role === 'assistant')
    if (realMessages.length < 2) return  // nothing to save
    setMemorySaving(true)
    try {
      const result = await generateSessionMemory(realMessages, memory?.profile ?? null, interfaceLanguage, targetLanguageName)
      await supabase
        .from('learner_memory')
        .upsert({
          user_id: user.id,
          profile: result.profile,
          last_session: result.last_session,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' })
      setMemory({ profile: result.profile, last_session: result.last_session, updated_at: new Date().toISOString() })
      setMemorySaved(true)
      setTimeout(() => setMemorySaved(false), 3000)
    } catch (e) {
      console.error('Failed to save memory:', e)
    }
    setMemorySaving(false)
  }

  function updateMessage(id, updates) {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...updates } : m)))
  }

  function handleSend(text) {
    const trimmed = (text ?? input).trim()
    if (!trimmed || loading) return

    const userMsg = { id: Date.now(), role: 'user', text: trimmed }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setLoading(true)

    const memoryText = memory
      ? `LEARNER PROFILE:\n${memory.profile || ''}\n\nLAST SESSION:\n${memory.last_session || ''}`
      : null

    chatWithTutor([...messages, { role: 'user', text: trimmed }], targetLanguageName, interfaceLanguage, memoryText, profile?.topics ?? [])
      .then((responseText) => {
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now() + 1,
            role: 'assistant',
            text: responseText,
            words: [],
            topicKey: null,
            practiceState: null,
          },
        ])
      })
      .catch(() => {
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now() + 1,
            role: 'assistant',
            text: t('chat.connectError'),
            words: [],
            topicKey: null,
            practiceState: null,
          },
        ])
      })
      .finally(() => setLoading(false))
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function handleAddWord(word) {
    setToast(word)
  }

  // ── Add-to-dictionary flow ───────────────────────────────────────────────
  async function handleStartAdd(msg) {
    setAddPanel({ stage: 'extracting', messageId: msg.id })
    try {
      const { theme, words } = await extractVocabFromChat(msg.text, targetLanguageName, interfaceLanguage)
      if (!words.length) { setAddPanel({ stage: 'empty' }); return }
      setAddPanel({
        stage: 'review',
        theme: '',
        translationLang: interfaceLanguage, // EN/UA — what new words get translated to
        singleSense: true, // themed sets: one relevant sense per word, not all
        items: words.map((w, i) => ({ ...w, id: i, checked: true })),
      })
    } catch (e) {
      console.error('extractVocabFromChat failed:', e)
      setAddPanel({ stage: 'error' })
    }
  }

  function setAddLang(translationLang) {
    setAddPanel(p => ({ ...p, translationLang }))
  }

  function toggleAddAllSenses() {
    setAddPanel(p => ({ ...p, singleSense: !p.singleSense }))
  }

  function toggleAddItem(id) {
    setAddPanel(p => ({ ...p, items: p.items.map(it => it.id === id ? { ...it, checked: !it.checked } : it) }))
  }

  function setAddTheme(theme) {
    setAddPanel(p => ({ ...p, theme }))
  }

  async function handleConfirmAdd() {
    const panel = addPanel
    const chosen = panel.items.filter(it => it.checked)
    if (!chosen.length) return
    setAddPanel(p => ({ ...p, stage: 'adding', progress: { done: 0, total: chosen.length, current: '' } }))

    // Resolve/create the collection (optional).
    let collectionId = null
    const themeName = (panel.theme || '').trim()
    if (themeName) {
      try {
        const { collections } = await fetchCollectionsData(user.id, targetLang)
        const existing = collections.find(c => c.name.toLowerCase() === themeName.toLowerCase())
        collectionId = existing ? existing.id : await createCollection(user.id, targetLang, themeName, nextColor(collections), [])
      } catch (e) { console.error('collection resolve failed:', e) }
    }

    let added = 0, existed = 0, failed = 0
    for (let i = 0; i < chosen.length; i++) {
      const item = chosen[i]
      setAddPanel(p => ({ ...p, progress: { done: i, total: chosen.length, current: item.word } }))
      try {
        const result = primaryEntry(await identifyWord(
          item.word, targetLanguageName, panel.translationLang || interfaceLanguage, null,
          { singleSense: panel.singleSense !== false, themeHint: themeName || null, topics: profile?.topics ?? [] }
        )) ?? {}
        const wordId = await addIdentifiedWord(result)
        if (wordId) {
          if (collectionId) {
            try { await addWordToCollection(user.id, collectionId, wordId.id) } catch { /* already in collection */ }
          }
          wordId.existed ? existed++ : added++
        } else failed++
      } catch (e) {
        console.error('add word failed:', item.word, e)
        failed++
      }
    }

    setAddPanel({ stage: 'done', summary: { added, existed, failed, theme: themeName } })
  }

  // Insert an identified word (+ senses); dedupe by base form. Returns { id, existed } or null.
  async function addIdentifiedWord(result) {
    const primary = result.senses?.[0]
    const { data: existing } = await supabase
      .from('words').select('id')
      .eq('user_id', user.id).eq('target_language', targetLang)
      .ilike('word', result.word).maybeSingle()
    if (existing) return { id: existing.id, existed: true }

    const { data: newWord, error } = await supabase
      .from('words')
      .insert({
        user_id: user.id,
        word: result.word,
        translation: primary?.translation ?? '',
        pos: primary?.pos ?? 'noun',
        form: primary?.form || null,
        grammar_note: primary?.grammarNote || null,
        explanation: primary?.explanation || null,
        is_exception: primary?.isException || false,
        conjugation: primary?.conjugation || null,
        entry_type: result.entryType || 'word',
        status: 'new',
        date_added: new Date().toISOString().split('T')[0],
        target_language: targetLang,
      })
      .select('id').single()
    if (error || !newWord) return null

    if (result.senses?.length) {
      await supabase.from('word_senses').insert(
        result.senses.map(s => ({
          word_id: newWord.id,
          user_id: user.id,
          target_language: targetLang,
          pos: s.pos,
          word_form: s.wordForm || result.word,
          aspect: s.aspect ?? null,
          gender: s.gender ?? null,
          translation: s.translation,
          form: s.form || null,
          grammar_note: s.grammarNote || null,
          usage_note: s.usageNote || null,
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
    }
    return { id: newWord.id, existed: false }
  }

  function handleAcceptPractice(msgId, topicKey) {
    // Mark the explanation message as accepted
    updateMessage(msgId, { practiceState: 'accepted' })
    // Insert the exercise message right after
    const exercise = {
      id: Date.now(),
      role: 'exercise',
      topicKey,
      answers: {},
      submitted: false,
    }
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === msgId)
      const next = [...prev]
      next.splice(idx + 1, 0, exercise)
      return next
    })
  }

  function handleDeclinePractice(msgId) {
    updateMessage(msgId, { practiceState: 'declined' })
  }

  function handleExerciseAnswer(msgId, qIdx, optIdx) {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId ? { ...m, answers: { ...m.answers, [qIdx]: optIdx } } : m
      )
    )
  }

  function handleExerciseSubmit(msgId) {
    updateMessage(msgId, { submitted: true })
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <NavBar className="flex-shrink-0" slot={
        <div className="flex items-center gap-2">
          <button
            onClick={handleSaveSession}
            disabled={memorySaving || messages.filter(m => m.role === 'user').length === 0}
            className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              memorySaved
                ? 'bg-green-50 text-green-700 border-green-200'
                : 'text-gray-500 hover:text-gray-800 border-gray-200 hover:border-gray-300'
            }`}
          >
            {memorySaving ? 'Saving…' : memorySaved ? '✓ Saved' : '💾 Save'}
          </button>
          <button
            onClick={handleNewChat}
            className="text-xs font-medium text-gray-500 hover:text-gray-800 border border-gray-200 hover:border-gray-300 px-3 py-1.5 rounded-lg transition-colors"
          >
            {t('chat.newChat')}
          </button>
        </div>
      } />

      {exerciseReturn && (
        <div className="bg-indigo-50 border-b border-indigo-100 px-6 py-2.5 flex items-center justify-between">
          <span className="text-xs text-indigo-600 font-medium">
            {lang === 'uk' ? '🔖 Вправа на паузі' : '🔖 Exercise paused'}
          </span>
          <button
            onClick={() => {
              localStorage.removeItem('wordy_exercise_return')
              setExerciseReturn(null)
              navigate(exerciseReturn.path)
            }}
            className="text-xs font-semibold text-indigo-700 hover:text-indigo-900 transition-colors"
          >
            ← {exerciseReturn.label}
          </button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden max-w-5xl mx-auto w-full px-4 sm:px-6 py-6 gap-6">
        {/* Sidebar */}
        <aside className="hidden lg:flex w-64 flex-shrink-0 flex-col gap-4">
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{t('chat.currentFocus')}</div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg">{targetLanguageName === 'German' ? '🇩🇪' : targetLanguageName === 'Ukrainian' ? '🇺🇦' : '🇬🇧'}</span>
              <div>
                <div className="text-sm font-semibold text-gray-900">{targetLanguageName}</div>
                <div className="text-xs text-gray-400">B1 · 47 {t('chat.wordsLearned')}</div>
              </div>
            </div>
            <div className="text-xs text-gray-500 leading-relaxed">{t('chat.focusHint')}</div>
          </div>

          {memory && (
            <div className="bg-indigo-50 rounded-2xl border border-indigo-100 p-4">
              <div className="text-xs font-semibold text-indigo-400 uppercase tracking-wide mb-2">
                {lang === 'uk' ? 'Пам\'ять увімкнена' : 'Memory active'}
              </div>
              {memory.last_session && (
                <p className="text-xs text-indigo-700 leading-relaxed line-clamp-3">{memory.last_session}</p>
              )}
              {memory.updated_at && (
                <p className="text-xs text-indigo-300 mt-1.5">
                  {lang === 'uk' ? 'Оновлено' : 'Updated'} {new Date(memory.updated_at).toLocaleDateString()}
                </p>
              )}
            </div>
          )}

          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{t('chat.tryAsking')}</div>
            <div className="flex flex-col gap-2">
              {t('chat.suggestedQuestions').map((q) => (
                <button
                  key={q}
                  onClick={() => handleSend(q)}
                  disabled={loading}
                  className="text-left text-xs text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 px-3 py-2 rounded-xl transition-colors leading-snug"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{t('chat.quickActions')}</div>
            <div className="flex flex-col gap-2">
              <button onClick={() => navigate('/dictionary')} className="text-left text-xs text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 px-3 py-2 rounded-xl transition-colors">{t('chat.openDict')}</button>
              <button onClick={() => navigate('/flashcards')} className="text-left text-xs text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 px-3 py-2 rounded-xl transition-colors">{t('chat.flashcards')}</button>
              <button onClick={() => navigate('/word-choice')} className="text-left text-xs text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 px-3 py-2 rounded-xl transition-colors">{t('chat.multipleChoice')}</button>
            </div>
          </div>
        </aside>

        {/* Chat */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto space-y-4 pb-4 pr-1">
            {messages.map((msg) =>
              msg.role === 'exercise' ? (
                <InlineExercise
                  key={msg.id}
                  msg={msg}
                  onAnswer={handleExerciseAnswer}
                  onSubmit={handleExerciseSubmit}
                />
              ) : (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  onAddWord={handleAddWord}
                  onAcceptPractice={handleAcceptPractice}
                  onDeclinePractice={handleDeclinePractice}
                  onStartAdd={handleStartAdd}
                />
              )
            )}

            {loading && (
              <div className="flex gap-3 items-start">
                <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 text-xs font-bold flex-shrink-0 mt-0.5">
                  AI
                </div>
                <div className="bg-white border border-gray-100 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
                  <div className="flex gap-1 items-center h-5">
                    <span className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce [animation-delay:0ms]" />
                    <span className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce [animation-delay:150ms]" />
                    <span className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Context bar */}
          {(() => {
            const totalChars = messages.reduce((s, m) => s + (m.text || '').length, 0)
            const approxTokens = Math.round(totalChars / 4)
            const contextLimit = 200000
            const pct = Math.min(100, Math.round((approxTokens / contextLimit) * 100))
            const barColor = pct < 50 ? 'bg-emerald-400' : pct < 80 ? 'bg-amber-400' : 'bg-red-400'
            return (
              <div className="flex items-center gap-3 px-1 mb-1 mt-2">
                <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${Math.max(pct, 0.5)}%` }} />
                </div>
                <span className="text-xs text-gray-400 shrink-0 font-mono">{pct}% · Sonnet 4.6</span>
              </div>
            )
          })()}

          {/* Input */}
          <div className="bg-white border border-gray-200 rounded-2xl flex items-end gap-3 px-4 py-3 shadow-sm">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                e.target.style.height = 'auto'
                e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px'
              }}
              onKeyDown={handleKeyDown}
              placeholder={t('chat.inputPlaceholder')}
              rows={1}
              className="flex-1 resize-none text-sm text-gray-800 placeholder-gray-400 outline-none leading-relaxed bg-transparent"
              style={{ maxHeight: '140px' }}
            />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || loading}
              className="flex-shrink-0 w-9 h-9 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-200 disabled:cursor-not-allowed text-white flex items-center justify-center transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 rotate-90">
                <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
              </svg>
            </button>
          </div>
          <p className="text-center text-xs text-gray-400 mt-2">
            {t('chat.sendHint').split('·')[0].replace('Enter', '')}
            <kbd className="bg-gray-100 px-1 rounded">Enter</kbd>
            {' · '}
            <kbd className="bg-gray-100 px-1 rounded">Shift+Enter</kbd>
            {' '}{t('chat.sendHint').split('·')[1]?.trim()}
          </p>
        </div>
      </div>

      {toast && <AddedWordToast word={toast} onDismiss={() => setToast(null)} />}

      {addPanel && (
        <AddToDictModal
          panel={addPanel}
          targetLanguageName={targetLanguageName}
          onToggle={toggleAddItem}
          onThemeChange={setAddTheme}
          onLangChange={setAddLang}
          onToggleAllSenses={toggleAddAllSenses}
          onConfirm={handleConfirmAdd}
          onClose={() => setAddPanel(null)}
          onGoToDictionary={() => navigate('/dictionary')}
        />
      )}
    </div>
  )
}

// ─── Add-to-dictionary modal ──────────────────────────────────────────────────

function AddToDictModal({ panel, targetLanguageName, onToggle, onThemeChange, onLangChange, onToggleAllSenses, onConfirm, onClose, onGoToDictionary }) {
  const { lang } = useLanguage()
  const uk = lang === 'uk'
  const checkedCount = panel.items?.filter(it => it.checked).length ?? 0
  const dismissable = panel.stage !== 'adding'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" onClick={dismissable ? onClose : undefined}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">{uk ? 'Додати до словника' : 'Add to dictionary'}</h2>
          {dismissable && <button onClick={onClose} className="text-gray-300 hover:text-gray-600 text-2xl leading-none">×</button>}
        </div>

        {/* Extracting */}
        {panel.stage === 'extracting' && (
          <div className="px-6 py-12 flex flex-col items-center gap-3">
            <div className="flex gap-1">
              <span className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce [animation-delay:0ms]" />
              <span className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce [animation-delay:300ms]" />
            </div>
            <p className="text-sm text-gray-400">{uk ? 'Шукаю слова…' : 'Finding words…'}</p>
          </div>
        )}

        {(panel.stage === 'empty' || panel.stage === 'error') && (
          <div className="px-6 py-10 text-center">
            <p className="text-sm text-gray-500">
              {panel.stage === 'error'
                ? (uk ? 'Не вдалося опрацювати повідомлення.' : 'Could not process this message.')
                : (uk ? 'У цьому повідомленні немає слів для додавання.' : 'No addable words found in this message.')}
            </p>
            <button onClick={onClose} className="mt-5 px-5 py-2.5 rounded-2xl border border-gray-200 text-sm text-gray-500 hover:bg-gray-50">
              {uk ? 'Закрити' : 'Close'}
            </button>
          </div>
        )}

        {/* Review */}
        {panel.stage === 'review' && (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{uk ? 'Колекція (необов\'язково)' : 'Collection (optional)'}</label>
                <input
                  value={panel.theme}
                  onChange={e => onThemeChange(e.target.value)}
                  placeholder={uk ? 'напр. Відтінки кольорів' : 'e.g. Color shades'}
                  className="mt-1.5 w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-400"
                />
                <p className="text-xs text-gray-400 mt-1.5">{uk ? 'Залиште порожнім, щоб просто додати слова.' : 'Leave empty to just add the words.'}</p>
              </div>

              {/* Translate-to picker — controls the stored translation language */}
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-gray-400">{uk ? 'Перекласти на' : 'Translate to'}</span>
                <div className="flex rounded-full border border-gray-200 overflow-hidden text-xs font-semibold">
                  {[{ code: 'English', label: 'EN' }, { code: 'Ukrainian', label: 'UA' }].map(({ code, label }) => (
                    <button
                      key={code}
                      onClick={() => onLangChange(code)}
                      className={`px-3 py-1 transition-colors ${panel.translationLang === code ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-700'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sense scope */}
              <button onClick={onToggleAllSenses} className="flex items-start gap-2 text-left">
                <span className={`w-4 h-4 mt-0.5 rounded border flex items-center justify-center text-[10px] shrink-0 ${!panel.singleSense ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-300'}`}>
                  {!panel.singleSense && '✓'}
                </span>
                <span className="text-xs text-gray-500 leading-snug">
                  {uk ? 'Додати всі значення кожного слова' : 'Add every meaning of each word'}
                  <span className="block text-gray-400">{uk ? 'За замовчуванням — лише значення, що відповідає темі.' : 'Default: just the sense that fits the theme.'}</span>
                </span>
              </button>

              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">{checkedCount} / {panel.items.length} {uk ? 'вибрано' : 'selected'}</span>
              </div>

              <div className="border border-gray-100 rounded-2xl divide-y divide-gray-50 max-h-72 overflow-y-auto">
                {panel.items.map(it => (
                  <button
                    key={it.id}
                    onClick={() => onToggle(it.id)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${it.checked ? 'bg-indigo-50/60' : 'hover:bg-gray-50'}`}
                  >
                    <span className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] shrink-0 ${it.checked ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-300'}`}>
                      {it.checked && '✓'}
                    </span>
                    <span className="text-sm font-medium text-gray-800">{it.word}</span>
                    {it.translation && <span className="text-xs text-gray-400 truncate">— {it.translation}</span>}
                  </button>
                ))}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
              <button onClick={onClose} className="px-4 py-2.5 rounded-2xl border border-gray-200 text-sm text-gray-500 hover:bg-gray-50">
                {uk ? 'Скасувати' : 'Cancel'}
              </button>
              <button
                onClick={onConfirm}
                disabled={checkedCount === 0}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-200 disabled:cursor-not-allowed text-white rounded-2xl text-sm font-semibold transition-colors"
              >
                {uk ? `Додати ${checkedCount} слів` : `Add ${checkedCount} word${checkedCount !== 1 ? 's' : ''}`}
              </button>
            </div>
          </>
        )}

        {/* Adding */}
        {panel.stage === 'adding' && (
          <div className="px-6 py-10 flex flex-col items-center gap-4">
            <p className="text-sm text-gray-600">
              {uk ? 'Додаю' : 'Adding'} <strong>{panel.progress.current}</strong>…
            </p>
            <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-500 transition-all duration-300" style={{ width: `${Math.round((panel.progress.done / panel.progress.total) * 100)}%` }} />
            </div>
            <p className="text-xs text-gray-400">{panel.progress.done} / {panel.progress.total}</p>
          </div>
        )}

        {/* Done */}
        {panel.stage === 'done' && (
          <div className="px-6 py-10 text-center flex flex-col items-center gap-4">
            <div className="text-4xl">✓</div>
            <div>
              <p className="text-sm font-semibold text-gray-800">
                {uk ? `Додано ${panel.summary.added} слів` : `Added ${panel.summary.added} word${panel.summary.added !== 1 ? 's' : ''}`}
                {panel.summary.theme ? (uk ? ` до «${panel.summary.theme}»` : ` to "${panel.summary.theme}"`) : ''}
              </p>
              {(panel.summary.existed > 0 || panel.summary.failed > 0) && (
                <p className="text-xs text-gray-400 mt-1">
                  {panel.summary.existed > 0 && (uk ? `${panel.summary.existed} вже були у словнику` : `${panel.summary.existed} already in your dictionary`)}
                  {panel.summary.existed > 0 && panel.summary.failed > 0 && ' · '}
                  {panel.summary.failed > 0 && (uk ? `${panel.summary.failed} не вдалося` : `${panel.summary.failed} failed`)}
                </p>
              )}
            </div>
            <div className="flex gap-3 w-full">
              <button onClick={onClose} className="flex-1 py-2.5 rounded-2xl border border-gray-200 text-sm text-gray-500 hover:bg-gray-50">
                {uk ? 'Готово' : 'Done'}
              </button>
              <button onClick={onGoToDictionary} className="flex-1 py-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors">
                {uk ? 'Відкрити словник' : 'Open dictionary'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
