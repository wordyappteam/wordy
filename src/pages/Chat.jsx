import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { chatWithTutor } from '../lib/claude'
import { useLanguage } from '../lib/i18n'
import { useAuth } from '../lib/AuthContext'

const GREETINGS = {
  en: `Hi! I'm your German grammar tutor. Ask me anything — grammar rules, tricky sentences, word usage, or anything you've encountered while learning.\n\nI can also help you add new words or phrases directly to your dictionary from our conversation.`,
  uk: `Привіт! Я ваш репетитор з німецької граматики. Запитуйте будь-що — граматичні правила, складні речення, вживання слів або все, що зустріли під час навчання.\n\nЯ також можу допомогти додати нові слова або фрази до вашого словника прямо з нашої розмови.`,
}
function translations_greeting(lang) { return GREETINGS[lang] ?? GREETINGS.en }

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

function MessageBubble({ msg, onAddWord, onAcceptPractice, onDeclinePractice }) {
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
  const { t, lang, switchLang } = useLanguage()
  const { user } = useAuth()
  const interfaceLanguage = lang === 'uk' ? 'Ukrainian' : 'English'

  const [messages, setMessages] = useState(() => {
    try {
      const saved = localStorage.getItem('wordy_chat_history')
      if (saved) return JSON.parse(saved)
    } catch {}
    return [
      {
        id: 0,
        role: 'assistant',
        text: translations_greeting(lang),
        words: [],
        topicKey: null,
        practiceState: null,
      },
    ]
  })
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState(null)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  // Persist chat history to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('wordy_chat_history', JSON.stringify(messages))
    } catch {}
  }, [messages])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  function handleNewChat() {
    const fresh = [
      {
        id: Date.now(),
        role: 'assistant',
        text: translations_greeting(lang),
        words: [],
        topicKey: null,
        practiceState: null,
      },
    ]
    setMessages(fresh)
    localStorage.removeItem('wordy_chat_history')
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

    chatWithTutor([...messages, { role: 'user', text: trimmed }], 'German', interfaceLanguage)
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
      {/* Nav */}
      <nav className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div className="text-xl font-bold text-indigo-600">wordy</div>
        <div className="flex items-center gap-6 text-sm font-medium text-gray-500">
          <button onClick={() => navigate('/dashboard')} className="hover:text-gray-900 transition-colors">{t('nav.dashboard')}</button>
          <button onClick={() => navigate('/dictionary')} className="hover:text-gray-900 transition-colors">{t('nav.dictionary')}</button>
          <button onClick={() => navigate('/dashboard')} className="hover:text-gray-900 transition-colors">{t('nav.exercises')}</button>
          <button className="text-indigo-600">{t('nav.chat')}</button>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleNewChat}
            className="text-xs font-medium text-gray-500 hover:text-gray-800 border border-gray-200 hover:border-gray-300 px-3 py-1.5 rounded-lg transition-colors"
          >
            {t('chat.newChat')}
          </button>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-semibold">
            <button onClick={() => switchLang('en')} className={`px-2.5 py-1 transition-colors ${lang === 'en' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-700'}`}>EN</button>
            <button onClick={() => switchLang('uk')} className={`px-2.5 py-1 transition-colors ${lang === 'uk' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-700'}`}>UA</button>
          </div>
          <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 text-sm font-bold">{(user?.email?.[0] ?? 'U').toUpperCase()}</div>
        </div>
      </nav>

      <div className="flex flex-1 overflow-hidden max-w-5xl mx-auto w-full px-6 py-6 gap-6">
        {/* Sidebar */}
        <aside className="w-64 flex-shrink-0 flex flex-col gap-4">
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{t('chat.currentFocus')}</div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg">🇩🇪</span>
              <div>
                <div className="text-sm font-semibold text-gray-900">German</div>
                <div className="text-xs text-gray-400">B1 · 47 {t('chat.wordsLearned')}</div>
              </div>
            </div>
            <div className="text-xs text-gray-500 leading-relaxed">{t('chat.focusHint')}</div>
          </div>

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
    </div>
  )
}
