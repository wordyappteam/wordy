import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { identifyWord as identifyWordAI } from '../lib/claude'
import { useLanguage } from '../lib/i18n'
import { useTargetLang } from '../lib/TargetLangContext'
import NavBar from '../components/NavBar'

// ── Helpers ───────────────────────────────────────────────────────────────
// Normalize noun form to full plural without article
// Handles: "Krankheiten" → "Krankheiten", "-en (plural: ...)" → derive from word, "-en" → derive from word
function cleanForm(form, baseWord) {
  if (!form) return form
  // Strip old "(plural: ...)" redundancy
  form = form.replace(/\s*\(plural:[^)]*\)/gi, '').trim()
  // If it's a dash-ending like "-en", derive full plural from the noun stem
  if (/^-\S/.test(form) && baseWord) {
    const stem = baseWord.replace(/^(der|die|das)\s+/i, '').trim()
    const suffix = form.slice(1) // remove leading "-"
    return stem + suffix
  }
  // Strip leading article if present (e.g. "die Krankheiten" → "Krankheiten")
  return form.replace(/^(der|die|das)\s+/i, '').trim()
}

// Determine case badge for prep verbs
// Priority: fixed-case prepositions → grammarNote → default Akk for common two-way preps
const PREP_ALWAYS_AKK = new Set(['für','gegen','ohne','um','durch','bis'])
const PREP_ALWAYS_DAT = new Set(['mit','von','nach','bei','zu','aus','seit','ab'])
const PREP_DEFAULT_AKK = new Set(['auf','über','an','in']) // two-way but Akk in most verb phrases

function extractCaseBadge(w) {
  if (w.pos !== 'verb') return null
  const tokens = w.word.toLowerCase().split(/\s+/)
  const AKK = { label: '+A', cls: 'bg-blue-50 text-blue-500 border-blue-100' }
  const DAT = { label: '+D', cls: 'bg-amber-50 text-amber-600 border-amber-100' }

  for (const t of tokens) {
    if (PREP_ALWAYS_AKK.has(t)) return AKK
    if (PREP_ALWAYS_DAT.has(t)) return DAT
  }

  // Two-way prepositions: trust grammarNote if available, else default to Akk
  const note = (w.grammarNote || '').toLowerCase()
  const hasTwoWay = tokens.some(t => PREP_DEFAULT_AKK.has(t))
  if (hasTwoWay) {
    if (note.includes('dativ'))     return DAT
    if (note.includes('akkusativ')) return AKK
    return AKK // safe default — most verb phrases with auf/über/an/in take Akk
  }

  return null
}

// ── DB ↔ Frontend mapping ─────────────────────────────────────────────────
function dbToWord(row, examples = []) {
  return {
    id: row.id,
    entryType: row.entry_type,
    word: row.word,
    form: row.form,
    pos: row.pos,
    translation: row.translation,
    status: row.status,
    dateAdded: row.date_added,
    source: row.source,
    lastReviewed: row.last_reviewed,
    explanation: row.explanation,
    grammarNote: row.grammar_note,
    isException: row.is_exception,
    conjugation: row.conjugation || null,
    examples: examples.map((ex) => ({
      target:      ex.sentence_target,
      translation: ex.sentence_translation,
      tense:       ex.tense,
    })),
  }
}

function wordToDb(word, userId, targetLang = 'de') {
  return {
    user_id: userId,
    word: word.word,
    form: word.form || null,
    pos: word.pos,
    entry_type: word.entryType,
    translation: word.translation,
    grammar_note: word.grammarNote || null,
    explanation: word.explanation || null,
    is_exception: word.isException || false,
    conjugation: word.conjugation || null,
    status: word.status || 'new',
    source: word.source || 'manual',
    date_added: word.dateAdded || new Date().toISOString().slice(0, 10),
    last_reviewed: word.lastReviewed || '—',
    target_language: targetLang,
  }
}

