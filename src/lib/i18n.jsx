import { createContext, useContext, useState } from 'react'

// ── Translations ──────────────────────────────────────────────────────────────
const translations = {
  en: {
    landing: {
      login:       'Log in',
      getStarted:  'Get started',
      badge:       'AI-powered vocabulary learning',
      headline1:   'Learn words that',
      headlineAccent: 'actually stay',
      headline2:   'with you',
      sub:         'An intelligent app that adapts to how you learn. Build vocabulary in 10+ languages, 300+ words a month — and actually remember them.',
      cta:         'Start learning for free',
      howItWorks:  'See how it works →',
      pills:       ['10+ languages', 'Adaptive exercises', 'Browser extension', 'Personal dictionary', 'Grammar chat', 'Spaced repetition'],
      footer:      'Free for your first month · No credit card required',
    },
    nav: {
      dashboard:  'Dashboard',
      dictionary: 'Dictionary',
      exercises:  'Exercises',
      reader:     'Reader',
      chat:       'Chat',
    },
    dict: {
      title:           'My Dictionary',
      addWord:         '+ Add word',
      entries:         'entries',
      language:        'German',
      searchPlaceholder: 'Search words, phrases or translations…',
      allTypes:        'All types',
      words:           'Words',
      phrases:         'Phrases',
      idioms:          'Idioms',
      phrasalVerbs:    'Phrasal verbs',
      allStatuses:     'All statuses',
      sortByDate:      'Sort by date added',
      sortByWord:      'Sort by word (A–Z)',
      sortByStatus:    'Sort by status',
      sortByType:      'Sort by type',
      dragHint:        'Drag column headers to reorder · Click an entry to open its full card',
      empty:           'Your dictionary is empty — add your first word!',
      noResults:       'No entries found.',
      // columns
      colWord:         'Word / Phrase',
      colKind:         'Kind',
      colForm:         'Form',
      colTranslation:  'Translation',
      colStatus:       'Status',
      colLastReviewed: 'Last reviewed',
      // Passive flip-through, as opposed to the dashboard's graded "Test me".
      flipThrough:     '▶ Flip through',
      // The three sense notes. Each is allowed to be silent — grammar is null for
      // most nouns, the usage note is null for most words.
      // Card controls — these were left in English inside a Ukrainian card.
      addImage:        '+ Add image',
      uploading:       'Uploading…',
      replaceImage:    'Replace',
      removeImage:     'Remove',
      newCollection:   '+ New',
      identifyWithAi:  'Identify with AI',
      identifying:     'Identifying…',
      reidentifyIn:    'Re-identify in',
      meaning:         'Meaning',
      grammar:         'Grammar',
      goodToKnow:      'Good to know',
      deleteSense:     'Delete this sense',
      deleteWord:      'Delete word',
      // Page-level controls (toolbar, modals) — the last English in the Ukrainian UI.
      translateTo:     'Translate to',
      importList:      'Import list',
      sortWords:       'Sort words',
      allWords:        'All words',
      manage:          'Manage',
      allIdentified:   'All words are already identified!',
      // Target-language names, shown under "My dictionary"
      langGerman:      'German',
      langEnglish:     'English',
      langUkrainian:   'Ukrainian',
      done:            'Done',
      noTranslation:   'No translation yet',
      identifyUnidentified: 'Identify unidentified words',
      wordsToIdentify: 'Words to identify',
      bulkImport:      'Bulk import words',
      collectionsTitle:'Collections',
      newCollectionTitle: 'New collection',
      colorLabel:      'Color',
      suggestWithAi:   'Suggest with AI',
      finding:         'Finding…',
      identifyAll:     'Identify all',
      select:          'Select',
      deleteBtn:       'Delete',
      // status labels
      statusNew:       'new',
      statusLearning:  'learning',
      statusKnown:     'known',
      statusMastered:  'mastered',
      // add modal
      modalTitle:      'Add to dictionary',
      typePlaceholder: 'Type a word, phrase, or any form…',
      typeHint:        'Type anything — an inflected form, a full phrase, even a phrasal verb. AI will find the base form and entry type.',
      identify:        'Identify',
      cancel:          'Cancel',
      aiIdentified:    'AI identified',
      addToDictBtn:    'Add to dictionary',
      identifyError:   "Could not identify the word. Check your connection and try again.",
      busyError:       "The AI is busy right now. Please try again in a moment.",
      notFound:        "That is not a word in the language you are learning.",
      notFoundHint:    "Check the spelling, or switch your learning language.",
      didYouMean:      "Did you mean",
      // panel
      translation:     'Translation',
      pronounce:       '🔈 Pronounce',
      explanation:     'Explanation',
      grammarNote:     'Grammar note',
      examples:        'Example sentences',
      examplesVerb:    'Example sentences (present & past)',
      conjugation:     'Conjugation',
      pronoun:         'Pronoun',
      auxiliary:       'Auxiliary',
      practiceWord:    'Practice this word',
      edit:            'Edit',
      editingLabel:    'editing',
      exception:       '⚠ exception',
      saveChanges:     'Save changes',
      examplesNote:    'Example sentences are generated by AI — editing them will be available in a future update.',
      deleteConfirm:   'Remove this word from your dictionary?',
      deleteSenseConfirm: 'Delete this sense only?',
      deleteConfirmBtn:'Delete',
    },
    chat: {
      currentFocus:    'Current focus',
      wordsLearned:    'words learned',
      focusHint:       'Ask about grammar, word usage, or anything from today\'s exercises.',
      tryAsking:       'Try asking',
      quickActions:    'Quick actions',
      openDict:        '📖 Open dictionary',
      flashcards:      '🃏 Practice flashcards',
      multipleChoice:  '🎯 Multiple choice',
      inputPlaceholder:'Ask about grammar, a word, or anything you\'re unsure about…',
      sendHint:        'Press Enter to send · Shift+Enter for new line',
      wordsToAdd:      'Words mentioned — add to dictionary?',
      addToDict:       'Add words to dictionary',
      practiceOffer:   'Want to practise this? I can make a quick exercise for you right here. 🎯',
      yesLetsGo:       'Yes, let\'s go!',
      maybeLater:      'Maybe later',
      declinedNote:    'No problem — ask me anything else whenever you\'re ready.',
      connectError:    'Sorry, I could not connect to the AI right now. Please try again.',
      addedToDict:     'added to your dictionary',
      checkAnswers:    'Check my answers →',
      answerAll:       (n) => `Answer all ${n} questions to continue`,
      perfect:         '— Perfect! 🎉',
      goodWork:        '— Good work! Keep going.',
      reviewMore:      '— Review the explanations above and try again.',
      questions:       'questions',
      newChat:         'New chat',
      greeting:        `Hi! I'm your German grammar tutor. Ask me anything — grammar rules, tricky sentences, word usage, or anything you've encountered while learning.\n\nI can also help you add new words or phrases directly to your dictionary from our conversation.`,
      suggestedQuestions: [
        'When do I use haben vs. sein in Perfekt?',
        'Explain Konjunktiv II with examples',
        'How do German cases work?',
        'When do I use reflexive verbs?',
        'What determines noun gender in German?',
      ],
    },
  },

  uk: {
    landing: {
      login:          'Увійти',
      getStarted:     'Почати',
      badge:          'Навчання лексики за допомогою AI',
      headline1:      'Вивчайте слова, які',
      headlineAccent: 'справді залишаються',
      headline2:      'з вами',
      sub:            'Розумний застосунок, що адаптується до вашого стилю навчання. Будуйте словниковий запас у 10+ мовах, 300+ слів на місяць — і справді їх запамʼятовуйте.',
      cta:            'Почати навчання безкоштовно',
      howItWorks:     'Як це працює →',
      pills:          ['10+ мов', 'Адаптивні вправи', 'Розширення браузера', 'Особистий словник', 'Граматичний чат', 'Інтервальне повторення'],
      footer:         'Перший місяць безкоштовно · Без кредитної картки',
    },
    nav: {
      dashboard:  'Головна',
      dictionary: 'Словник',
      exercises:  'Вправи',
      reader:     'Читанка',
      chat:       'Чат',
    },
    dict: {
      title:           'Мій словник',
      addWord:         '+ Додати слово',
      entries:         'записів',
      language:        'Німецька',
      searchPlaceholder: 'Пошук слів, фраз або перекладів…',
      allTypes:        'Всі типи',
      words:           'Слова',
      phrases:         'Фрази',
      idioms:          'Ідіоми',
      phrasalVerbs:    'Фразові дієслова',
      allStatuses:     'Всі статуси',
      sortByDate:      'За датою',
      sortByWord:      'За алфавітом',
      sortByStatus:    'За статусом',
      sortByType:      'За типом',
      dragHint:        'Перетягніть заголовки для зміни порядку · Натисніть на запис для деталей',
      empty:           'Ваш словник порожній — додайте перше слово!',
      noResults:       'Нічого не знайдено.',
      // columns
      colWord:         'Слово / Фраза',
      colKind:         'Тип',
      colForm:         'Форма',
      colTranslation:  'Переклад',
      colStatus:       'Статус',
      colLastReviewed: 'Останній огляд',
      flipThrough:     '▶ Переглянути картки',
      addImage:        '+ Додати зображення',
      uploading:       'Завантаження…',
      replaceImage:    'Замінити',
      removeImage:     'Видалити',
      newCollection:   '+ Нова',
      identifyWithAi:  'Розпізнати з AI',
      identifying:     'Розпізнаю…',
      reidentifyIn:    'Перерозпізнати:',
      meaning:         'Значення',
      grammar:         'Граматика',
      goodToKnow:      'Варто знати',
      deleteSense:     'Видалити цей сенс',
      deleteWord:      'Видалити слово',
      translateTo:     'Перекласти на',
      importList:      'Імпортувати список',
      sortWords:       'Сортувати слова',
      allWords:        'Усі слова',
      manage:          'Керувати',
      allIdentified:   'Усі слова вже розпізнані!',
      langGerman:      'Німецька',
      langEnglish:     'Англійська',
      langUkrainian:   'Українська',
      done:            'Готово',
      noTranslation:   'Ще немає перекладу',
      identifyUnidentified: 'Розпізнати нерозпізнані слова',
      wordsToIdentify: 'Слова для розпізнавання',
      bulkImport:      'Масовий імпорт слів',
      collectionsTitle:'Колекції',
      newCollectionTitle: 'Нова колекція',
      colorLabel:      'Колір',
      suggestWithAi:   'Запропонувати з AI',
      finding:         'Шукаю…',
      identifyAll:     'Розпізнати всі',
      select:          'Обрати',
      deleteBtn:       'Видалити',
      // status labels
      statusNew:       'нове',
      statusLearning:  'вивчаю',
      statusKnown:     'знаю',
      statusMastered:  'засвоїв',
      // add modal
      modalTitle:      'Додати до словника',
      typePlaceholder: 'Введіть слово, фразу або будь-яку форму…',
      typeHint:        'Введіть будь-що — відмінену форму, фразу або фразове дієслово. AI знайде базову форму та тип.',
      identify:        'Визначити',
      cancel:          'Скасувати',
      aiIdentified:    'AI визначив',
      addToDictBtn:    'Додати до словника',
      identifyError:   "Не вдалося визначити слово. Перевірте з'єднання та спробуйте ще раз.",
      busyError:       "AI зараз зайнятий. Будь ласка, спробуйте ще раз за хвилинку.",
      notFound:        "Такого слова немає в мові, яку ви вивчаєте.",
      notFoundHint:    "Перевірте написання або змініть мову вивчення.",
      didYouMean:      "Можливо, ви мали на увазі",
      // panel
      translation:     'Переклад',
      pronounce:       '🔈 Вимовити',
      explanation:     'Пояснення',
      grammarNote:     'Граматична нотатка',
      examples:        'Приклади речень',
      examplesVerb:    'Приклади речень (теп. і мин. час)',
      conjugation:     'Відмінювання',
      pronoun:         'Займенник',
      auxiliary:       'Допом. дієслово',
      practiceWord:    'Практикувати',
      edit:            'Редагувати',
      editingLabel:    'редагування',
      exception:       '⚠ виняток',
      saveChanges:     'Зберегти',
      examplesNote:    'Приклади речень генеруються AI — редагування буде доступне в майбутньому.',
      deleteConfirm:   'Видалити це слово зі словника?',
      deleteSenseConfirm: 'Видалити лише це значення?',
      deleteConfirmBtn:'Видалити',
    },
    chat: {
      currentFocus:    'Поточна мова',
      wordsLearned:    'слів вивчено',
      focusHint:       'Запитуйте про граматику, вживання слів або що вас цікавить.',
      tryAsking:       'Запитайте, наприклад',
      quickActions:    'Швидкі дії',
      openDict:        '📖 Відкрити словник',
      flashcards:      '🃏 Флеш-картки',
      multipleChoice:  '🎯 Тест',
      inputPlaceholder:'Запитайте про граматику, слово або що вас цікавить…',
      sendHint:        'Натисніть Enter, щоб надіслати · Shift+Enter для нового рядка',
      wordsToAdd:      'Згадані слова — додати до словника?',
      addToDict:       'Додати слова до словника',
      practiceOffer:   'Хочете попрактикуватись? Можу зробити коротку вправу прямо тут. 🎯',
      yesLetsGo:       'Так, давайте!',
      maybeLater:      'Може пізніше',
      declinedNote:    'Без проблем — запитуйте будь-коли.',
      connectError:    'Не вдалося з\'єднатися з AI. Спробуйте ще раз.',
      addedToDict:     'додано до словника',
      checkAnswers:    'Перевірити відповіді →',
      answerAll:       (n) => `Дайте відповідь на всі ${n} запитань`,
      perfect:         '— Чудово! 🎉',
      goodWork:        '— Молодець! Продовжуйте.',
      reviewMore:      '— Перегляньте пояснення та спробуйте ще.',
      questions:       'запитань',
      newChat:         'Новий чат',
      greeting:        `Привіт! Я ваш репетитор з німецької граматики. Запитуйте будь-що — граматичні правила, складні речення, вживання слів або все, що зустріли під час навчання.\n\nЯ також можу допомогти додати нові слова або фрази до вашого словника прямо з нашої розмови.`,
      suggestedQuestions: [
        'Коли вживати haben, а коли sein у Perfekt?',
        'Поясніть Konjunktiv II з прикладами',
        'Як працюють відмінки в німецькій?',
        'Коли вживати зворотні дієслова?',
        'Як визначити рід іменника в німецькій?',
      ],
    },
  },
}

// ── Context ───────────────────────────────────────────────────────────────────
const LanguageContext = createContext()

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(
    () => localStorage.getItem('wordy_lang') || 'en'
  )

  function switchLang(l) {
    setLang(l)
    localStorage.setItem('wordy_lang', l)
  }

  // t('dict.title') → looks up translations[lang].dict.title
  function t(path) {
    const keys = path.split('.')
    let val = translations[lang]
    for (const k of keys) val = val?.[k]
    return val ?? path
  }

  return (
    <LanguageContext.Provider value={{ lang, switchLang, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  return useContext(LanguageContext)
}

// Ukrainian-interface helpers: render the target language name in the right
// grammatical form (e.g. "по-українськи", "української") for any target.
export function targetAdverbUk(name) {
  return name === 'German' ? 'по-німецьки' : name === 'Ukrainian' ? 'по-українськи' : 'по-англійськи'
}

export function targetGenitiveUk(name) {
  return name === 'German' ? 'німецької' : name === 'Ukrainian' ? 'української' : 'англійської'
}
