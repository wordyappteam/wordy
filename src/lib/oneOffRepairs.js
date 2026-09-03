// The ten repairs that had to be written by hand, approved by Nika 2026-09-03.
//
// Every other correction in the repair pass is derived from the defect itself.
// These could not be: "Berегти" wants a Б that no letter-swap produces,
// "Fortificована" wants a Ukrainian word chosen for the sentence, "más" hid an
// adjective agreeing with nothing. Someone had to decide, and this is the
// record of what was decided.
//
// Each entry matches on the FULL current text. If a note has changed since, the
// entry simply does not apply and the finding stays open — so this list retires
// itself once run, and can never overwrite work done later.

export const ONE_OFF_REPAIRS = [
  {
    word: 'erhalten', field: 'explanation',
    before: 'Запобігти розпаду, зникненню чи погіршенню. Berегти в гарному стані.',
    after:  'Запобігти розпаду, зникненню чи погіршенню. Берегти в гарному стані.',
    why: 'Latin B and e inside Берегти',
  },
  {
    word: 'die Berliner Mauer', field: 'explanation',
    before: 'Fortificована стіна, збудована 1961 року для розділення комуністичного Сходу й капіталістичного Заходу Берлина. Впала в 1989 році.',
    after:  'Укріплена стіна, збудована 1961 року для розділення комуністичного Сходу й капіталістичного Заходу Берлина. Впала в 1989 році.',
    why: 'Fortificована is not a word in any of the three languages',
  },
  {
    word: 'der Bürger', field: 'usage_note',
    before: 'Відрізняється від Einwohner (житель) — Bürger підкреслює політичні права, Einwohner просто живу́',
    after:  'Відрізняється від Einwohner (житель) — Bürger підкреслює політичні права, Einwohner просто живе там',
    why: 'the note was cut off mid-word, with a stress mark left on it',
  },
  {
    word: 'erhalten', field: 'usage_note',
    before: "Дуже схожа на bekommen (обидва означають 'отримати'), але erhalten más офіційна, формальна; bekommen — повсякденна.",
    after:  "Дуже схоже на bekommen (обидва означають 'отримати'), але erhalten офіційніше, формальніше; bekommen — повсякденне.",
    why: 'Spanish más, and adjectives agreeing with nothing — erhalten is a verb',
  },
  {
    word: 'allgemein', field: 'grammar_note',
    before: 'Attributive: allgemeiner Wunsch; predicative: Das ist allgemein bekannt.',
    after:  'Атрибутивне вживання: allgemeiner Wunsch · предикативне: Das ist allgemein bekannt.',
    why: 'an English note on a sense explained in Ukrainian',
  },
  {
    word: 'diaphragm', field: 'explanation',
    before: 'Тонка куполоподібна чаша з латексу або силікону, яка вставляється у піхву як барierний контрацептив. Потребує застосування спермацидної паста для ефективності.',
    after:  "Тонка куполоподібна чаша з латексу або силікону, яка вставляється у піхву як бар'єрний контрацептив. Потребує застосування спермацидної пасти для ефективності.",
    why: "барierний spliced from two scripts; спермацидної паста in the wrong case",
  },
  {
    word: 'purgatory', field: 'usage_note',
    before: "У розмовному англійській мові використовується метафорично: 'это настоящее чистилище' означає 'це жахлива ситуація'.",
    after:  "У розмовній англійській мові використовується метафорично: 'це справжнє чистилище' означає 'це жахлива ситуація'.",
    why: 'an English word glossed by quoting Russian, and розмовному disagreeing',
  },
  {
    word: 'brazen', field: 'translation',
    before: 'дерзкий, нахабный, безстидний',
    after:  'зухвалий, нахабний, безсоромний',
    why: 'two of the three words were Russian',
  },
  {
    word: 'backlash', field: 'explanation',
    before: 'Різка негативна реакція групи людей на événement, рішення або тренд. Позначає громадський опір або відповідь на щось непопулярне.',
    after:  'Різка негативна реакція групи людей на подію, рішення або тренд. Позначає громадський опір або відповідь на щось непопулярне.',
    why: 'French événement',
  },
  {
    word: 'champagne', field: 'grammar_note',
    before: "Uncountable як колективне: 'champagne is expensive'. Countable: 'two champagnes please'.",
    after:  "Uncountable as a collective: 'champagne is expensive'. Countable: 'two champagnes please'.",
    why: 'Ukrainian spliced into a note whose sense is explained in English',
  },
]

// The one-off written for this sense and field, if its text still matches.
export function oneOffRepair(sense, field) {
  const word = sense.word_form ?? sense.wordForm
  const current = sense[field] ?? sense[field.replace(/_(.)/g, (_, c) => c.toUpperCase())]
  const hit = ONE_OFF_REPAIRS.find((r) => r.word === word && r.field === field && r.before === current)
  return hit ? hit.after : null
}