// entryType: 'word' | 'phrase' | 'idiom' | 'phrasal-verb'
const INITIAL_WORDS = [
  {
    id: 1, entryType: 'word',
    word: 'scheitern', form: 'gescheitert', pos: 'verb',
    translation: 'to fail, to fall through',
    status: 'learning', dateAdded: '2026-05-08', source: 'manual', lastReviewed: '2026-05-10',
    explanation: 'Used when something collapses or falls through entirely — a plan, a relationship, a negotiation. Stronger and more final than simply "nicht klappen".',
    grammarNote: 'Auxiliary: sein · gescheitert (not haben)',
    isException: false,
    examples: [
      { de: 'Die Verhandlungen scheitern oft an Kleinigkeiten.', en: 'Negotiations often fail over small things.', tense: 'present' },
      { de: 'Sein erster Versuch ist gescheitert.', en: 'His first attempt has failed.', tense: 'past' },
      { de: 'Das Projekt scheiterte an fehlendem Budget.', en: 'The project failed due to a lack of budget.', tense: 'past' },
    ],
  },
  {
    id: 2, entryType: 'word',
    word: 'die Sehnsucht', form: '-süchte', pos: 'noun',
    translation: 'longing, yearning',
    status: 'known', dateAdded: '2026-05-07', source: 'flashcard', lastReviewed: '2026-05-10',
    explanation: 'A profound, often melancholic longing for something distant or unattainable. Deeply embedded in German culture and literature.',
    grammarNote: 'feminine · die Sehnsucht · plural rare (die Sehnsüchte)',
    isException: false,
    examples: [
      { de: 'Er spürt eine tiefe Sehnsucht nach seiner Kindheit.', en: 'He feels a deep longing for his childhood.', tense: null },
      { de: 'Die Sehnsucht nach Freiheit treibt sie an.', en: 'The yearning for freedom drives her forward.', tense: null },
      { de: 'In seinen Liedern steckt viel Sehnsucht.', en: 'His songs are full of longing.', tense: null },
    ],
  },
  {
    id: 3, entryType: 'word',
    word: 'erreichen', form: 'erreicht', pos: 'verb',
    translation: 'to reach, to achieve',
    status: 'learning', dateAdded: '2026-05-06', source: 'browser', lastReviewed: '2026-05-09',
    explanation: 'Can mean physically reaching a place, contacting someone, or achieving a goal. Very versatile — one of the most common verbs in professional and academic German.',
    grammarNote: 'Auxiliary: haben · erreicht',
    isException: false,
    examples: [
      { de: 'Wir erreichen das Ziel nur durch Zusammenarbeit.', en: 'We can only reach the goal through cooperation.', tense: 'present' },
      { de: 'Sie hat ihren Traumjob endlich erreicht.', en: 'She has finally achieved her dream job.', tense: 'past' },
      { de: 'Der Zug erreichte den Bahnhof pünktlich.', en: 'The train reached the station on time.', tense: 'past' },
    ],
  },
  {
    id: 4, entryType: 'word',
    word: 'trotzdem', form: null, pos: 'adverb',
    translation: 'nevertheless, still, anyway',
    status: 'known', dateAdded: '2026-05-05', source: 'manual', lastReviewed: '2026-05-09',
    explanation: 'Expresses contrast — something happens despite an obstacle. More conversational than "dennoch." When used to start a clause, the verb immediately follows.',
    grammarNote: 'Triggers verb inversion when used as a connective adverb',
    isException: false,
    examples: [
      { de: 'Es regnet, aber wir gehen trotzdem spazieren.', en: 'It is raining, but we are going for a walk anyway.', tense: null },
      { de: 'Trotzdem entschied sie sich zu bleiben.', en: 'Nevertheless, she decided to stay.', tense: null },
      { de: 'Er wusste es besser, handelte trotzdem falsch.', en: 'He knew better, yet he acted wrongly.', tense: null },
    ],
  },
  {
    id: 5, entryType: 'word',
    word: 'das Heimweh', form: null, pos: 'noun',
    translation: 'homesickness',
    status: 'new', dateAdded: '2026-05-10', source: 'chat', lastReviewed: '—',
    explanation: 'Literally "home-pain." Neuter gender, no plural. Used with "haben" (to have) or "bekommen" (to get).',
    grammarNote: 'neuter · no plural · Heimweh haben / bekommen',
    isException: false,
    examples: [
      { de: 'Nach zwei Wochen bekommt er immer Heimweh.', en: 'After two weeks he always gets homesick.', tense: null },
      { de: 'Das Heimweh war stärker als erwartet.', en: 'The homesickness was stronger than expected.', tense: null },
      { de: 'Sie hatte großes Heimweh nach ihrer Familie.', en: 'She was very homesick for her family.', tense: null },
    ],
  },
  {
    id: 6, entryType: 'word',
    word: 'begeistert', form: 'mehr begeistert', pos: 'adjective',
    translation: 'enthusiastic, excited, thrilled',
    status: 'learning', dateAdded: '2026-05-04', source: 'flashcard', lastReviewed: '2026-05-08',
    explanation: 'Describes strong, genuine enthusiasm. Can be used predicatively (after sein) or attributively (before a noun). Often paired with "von".',
    grammarNote: 'begeistert von + Dativ · begeistert sein',
    isException: false,
    examples: [
      { de: 'Die Kinder sind von dem Film begeistert.', en: 'The children are thrilled by the film.', tense: null },
      { de: 'Er war so begeistert, dass er kaum schlafen konnte.', en: 'He was so excited that he could barely sleep.', tense: null },
      { de: 'Sie spricht mit begeisterter Stimme über das Thema.', en: 'She speaks about the topic with an enthusiastic voice.', tense: null },
    ],
  },
  {
    id: 7, entryType: 'word',
    word: 'sich erinnern an', form: 'erinnert sich', pos: 'verb',
    translation: 'to remember (something/someone)',
    status: 'new', dateAdded: '2026-05-10', source: 'manual', lastReviewed: '—',
    explanation: 'A reflexive verb — always requires a reflexive pronoun. The thing or person remembered is introduced with "an + Akkusativ." The preposition "an" is fixed and cannot be replaced.',
    grammarNote: '⚠ reflexive · sich erinnern an + Akkusativ · auxiliary: haben',
    isException: true,
    examples: [
      { de: 'Ich erinnere mich gut an unseren ersten Tag.', en: 'I remember our first day well.', tense: 'present' },
      { de: 'Er hat sich an ihren Namen nicht erinnert.', en: 'He did not remember her name.', tense: 'past' },
      { de: 'Wir erinnern uns an jeden Moment dieser Reise.', en: 'We remember every moment of that trip.', tense: 'present' },
    ],
  },
  {
    id: 8, entryType: 'word',
    word: 'plötzlich', form: null, pos: 'adverb',
    translation: 'suddenly, all of a sudden',
    status: 'known', dateAdded: '2026-05-03', source: 'browser', lastReviewed: '2026-05-07',
    explanation: 'Describes something that happens without warning. Common in both spoken and written German. Can also be used as an adjective before a noun.',
    grammarNote: 'adverb / attributive adjective · very common in narrative',
    isException: false,
    examples: [
      { de: 'Plötzlich fängt es an zu regnen.', en: 'Suddenly it starts to rain.', tense: null },
      { de: 'Das Licht ging plötzlich aus.', en: 'The light went out all of a sudden.', tense: null },
      { de: 'Ein plötzlicher Knall ließ alle erschrecken.', en: 'A sudden bang made everyone jump.', tense: null },
    ],
  },
  {
    id: 9, entryType: 'word',
    word: 'der Mut', form: null, pos: 'noun',
    translation: 'courage, bravery',
    status: 'mastered', dateAdded: '2026-05-01', source: 'flashcard', lastReviewed: '2026-05-10',
    explanation: 'Inner courage or resolve — the strength to do something difficult or frightening.',
    grammarNote: 'masculine · no plural · Mut haben / fassen / zeigen',
    isException: false,
    examples: [
      { de: 'Es braucht Mut, die Wahrheit zu sagen.', en: 'It takes courage to tell the truth.', tense: null },
      { de: 'Sie fasste Mut und bat ihn um Hilfe.', en: 'She gathered her courage and asked him for help.', tense: null },
      { de: 'Der Mut der Feuerwehrleute war beeindruckend.', en: 'The bravery of the firefighters was impressive.', tense: null },
    ],
  },
  {
    id: 10, entryType: 'word',
    word: 'wunderschön', form: 'wunderschöner', pos: 'adjective',
    translation: 'beautiful, gorgeous, wonderful',
    status: 'learning', dateAdded: '2026-05-06', source: 'manual', lastReviewed: '2026-05-09',
    explanation: 'A compound of Wunder (wonder) and schön (beautiful). Stronger than schön — implies awe or delight.',
    grammarNote: 'comparative: wunderschöner · superlative: am wunderschönsten',
    isException: false,
    examples: [
      { de: 'Der Sonnenuntergang heute Abend ist wunderschön.', en: 'The sunset this evening is gorgeous.', tense: null },
      { de: 'Es war ein wunderschöner Sommertag.', en: 'It was a beautiful summer day.', tense: null },
      { de: 'Sie trägt ein wunderschönes Kleid.', en: 'She is wearing a beautiful dress.', tense: null },
    ],
  },
  {
    id: 11, entryType: 'word',
    word: 'obwohl', form: null, pos: 'conjunction',
    translation: 'although, even though',
    status: 'known', dateAdded: '2026-05-02', source: 'flashcard', lastReviewed: '2026-05-08',
    explanation: 'A subordinating conjunction that introduces a concessive clause. Sends the conjugated verb to the end of its clause.',
    grammarNote: '⚠ subordinating conjunction · verb moves to end of clause',
    isException: true,
    examples: [
      { de: 'Obwohl er müde ist, arbeitet er weiter.', en: 'Although he is tired, he keeps working.', tense: null },
      { de: 'Sie lächelte, obwohl sie traurig war.', en: 'She smiled even though she was sad.', tense: null },
      { de: 'Obwohl es spät war, gingen wir noch spazieren.', en: 'Even though it was late, we still went for a walk.', tense: null },
    ],
  },
  {
    id: 12, entryType: 'word',
    word: 'die Entscheidung', form: '-en', pos: 'noun',
    translation: 'decision, choice',
    status: 'learning', dateAdded: '2026-05-05', source: 'chat', lastReviewed: '2026-05-09',
    explanation: 'From entscheiden (to decide). Used for both small and life-changing decisions.',
    grammarNote: 'feminine · die Entscheidung · plural: die Entscheidungen',
    isException: false,
    examples: [
      { de: 'Es ist eine schwierige Entscheidung.', en: 'It is a difficult decision.', tense: null },
      { de: 'Er hat eine wichtige Entscheidung getroffen.', en: 'He made an important decision.', tense: null },
      { de: 'Die Entscheidung lag bei ihr.', en: 'The decision was hers to make.', tense: null },
    ],
  },
  // ── Phrases ──────────────────────────────────────────────────────────────
  {
    id: 13, entryType: 'phrase',
    word: 'eine Entscheidung treffen', form: 'trifft / traf / getroffen', pos: 'verb',
    translation: 'to make a decision',
    status: 'learning', dateAdded: '2026-05-11', source: 'manual', lastReviewed: '—',
    explanation: 'Fixed collocation — you cannot say "eine Entscheidung machen." The verb "treffen" (to hit, to meet) is used here in an idiomatic sense: to arrive at a decision.',
    grammarNote: '⚠ fixed phrase · treffen is irregular: trifft / traf / hat getroffen',
    isException: true,
    examples: [
      { de: 'Ich muss eine wichtige Entscheidung treffen.', en: 'I have to make an important decision.', tense: 'present' },
      { de: 'Sie hat gestern eine schwierige Entscheidung getroffen.', en: 'She made a difficult decision yesterday.', tense: 'past' },
      { de: 'Wer trifft hier die Entscheidungen?', en: 'Who makes the decisions here?', tense: 'present' },
    ],
  },
  {
    id: 14, entryType: 'phrase',
    word: 'Heimweh haben', form: 'hatte / gehabt', pos: 'verb',
    translation: 'to be homesick',
    status: 'new', dateAdded: '2026-05-11', source: 'manual', lastReviewed: '—',
    explanation: 'Fixed collocation — Heimweh is always used with "haben" (to have) or "bekommen" (to get/develop). You cannot say "Heimweh sein."',
    grammarNote: 'fixed phrase · Heimweh haben / bekommen · auxiliary: haben',
    isException: false,
    examples: [
      { de: 'Sie hat seit Wochen Heimweh.', en: 'She has been homesick for weeks.', tense: 'present' },
      { de: 'Er hatte so starkes Heimweh, dass er früher zurückfuhr.', en: 'He was so homesick that he went back earlier.', tense: 'past' },
      { de: 'Bekommst du auch manchmal Heimweh?', en: 'Do you sometimes get homesick too?', tense: 'present' },
    ],
  },
  {
    id: 15, entryType: 'idiom',
    word: 'den Mut zusammennehmen', form: 'nimmt zusammen / nahm zusammen / zusammengenommen', pos: 'verb',
    translation: 'to gather one\'s courage, to pluck up courage',
    status: 'new', dateAdded: '2026-05-11', source: 'manual', lastReviewed: '—',
    explanation: 'Idiomatic expression. Literally "to take one\'s courage together." Used when someone has to overcome fear or hesitation before doing something difficult.',
    grammarNote: 'separable verb idiom · zusammennehmen · auxiliary: haben',
    isException: false,
    examples: [
      { de: 'Sie nimmt all ihren Mut zusammen und fragt ihn.', en: 'She gathers all her courage and asks him.', tense: 'present' },
      { de: 'Er nahm den Mut zusammen und sprach vor dem Publikum.', en: 'He plucked up the courage and spoke before the audience.', tense: 'past' },
      { de: 'Nimm deinen Mut zusammen — du schaffst das!', en: 'Gather your courage — you can do it!', tense: 'present' },
    ],
  },
]

// ── Simulated AI identification ───────────────────────────────────────────
// In production this calls the Claude API. Here we simulate common inputs.
const AI_LOOKUP = {
  'eine entscheidung treffen': {
    word: 'eine Entscheidung treffen', form: 'trifft / traf / getroffen',
    pos: 'verb', entryType: 'phrase', translation: 'to make a decision',
    grammarNote: '⚠ fixed phrase · treffen is irregular: trifft / traf / hat getroffen',
    explanation: 'Fixed collocation — you cannot say "eine Entscheidung machen." The verb treffen is used idiomatically here.',
  },
  'entscheidung treffen': {
    word: 'eine Entscheidung treffen', form: 'trifft / traf / getroffen',
    pos: 'verb', entryType: 'phrase', translation: 'to make a decision',
    grammarNote: '⚠ fixed phrase · treffen is irregular',
    explanation: 'Fixed collocation for "to make a decision."',
  },
  'heimweh haben': {
    word: 'Heimweh haben', form: 'hatte / gehabt',
    pos: 'verb', entryType: 'phrase', translation: 'to be homesick',
    grammarNote: 'fixed phrase · Heimweh haben / bekommen',
    explanation: 'Heimweh is always used with haben or bekommen — never "Heimweh sein."',
  },
  'traf': {
    word: 'treffen', form: 'trifft / traf / getroffen',
    pos: 'verb', entryType: 'word', translation: 'to meet; to hit; to make (a decision)',
    grammarNote: '⚠ irregular · trifft / traf / hat getroffen',
    explanation: '"traf" is the simple past (Präteritum) of treffen. Base form: treffen.',
  },
  'getroffen': {
    word: 'treffen', form: 'trifft / traf / getroffen',
    pos: 'verb', entryType: 'word', translation: 'to meet; to hit; to make (a decision)',
    grammarNote: '⚠ irregular · trifft / traf / hat getroffen',
    explanation: '"getroffen" is the Partizip II of treffen. Used in Perfekt: hat getroffen.',
  },
  'gescheitert': {
    word: 'scheitern', form: 'scheitert / scheiterte / gescheitert',
    pos: 'verb', entryType: 'word', translation: 'to fail, to fall through',
    grammarNote: 'Auxiliary: sein · ist gescheitert',
    explanation: '"gescheitert" is the Partizip II of scheitern. Base form: scheitern.',
  },
  'den mut zusammennehmen': {
    word: 'den Mut zusammennehmen', form: 'nimmt zusammen / nahm zusammen / zusammengenommen',
    pos: 'verb', entryType: 'idiom', translation: 'to gather one\'s courage, to pluck up courage',
    grammarNote: 'separable verb idiom · auxiliary: haben',
    explanation: 'Idiomatic expression. Literally "to take one\'s courage together."',
  },
  'give up': {
    word: 'give up', form: 'gives up / gave up / given up',
    pos: 'verb', entryType: 'phrasal-verb', translation: 'to stop trying; to quit; to surrender',
    grammarNote: 'separable phrasal verb · give sth up / give up on sth',
    explanation: '"Give up" can mean to stop an activity, to quit trying, or to surrender something.',
  },
  'look after': {
    word: 'look after', form: 'looks after / looked after',
    pos: 'verb', entryType: 'phrasal-verb', translation: 'to take care of, to look after',
    grammarNote: 'inseparable phrasal verb · look after sb/sth',
    explanation: '"Look after" means to take care of someone or something. Cannot be separated.',
  },
}

function identifyWord(input) {
  const key = input.trim().toLowerCase()
  if (AI_LOOKUP[key]) return AI_LOOKUP[key]
  // Generic fallback — in production Claude API handles this
  return {
    word: input.trim(),
    form: null,
    pos: 'noun',
    entryType: 'word',
    translation: '',
    grammarNote: '',
    explanation: '',
  }
}

// ── Styles ────────────────────────────────────────────────────────────────
const POS_STYLES = {
  verb:        { label: 'verb',  className: 'bg-violet-50 text-violet-700 border border-violet-200' },
  noun:        { label: 'noun',  className: 'bg-blue-50 text-blue-700 border border-blue-200' },
  adjective:   { label: 'adj.', className: 'bg-amber-50 text-amber-700 border border-amber-200' },
  adverb:      { label: 'adv.', className: 'bg-teal-50 text-teal-700 border border-teal-200' },
  conjunction: { label: 'conj.',className: 'bg-rose-50 text-rose-700 border border-rose-200' },
  preposition: { label: 'prep.',className: 'bg-gray-100 text-gray-600 border border-gray-200' },
}

const ENTRY_TYPE_STYLES = {
  word:          null, // no extra badge — POS badge is enough
  phrase:        { label: 'phrase',        className: 'bg-indigo-50 text-indigo-700 border border-indigo-200' },
  idiom:         { label: 'idiom',         className: 'bg-orange-50 text-orange-700 border border-orange-200' },
  'phrasal-verb':{ label: 'phrasal verb',  className: 'bg-cyan-50 text-cyan-700 border border-cyan-200' },
}

const STATUS_COLORS = {
  new:      'bg-gray-100 text-gray-500',
  learning: 'bg-yellow-50 text-yellow-700',
  known:    'bg-green-50 text-green-700',
  mastered: 'bg-indigo-50 text-indigo-700',
}

const TENSE_LABELS = {
  present: { label: 'present', className: 'bg-blue-50 text-blue-600 border border-blue-100' },
  past:    { label: 'past',    className: 'bg-purple-50 text-purple-600 border border-purple-100' },
}

function getDefaultColumns(t) {
  return [
    { id: 'word',         label: t('dict.colWord') },
    { id: 'entryType',   label: t('dict.colKind') },
    { id: 'form',        label: t('dict.colForm') },
    { id: 'translation', label: t('dict.colTranslation') },
    { id: 'status',      label: t('dict.colStatus') },
    { id: 'lastReviewed',label: t('dict.colLastReviewed') },
  ]
}

function speak(text, lang = 'de-DE') {
  if (!window.speechSynthesis) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = lang; u.rate = 0.85
  window.speechSynthesis.speak(u)
}

function renderCell(colId, w, t) {
  const pos       = POS_STYLES[w.pos] || POS_STYLES.preposition
  const entryBadge = ENTRY_TYPE_STYLES[w.entryType]
  switch (colId) {
    case 'word': {
      const caseBadge = extractCaseBadge(w)
      return (
        <span className="font-medium text-gray-900 flex items-center gap-1.5 flex-wrap">
          <span>{w.word}</span>
          {w.pos === 'noun' && w.form && (
            <span className="text-gray-400 font-normal"> ({cleanForm(w.form, w.word)})</span>
          )}
          {caseBadge && (
            <span className={`text-xs font-semibold px-1.5 py-0.5 rounded border ${caseBadge.cls}`}>
              {caseBadge.label}
            </span>
          )}
        </span>
      )
    }
    case 'entryType':
      return entryBadge
        ? <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${entryBadge.className}`}>{entryBadge.label}</span>
        : <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${pos.className}`}>{pos.label}</span>
    case 'form': {
      const formText = w.pos !== 'noun' ? (w.form || '—') : '—'
      return (
        <span className="text-gray-400 italic text-xs block max-w-[160px] truncate" title={formText}>
          {formText}
        </span>
      )
    }
    case 'translation':  return <span className="text-gray-500">{w.translation}</span>
    case 'status': {
      const statusLabel = { new: t('dict.statusNew'), learning: t('dict.statusLearning'), known: t('dict.statusKnown'), mastered: t('dict.statusMastered') }
      return <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[w.status]}`}>{statusLabel[w.status] ?? w.status}</span>
    }
    case 'lastReviewed': return <span className="text-gray-400">{w.lastReviewed}</span>
    default: return null
  }
}

// ── Add Word Modal ────────────────────────────────────────────────────────
function AddWordModal({ onAdd, onClose, interfaceLanguage, targetLanguageName = 'German' }) {
  const { t } = useLanguage()
  const [input, setInput]       = useState('')
  const [stage, setStage]       = useState('idle') // idle | loading | result
  const [result, setResult]     = useState(null)

  const [identifyError, setIdentifyError] = useState(null)

  const handleIdentify = async () => {
    if (!input.trim()) return
    setStage('loading')
    setIdentifyError(null)
    try {
      const data = await identifyWordAI(input, targetLanguageName, interfaceLanguage)
      setResult(data)
      setStage('result')
    } catch (e) {
      setIdentifyError(t('dict.identifyError'))
      setStage('idle')
    }
  }

  const handleAdd = () => {
    if (!result) return
    onAdd({
      ...result,
      status: 'new',
      dateAdded: new Date().toISOString().slice(0, 10),
      source: 'manual',
      lastReviewed: '—',
    })
    onClose()
  }

  const entryBadge = result ? ENTRY_TYPE_STYLES[result.entryType] : null
  const posBadge   = result ? (POS_STYLES[result.pos] || POS_STYLES.preposition) : null

  return (
    <>
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-7">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-lg font-bold text-gray-900">{t('dict.modalTitle')}</h3>
            <button onClick={onClose} className="text-gray-300 hover:text-gray-600 text-2xl leading-none">×</button>
          </div>

          {/* Input */}
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={input}
              onChange={(e) => { setInput(e.target.value); setStage('idle'); setResult(null) }}
              onKeyDown={(e) => e.key === 'Enter' && handleIdentify()}
              placeholder={t('dict.typePlaceholder')}
              className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-400 transition-colors"
              autoFocus
            />
            <button
              onClick={handleIdentify}
              disabled={!input.trim() || stage === 'loading'}
              className="px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition-colors disabled:opacity-40"
            >
              {stage === 'loading' ? '…' : t('dict.identify')}
            </button>
          </div>
          <p className="text-xs text-gray-400 mb-5">{t('dict.typeHint')}</p>
          {identifyError && (
            <div className="bg-red-50 border border-red-100 text-red-600 text-xs px-3 py-2 rounded-xl mb-3">{identifyError}</div>
          )}

          {/* Loading */}
          {stage === 'loading' && (
            <div className="flex items-center gap-3 py-6 justify-center text-gray-400 text-sm">
              <span className="animate-spin text-indigo-500 text-lg">⟳</span>
              Identifying…
            </div>
          )}

          {/* Result */}
          {stage === 'result' && result && (
            <div className="border border-gray-100 rounded-2xl overflow-hidden mb-5">
              <div className="bg-gray-50 px-4 py-3 flex items-center gap-2">
                <span className="text-xs text-gray-400 uppercase tracking-wide">{t('dict.aiIdentified')}</span>
                <span className="ml-auto flex gap-1.5">
                  {entryBadge && (
                    <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${entryBadge.className}`}>
                      {entryBadge.label}
                    </span>
                  )}
                  {posBadge && (
                    <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${posBadge.className}`}>
                      {posBadge.label}
                    </span>
                  )}
                </span>
              </div>
              <div className="px-4 py-4 flex flex-col gap-3">
                <div>
                  <p className="text-lg font-bold text-gray-900">{result.word}</p>
                  {result.form && (
                    <p className="text-xs text-gray-400 italic mt-0.5">{result.form}</p>
                  )}
                </div>
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">{t('dict.translation')}</p>
                  <p className="text-sm font-medium text-gray-700">{result.translation}</p>
                </div>
                <div className={`rounded-xl px-3 py-2 text-xs font-medium flex items-start gap-2 ${
                  result.grammarNote?.startsWith('⚠')
                    ? 'bg-amber-50 text-amber-800 border border-amber-100'
                    : 'bg-indigo-50 text-indigo-800 border border-indigo-100'
                }`}>
                  <span>{result.grammarNote?.startsWith('⚠') ? '⚠️' : 'ℹ️'}</span>
                  <span>{result.grammarNote}</span>
                </div>
                <p className="text-xs text-gray-500 leading-relaxed">{result.explanation}</p>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-500 text-sm font-medium hover:bg-gray-50 transition-colors">
              {t('dict.cancel')}
            </button>
            <button
              onClick={handleAdd}
              disabled={stage !== 'result'}
              className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors disabled:opacity-30"
            >
              {t('dict.addToDictBtn')}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// ── Word Panel ────────────────────────────────────────────────────────────
function WordPanel({ word, onClose, onUpdate, onDelete, interfaceLanguage, targetLanguageName = 'German', speechLocale = 'de-DE' }) {
  const { t } = useLanguage()
  const [editing, setEditing]             = useState(false)
  const [draft, setDraft]                 = useState(word)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [identifying, setIdentifying]     = useState(false)
  const [identifyError, setIdentifyError] = useState(null)

  const pos        = POS_STYLES[word.pos] || POS_STYLES.preposition
  const entryBadge = ENTRY_TYPE_STYLES[word.entryType]

  async function handleIdentify() {
    setIdentifying(true)
    setIdentifyError(null)
    try {
      const result = await identifyWordAI(word.word, targetLanguageName, interfaceLanguage || 'English')
      const updated = {
        ...word,
        translation:  result.translation  || word.translation,
        explanation:  result.explanation  || word.explanation,
        grammarNote:  result.grammarNote  || word.grammarNote,
        form:         result.form         || word.form,
        pos:          result.pos          || word.pos,
        isException:  result.isException  ?? word.isException,
        conjugation:  result.conjugation  || word.conjugation,
        examples:     result.examples?.map(ex => ({ target: ex.target, translation: ex.translation, tense: ex.tense })) || word.examples,
      }
      onUpdate(updated)
    } catch (e) {
      setIdentifyError('AI identification failed. Try again.')
    } finally {
      setIdentifying(false)
    }
  }

  function startEdit() {
    setDraft(word)   // reset draft to latest saved state
    setEditing(true)
  }

  function cancelEdit() {
    setDraft(word)
    setEditing(false)
  }

  function saveEdit() {
    onUpdate(draft)
    setEditing(false)
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40" onClick={editing ? undefined : onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col overflow-y-auto">

        {/* Header */}
        <div className={`px-6 pt-6 pb-4 border-b border-gray-100 flex items-start justify-between ${editing ? 'bg-gray-50' : ''}`}>
          <div>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              {entryBadge
                ? <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${entryBadge.className}`}>{entryBadge.label}</span>
                : <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${pos.className}`}>{pos.label}</span>
              }
              {!editing && (
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[word.status]}`}>
                  {{ new: t('dict.statusNew'), learning: t('dict.statusLearning'), known: t('dict.statusKnown'), mastered: t('dict.statusMastered') }[word.status] ?? word.status}
                </span>
              )}
              {word.isException && !editing && (
                <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">{t('dict.exception')}</span>
              )}
              {editing && (
                <span className="text-xs text-indigo-500 font-medium">{t('dict.editingLabel')}</span>
              )}
            </div>
            <h2 className="text-2xl font-bold text-gray-900">{word.word}</h2>
            {word.form && <p className="text-sm text-gray-400 italic mt-0.5">{cleanForm(word.form, word.word)}</p>}
          </div>
          <button onClick={editing ? cancelEdit : onClose} className="text-gray-300 hover:text-gray-600 text-2xl leading-none mt-1">×</button>
        </div>

        {/* ── View mode ── */}
        {!editing && (
          <div className="px-6 py-5 flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{t('dict.translation')}</p>
                <p className="text-xl font-semibold text-gray-800">{word.translation}</p>
              </div>
              <button
                onClick={() => speak(word.word, speechLocale)}
                className="flex items-center gap-2 px-3 py-2 rounded-full border border-gray-200 text-sm text-gray-400 hover:text-indigo-600 hover:border-indigo-200 transition-colors"
              >
                {t('dict.pronounce')}
              </button>
            </div>

            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">{t('dict.explanation')}</p>
              <p className="text-sm text-gray-600 leading-relaxed">{word.explanation}</p>
            </div>

            {word.grammarNote && (
              <div className={`rounded-xl px-4 py-3 text-xs font-medium flex items-start gap-2 ${
                word.isException
                  ? 'bg-amber-50 text-amber-800 border border-amber-100'
                  : 'bg-indigo-50 text-indigo-800 border border-indigo-100'
              }`}>
                <span className="mt-0.5">{word.isException ? '⚠️' : 'ℹ️'}</span>
                <span>{word.grammarNote}</span>
              </div>
            )}

            {word.examples?.length > 0 && (
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-3">
                  {word.pos === 'verb' ? t('dict.examplesVerb') : t('dict.examples')}
                </p>
                <div className="flex flex-col gap-3">
                  {word.examples.map((ex, i) => (
                    <div key={i} className="bg-gray-50 rounded-xl p-4">
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <p className="text-sm font-medium text-gray-800 leading-snug">{ex.target}</p>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {ex.tense && TENSE_LABELS[ex.tense] && (
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TENSE_LABELS[ex.tense].className}`}>
                              {TENSE_LABELS[ex.tense].label}
                            </span>
                          )}
                          <button onClick={() => speak(ex.target, speechLocale)} className="text-gray-300 hover:text-indigo-500 transition-colors text-base">🔈</button>
                        </div>
                      </div>
                      <p className="text-xs text-gray-400 italic">{ex.translation}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Conjugation table — irregular verbs only */}
            {word.conjugation && (
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-3">{t('dict.conjugation')}</p>
                <div className="rounded-2xl overflow-hidden border border-amber-100">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-amber-50 text-xs text-amber-700 uppercase tracking-wide">
                        <th className="px-4 py-2 text-left font-medium w-1/3">{t('dict.pronoun')}</th>
                        <th className="px-4 py-2 text-left font-medium">Präsens</th>
                        <th className="px-4 py-2 text-left font-medium">Präteritum</th>
                      </tr>
                    </thead>
                    <tbody>
                      {['ich','du','er/sie/es','wir','ihr','sie/Sie'].map((pronoun, i) => (
                        <tr key={pronoun} className={i % 2 === 0 ? 'bg-white' : 'bg-amber-50/30'}>
                          <td className="px-4 py-2 text-gray-400 font-medium text-xs">{pronoun}</td>
                          <td className="px-4 py-2 text-gray-800 italic">{word.conjugation.präsens?.[pronoun] || '—'}</td>
                          <td className="px-4 py-2 text-gray-500 italic">{word.conjugation.präteritum?.[pronoun] || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="bg-amber-50/50 px-4 py-2.5 flex items-center gap-4 border-t border-amber-100 text-xs text-amber-800">
                    <span><span className="font-semibold">Partizip II:</span> {word.conjugation.partizip_ii}</span>
                    <span><span className="font-semibold">{t('dict.auxiliary')}:</span> {word.conjugation.auxiliary}</span>
                  </div>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <button
                onClick={handleIdentify}
                disabled={identifying}
                className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
              >
                {identifying ? (
                  <>
                    <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    Identifying…
                  </>
                ) : '✨ Identify with AI'}
              </button>
              {identifyError && <p className="text-xs text-red-500 text-center">{identifyError}</p>}
            </div>

            <div className="flex gap-2 pt-1">
              <button className="flex-1 py-2.5 rounded-xl border border-indigo-200 text-indigo-600 text-sm font-medium hover:bg-indigo-50 transition-colors">
                {t('dict.practiceWord')}
              </button>
              <button
                onClick={startEdit}
                className="py-2.5 px-4 rounded-xl border border-gray-200 text-gray-500 text-sm font-medium hover:bg-gray-50 hover:text-gray-700 transition-colors"
              >
                {t('dict.edit')}
              </button>
              <button
                onClick={() => setConfirmDelete(true)}
                className="py-2.5 px-3 rounded-xl border border-red-100 text-red-400 text-sm font-medium hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors"
              >
                🗑
              </button>
            </div>

            {confirmDelete && (
              <div className="bg-red-50 border border-red-100 rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
                <p className="text-xs text-red-700 font-medium">
                  {t('dict.deleteConfirm')}
                </p>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-white transition-colors"
                  >
                    {t('dict.cancel')}
                  </button>
                  <button
                    onClick={() => onDelete(word.id)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white font-semibold transition-colors"
                  >
                    {t('dict.deleteConfirmBtn')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Edit mode ── */}
        {editing && (
          <div className="px-6 py-5 flex flex-col gap-5">

            {/* Translation */}
            <div>
              <label className="text-xs text-gray-400 uppercase tracking-wide mb-1.5 block">{t('dict.translation')}</label>
              <input
                value={draft.translation}
                onChange={(e) => setDraft({ ...draft, translation: e.target.value })}
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-800 focus:outline-none focus:border-indigo-400 transition-colors"
              />
            </div>

            {/* Status */}
            <div>
              <label className="text-xs text-gray-400 uppercase tracking-wide mb-1.5 block">{t('dict.colStatus')}</label>
              <div className="flex gap-2">
                {['new', 'learning', 'known', 'mastered'].map((s) => (
                  <button
                    key={s}
                    onClick={() => setDraft({ ...draft, status: s })}
                    className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-colors ${
                      draft.status === s
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'border-gray-200 text-gray-500 hover:border-indigo-300 hover:bg-indigo-50'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Grammar note */}
            <div>
              <label className="text-xs text-gray-400 uppercase tracking-wide mb-1.5 block">{t('dict.grammarNote')}</label>
              <input
                value={draft.grammarNote || ''}
                onChange={(e) => setDraft({ ...draft, grammarNote: e.target.value })}
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-800 focus:outline-none focus:border-indigo-400 transition-colors"
              />
            </div>

            {/* Explanation */}
            <div>
              <label className="text-xs text-gray-400 uppercase tracking-wide mb-1.5 block">{t('dict.explanation')}</label>
              <textarea
                value={draft.explanation || ''}
                onChange={(e) => setDraft({ ...draft, explanation: e.target.value })}
                rows={4}
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-800 focus:outline-none focus:border-indigo-400 transition-colors resize-none leading-relaxed"
              />
            </div>

            {/* Examples (read-only reminder) */}
            {word.examples?.length > 0 && (
              <p className="text-xs text-gray-400 italic">{t('dict.examplesNote')}</p>
            )}

            {/* Save / Cancel */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={cancelEdit}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-500 text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                {t('dict.cancel')}
              </button>
              <button
                onClick={saveEdit}
                className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors"
              >
                {t('dict.saveChanges')}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ── Quick Sort mode ───────────────────────────────────────────────────────
function QuickSortMode({ words, onClose, onStatusChange }) {
  const [index, setIndex]   = useState(0)
  const [saving, setSaving] = useState(false)
  const [done, setDone]     = useState(false)
  const [counts, setCounts] = useState({ new: 0, learning: 0, known: 0, mastered: 0, skipped: 0 })

  const current = words[index]

  async function handleStatus(status) {
    if (saving) return
    setSaving(true)
    await onStatusChange(current.id, status)
    setCounts(prev => ({ ...prev, [status]: prev[status] + 1 }))
    setSaving(false)
    if (index + 1 >= words.length) { setDone(true) } else { setIndex(i => i + 1) }
  }

  function handleSkip() {
    setCounts(prev => ({ ...prev, skipped: prev.skipped + 1 }))
    if (index + 1 >= words.length) { setDone(true) } else { setIndex(i => i + 1) }
  }

  if (done || words.length === 0) {
    const changed = words.length - counts.skipped
    return (
      <div className="fixed inset-0 bg-white z-50 flex flex-col items-center justify-center px-6 text-center">
        <div className="text-4xl mb-4">🎉</div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">All sorted!</h2>
        <p className="text-sm text-gray-500 mb-6">{changed} word{changed !== 1 ? 's' : ''} updated.</p>
        <div className="flex gap-3 text-sm mb-8">
          {[['new','gray'],['learning','yellow'],['known','green'],['mastered','indigo']].map(([s, c]) => counts[s] > 0 && (
            <div key={s} className={`px-3 py-1.5 rounded-full font-medium bg-${c}-100 text-${c}-700`}>
              {counts[s]} {s}
            </div>
          ))}
        </div>
        <button onClick={onClose} className="px-6 py-3 rounded-xl bg-indigo-600 text-white font-semibold text-sm">Done</button>
      </div>
    )
  }

  const progress = (index / words.length) * 100
  const pos    = POS_STYLES[current.pos] || POS_STYLES.preposition
  const eType  = ENTRY_TYPE_STYLES[current.entryType]

  return (
    <div className="fixed inset-0 bg-gray-50 z-50 flex flex-col">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-100 px-6 py-3 flex items-center justify-between shrink-0">
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-sm font-medium">← Exit</button>
        <span className="text-sm font-semibold text-gray-700">{index + 1} / {words.length}</span>
        <span className="text-xs text-gray-400">{Math.round(progress)}% done</span>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-gray-100 shrink-0">
        <div className="h-full bg-indigo-500 transition-all duration-300" style={{ width: `${progress}%` }} />
      </div>

      {/* Card */}
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <div className="bg-white rounded-3xl shadow-md border border-gray-100 w-full max-w-sm px-8 py-10 flex flex-col items-center text-center gap-4">
          <div className="flex gap-1.5 flex-wrap justify-center">
            {eType
              ? <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${eType.className}`}>{eType.label}</span>
              : <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${pos.className}`}>{pos.label}</span>
            }
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[current.status]}`}>{current.status}</span>
          </div>
          <p className="text-3xl font-bold text-gray-900 leading-tight">{current.word}</p>
          {current.form && current.pos !== 'noun' && (
            <p className="text-sm text-gray-400 italic -mt-2">{current.form}</p>
          )}
          {current.translation
            ? <p className="text-lg text-gray-600">{current.translation}</p>
            : <p className="text-sm text-gray-300 italic">No translation yet</p>
          }
          {current.grammarNote && (
            <p className="text-xs text-gray-400 border-t border-gray-100 pt-3 w-full">{current.grammarNote}</p>
          )}
        </div>
      </div>

      {/* Status buttons */}
      <div className="px-6 pb-8 flex flex-col gap-3 shrink-0 max-w-sm w-full mx-auto">
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => handleStatus('new')}
            disabled={saving}
            className="py-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-semibold transition-colors disabled:opacity-50">
            New
          </button>
          <button onClick={() => handleStatus('learning')}
            disabled={saving}
            className="py-3 rounded-xl bg-yellow-100 hover:bg-yellow-200 text-yellow-700 text-sm font-semibold transition-colors disabled:opacity-50">
            Learning
          </button>
          <button onClick={() => handleStatus('known')}
            disabled={saving}
            className="py-3 rounded-xl bg-green-100 hover:bg-green-200 text-green-700 text-sm font-semibold transition-colors disabled:opacity-50">
            Known
          </button>
          <button onClick={() => handleStatus('mastered')}
            disabled={saving}
            className="py-3 rounded-xl bg-indigo-100 hover:bg-indigo-200 text-indigo-700 text-sm font-semibold transition-colors disabled:opacity-50">
            Mastered
          </button>
        </div>
        <button onClick={handleSkip} className="py-2 text-gray-400 text-sm hover:text-gray-600 transition-colors">Skip →</button>
      </div>
    </div>
  )
}

// ── Bulk Identify modal ───────────────────────────────────────────────────
function BulkIdentifyModal({ words, onClose, onWordIdentified, interfaceLanguage, targetLanguageName = 'German' }) {
  const unidentified = words.filter(w => !w.translation || !w.explanation)
  const [running, setRunning]     = useState(false)
  const [index, setIndex]         = useState(0)
  const [errors, setErrors]       = useState([])
  const [done, setDone]           = useState(false)
  const total = unidentified.length

  async function handleStart() {
    setRunning(true)
    setErrors([])
    for (let i = 0; i < unidentified.length; i++) {
      setIndex(i)
      const w = unidentified[i]
      try {
        const result = await identifyWordAI(w.word, targetLanguageName, interfaceLanguage)
        const updated = {
          ...w,
          translation: result.translation  || w.translation,
          explanation: result.explanation  || w.explanation,
          grammarNote: result.grammarNote  || w.grammarNote,
          form:        result.form         || w.form,
          pos:         result.pos          || w.pos,
          isException: result.isException  ?? w.isException,
          conjugation: result.conjugation  || w.conjugation,
          examples:    result.examples?.map(ex => ({ target: ex.target, translation: ex.translation, tense: ex.tense })) || w.examples,
        }
        await onWordIdentified(updated)
      } catch (e) {
        setErrors(prev => [...prev, w.word])
      }
    }
    setDone(true)
    setRunning(false)
  }

  const succeeded = done ? (total - errors.length) : 0

  return (
    <>
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40" onClick={!running ? onClose : undefined} />
      <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-7">

          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-lg font-bold text-gray-900">Identify unidentified words</h3>
            {!running && <button onClick={onClose} className="text-gray-300 hover:text-gray-600 text-2xl leading-none">×</button>}
          </div>

          {!running && !done && (
            <>
              <p className="text-sm text-gray-500 mb-4">
                Found <span className="font-semibold text-gray-800">{total}</span> word{total !== 1 ? 's' : ''} without translation or explanation.
                Claude will identify them one by one.
              </p>
              {total === 0
                ? <p className="text-sm text-green-600 bg-green-50 rounded-xl px-4 py-3 mb-5">✓ All words are already identified!</p>
                : (
                  <div className="bg-gray-50 rounded-2xl px-4 py-3 mb-5 max-h-48 overflow-y-auto">
                    <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Words to identify</p>
                    <div className="flex flex-wrap gap-1.5">
                      {unidentified.map(w => (
                        <span key={w.id} className="px-2.5 py-1 bg-white border border-gray-200 rounded-full text-xs text-gray-600">{w.word}</span>
                      ))}
                    </div>
                  </div>
                )
              }
              <div className="flex gap-2">
                <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-500 text-sm font-medium hover:bg-gray-50">Cancel</button>
                {total > 0 && (
                  <button onClick={handleStart} className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold">
                    Identify all {total}
                  </button>
                )}
              </div>
            </>
          )}

          {running && (
            <div className="flex flex-col items-center py-4 gap-4">
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div className="h-2 bg-indigo-500 rounded-full transition-all duration-300" style={{ width: `${((index) / total) * 100}%` }} />
              </div>
              <p className="text-sm text-gray-500">
                Identifying <span className="font-semibold text-gray-800">{index + 1}</span> / {total}
              </p>
              <p className="text-base font-semibold text-indigo-700 bg-indigo-50 px-4 py-2 rounded-xl">
                {unidentified[index]?.word}
              </p>
              <p className="text-xs text-gray-400">This may take a minute — please don't close this tab.</p>
            </div>
          )}

          {done && (
            <div className="flex flex-col items-center py-4 gap-4 text-center">
              <div className="text-4xl">{errors.length === 0 ? '✨' : '⚠️'}</div>
              <p className="text-lg font-bold text-gray-900">
                {succeeded} of {total} identified
              </p>
              {errors.length > 0 && (
                <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 w-full text-left">
                  <p className="text-xs text-red-600 font-semibold mb-1">Failed ({errors.length}):</p>
                  <p className="text-xs text-red-500">{errors.join(', ')}</p>
                </div>
              )}
              <button onClick={onClose} className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold">Done</button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ── Bulk import parser ────────────────────────────────────────────────────
const PREPOSITIONS = ['auf','an','für','über','um','von','mit','nach','zu','bei','in','gegen','durch','aus','als']

function parseBulkLine(line) {
  line = line.trim()
  if (!line) return null

  // Skip section headers like "Dativ", "Akkusativ"
  if (/^(Dativ|Akkusativ|Genitiv)$/i.test(line)) return null

  // Verb + preposition formats:
  // "achten (auf)" → "achten auf"
  // "anmelden (sich) für" → "sich anmelden für"
  // "abhängen von" (no parens)
  const prepInParen = line.match(/^(\S+)\s+\((sich)\)\s+(\S+)$/)   // verb (sich) prep
  const prepInParen2 = line.match(/^(\S+)\s+\((\S+)\)$/)            // verb (prep)
  const verbPrepPlain = line.match(/^(\S+)\s+(auf|an|für|über|um|von|mit|nach|zu|bei|in|gegen|durch|aus|als)\s*$/)

  if (prepInParen) {
    const [, verb, , prep] = prepInParen
    return { word: `sich ${verb} ${prep}`, form: null, pos: 'verb', entry_type: 'phrasal-verb', translation: '', status: 'new' }
  }
  if (prepInParen2 && PREPOSITIONS.includes(prepInParen2[2])) {
    const [, verb, prep] = prepInParen2
    return { word: `${verb} ${prep}`, form: null, pos: 'verb', entry_type: 'phrasal-verb', translation: '', status: 'new' }
  }
  if (verbPrepPlain) {
    const [, verb, prep] = verbPrepPlain
    return { word: `${verb} ${prep}`, form: null, pos: 'verb', entry_type: 'phrasal-verb', translation: '', status: 'new' }
  }
  // Multi-word verb + preposition: "einverstanden sein mit", "fertig sein mit", "beteiligt sein an"
  const multiWordPrep = line.match(new RegExp(`^(.+?)\\s+(${PREPOSITIONS.join('|')})$`))
  if (multiWordPrep && !line.includes('(')) {
    const [, verb, prep] = multiWordPrep
    return { word: `${verb} ${prep}`, form: null, pos: 'verb', entry_type: 'phrasal-verb', translation: '', status: 'new' }
  }

  // Noun: starts with der/die/das
  if (/^(der|die|das)\s/i.test(line)) {
    const commaIdx = line.indexOf(',')
    const word = commaIdx > -1 ? line.slice(0, commaIdx).trim() : line.trim()
    const noun = word.replace(/^(der|die|das)\s+/i, '')
    const ending = commaIdx > -1 ? line.slice(commaIdx + 1).trim() : null
    let form = null
    if (ending) {
      if (ending === '-') form = noun // no change plural
      else if (ending.startsWith('-¨')) form = ending // umlaut — store as-is
      else if (ending.startsWith('-')) form = noun + ending.slice(1)
      else form = ending
    }
    return { word, form, pos: 'noun', entry_type: 'word', translation: '', status: 'new' }
  }

  // Verb / phrasal verb: has conjugation in parens
  if (line.includes('(') && !line.startsWith('-')) {
    const parenIdx = line.indexOf('(')
    const wordRaw = line.slice(0, parenIdx).trim()
    const conj = line.match(/\(([^)]+)\)/)?.[1] || ''
    const parts = conj.split(',').map(s => s.trim()).filter(Boolean)
    // form: "reißt ab / riss ab / hat abgerissen"
    const form = parts.slice(0, 3).join(' / ')
    const isPhrasal = wordRaw.includes(' ')
    return {
      word: wordRaw,
      form,
      pos: 'verb',
      entry_type: isPhrasal ? 'phrasal-verb' : 'word',
      translation: '',
      status: 'new',
    }
  }

  // Adjective / adverb / other
  const word = line.replace(/,.*/, '').replace(/\(.*\)/, '').trim()
  if (!word) return null
  return { word, form: null, pos: 'adjective', entry_type: 'word', translation: '', status: 'new' }
}

// ── Bulk import modal ─────────────────────────────────────────────────────
function BulkImportModal({ onClose, onImport }) {
  const [text, setText] = useState('')
  const [preview, setPreview] = useState([])
  const [importing, setImporting] = useState(false)
  const [done, setDone] = useState(false)

  function handleParse() {
    const lines = text.split('\n')
    const parsed = lines.map(parseBulkLine).filter(Boolean)
    setPreview(parsed)
  }

  async function handleImport() {
    setImporting(true)
    await onImport(preview)
    setImporting(false)
    setDone(true)
  }

  const posColor = {
    noun: 'bg-blue-50 text-blue-600',
    verb: 'bg-purple-50 text-purple-600',
    adjective: 'bg-yellow-50 text-yellow-600',
  }

  if (done) return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-sm w-full text-center">
        <div className="text-4xl mb-3">🎉</div>
        <h2 className="text-xl font-bold text-gray-900 mb-1">{preview.length} words imported!</h2>
        <p className="text-sm text-gray-500 mb-6">Translations are empty — click any word to add them via AI.</p>
        <button onClick={onClose} className="w-full py-2.5 rounded-xl bg-indigo-600 text-white font-semibold text-sm">Done</button>
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Bulk import words</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        {preview.length === 0 ? (
          <div className="p-6 flex flex-col gap-4 flex-1">
            <p className="text-sm text-gray-500">Paste your word list — one word per line. Supports German dictionary format (e.g. <em>die Architektur, -en</em> or <em>abreißen (reißt ab, riss ab, hat abgerissen)</em>).</p>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              className="flex-1 min-h-64 border border-gray-200 rounded-xl p-3 text-sm font-mono resize-none focus:outline-none focus:border-indigo-400"
              placeholder="die Architektur, -en&#10;abreißen (reißt ab, riss ab, hat abgerissen)&#10;altmodisch&#10;..."
            />
            <button
              onClick={handleParse}
              disabled={!text.trim()}
              className="py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-200 text-white text-sm font-semibold transition-colors"
            >
              Preview ({text.split('\n').filter(l => l.trim()).length} lines)
            </button>
          </div>
        ) : (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="overflow-y-auto flex-1">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-400 font-semibold uppercase tracking-wide sticky top-0">
                  <tr>
                    <th className="px-4 py-2 text-left">Word</th>
                    <th className="px-4 py-2 text-left">Form</th>
                    <th className="px-4 py-2 text-left">POS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {preview.map((w, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium text-gray-900">{w.word}</td>
                      <td className="px-4 py-2 text-gray-400 text-xs">{w.form || '—'}</td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${posColor[w.pos] || 'bg-gray-100 text-gray-500'}`}>{w.pos}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
              <button onClick={() => setPreview([])} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-500 text-sm font-medium hover:bg-gray-50">← Back</button>
              <button
                onClick={handleImport}
                disabled={importing}
                className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-sm font-semibold transition-colors"
              >
                {importing ? 'Importing…' : `Import ${preview.length} words`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────
export default function Dictionary() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { t, lang } = useLanguage()
  const { targetLang, targetLanguageName, speechLocale } = useTargetLang()
  const interfaceLanguage = lang === 'uk' ? 'Ukrainian' : 'English'

  const [words, setWords]               = useState([])
  const [loadingWords, setLoadingWords] = useState(true)
  const [search, setSearch]             = useState('')
  const [sortBy, setSortBy]             = useState('dateAdded')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterType, setFilterType]     = useState('all')
  const [columns, setColumns]           = useState(() => {
    try {
      const saved = localStorage.getItem('wordy_col_order')
      if (saved) {
        const ids = JSON.parse(saved)
        const map = Object.fromEntries(getDefaultColumns(t).map(c => [c.id, c]))
        const restored = ids.map(id => map[id]).filter(Boolean)
        if (restored.length === getDefaultColumns(t).length) return restored
      }
    } catch {}
    return getDefaultColumns(t)
  })
  const [dragOver, setDragOver]         = useState(null)
  const [selectedWord, setSelectedWord] = useState(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [showSortMode, setShowSortMode]   = useState(false)
  const [showBulkIdentify, setShowBulkIdentify] = useState(false)
  const dragCol = useRef(null)

  // Keep column labels in sync when language changes, but preserve current order
  useEffect(() => {
    const map = Object.fromEntries(getDefaultColumns(t).map(c => [c.id, c]))
    setColumns(prev => prev.map(col => map[col.id] || col))
  }, [lang])

  // ── Fetch words from Supabase ──────────────────────────────────────────
  useEffect(() => {
    if (!user) return
    fetchWords()
  }, [user, targetLang])

  async function fetchWords() {
    setLoadingWords(true)
    const { data: wordRows } = await supabase
      .from('words')
      .select('*')
      .eq('user_id', user.id)
      .eq('target_language', targetLang)
      .order('created_at', { ascending: false })

    if (!wordRows) { setLoadingWords(false); return }

    // Fetch all examples for these words in one query
    const wordIds = wordRows.map((w) => w.id)
    const { data: exampleRows } = await supabase
      .from('examples')
      .select('*')
      .in('word_id', wordIds)

    const examplesByWordId = {}
    for (const ex of exampleRows || []) {
      if (!examplesByWordId[ex.word_id]) examplesByWordId[ex.word_id] = []
      examplesByWordId[ex.word_id].push(ex)
    }

    setWords(wordRows.map((row) => dbToWord(row, examplesByWordId[row.id] || [])))
    setLoadingWords(false)
  }

  const filtered = words
    .filter((w) => {
      const matchSearch  = w.word.toLowerCase().includes(search.toLowerCase()) ||
                           (w.translation || '').toLowerCase().includes(search.toLowerCase())
      const matchStatus  = filterStatus === 'all' || w.status === filterStatus
      const matchType    = filterType   === 'all' || w.entryType === filterType
      return matchSearch && matchStatus && matchType
    })
    .sort((a, b) => {
      if (sortBy === 'word')      return a.word.localeCompare(b.word)
      if (sortBy === 'status')    return a.status.localeCompare(b.status)
      if (sortBy === 'entryType') return a.entryType.localeCompare(b.entryType)
      if (sortBy === 'dateAdded') return new Date(b.dateAdded) - new Date(a.dateAdded)
      return 0
    })

  const onDragStart = (colId) => { dragCol.current = colId }
  const onDragOver  = (e, colId) => { e.preventDefault(); setDragOver(colId) }
  const onDragEnd   = () => { dragCol.current = null; setDragOver(null) }
  const onDrop = (targetId) => {
    if (!dragCol.current || dragCol.current === targetId) return
    const from = columns.findIndex((c) => c.id === dragCol.current)
    const to   = columns.findIndex((c) => c.id === targetId)
    const next = [...columns]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setColumns(next)
    localStorage.setItem('wordy_col_order', JSON.stringify(next.map(c => c.id)))
    setDragOver(null)
  }

  async function handleAdd(entry) {
    if (!user) return
    // Insert word
    const { data: newWord, error } = await supabase
      .from('words')
      .insert(wordToDb(entry, user.id, targetLang))
      .select()
      .single()
    if (error || !newWord) return

    // Insert examples if any
    if (entry.examples?.length > 0) {
      await supabase.from('examples').insert(
        entry.examples.map((ex) => ({
          word_id: newWord.id,
          sentence_target: ex.target,
          sentence_translation: ex.translation,
          tense: ex.tense || null,
        }))
      )
    }

    // Reload to get fresh data with examples
    fetchWords()
  }

  async function handleDelete(wordId) {
    if (!user) return
    await supabase.from('examples').delete().eq('word_id', wordId)
    await supabase.from('words').delete().eq('id', wordId).eq('user_id', user.id)
    setWords((prev) => prev.filter((w) => w.id !== wordId))
    setSelectedWord(null)
  }

  async function handleUpdate(updated) {
    if (!user) return
    await supabase
      .from('words')
      .update({
        translation: updated.translation,
        status: updated.status,
        grammar_note: updated.grammarNote,
        explanation: updated.explanation,
        form: updated.form || null,
        pos: updated.pos || null,
        is_exception: updated.isException ?? false,
        conjugation: updated.conjugation || null,
      })
      .eq('id', updated.id)
      .eq('user_id', user.id)

    // Upsert examples if provided
    if (updated.examples?.length) {
      await supabase.from('examples').delete().eq('word_id', updated.id)
      await supabase.from('examples').insert(
        updated.examples.map((ex) => ({
          word_id: updated.id,
          sentence_target: ex.target,
          sentence_translation: ex.translation,
          tense: ex.tense || null,
        }))
      )
    }

    fetchWords()
  }

  async function handleQuickStatusChange(wordId, newStatus) {
    if (!user) return
    await supabase.from('words').update({ status: newStatus }).eq('id', wordId).eq('user_id', user.id)
    setWords(prev => prev.map(w => w.id === wordId ? { ...w, status: newStatus } : w))
  }

  async function handleBulkImport(entries) {
    if (!user) return
    const rows = entries.map(e => ({
      user_id: user.id,
      word: e.word,
      translation: e.translation,
      form: e.form || null,
      pos: e.pos,
      entry_type: e.entry_type,
      status: 'new',
      date_added: new Date().toISOString().split('T')[0],
      target_language: targetLang,
    }))
    // Insert in chunks of 20 to avoid request size limits
    for (let i = 0; i < rows.length; i += 20) {
      await supabase.from('words').insert(rows.slice(i, i + 20))
    }
    await fetchWords()
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />

      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('dict.title')}</h1>
            <p className="text-sm text-gray-500 mt-0.5">{loadingWords ? '…' : `${words.length} ${t('dict.entries')}`} · {targetLanguageName}</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setShowBulkModal(true)}
              className="border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 text-gray-600 hover:text-indigo-600 px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
            >
              Import list
            </button>
            <button
              onClick={() => setShowBulkIdentify(true)}
              className="border border-gray-200 hover:border-amber-300 hover:bg-amber-50 text-gray-600 hover:text-amber-700 px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
              title="Identify all words missing translation or explanation"
            >
              ✨ Identify all
            </button>
            <button
              onClick={() => setShowSortMode(true)}
              className="border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 text-gray-600 hover:text-indigo-600 px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
              title="Go through all words and assign status levels"
            >
              🗂 Sort words
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
            >
              {t('dict.addWord')}
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-3">
          <input
            type="text"
            placeholder={t('dict.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-48 border border-gray-200 rounded-xl px-4 py-2.5 text-sm placeholder-gray-400 focus:outline-none focus:border-indigo-400 bg-white"
          />
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
            className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-600 focus:outline-none focus:border-indigo-400 bg-white">
            <option value="all">{t('dict.allTypes')}</option>
            <option value="word">{t('dict.words')}</option>
            <option value="phrase">{t('dict.phrases')}</option>
            <option value="idiom">{t('dict.idioms')}</option>
            <option value="phrasal-verb">{t('dict.phrasalVerbs')}</option>
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
            className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-600 focus:outline-none focus:border-indigo-400 bg-white">
            <option value="all">{t('dict.allStatuses')}</option>
            <option value="new">{t('dict.statusNew')}</option>
            <option value="learning">{t('dict.statusLearning')}</option>
            <option value="known">{t('dict.statusKnown')}</option>
            <option value="mastered">{t('dict.statusMastered')}</option>
          </select>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}
            className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-600 focus:outline-none focus:border-indigo-400 bg-white">
            <option value="dateAdded">{t('dict.sortByDate')}</option>
            <option value="word">{t('dict.sortByWord')}</option>
            <option value="status">{t('dict.sortByStatus')}</option>
            <option value="entryType">{t('dict.sortByType')}</option>
          </select>
        </div>

        <p className="text-xs text-gray-400 mb-4 flex items-center gap-1">
          <span>⠿</span> {t('dict.dragHint')}
        </p>

        {/* Table */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase tracking-wide">
                {columns.map((col) => (
                  <th key={col.id} draggable
                    onDragStart={() => onDragStart(col.id)}
                    onDragOver={(e) => onDragOver(e, col.id)}
                    onDrop={() => onDrop(col.id)}
                    onDragEnd={onDragEnd}
                    className={`text-left px-5 py-3 font-medium select-none cursor-grab active:cursor-grabbing transition-colors whitespace-nowrap ${
                      dragOver === col.id ? 'bg-indigo-50 text-indigo-500' : 'hover:text-gray-600'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="text-gray-300 text-base leading-none">⠿</span>
                      {col.label}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((w, i) => (
                <tr key={w.id} onClick={() => setSelectedWord(w)}
                  className={`hover:bg-indigo-50/40 cursor-pointer transition-colors ${
                    i !== filtered.length - 1 ? 'border-b border-gray-50' : ''
                  } ${selectedWord?.id === w.id ? 'bg-indigo-50/60' : ''}`}
                >
                  {columns.map((col) => (
                    <td key={col.id} className="px-5 py-3.5 whitespace-nowrap">
                      {renderCell(col.id, w, t)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {loadingWords && (
            <div className="text-center py-12 text-gray-400 text-sm flex items-center justify-center gap-2">
              <span className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce [animation-delay:0ms]" />
              <span className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce [animation-delay:300ms]" />
            </div>
          )}
          {!loadingWords && filtered.length === 0 && (
            <div className="text-center py-12 text-gray-400 text-sm">
              {words.length === 0 ? t('dict.empty') : t('dict.noResults')}
            </div>
          )}
        </div>
      </main>

      {selectedWord && <WordPanel word={selectedWord} onClose={() => setSelectedWord(null)} onUpdate={handleUpdate} onDelete={handleDelete} interfaceLanguage={interfaceLanguage} targetLanguageName={targetLanguageName} speechLocale={speechLocale} />}
      {showAddModal && <AddWordModal onAdd={handleAdd} onClose={() => setShowAddModal(false)} interfaceLanguage={interfaceLanguage} targetLanguageName={targetLanguageName} />}
      {showBulkModal && <BulkImportModal onClose={() => setShowBulkModal(false)} onImport={handleBulkImport} />}
      {showSortMode && (
        <QuickSortMode
          words={words}
          onClose={() => { setShowSortMode(false); fetchWords() }}
          onStatusChange={handleQuickStatusChange}
        />
      )}
      {showBulkIdentify && (
        <BulkIdentifyModal
          words={words}
          onClose={() => { setShowBulkIdentify(false); fetchWords() }}
          onWordIdentified={handleUpdate}
          interfaceLanguage={interfaceLanguage}
          targetLanguageName={targetLanguageName}
        />
      )}
    </div>
  )
}
