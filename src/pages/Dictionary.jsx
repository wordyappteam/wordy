import { useState, useRef, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { identifyWord as identifyWordAI, primaryEntry, suggestCollectionWords, reglossSenses } from '../lib/claude'
import { displayTranslation, showSenseForm } from '../lib/senseDisplay'
import { listHeadword } from '../lib/senseFormat'
import { badgeForWord, badgeForStage, manualStagePatch } from '../lib/srs'
import { useLanguage } from '../lib/i18n'
import { useTargetLang } from '../lib/TargetLangContext'
import {
  collectionColor, nextColor, fetchCollectionsData, createCollection,
  renameCollection, deleteCollection, addWordToCollection, removeWordFromCollection,
  COLLECTION_COLOR_KEYS,
} from '../lib/collections'
import { candidateToRows } from '../lib/identifyCandidates'
import { planSenseWrites } from '../lib/senseWrites'
import { repairSense } from '../lib/noteRepair'
import { parseBulkLine } from '../lib/bulkImportParse'
import { uploadSenseImage, deleteSenseImageByUrl, setSenseImageUrl } from '../lib/senseImages'
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
function dbSenseToFrontend(s) {
  return {
    id: s.id,
    pos: s.pos,
    wordForm: s.word_form,
    translation: s.translation,
    form: s.form,
    grammarNote: s.grammar_note,
    usageNote: s.usage_note,
    explanation: s.explanation,
    isException: s.is_exception,
    register: s.register ?? 'neutral',
    cefr: s.cefr ?? null,
    conjugation: s.conjugation || null,
    examples: (s.examples || []).map(ex => ({
      target: ex.target,
      translation: ex.translation,
      tense: ex.tense || null,
    })),
    learningStage: s.learning_stage,
    correctRecallCount: s.correct_recall_count,
    nextReviewDate: s.next_review_date,
    imageUrl: s.image_url ?? null,
    aspect: s.aspect ?? null,
    gender: s.gender ?? null,
  }
}

function dbToWord(row, legacyExamples = [], senses = []) {
  const frontendSenses = senses.map(dbSenseToFrontend)
  const primary = frontendSenses[0] || null
  return {
    id: row.id,
    entryType: row.entry_type,
    word: row.word,
    // Legacy flat fields — used for list display and backward compat
    form: primary?.form ?? row.form,
    pos: primary?.pos ?? row.pos,
    translation: primary?.translation ?? row.translation,
    status: badgeForWord(senses, row.status),
    dateAdded: row.date_added,
    source: row.source,
    lastReviewed: row.last_reviewed,
    explanation: primary?.explanation ?? row.explanation,
    grammarNote: primary?.grammarNote ?? row.grammar_note,
    isException: primary?.isException ?? row.is_exception,
    conjugation: primary?.conjugation ?? row.conjugation ?? null,
    examples: primary?.examples ?? legacyExamples.map(ex => ({
      target: ex.sentence_target,
      translation: ex.sentence_translation,
      tense: ex.tense,
    })),
    // Senses (new model)
    senses: frontendSenses,
    hasSenses: frontendSenses.length > 0,
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
  // A word that is both, which German does constantly — schnell is "fast" and
  // "quickly" with no change of form. It reads as an adjective first, so it
  // keeps the adjective's colour and carries the difference in its label.
  'adjective-adverb': { label: 'adj./adv.', className: 'bg-amber-50 text-amber-800 border border-amber-300' },
  adverb:      { label: 'adv.', className: 'bg-teal-50 text-teal-700 border border-teal-200' },
  conjunction: { label: 'conj.',className: 'bg-rose-50 text-rose-700 border border-rose-200' },
  preposition: { label: 'prep.',className: 'bg-gray-100 text-gray-600 border border-gray-200' },
}

// The badges were the last English left inside a Ukrainian card. A learner reading
// "нове" in the header and "new" two lines below it is looking at the same fact
// twice, in two languages.
const POS_LABELS_UK = {
  verb: 'дієсл.', noun: 'ім.', adjective: 'прикм.',
  'adjective-adverb': 'прикм./присл.',
  adverb: 'присл.', conjunction: 'спол.', preposition: 'прийм.',
}
const STAGE_LABELS_UK = {
  new: 'нове', early: 'початок', mid: 'вивчаю', learning: 'вивчаю',
  late: 'майже', known: 'знаю', mastered: 'засвоєно',
}
function posLabel(pos, lang) {
  const fallback = POS_STYLES[pos] || POS_STYLES.preposition
  return (lang === 'uk' && POS_LABELS_UK[pos]) || fallback.label
}
function stageLabel(stage, lang) {
  const s = stage || 'new'
  return (lang === 'uk' && STAGE_LABELS_UK[s]) || s
}

const ENTRY_LABELS_UK = {
  phrase: 'фраза', idiom: 'ідіома', 'phrasal-verb': 'фразове дієсл.',
}
function entryLabel(entryType, lang) {
  const e = ENTRY_TYPE_STYLES[entryType]
  if (!e) return null
  return (lang === 'uk' && ENTRY_LABELS_UK[entryType]) || e.label
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

// A tense tag annotates the sentence; it does not compete with it. The old blue and
// purple pills read as badges and pulled the eye away from the German. Quiet grey
// text, and in the interface language like everything else on the card.
const TENSE_LABELS = {
  present: { en: 'present', uk: 'теперішній' },
  past:    { en: 'past',    uk: 'минулий' },
}
const TENSE_CLASS = 'text-[10px] uppercase tracking-wide text-gray-400 font-medium'
function tenseLabel(tense, lang) {
  const entry = TENSE_LABELS[tense]
  if (!entry) return null
  return lang === 'uk' ? entry.uk : entry.en
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

function renderCell(colId, w, t, lang) {
  const pos       = POS_STYLES[w.pos] || POS_STYLES.preposition
  const entryBadge = ENTRY_TYPE_STYLES[w.entryType]
  switch (colId) {
    case 'word': {
      const caseBadge = extractCaseBadge(w)
      return (
        <span className="font-medium text-gray-900 flex items-center gap-1.5 flex-wrap">
          <span>{listHeadword(w)}</span>
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
        ? <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${entryBadge.className}`}>{entryLabel(w.entryType, lang)}</span>
        : <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${pos.className}`}>{posLabel(w.pos, lang)}</span>
    case 'form': {
      const formText = w.pos !== 'noun' ? (w.form || '—') : '—'
      return (
        <span className="text-gray-400 italic text-xs block max-w-[160px] truncate" title={formText}>
          {formText}
        </span>
      )
    }
    case 'translation': {
      const translations = w.senses?.length > 0
        ? w.senses.map((s) => s.translation).filter(Boolean)
        : [w.translation].filter(Boolean)
      const shown   = translations.slice(0, 3)
      const overflow = translations.length - shown.length
      return (
        <span className="flex flex-col gap-0.5">
          {shown.map((t, i) => (
            <span key={i} className="text-gray-500 text-sm leading-snug">{t}</span>
          ))}
          {overflow > 0 && (
            <span className="text-xs text-gray-400 italic">+{overflow} more</span>
          )}
        </span>
      )
    }
    case 'status': {
      const statusLabel = { new: t('dict.statusNew'), learning: t('dict.statusLearning'), known: t('dict.statusKnown'), mastered: t('dict.statusMastered') }
      return <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[w.status]}`}>{statusLabel[w.status] ?? w.status}</span>
    }
    case 'lastReviewed': return <span className="text-gray-400">{w.lastReviewed}</span>
    default: return null
  }
}

// ── Add Word Modal ────────────────────────────────────────────────────────
const TRANSLATE_LANGS = [
  { code: 'English',   label: 'EN' },
  { code: 'Ukrainian', label: 'UA' },
]

function AddWordModal({ onAdd, onClose, interfaceLanguage, targetLanguageName = 'German', topics = [] }) {
  const { t, lang } = useLanguage()
  const [input, setInput]           = useState('')
  const [stage, setStage]           = useState('idle') // idle | loading | result
  const [result, setResult]         = useState(null)
  const [checked, setChecked]       = useState({}) // "ci.si" -> bool, default all true
  const [identifyError, setIdentifyError] = useState(null)
  const [translationLang, setTranslationLang] = useState(interfaceLanguage)

  const handleIdentify = async () => {
    if (!input.trim()) return
    setStage('loading')
    setIdentifyError(null)
    try {
      const data = await identifyWordAI(input, targetLanguageName, translationLang, null, { topics })
      const init = {}
      ;(data.candidates || []).forEach((c, ci) =>
        (c.senses || []).forEach((_, si) => { init[`${ci}.${si}`] = true }))
      setChecked(init)
      setResult(data)
      setStage('result')
    } catch (e) {
      setIdentifyError(t(e?.overloaded ? 'dict.busyError' : 'dict.identifyError'))
      setStage('idle')
    }
  }

  const toggleSense = (key) => setChecked(prev => ({ ...prev, [key]: !prev[key] }))

  const handleAdd = () => {
    if (!result) return
    const chosen = (result.candidates || [])
      .map((c, ci) => ({
        ...c,
        senses: (c.senses || []).filter((_, si) => checked[`${ci}.${si}`]),
      }))
      .filter(c => c.senses.length > 0)
    if (!chosen.length) return
    onAdd({ candidates: chosen, source: 'manual' })
    onClose()
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-7 max-h-[90vh] overflow-y-auto">
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
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs text-gray-400">{t('dict.translateTo')}</span>
            <div className="flex rounded-full border border-gray-200 overflow-hidden text-xs font-semibold">
              {TRANSLATE_LANGS.map(({ code, label }) => (
                <button
                  key={code}
                  onClick={() => { setTranslationLang(code); setStage('idle'); setResult(null) }}
                  className={`px-3 py-1 transition-colors ${translationLang === code ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-700'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-gray-400 mb-5">{t('dict.typeHint')}</p>
          {identifyError && (
            <div className="bg-red-50 border border-red-100 text-red-600 text-xs px-3 py-2 rounded-xl mb-3">{identifyError}</div>
          )}

          {stage === 'loading' && (
            <div className="flex items-center gap-3 py-6 justify-center text-gray-400 text-sm">
              <span className="animate-spin text-indigo-500 text-lg">⟳</span>
              Identifying…
            </div>
          )}

          {/* Not a word in the target language — a real answer, not an empty list.
              Add stays disabled on its own (nothing is checked), so this only has
              to say what happened and what to do about it. */}
          {stage === 'result' && result?.notFound && (
            <div className="mb-5 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
              <p className="text-sm font-medium text-amber-900">{t('dict.notFound')}</p>
              {result.notFound.suggestion && (
                <p className="text-sm text-amber-800 mt-1">
                  {t('dict.didYouMean')}{' '}
                  <button
                    type="button"
                    onClick={() => { setInput(result.notFound.suggestion); setStage('idle'); setResult(null) }}
                    className="font-semibold underline underline-offset-2 hover:text-amber-950"
                  >
                    {result.notFound.suggestion}
                  </button>?
                </p>
              )}
              <p className="text-xs text-amber-700 mt-1.5">{t('dict.notFoundHint')}</p>
            </div>
          )}

          {/* Candidate / sense picker */}
          {stage === 'result' && result && !result.notFound && (
            <div className="mb-5 flex flex-col gap-5">
              {(result.candidates || []).length > 1 && (
                <p className="text-xs text-gray-400 -mb-2">{"These are different words — pick the ones to add."}</p>
              )}
              {(result.candidates || []).map((candidate, ci) => {
                const entryBadge = ENTRY_TYPE_STYLES[candidate.entryType]
                return (
                  <div key={ci}>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-sm font-semibold text-gray-900">{candidate.word}</span>
                      {entryBadge && (
                        <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${entryBadge.className}`}>{entryLabel(candidate.entryType, lang)}</span>
                      )}
                      {(candidate.senses || []).length > 1 && (
                        <span className="text-xs text-gray-400 ml-auto">{(candidate.senses || []).length} senses — uncheck any you don't want</span>
                      )}
                    </div>
                    <div className="flex flex-col gap-2">
                      {(candidate.senses || []).map((sense, si) => {
                        const posBadge = POS_STYLES[sense.pos] || POS_STYLES.preposition
                        const key = `${ci}.${si}`
                        const isChecked = checked[key]
                        return (
                          <button
                            key={key}
                            onClick={() => toggleSense(key)}
                            className={`w-full text-left rounded-xl border px-4 py-3 transition-colors ${
                              isChecked
                                ? 'border-indigo-300 bg-indigo-50'
                                : 'border-gray-200 bg-white opacity-50'
                            }`}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${posBadge.className}`}>{posLabel(sense.pos, lang)}</span>
                              {sense.aspect && (
                                <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-violet-50 text-violet-700 border border-violet-100">{sense.aspect === 'imperfective' ? 'impf.' : 'pf.'}</span>
                              )}
                              {sense.gender && (
                                <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-blue-50 text-blue-600 border border-blue-100">{{ m: 'ч', f: 'ж', n: 'с' }[sense.gender] || sense.gender}</span>
                              )}
                              <span className="text-sm font-medium text-gray-900">{sense.wordForm}</span>
                              <span className={`ml-auto w-4 h-4 rounded border flex items-center justify-center text-xs shrink-0 ${
                                isChecked ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-300'
                              }`}>{isChecked ? '✓' : ''}</span>
                            </div>
                            <p className="text-sm text-gray-600">{displayTranslation(sense.translation, (candidate.senses || []).length > 1)}</p>
                            {sense.grammarNote && (
                              <p className="text-xs text-gray-400 mt-1">{sense.grammarNote}</p>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-500 text-sm font-medium hover:bg-gray-50 transition-colors">
              {t('dict.cancel')}
            </button>
            <button
              onClick={handleAdd}
              disabled={stage !== 'result' || Object.values(checked).every(v => !v)}
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

// ── Per-sense image slot ──────────────────────────────────────────────────
// Stroke icon rather than the 🔈 emoji: emoji render differently on every platform
// and read as decoration. This is a control.
function SpeakerIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  )
}

function TrashIcon({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a1 1 0 01-1 1H7a1 1 0 01-1-1L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  )
}

function SenseImage({ sense, userId, onChange }) {
  const { t } = useLanguage()
  const fileRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (!file || !userId) return
    if (!file.type.startsWith('image/')) { setError('Not an image'); return }
    setBusy(true); setError(null)
    try {
      const prev = sense.imageUrl
      const url = await uploadSenseImage(userId, sense.id, file)
      await setSenseImageUrl(sense.id, userId, url)
      onChange(sense.id, url)
      if (prev) deleteSenseImageByUrl(prev) // clean up the replaced image
    } catch (err) {
      console.error('image upload failed:', err)
      setError('Upload failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove() {
    if (!userId) return
    const prev = sense.imageUrl
    setBusy(true)
    try {
      await setSenseImageUrl(sense.id, userId, null)
      onChange(sense.id, null)
      if (prev) deleteSenseImageByUrl(prev)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      {sense.imageUrl ? (
        <div className="relative group rounded-xl overflow-hidden border border-gray-100">
          <img src={sense.imageUrl} alt="" className="w-full max-h-52 object-cover" />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
            <button onClick={() => fileRef.current?.click()} disabled={busy} className="text-xs font-semibold bg-white/90 text-gray-700 px-3 py-1.5 rounded-lg hover:bg-white">{t('dict.replaceImage')}</button>
            <button onClick={handleRemove} disabled={busy} className="text-xs font-semibold bg-red-500/90 text-white px-3 py-1.5 rounded-lg hover:bg-red-600">{t('dict.removeImage')}</button>
          </div>
          {busy && <div className="absolute inset-0 bg-white/60 flex items-center justify-center text-xs text-gray-500">Working…</div>}
        </div>
      ) : (
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="w-full py-2.5 border border-dashed border-gray-200 hover:border-indigo-300 rounded-xl text-xs text-gray-400 hover:text-indigo-500 transition-colors flex items-center justify-center gap-1.5"
        >
          {busy ? t('dict.uploading') : t('dict.addImage')}
        </button>
      )}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  )
}

// ── Word Panel ────────────────────────────────────────────────────────────
// A note: a coloured left rule and no fill. The fill is what the examples get, so
// the body reads as two kinds of thing — notes are ink, examples are cards — and
// the rule colour lets you find the grammar note without reading a word.
//
// Three tones, one meaning each. `trap` is wheat and means exactly that: a trap.
// Being irregular is a fact, not a trap, and it has its own badge in the header —
// so the exception flag must never reach in here and tint the grammar note.
const NOTE_TONES = {
  meaning: { rule: 'border-indigo-600', label: 'text-indigo-700', body: 'text-[15px] text-gray-700' },
  grammar: { rule: 'border-gray-300',   label: 'text-gray-500',   body: 'text-[14px] text-gray-600' },
  trap:    { rule: 'border-amber-600',  label: 'text-amber-700',  body: 'text-[14px] text-gray-600' },
}

function Note({ label, tone, children }) {
  const c = NOTE_TONES[tone]
  return (
    <div className={`border-l-[3px] pl-3 py-0.5 ${c.rule}`}>
      <p className={`text-[11px] font-semibold uppercase tracking-wide mb-0.5 ${c.label}`}>{label}</p>
      <p className={`leading-relaxed ${c.body}`}>{children}</p>
    </div>
  )
}

function WordPanel({ word, onClose, onUpdate, onDelete, onDeleteSense, interfaceLanguage, targetLanguageName = 'German', speechLocale = 'de-DE', collections = [], wordCollectionIds, onToggleCollection, onQuickCreateCollection, userId, onSenseImageChange, onSenseStageChange, topics = [] }) {
  const { t, lang } = useLanguage()
  const [editing, setEditing]             = useState(false)
  const [draft, setDraft]                 = useState(word)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [identifying, setIdentifying]     = useState(false)
  const [identifyError, setIdentifyError] = useState(null)
  const [creatingCollection, setCreatingCollection] = useState(false)
  const [newCollectionName, setNewCollectionName]   = useState('')
  const [expandedConjugation, setExpandedConjugation] = useState(new Set())
  const [activeSenseIdx, setActiveSenseIdx] = useState(0)
  useEffect(() => { setActiveSenseIdx(0) }, [word.id]) // reset pager when a different word opens
  const [confirmDeleteSense, setConfirmDeleteSense] = useState(false)
  useEffect(() => { setConfirmDeleteSense(false) }, [word.id, activeSenseIdx]) // close confirm on word/sense change
  const [stagePickerOpen, setStagePickerOpen] = useState(false)
  useEffect(() => { setStagePickerOpen(false) }, [word.id, activeSenseIdx]) // close picker on word/sense change

  function toggleConjugation(key) {
    setExpandedConjugation(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const pos        = POS_STYLES[word.pos] || POS_STYLES.preposition
  const entryBadge = ENTRY_TYPE_STYLES[word.entryType]

  // Ukrainian verbs are stored as two aspect senses — show the pair in the header.
  const aspectSenses = (word.senses || []).filter(s => s.aspect)
  const aspectRank = (s) => (s.aspect === 'imperfective' ? 0 : 1)
  const aspectPairTitle = aspectSenses.length >= 2
    ? [...aspectSenses].sort((a, b) => aspectRank(a) - aspectRank(b)).map(s => s.wordForm).join(' / ')
    : null

  async function handleIdentify(reidentLang) {
    setIdentifying(true)
    setIdentifyError(null)
    try {
      const lang = reidentLang || interfaceLanguage || 'English'
      const idResult = await identifyWordAI(word.word, targetLanguageName, lang, null, { topics })
      const result = primaryEntry(idResult) ?? { senses: word.senses }
      const primary = result.senses?.[0]
      const updated = {
        ...word,
        senses: result.senses || word.senses || [],
        hasSenses: (result.senses?.length ?? 0) > 0,
        translation:  primary?.translation  || word.translation,
        explanation:  primary?.explanation  || word.explanation,
        grammarNote:  primary?.grammarNote  || word.grammarNote,
        form:         primary?.form         || word.form,
        pos:          primary?.pos          || word.pos,
        isException:  primary?.isException  ?? word.isException,
        conjugation:  primary?.conjugation  || word.conjugation,
        examples:     primary?.examples || word.examples,
      }
      onUpdate(updated)
    } catch (e) {
      setIdentifyError(t(e?.overloaded ? 'dict.busyError' : 'dict.identifyError'))
    } finally {
      setIdentifying(false)
    }
  }

  // The form edits the sense you are LOOKING AT. It used to edit word-level
  // fields that nothing read back for a word with senses, so pressing Save
  // changed no text at all — while the save path rewrote every sense row and
  // lost its study history. Editing the visible sense is what a person means
  // when they open a card on sense 2 and press the pencil.
  const editedSense = draft.senses?.[activeSenseIdx] ?? null

  const noteValue = (field) => (editedSense ? editedSense[field] : draft[field]) || ''

  const setNote = (field, value) => setDraft((d) => (
    editedSense
      ? { ...d, senses: d.senses.map((s, i) => (i === activeSenseIdx ? { ...s, [field]: value } : s)) }
      : { ...d, [field]: value }
  ))

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

  // Set the learning stage for ONE sense — writes real SRS state to that
  // sense's word_senses row only, so sibling senses of the same word are
  // untouched. The word-level list badge stays derived (badgeForWord).
  async function setSenseStage(senseId, level) {
    setStagePickerOpen(false)
    const patch = manualStagePatch(level, new Date().toISOString().slice(0, 10))
    await supabase.from('word_senses').update(patch).eq('id', senseId).eq('user_id', userId)
    onSenseStageChange?.(senseId, patch) // patch local state so the derived word badge refreshes
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
                ? <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${entryBadge.className}`}>{entryLabel(word.entryType, lang)}</span>
                : <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${pos.className}`}>{posLabel(word.pos, lang)}</span>
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
            {/* Pronounce belongs ON the word, not on a row of its own below it —
                it's an attribute of the headword, so it reads as one thing. */}
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-2xl font-bold text-gray-900">{aspectPairTitle || word.word}</h2>
              {!editing && (
                <button
                  onClick={() => speak(word.word, speechLocale)}
                  aria-label={t('dict.pronounce')}
                  title={t('dict.pronounce')}
                  className="w-7 h-7 rounded-full border border-gray-200 text-gray-400 hover:text-indigo-600 hover:border-indigo-200 transition-colors flex items-center justify-center shrink-0"
                >
                  <SpeakerIcon />
                </button>
              )}
            </div>
            {!aspectPairTitle && word.form && <p className="text-sm text-gray-400 italic mt-0.5">{cleanForm(word.form, word.word)}</p>}
          </div>
          <button onClick={editing ? cancelEdit : onClose} className="text-gray-300 hover:text-gray-600 text-2xl leading-none mt-1">×</button>
        </div>

        {/* ── View mode ── */}
        {!editing && (
          <div className="px-6 py-5 flex flex-col gap-5">
            {/* ── Sense-based display ── */}
            {word.hasSenses ? (
              <div className="flex flex-col gap-4">
                {/* Senses are TABS, not a carousel: each tab is labelled with its own
                    meaning, so you can jump straight to the sense you want instead of
                    stepping through anonymous dots hunting for it. */}
                {word.senses.length > 1 && (
                  <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5">
                    {word.senses.map((s, i) => (
                      <button
                        key={s.id || i}
                        onClick={() => setActiveSenseIdx(i)}
                        title={displayTranslation(s.translation, true)}
                        className={`shrink-0 max-w-[9rem] truncate px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          i === activeSenseIdx
                            ? 'bg-indigo-50 text-indigo-700'
                            : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        {displayTranslation(s.translation, true)}
                      </button>
                    ))}
                  </div>
                )}
                {(() => {
                  const si = Math.min(activeSenseIdx, word.senses.length - 1)
                  const sense = word.senses[si]
                  const posBadge = POS_STYLES[sense.pos] || POS_STYLES.preposition
                  const STAGE_COLORS = { new: 'bg-gray-100 text-gray-500', early: 'bg-yellow-50 text-yellow-700', mid: 'bg-yellow-100 text-yellow-800', late: 'bg-orange-50 text-orange-700', known: 'bg-green-50 text-green-700', mastered: 'bg-indigo-50 text-indigo-700' }
                  const stageColor = STAGE_COLORS[sense.learningStage] || STAGE_COLORS.new
                  return (
                    <div key={sense.id || si} className="border border-gray-100 rounded-2xl overflow-hidden">
                      {/* Meta row: what KIND of word this is. Part of speech, level and
                          register are metadata — they belong up here with the headword,
                          not competing for attention with the definition below. */}
                      <div className="bg-gray-50 px-4 py-2.5 flex items-center gap-2 border-b border-gray-100">
                        <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${posBadge.className}`}>{posLabel(sense.pos, lang)}</span>
                        {sense.aspect && (
                          <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-violet-50 text-violet-700 border border-violet-100">
                            {sense.aspect === 'imperfective' ? 'impf.' : 'pf.'}
                          </span>
                        )}
                        {sense.gender && (
                          <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-blue-50 text-blue-600 border border-blue-100" title={{ m: 'masculine', f: 'feminine', n: 'neuter' }[sense.gender]}>
                            {{ m: 'ч', f: 'ж', n: 'с' }[sense.gender] || sense.gender}
                          </span>
                        )}
                        {sense.cefr && (
                          <span className="px-2 py-0.5 rounded-md text-xs font-bold bg-indigo-600 text-white">{sense.cefr}</span>
                        )}
                        {/* Register only when it is NOT neutral — "neutral" on every
                            everyday word is a badge that says nothing. */}
                        {sense.register && sense.register !== 'neutral' && (
                          <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-gray-100 text-gray-500 capitalize">{sense.register}</span>
                        )}
                        <div className="ml-auto relative">
                          <button
                            type="button"
                            onClick={() => setStagePickerOpen(o => !o)}
                            className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${stageColor}`}
                          >
                            {stageLabel(sense.learningStage, lang)}
                          </button>
                          {stagePickerOpen && (
                            <div className="absolute right-0 top-full mt-1 z-10 bg-white border border-gray-100 rounded-xl shadow-lg p-1.5 flex gap-1">
                              {['new', 'learning', 'known', 'mastered'].map((level) => (
                                <button
                                  key={level}
                                  type="button"
                                  onClick={() => setSenseStage(sense.id, level)}
                                  className={`px-2 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                                    badgeForStage(sense.learningStage) === level
                                      ? 'bg-indigo-600 text-white'
                                      : 'text-gray-500 hover:bg-indigo-50 hover:text-indigo-700'
                                  }`}
                                >
                                  {stageLabel(level, lang)}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="px-4 py-3 flex flex-col gap-3">
                        {/* The sense's own form — only when it is not already what the
                            header says. A phrase sense or half an aspect pair earns this
                            line; `bestehen` under the header `bestehen` does not, and
                            `sense.form` rides along with it for the same reason. */}
                        {showSenseForm(sense, aspectPairTitle || word.word) && (
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <span className="text-lg font-bold text-gray-900">{sense.wordForm}</span>
                            {sense.form && <span className="text-xs text-gray-400 italic">({sense.form})</span>}
                          </div>
                        )}

                        {/* The translation — the answer to "what does this mean". Biggest thing on the card. */}
                        <p className="text-base font-medium text-gray-800">{displayTranslation(sense.translation, word.senses.length > 1)}</p>

                        {/* Three notes, three jobs, each allowed to be silent:
                              Значення    — the definition. Always there.
                              Граматика   — how to build with it. Null for most nouns.
                              Варто знати — the trap. Null for most words.
                            A note with nothing to say does not render at all: an empty
                            "Граматика" on `der Tisch` would be worse than no note.
                            The trap sits before the examples on purpose — a warning read
                            after the evidence is a warning read too late. */}
                        {(sense.explanation || sense.grammarNote || sense.usageNote) && (
                          <div className="flex flex-col gap-2.5">
                            {sense.explanation && (
                              <Note label={t('dict.meaning')} tone="meaning">{sense.explanation}</Note>
                            )}
                            {sense.grammarNote && (
                              <Note label={t('dict.grammar')} tone="grammar">{sense.grammarNote}</Note>
                            )}
                            {sense.usageNote && (
                              <Note label={t('dict.goodToKnow')} tone="trap">{sense.usageNote}</Note>
                            )}
                          </div>
                        )}

                        {sense.examples?.length > 0 && (
                          <div className="flex flex-col gap-2">
                            {sense.examples.map((ex, i) => (
                              <div key={i} className="bg-gray-50 rounded-xl p-3">
                                <div className="flex items-start justify-between gap-2 mb-1">
                                  <p className="text-sm font-medium text-gray-800 leading-snug">{ex.target}</p>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    {tenseLabel(ex.tense, lang) && (
                                      <span className={TENSE_CLASS}>{tenseLabel(ex.tense, lang)}</span>
                                    )}
                                    <button onClick={() => speak(ex.target, speechLocale)} aria-label="Pronounce" className="text-gray-300 hover:text-indigo-500 transition-colors"><SpeakerIcon /></button>
                                  </div>
                                </div>
                                <p className="text-xs text-gray-400 italic">{ex.translation}</p>
                              </div>
                            ))}
                          </div>
                        )}
                        {/* Conjugation table */}
                        {sense.conjugation && targetLanguageName === 'Ukrainian' && sense.isException ? (
                          <div>
                            <button
                              onClick={() => toggleConjugation(sense.id || si)}
                              className="text-xs text-violet-600 font-medium flex items-center gap-1.5 hover:text-violet-800 transition-colors"
                            >
                              <span>{expandedConjugation.has(sense.id || si) ? '▾' : '▸'}</span>
                              {expandedConjugation.has(sense.id || si) ? 'Сховати відмінювання' : 'Відмінювання'}
                            </button>
                            {expandedConjugation.has(sense.id || si) && (
                              <div className="rounded-2xl overflow-hidden border border-violet-100 mt-2">
                                {(() => {
                                  const tense = sense.conjugation.present
                                    ? { label: 'Теперішній', data: sense.conjugation.present }
                                    : sense.conjugation.future
                                    ? { label: 'Майбутній', data: sense.conjugation.future }
                                    : null
                                  return (
                                    <>
                                      {tense && (
                                        <table className="w-full text-sm">
                                          <thead>
                                            <tr className="bg-violet-50 text-xs text-violet-700 uppercase tracking-wide">
                                              <th className="px-3 py-2 text-left font-medium w-1/2">займенник</th>
                                              <th className="px-3 py-2 text-left font-medium">{tense.label}</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {['я','ти','він/вона','ми','ви','вони'].map((p, i) => (
                                              <tr key={p} className={i % 2 === 0 ? 'bg-white' : 'bg-violet-50/30'}>
                                                <td className="px-3 py-1.5 text-gray-400 font-medium text-xs">{p}</td>
                                                <td className="px-3 py-1.5 text-gray-800 italic">{tense.data?.[p] || '—'}</td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      )}
                                      {sense.conjugation.past && (
                                        <div className="bg-violet-50/50 px-3 py-2 border-t border-violet-100 text-xs text-violet-800 flex flex-wrap gap-x-4 gap-y-1 items-center">
                                          <span className="font-semibold uppercase tracking-wide">Минулий:</span>
                                          {['ч','ж','с','мн'].map((k) => sense.conjugation.past[k] && (
                                            <span key={k}><span className="text-violet-500">{k}:</span> <span className="italic">{sense.conjugation.past[k]}</span></span>
                                          ))}
                                        </div>
                                      )}
                                    </>
                                  )
                                })()}
                              </div>
                            )}
                          </div>
                        ) : sense.conjugation && targetLanguageName !== 'Ukrainian' && (
                          <div className="rounded-2xl overflow-hidden border border-amber-100">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="bg-amber-50 text-xs text-amber-700 uppercase tracking-wide">
                                  <th className="px-3 py-2 text-left font-medium w-1/3">{t('dict.pronoun')}</th>
                                  <th className="px-3 py-2 text-left font-medium">Präsens</th>
                                  <th className="px-3 py-2 text-left font-medium">Präteritum</th>
                                </tr>
                              </thead>
                              <tbody>
                                {['ich','du','er/sie/es','wir','ihr','sie/Sie'].map((pronoun, i) => (
                                  <tr key={pronoun} className={i % 2 === 0 ? 'bg-white' : 'bg-amber-50/30'}>
                                    <td className="px-3 py-1.5 text-gray-400 font-medium text-xs">{pronoun}</td>
                                    <td className="px-3 py-1.5 text-gray-800 italic">{sense.conjugation.präsens?.[pronoun] || '—'}</td>
                                    <td className="px-3 py-1.5 text-gray-500 italic">{sense.conjugation.präteritum?.[pronoun] || '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            <div className="bg-amber-50/50 px-3 py-2 flex items-center gap-4 border-t border-amber-100 text-xs text-amber-800">
                              <span><span className="font-semibold">Partizip II:</span> {sense.conjugation.partizip_ii}</span>
                              <span><span className="font-semibold">{t('dict.auxiliary')}:</span> {sense.conjugation.auxiliary}</span>
                            </div>
                          </div>
                        )}

                        {/* The image is an aid, not the point — it sits after the examples,
                            and when there is none it is a quiet invitation, not an empty
                            box demanding to be filled. */}
                        <SenseImage sense={sense} userId={userId} onChange={onSenseImageChange} />

                        {/* Destructive actions live down here, as quiet text. Deleting a
                            sense used to be a 🗑 sitting inline with the content, one
                            mis-tap from losing a word you have been learning for weeks. */}
                        {/* Only when there is more than one sense. On a single-sense word
                            "delete this sense" IS "delete the word" — and the word-level
                            button below already says so. Showing both was the same
                            destructive action twice, one card apart. */}
                        {/* The confirm takes the button's place rather than opening at the top
                            of the card: a question about a click belongs where the click was. */}
                        {word.senses.length > 1 && (
                          <div className="pt-2 mt-1 border-t border-gray-100 flex justify-end">
                            {confirmDeleteSense ? (
                              <div className="w-full flex items-center justify-between gap-3 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
                                <p className="text-xs text-red-700 font-medium">{t('dict.deleteSenseConfirm')}</p>
                                <div className="flex gap-2 shrink-0">
                                  <button
                                    onClick={() => setConfirmDeleteSense(false)}
                                    className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-white transition-colors"
                                  >
                                    {t('dict.cancel')}
                                  </button>
                                  <button
                                    onClick={async () => {
                                      setConfirmDeleteSense(false)
                                      setActiveSenseIdx(i => Math.max(0, Math.min(i, word.senses.length - 2)))
                                      await onDeleteSense(word.id, sense.id)
                                    }}
                                    className="text-xs px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white font-semibold transition-colors"
                                  >
                                    {t('dict.deleteConfirmBtn')}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                onClick={() => setConfirmDeleteSense(true)}
                                className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-red-600 transition-colors px-2 py-1 -mr-2 rounded-lg hover:bg-red-50"
                              >
                                <TrashIcon />
                                {t('dict.deleteSense')}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })()}
              </div>
            ) : (
              /* ── Legacy flat display (pre-migration words) ── */
              <>
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{t('dict.translation')}</p>
                  <p className="text-xl font-semibold text-gray-800">{displayTranslation(word.translation, word.senses.length > 1)}</p>
                </div>
                {word.explanation && (
                  <div>
                    <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">{t('dict.explanation')}</p>
                    <p className="text-sm text-gray-600 leading-relaxed">{word.explanation}</p>
                  </div>
                )}
                {word.grammarNote && !/^(countable|uncountable) noun/i.test(word.grammarNote) && (
                  <div className={`rounded-xl px-4 py-3 text-xs font-medium flex items-start gap-2 ${
                    word.isException ? 'bg-amber-50 text-amber-800 border border-amber-100' : 'bg-indigo-50 text-indigo-800 border border-indigo-100'
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
                              {tenseLabel(ex.tense, lang) && (
                                <span className={TENSE_CLASS}>{tenseLabel(ex.tense, lang)}</span>
                              )}
                              <button onClick={() => speak(ex.target, speechLocale)} aria-label="Pronounce" className="text-gray-300 hover:text-indigo-500 transition-colors"><SpeakerIcon /></button>
                            </div>
                          </div>
                          <p className="text-xs text-gray-400 italic">{ex.translation}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
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
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                  Run the senses migration to see this word in the new format.
                </p>
              </>
            )}

            {/* Collections: filing a word away is something you do AFTER reading it,
                so this sits below the senses rather than above them. */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{t('dict.collectionsTitle')}</p>
              <div className="flex flex-wrap gap-2 items-center">
                {collections.map((c) => {
                  const isMember = wordCollectionIds?.has(c.id)
                  const col = collectionColor(c.color)
                  return (
                    <button
                      key={c.id}
                      onClick={() => onToggleCollection?.(word.id, c.id)}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors flex items-center gap-1.5 ${isMember ? col.active : `${col.chip} opacity-70 hover:opacity-100`}`}
                    >
                      {!isMember && <span className={`w-2 h-2 rounded-full ${col.dot}`} />}
                      {isMember && <span>✓</span>}
                      {c.name}
                    </button>
                  )
                })}
                {creatingCollection ? (
                  <input
                    autoFocus
                    value={newCollectionName}
                    onChange={(e) => setNewCollectionName(e.target.value)}
                    onKeyDown={async (e) => {
                      if (e.key === 'Enter' && newCollectionName.trim()) {
                        await onQuickCreateCollection?.(newCollectionName.trim(), word.id)
                        setNewCollectionName(''); setCreatingCollection(false)
                      }
                      if (e.key === 'Escape') { setNewCollectionName(''); setCreatingCollection(false) }
                    }}
                    onBlur={() => { setNewCollectionName(''); setCreatingCollection(false) }}
                    placeholder="Name…"
                    className="px-3 py-1 rounded-full text-xs border border-indigo-300 focus:outline-none focus:border-indigo-500 w-24"
                  />
                ) : (
                  <button
                    onClick={() => setCreatingCollection(true)}
                    className="px-3 py-1 rounded-full text-xs font-medium border border-dashed border-gray-300 text-gray-400 hover:text-indigo-600 hover:border-indigo-300 transition-colors"
                  >
                    {t('dict.newCollection')}
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <button
                onClick={() => handleIdentify()}
                disabled={identifying}
                className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
              >
                {identifying ? (
                  <>
                    <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    {t('dict.identifying')}
                  </>
                ) : t('dict.identifyWithAi')}
              </button>
              <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
                <span>{t('dict.reidentifyIn')}</span>
                <button onClick={() => handleIdentify('English')} disabled={identifying} className="px-2 py-1 rounded-lg border border-gray-200 hover:border-indigo-300 text-gray-600 disabled:opacity-50">🇬🇧 EN</button>
                <button onClick={() => handleIdentify('Ukrainian')} disabled={identifying} className="px-2 py-1 rounded-lg border border-gray-200 hover:border-indigo-300 text-gray-600 disabled:opacity-50">🇺🇦 UA</button>
              </div>
              {identifyError && <p className="text-xs text-red-500 text-center">{identifyError}</p>}
            </div>

            <div className="flex gap-2 pt-1">
              {!confirmDelete ? (
                <>
                  {/* "Practice this word" is gone — it had no onClick and never did
                      anything. A button that does nothing is worse than no button. */}
                  <button
                    onClick={startEdit}
                    className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-500 text-sm font-medium hover:bg-gray-50 hover:text-gray-700 transition-colors"
                  >
                    {t('dict.edit')}
                  </button>
                  {/* Legible, but not shouting. Grey with a real border so it can be
                      found; red only on hover, when you are actually on it. An
                      invisible destructive action isn't safe — it's just confusing. */}
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="py-2.5 px-4 rounded-xl border border-gray-200 text-gray-500 text-sm font-medium hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors flex items-center gap-1.5"
                  >
                    <TrashIcon size={14} />
                    {t('dict.deleteWord')}
                  </button>
                </>
              ) : (
                /* In-place confirm — same row, no scroll needed */
                <div className="flex-1 flex items-center justify-between gap-3 bg-red-50 border border-red-100 rounded-xl px-4 py-2">
                  <p className="text-xs text-red-700 font-medium">{t('dict.deleteConfirm')}</p>
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
          </div>
        )}

        {/* ── Edit mode ── */}
        {editing && (
          <div className="px-6 py-5 flex flex-col gap-5">

            {/* Translation */}
            <div>
              <label className="text-xs text-gray-400 uppercase tracking-wide mb-1.5 block">{t('dict.translation')}</label>
              <input
                value={noteValue('translation')}
                onChange={(e) => setNote('translation', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-800 focus:outline-none focus:border-indigo-400 transition-colors"
              />
            </div>

            {/* Grammar note. Labelled as the CARD labels it: a form that renames
                the field you were just reading is a form you have to decode. */}
            <div>
              <label className="text-xs text-gray-400 uppercase tracking-wide mb-1.5 block">{t('dict.grammar')}</label>
              <input
                value={noteValue('grammarNote')}
                onChange={(e) => setNote('grammarNote', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-800 focus:outline-none focus:border-indigo-400 transition-colors"
              />
            </div>

            {/* Usage note — the trap. Absent from this form until now, which is
                why two of the six defects the note audit found could not be
                fixed by hand at all. */}
            <div>
              <label className="text-xs text-gray-400 uppercase tracking-wide mb-1.5 block">{t('dict.goodToKnow')}</label>
              <input
                value={noteValue('usageNote')}
                onChange={(e) => setNote('usageNote', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-800 focus:outline-none focus:border-indigo-400 transition-colors"
              />
            </div>

            {/* Explanation — "Значення" on the card, and now here too. */}
            <div>
              <label className="text-xs text-gray-400 uppercase tracking-wide mb-1.5 block">{t('dict.meaning')}</label>
              <textarea
                value={noteValue('explanation')}
                onChange={(e) => setNote('explanation', e.target.value)}
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
  const { t, lang } = useLanguage()
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
        <button onClick={onClose} className="px-6 py-3 rounded-xl bg-indigo-600 text-white font-semibold text-sm">{t('dict.done')}</button>
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
              ? <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${eType.className}`}>{entryLabel(current.entryType, lang)}</span>
              : <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${pos.className}`}>{posLabel(current.pos, lang)}</span>
            }
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[current.status]}`}>{current.status}</span>
          </div>
          <p className="text-3xl font-bold text-gray-900 leading-tight">{current.word}</p>
          {current.form && current.pos !== 'noun' && (
            <p className="text-sm text-gray-400 italic -mt-2">{current.form}</p>
          )}
          {current.translation
            ? <p className="text-lg text-gray-600">{displayTranslation(current.translation)}</p>
            : <p className="text-sm text-gray-300 italic">{t('dict.noTranslation')}</p>
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
function BulkIdentifyModal({ words, onClose, onWordIdentified, interfaceLanguage, targetLanguageName = 'German', topics = [] }) {
  const { t } = useLanguage()
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
        const idResult = await identifyWordAI(w.word, targetLanguageName, interfaceLanguage, null, { topics })
        const result = primaryEntry(idResult) ?? {}
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
            <h3 className="text-lg font-bold text-gray-900">{t('dict.identifyUnidentified')}</h3>
            {!running && <button onClick={onClose} className="text-gray-300 hover:text-gray-600 text-2xl leading-none">×</button>}
          </div>

          {!running && !done && (
            <>
              <p className="text-sm text-gray-500 mb-4">
                Found <span className="font-semibold text-gray-800">{total}</span> word{total !== 1 ? 's' : ''} without translation or explanation.
                Claude will identify them one by one.
              </p>
              {total === 0
                ? <p className="text-sm text-green-600 bg-green-50 rounded-xl px-4 py-3 mb-5">✓ {t('dict.allIdentified')}</p>
                : (
                  <div className="bg-gray-50 rounded-2xl px-4 py-3 mb-5 max-h-48 overflow-y-auto">
                    <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">{t('dict.wordsToIdentify')}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {unidentified.map(w => (
                        <span key={w.id} className="px-2.5 py-1 bg-white border border-gray-200 rounded-full text-xs text-gray-600">{w.word}</span>
                      ))}
                    </div>
                  </div>
                )
              }
              <div className="flex gap-2">
                <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-500 text-sm font-medium hover:bg-gray-50">{t('dict.cancel')}</button>
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
              <div className={`text-2xl font-bold ${errors.length === 0 ? 'text-green-600' : 'text-amber-600'}`}>{errors.length === 0 ? '✓' : '!'}</div>
              <p className="text-lg font-bold text-gray-900">
                {succeeded} of {total} identified
              </p>
              {errors.length > 0 && (
                <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 w-full text-left">
                  <p className="text-xs text-red-600 font-semibold mb-1">Failed ({errors.length}):</p>
                  <p className="text-xs text-red-500">{errors.join(', ')}</p>
                </div>
              )}
              <button onClick={onClose} className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold">{t('dict.done')}</button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ── Bulk import parser ────────────────────────────────────────────────────

// ── Bulk import modal ─────────────────────────────────────────────────────
function BulkImportModal({ onClose, onImport }) {
  const { t } = useLanguage()
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
        <button onClick={onClose} className="w-full py-2.5 rounded-xl bg-indigo-600 text-white font-semibold text-sm">{t('dict.done')}</button>
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">{t('dict.bulkImport')}</h2>
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

// ── Collections modal (manage + create with AI pre-select) ─────────────────
function CollectionsModal({ collections, words, membershipByWord, countByCollection, targetLanguageName, onCreate, onRename, onDelete, onClose }) {
  const { t } = useLanguage()
  const [mode, setMode]       = useState(collections.length ? 'list' : 'create') // list | create
  const [name, setName]       = useState('')
  const [color, setColor]     = useState(nextColor(collections))
  const [checked, setChecked] = useState(() => new Set())
  const [suggesting, setSuggesting] = useState(false)
  const [creating, setCreating]     = useState(false)
  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)

  const toggle = (id) => setChecked(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  async function handleSuggest() {
    if (!name.trim() || !words.length) return
    setSuggesting(true)
    try {
      const ids = await suggestCollectionWords(name.trim(), words.map(w => ({ id: w.id, word: w.word, translation: w.translation })), targetLanguageName)
      const valid = new Set(words.map(w => String(w.id)))
      setChecked(new Set(ids.map(String).filter(id => valid.has(id))))
    } catch (e) {
      console.error('suggestCollectionWords failed:', e)
    } finally {
      setSuggesting(false)
    }
  }

  async function handleCreate() {
    if (!name.trim()) return
    setCreating(true)
    try {
      // `checked` holds stringified ids; map back to original word id types
      const wordIds = words.filter(w => checked.has(String(w.id))).map(w => w.id)
      await onCreate(name.trim(), color, wordIds)
      setName(''); setColor(nextColor(collections)); setChecked(new Set())
      setMode('list')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">{mode === 'create' ? t('dict.newCollectionTitle') : t('dict.collectionsTitle')}</h2>
          <button onClick={onClose} className="text-gray-300 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        {/* ── List / manage ── */}
        {mode === 'list' && (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-2">
              {collections.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-8">No collections yet.</p>
              )}
              {collections.map((c) => {
                const col = collectionColor(c.color)
                return (
                  <div key={c.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-gray-100 hover:bg-gray-50">
                    <span className={`w-3 h-3 rounded-full shrink-0 ${col.dot}`} />
                    {renamingId === c.id ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && renameValue.trim()) { onRename(c.id, renameValue.trim()); setRenamingId(null) }
                          if (e.key === 'Escape') setRenamingId(null)
                        }}
                        onBlur={() => setRenamingId(null)}
                        className="flex-1 border border-indigo-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-indigo-500"
                      />
                    ) : (
                      <span className="flex-1 text-sm font-medium text-gray-800">{c.name}</span>
                    )}
                    <span className="text-xs text-gray-400">{countByCollection[c.id] || 0} words</span>
                    <button onClick={() => { setRenamingId(c.id); setRenameValue(c.name) }} className="text-gray-300 hover:text-indigo-500 text-sm px-1" title="Rename">✎</button>
                    {confirmDelete === c.id ? (
                      <button onClick={() => { onDelete(c.id); setConfirmDelete(null) }} className="text-xs font-semibold text-red-500 hover:text-red-600">Delete?</button>
                    ) : (
                      <button onClick={() => setConfirmDelete(c.id)} className="text-gray-400 hover:text-red-500 px-1 transition-colors" title={t('dict.deleteBtn')}><TrashIcon /></button>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="px-6 py-4 border-t border-gray-100">
              <button
                onClick={() => { setMode('create'); setName(''); setColor(nextColor(collections)); setChecked(new Set()) }}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-sm font-semibold transition-colors"
              >
                {t('dict.newCollectionTitle')}
              </button>
            </div>
          </>
        )}

        {/* ── Create ── */}
        {mode === 'create' && (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
              <div className="flex gap-2">
                <input
                  autoFocus
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Collection name (e.g. Colors, Body parts)"
                  className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-400"
                />
              </div>

              {/* Color picker */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">{t('dict.colorLabel')}</span>
                {COLLECTION_COLOR_KEYS.map(k => (
                  <button
                    key={k}
                    onClick={() => setColor(k)}
                    className={`w-6 h-6 rounded-full ${collectionColor(k).dot} transition-transform ${color === k ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : 'hover:scale-110'}`}
                  />
                ))}
              </div>

              {/* AI suggest */}
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-gray-400">
                  {checked.size > 0 ? `${checked.size} word${checked.size !== 1 ? 's' : ''} selected` : 'Pick words below, or let AI find matches'}
                </p>
                <button
                  onClick={handleSuggest}
                  disabled={!name.trim() || suggesting || !words.length}
                  className="px-3 py-1.5 rounded-full text-xs font-semibold border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                >
                  {suggesting ? t('dict.finding') : t('dict.suggestWithAi')}
                </button>
              </div>

              {/* Word checklist */}
              <div className="border border-gray-100 rounded-2xl divide-y divide-gray-50 max-h-64 overflow-y-auto">
                {words.length === 0 && <p className="text-sm text-gray-400 text-center py-6">No words in your dictionary yet.</p>}
                {words.map(w => {
                  const isChecked = checked.has(String(w.id))
                  return (
                    <button
                      key={w.id}
                      onClick={() => toggle(String(w.id))}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${isChecked ? 'bg-indigo-50/60' : 'hover:bg-gray-50'}`}
                    >
                      <span className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] shrink-0 ${isChecked ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-300'}`}>
                        {isChecked && '✓'}
                      </span>
                      <span className="text-sm font-medium text-gray-800">{w.word}</span>
                      {w.translation && <span className="text-xs text-gray-400 truncate">{w.translation}</span>}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
              {collections.length > 0 && (
                <button onClick={() => setMode('list')} className="px-4 py-2.5 rounded-2xl border border-gray-200 text-sm text-gray-500 hover:bg-gray-50">
                  Back
                </button>
              )}
              <button
                onClick={handleCreate}
                disabled={!name.trim() || creating}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-200 disabled:cursor-not-allowed text-white rounded-2xl text-sm font-semibold transition-colors"
              >
                {creating ? 'Creating…' : checked.size > 0 ? `Create with ${checked.size} word${checked.size !== 1 ? 's' : ''}` : 'Create empty collection'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────

// Rewrite existing glosses so each sense reads as one clear meaning.
//
// Text only, and never without showing the learner what will change first: this
// UPDATEs rows in a dictionary someone has been studying from for a month. Sense
// ids are untouched, so interval_step / next_review_date / lapses all survive —
// the reason this is a re-gloss and not a re-identify.
// Repairing the written notes.
//
// The audit finds defects a learner cannot catch — a Latin B inside Берегти, a
// Russian "или", fourteen spellings of "countable noun". This shows every one
// with its correction, and writes only what is ticked.
//
// It writes ONE text column per row, by sense id. It never touches SRS state,
// never re-inserts a row, and never changes an id — the tool that did that cost
// a word its whole study history, and was fixed this morning. Undo is the
// export taken beforehand, which is why this refuses to run without one.
function RepairNotesModal({ onClose, userId, targetLang, lang, onApplied }) {
  const [phase, setPhase] = useState('idle')   // idle | scanning | review | applying | done | error
  const [rows, setRows] = useState([])
  const [chosen, setChosen] = useState({})
  const [error, setError] = useState(null)
  const [applied, setApplied] = useState(0)
  const uk = lang === 'uk'

  async function scan() {
    setPhase('scanning'); setError(null)
    try {
      const { data, error: err } = await supabase
        .from('word_senses')
        .select('id, word_form, translation, explanation, grammar_note, usage_note')
        .eq('user_id', userId).eq('target_language', targetLang)
      if (err) throw err
      const found = (data ?? []).flatMap(repairSense).filter((r) => r.after)
      setRows(found)
      setChosen(Object.fromEntries(found.map((r, i) => [i, true])))
      setPhase('review')
    } catch (e) { setError(e?.message ?? String(e)); setPhase('error') }
  }

  async function apply() {
    setPhase('applying'); setError(null)
    try {
      let n = 0
      for (const [i, row] of rows.entries()) {
        if (!chosen[i]) continue
        // One column, keyed by the sense's own id. Nothing else can be reached
        // from here, which is the point.
        const { error: err } = await supabase.from('word_senses')
          .update({ [row.field]: row.after })
          .eq('id', row.senseId).eq('user_id', userId)
        if (err) throw err
        n++
      }
      setApplied(n); setPhase('done'); onApplied?.()
    } catch (e) { setError(e?.message ?? String(e)); setPhase('error') }
  }

  const count = Object.values(chosen).filter(Boolean).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={phase === 'applying' ? undefined : onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{uk ? 'Виправити нотатки' : 'Repair notes'}</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {uk ? 'Змінюється лише текст. Історія вивчення не торкається.'
                  : 'Text only. Study history is never touched.'}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-300 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {phase === 'idle' && (
            <div className="text-sm text-gray-600 flex flex-col gap-3">
              <p>{uk
                ? 'Спершу зробіть експорт — це єдиний спосіб повернути текст назад.'
                : 'Export first — that is the only way to put the old text back.'}</p>
              <button onClick={scan} className="self-start bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors">
                {uk ? 'Знайти помилки' : 'Find the defects'}
              </button>
            </div>
          )}

          {phase === 'scanning' && <p className="text-sm text-gray-500">{uk ? 'Перевіряю…' : 'Checking…'}</p>}

          {phase === 'review' && rows.length === 0 && (
            <p className="text-sm text-gray-600">{uk ? 'Нічого не знайдено.' : 'Nothing found.'}</p>
          )}

          {phase === 'review' && rows.map((row, i) => (
            <label key={i} className="flex gap-3 py-3 border-b border-gray-50 cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(chosen[i])}
                onChange={(e) => setChosen((c) => ({ ...c, [i]: e.target.checked }))}
                className="mt-1 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-gray-400 mb-1">
                  <span className="font-semibold text-gray-600">{row.word}</span>
                  {' · '}{row.field.replace('_', ' ')}
                  {row.oneOff && <span className="ml-2 text-indigo-400">{uk ? 'вручну' : 'written by hand'}</span>}
                </p>
                <p className="text-sm text-rose-700 line-through decoration-rose-200 break-words">{row.before}</p>
                <p className="text-sm text-green-700 break-words">{row.after}</p>
              </div>
            </label>
          ))}

          {phase === 'applying' && <p className="text-sm text-gray-500">{uk ? 'Записую…' : 'Writing…'}</p>}
          {phase === 'done' && (
            <p className="text-sm text-green-700 font-medium">
              {uk ? `Виправлено: ${applied}.` : `${applied} notes repaired.`}
            </p>
          )}
          {phase === 'error' && <p className="text-sm text-rose-600">{error}</p>}
        </div>

        {phase === 'review' && rows.length > 0 && (
          <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
            <p className="text-xs text-gray-400">
              {uk ? `Вибрано ${count} із ${rows.length}` : `${count} of ${rows.length} selected`}
            </p>
            <button
              onClick={apply}
              disabled={!count}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
            >
              {uk ? `Застосувати (${count})` : `Apply ${count}`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function ReglossModal({ onClose, userId, targetLang, targetLanguageName, lang, onApplied }) {
  const [phase, setPhase] = useState("idle") // idle | scanning | review | applying | done | error
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [rows, setRows] = useState([])
  const [error, setError] = useState(null)
  const [restored, setRestored] = useState(0)
  const uk = lang === "uk"

  // Undo. Every proposal this modal writes replaces a gloss that existed before,
  // and an export taken beforehand holds every one of them verbatim — so putting
  // them back is just an UPDATE keyed by the same sense ids. Worth having
  // unconditionally: this tool rewrites a dictionary someone studies from, and a
  // preview you have to read 104 rows of is not, on its own, a safety net.
  async function restoreFromFile(file) {
    if (!file) return
    setPhase("applying"); setError(null)
    try {
      const data = JSON.parse(await file.text())
      const senses = Array.isArray(data?.senses) ? data.senses : []
      if (!senses.length) throw new Error(uk ? "У файлі немає значень." : "No senses found in that file.")
      let n = 0
      for (const x of senses) {
        if (!x?.id || typeof x.translation !== "string") continue
        const patch = { translation: x.translation }
        if (typeof x.explanation === "string") patch.explanation = x.explanation
        const { error: upErr } = await supabase.from("word_senses")
          .update(patch)
          .eq("id", x.id).eq("user_id", userId)
        if (upErr) throw upErr
        n++
      }
      setRestored(n); setRows([]); setPhase("done"); onApplied?.()
    } catch (e) { setError(e?.message ?? String(e)); setPhase("error") }
  }

  async function scan() {
    setPhase("scanning"); setError(null); setRows([])
    try {
      const [w, sn] = await Promise.all([
        supabase.from("words").select("id, word, pos").eq("user_id", userId).eq("target_language", targetLang),
        supabase.from("word_senses").select("id, word_id, translation, explanation").eq("user_id", userId).eq("target_language", targetLang),
      ])
      if (w.error || sn.error) throw (w.error || sn.error)
      const byWord = new Map()
      for (const x of sn.data ?? []) {
        if (!byWord.has(x.word_id)) byWord.set(x.word_id, [])
        byWord.get(x.word_id).push(x)
      }
      // Every sense of a word goes in the same request — two senses cannot be
      // made distinct from each other unless the model sees both.
      const entries = (w.data ?? []).filter(x => byWord.has(x.id))
        .map(x => ({ word: x.word, pos: x.pos, senses: byWord.get(x.id) }))
      setProgress({ done: 0, total: entries.length })
      const found = []
      const BATCH = 8
      for (let i = 0; i < entries.length; i += BATCH) {
        const chunk = entries.slice(i, i + BATCH)
        let map = {}
        // One bad batch must not lose the ones that already succeeded.
        try { map = await reglossSenses(chunk, targetLanguageName) } catch { map = {} }
        for (const e of chunk) for (const x of e.senses) {
          const got = map[x.id]
          if (!got) continue
          const next = (got.translation ?? "").trim()
          const nextExpl = (got.explanation ?? "").trim()
          const glossChanged = next && next !== (x.translation ?? "").trim()
          const explChanged = nextExpl && nextExpl !== (x.explanation ?? "").trim()
          if (glossChanged || explChanged) {
            found.push({
              id: x.id, word: e.word,
              old: x.translation ?? "", next: next || (x.translation ?? ""),
              oldExpl: x.explanation ?? "", nextExpl: nextExpl || null,
              checked: true,
            })
          }
        }
        setProgress({ done: Math.min(i + BATCH, entries.length), total: entries.length })
        setRows([...found])
      }
      setPhase("review")
    } catch (e) { setError(e?.message ?? String(e)); setPhase("error") }
  }

  async function apply() {
    setPhase("applying")
    const picked = rows.filter(r => r.checked)
    for (const r of picked) {
      const patch = { translation: r.next }
      if (r.nextExpl) patch.explanation = r.nextExpl
      const { error: upErr } = await supabase.from("word_senses").update(patch).eq("id", r.id).eq("user_id", userId)
      if (upErr) { setError(upErr.message); setPhase("error"); return }
    }
    setPhase("done"); onApplied?.()
  }

  const picked = rows.filter(r => r.checked).length
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">{uk ? "Почистити переклади" : "Clean up glosses"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        {phase === "idle" && (
          <div className="p-6 flex flex-col gap-4">
            <p className="text-sm text-gray-600">
              {uk
                ? "Кожне значення отримає один чіткий переклад замість списку синонімів, і всі — мовою інтерфейсу. Значення НЕ додаються, не об'єднуються і не розділяються, тож ваш прогрес у вивченні зберігається повністю."
                : "Each sense gets one clear gloss instead of a pile of synonyms, all in your interface language. No sense is added, merged or re-split, so your learning progress is kept in full."}
            </p>
            <p className="text-xs text-gray-400">{uk ? "Ви побачите всі зміни перед тим, як щось буде збережено." : "You will see every change before anything is saved."}</p>
            <button onClick={scan} className="py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors">
              {uk ? "Переглянути зміни" : "Preview changes"}
            </button>
            <div className="border-t border-gray-100 pt-4 mt-1">
              <p className="text-xs font-semibold text-gray-500 mb-1">{uk ? "Відновити з файлу експорту" : "Restore from an export file"}</p>
              <p className="text-xs text-gray-400 mb-2">
                {uk
                  ? "Повертає переклади точно такими, якими вони були на момент експорту. Нічого іншого не змінює."
                  : "Puts every gloss back exactly as it was when the file was exported. Changes nothing else."}
              </p>
              <input type="file" accept="application/json,.json"
                onChange={(e) => restoreFromFile(e.target.files?.[0])}
                className="text-xs text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-gray-200 file:text-xs file:font-semibold file:bg-white file:text-gray-600" />
            </div>
          </div>
        )}

        {phase === "scanning" && (
          <div className="p-6 flex flex-col gap-3">
            <p className="text-sm text-gray-600">{uk ? "Аналізую словник…" : "Reading the dictionary…"} {progress.done} / {progress.total}</p>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-500 transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
            </div>
            <p className="text-xs text-gray-400">{rows.length} {uk ? "змін знайдено" : "changes found so far"}</p>
          </div>
        )}

        {phase === "review" && (
          <>
            <div className="overflow-y-auto flex-1">
              {rows.length === 0 ? (
                <p className="p-6 text-sm text-gray-500">{uk ? "Нічого міняти — словник уже чистий." : "Nothing to change — the dictionary is already clean."}</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-400 font-semibold uppercase tracking-wide sticky top-0">
                    <tr>
                      <th className="px-3 py-2 w-8"></th>
                      <th className="px-3 py-2 text-left">{uk ? "Слово" : "Word"}</th>
                      <th className="px-3 py-2 text-left">{uk ? "Було" : "Now"}</th>
                      <th className="px-3 py-2 text-left">{uk ? "Стане" : "Becomes"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {rows.map((r, i) => (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2">
                          <input type="checkbox" checked={r.checked}
                            onChange={() => setRows(rs => rs.map((x, j) => j === i ? { ...x, checked: !x.checked } : x))} />
                        </td>
                        <td className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">{r.word}</td>
                        <td className="px-3 py-2 text-gray-400 align-top">
                          <div className="line-through">{r.old}</div>
                          {r.nextExpl && <div className="text-[11px] mt-1 max-w-xs">{r.oldExpl}</div>}
                        </td>
                        <td className="px-3 py-2 text-gray-900 align-top">
                          <div className="font-medium">{r.next}</div>
                          {r.nextExpl && <div className="text-[11px] text-gray-500 mt-1 max-w-xs">{r.nextExpl}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex gap-2">
              <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-semibold">{uk ? "Скасувати" : "Cancel"}</button>
              <button onClick={apply} disabled={!picked}
                className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-200 text-white text-sm font-semibold transition-colors">
                {uk ? `Застосувати ${picked}` : `Apply ${picked}`}
              </button>
            </div>
          </>
        )}

        {phase === "applying" && <p className="p-6 text-sm text-gray-600">{uk ? "Зберігаю…" : "Saving…"}</p>}
        {phase === "done" && (
          <div className="p-6 flex flex-col gap-4">
            <p className="text-sm text-gray-900 font-semibold">
              {uk ? "Готово." : "Done."} {restored || picked} {uk ? "значень оновлено." : "senses updated."}
            </p>
            <button onClick={onClose} className="py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold">{uk ? "Закрити" : "Close"}</button>
          </div>
        )}
        {phase === "error" && (
          <div className="p-6 flex flex-col gap-4">
            <p className="text-sm text-rose-600">{error}</p>
            <button onClick={() => setPhase("idle")} className="py-2.5 rounded-xl border border-gray-200 text-sm font-semibold">{uk ? "Спробувати ще" : "Try again"}</button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function Dictionary() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const { t, lang } = useLanguage()
  const { targetLang, targetLanguageName, speechLocale } = useTargetLang()
  const interfaceLanguage = lang === 'uk' ? 'Ukrainian' : 'English'
  const topics = profile?.topics ?? []

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
  // Hold the selected word's ID, not a copy of the word. The panel then always
  // renders whatever is currently in `words` — so a re-identify (which refetches
  // the list) shows its new examples immediately. Holding a snapshot meant the open
  // panel kept rendering the stale copy until you closed it or reloaded the page.
  const [selectedId, setSelectedId] = useState(null)
  const selectedWord = useMemo(
    () => (selectedId == null ? null : words.find((w) => String(w.id) === String(selectedId)) ?? null),
    [words, selectedId],
  )
  const [showAddModal, setShowAddModal] = useState(false)
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [showSortMode, setShowSortMode]   = useState(false)
  const [showBulkIdentify, setShowBulkIdentify] = useState(false)
  const [collections, setCollections]   = useState([])
  const [memberships, setMemberships]   = useState([]) // { collection_id, word_id }
  const [filterCollection, setFilterCollection] = useState('all')
  const [showCollectionsModal, setShowCollectionsModal] = useState(false)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds]     = useState(() => new Set())
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
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

    const wordIds = wordRows.map((w) => w.id)

    const [{ data: exampleRows }, { data: senseRows }] = await Promise.all([
      supabase.from('examples').select('*').in('word_id', wordIds),
      supabase.from('word_senses').select('*').in('word_id', wordIds).order('created_at', { ascending: true }),
    ])

    const examplesByWordId = {}
    for (const ex of exampleRows || []) {
      if (!examplesByWordId[ex.word_id]) examplesByWordId[ex.word_id] = []
      examplesByWordId[ex.word_id].push(ex)
    }
    const sensesByWordId = {}
    for (const s of senseRows || []) {
      if (!sensesByWordId[s.word_id]) sensesByWordId[s.word_id] = []
      sensesByWordId[s.word_id].push(s)
    }

    setWords(wordRows.map(row => dbToWord(row, examplesByWordId[row.id] || [], sensesByWordId[row.id] || [])))
    setLoadingWords(false)
  }

  // ── Collections ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return
    loadCollections()
  }, [user, targetLang])

  async function loadCollections() {
    const { collections, memberships } = await fetchCollectionsData(user.id, targetLang)
    setCollections(collections)
    setMemberships(memberships)
    setFilterCollection(prev => prev === 'all' || collections.some(c => c.id === prev) ? prev : 'all')
  }

  const membershipByWord = useMemo(() => {
    const m = {}
    for (const r of memberships) (m[r.word_id] ??= new Set()).add(r.collection_id)
    return m
  }, [memberships])

  const countByCollection = useMemo(() => {
    const c = {}
    for (const r of memberships) c[r.collection_id] = (c[r.collection_id] || 0) + 1
    return c
  }, [memberships])

  async function toggleWordCollection(wordId, collectionId) {
    const isMember = membershipByWord[wordId]?.has(collectionId)
    if (isMember) {
      setMemberships(prev => prev.filter(r => !(String(r.word_id) === String(wordId) && r.collection_id === collectionId)))
      await removeWordFromCollection(collectionId, wordId)
    } else {
      setMemberships(prev => [...prev, { collection_id: collectionId, word_id: wordId }])
      await addWordToCollection(user.id, collectionId, wordId)
    }
  }

  async function handleQuickCreateCollection(name, wordId) {
    await createCollection(user.id, targetLang, name, nextColor(collections), wordId ? [wordId] : [])
    await loadCollections()
  }

  async function handleCreateCollection(name, color, wordIds) {
    await createCollection(user.id, targetLang, name, color, wordIds)
    await loadCollections()
  }

  async function handleRenameCollection(id, name) {
    setCollections(prev => prev.map(c => c.id === id ? { ...c, name } : c))
    await renameCollection(id, name)
  }

  async function handleDeleteCollection(id) {
    setCollections(prev => prev.filter(c => c.id !== id))
    setMemberships(prev => prev.filter(r => r.collection_id !== id))
    if (filterCollection === id) setFilterCollection('all')
    await deleteCollection(id)
  }

  const filtered = words
    .filter((w) => {
      const matchSearch  = w.word.toLowerCase().includes(search.toLowerCase()) ||
                           (w.translation || '').toLowerCase().includes(search.toLowerCase())
      const matchStatus  = filterStatus === 'all' || w.status === filterStatus
      const matchType    = filterType   === 'all' || w.entryType === filterType
      const matchCollection = filterCollection === 'all' || membershipByWord[w.id]?.has(filterCollection)
      return matchSearch && matchStatus && matchType && matchCollection
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

  async function handleAdd(payload) {
    if (!user) return
    const candidates = payload.candidates ?? [payload] // tolerate a single entry
    for (const c of candidates) {
      const { wordRow, senseRows } = candidateToRows(c, { userId: user.id, targetLang, source: payload.source })
      const { data: newWord, error } = await supabase.from('words').insert(wordRow).select('id').single()
      if (error || !newWord) continue
      if (senseRows.length) {
        await supabase.from('word_senses').insert(senseRows.map(r => ({ ...r, word_id: newWord.id })))
      }
    }
    fetchWords()
  }

  async function handleDelete(wordId) {
    if (!user) return
    const doomed = words.find(w => w.id === wordId)
    ;(doomed?.senses || []).forEach(s => s.imageUrl && deleteSenseImageByUrl(s.imageUrl))
    await supabase.from('examples').delete().eq('word_id', wordId)
    await supabase.from('words').delete().eq('id', wordId).eq('user_id', user.id)
    setWords((prev) => prev.filter((w) => w.id !== wordId))
    setSelectedId(null)
  }

  // Delete ONE sense directly by id. Deliberately NOT routed through handleUpdate,
  // which re-inserts all sense rows and would reset the v2 SRS columns
  // (interval_step, lapses, …) on the surviving siblings.
  async function handleDeleteSense(wordId, senseId) {
    if (!user) return
    const w = words.find((x) => x.id === wordId)
    if (!w) return
    const doomed = (w.senses || []).find((s) => s.id === senseId)
    if (doomed?.imageUrl) deleteSenseImageByUrl(doomed.imageUrl)
    await supabase.from('word_senses').delete().eq('id', senseId).eq('user_id', user.id)
    const remaining = (w.senses || []).filter((s) => s.id !== senseId)
    const updatedWord = { ...w, senses: remaining, hasSenses: remaining.length > 0 }
    setWords((prev) => prev.map((x) => (x.id === wordId ? updatedWord : x)))
  }

  async function handleUpdate(updated) {
    if (!user) return
    const primarySense = updated.senses?.[0]
    await supabase
      .from('words')
      .update({
        translation: primarySense?.translation ?? updated.translation,
        grammar_note: primarySense?.grammarNote ?? updated.grammarNote,
        explanation: primarySense?.explanation ?? updated.explanation,
        form: primarySense?.form ?? updated.form ?? null,
        pos: primarySense?.pos ?? updated.pos ?? null,
        is_exception: primarySense?.isException ?? updated.isException ?? false,
        conjugation: primarySense?.conjugation ?? updated.conjugation ?? null,
      })
      .eq('id', updated.id)
      .eq('user_id', user.id)

    // Edit the sense rows in place. This used to delete every row for the word
    // and re-insert it, which minted new sense ids and dropped interval_step,
    // lapses, is_leech, slipped, last_reviewed and image_url — so editing a
    // note cost the learner that word's entire study history. An edit is now an
    // UPDATE keyed by the sense's own id, touching only editable columns.
    if (updated.senses?.length) {
      const previous = words.find((w) => w.id === updated.id)?.senses ?? []
      const { updates, inserts, deletes } = planSenseWrites(previous, updated.senses)

      for (const { id, patch } of updates) {
        const { error } = await supabase.from('word_senses')
          .update(patch).eq('id', id).eq('user_id', user.id)
        if (error) { alert(`Save failed: ${error.message}`); return }
      }

      if (inserts.length) {
        const { error } = await supabase.from('word_senses').insert(
          inserts.map(s => ({
            word_id: updated.id,
            user_id: user.id,
            target_language: targetLang,
            pos: s.pos,
            word_form: s.wordForm || updated.word,
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
            learning_stage: s.learningStage || 'new',
            correct_recall_count: s.correctRecallCount || 0,
            next_review_date: s.nextReviewDate || null,
          }))
        )
        if (error) { alert(`Save failed: ${error.message}`); return }
      }

      // Only senses the learner actually removed, by their own ids.
      for (const id of deletes) {
        await supabase.from('word_senses').delete().eq('id', id).eq('user_id', user.id)
      }
    } else if (updated.examples?.length) {
      await supabase.from('examples').delete().eq('word_id', updated.id)
      await supabase.from('examples').insert(
        updated.examples.map(ex => ({
          word_id: updated.id,
          sentence_target: ex.target,
          sentence_translation: ex.translation,
          tense: ex.tense || null,
        }))
      )
    }

    fetchWords()
  }

  function handleSenseImageChange(senseId, imageUrl) {
    const patchSenses = (w) => ({ ...w, senses: w.senses?.map(s => s.id === senseId ? { ...s, imageUrl } : s) })
    setWords(prev => prev.map(w => w.senses?.some(s => s.id === senseId) ? patchSenses(w) : w))
  }

  // The write itself happens in WordPanel (setSenseStage); this only patches
  // local state so the derived word badge (badgeForWord) refreshes immediately.
  function handleSenseStageChange(senseId, patch) {
    setWords(prev => prev.map(w => {
      if (!w.senses?.some(s => s.id === senseId)) return w
      const senses = w.senses.map(s => s.id === senseId ? { ...s, learningStage: patch.learning_stage } : s)
      const status = badgeForWord(senses.map(s => ({ learning_stage: s.learningStage })), w.status)
      return { ...w, senses, status }
    }))
  }

  // QuickSortMode sets the WORD's status, but the only real SRS state lives on
  // its senses — so this writes the primary sense's stage (word_senses), not
  // the dead words.status column. A word with no senses yet has nothing to
  // write (it keeps the legacy fallback badgeForWord already handles).
  async function handleQuickStatusChange(wordId, newStatus) {
    if (!user) return
    const w = words.find(x => x.id === wordId)
    const primarySenseId = w?.senses?.[0]?.id
    if (!primarySenseId) return
    const patch = manualStagePatch(newStatus, new Date().toISOString().slice(0, 10))
    await supabase.from('word_senses').update(patch).eq('id', primarySenseId).eq('user_id', user.id)
    setWords(prev => prev.map(x => x.id === wordId
      ? { ...x, status: newStatus, senses: x.senses.map((s, i) => i === 0 ? { ...s, learningStage: patch.learning_stage } : s) }
      : x))
  }

  // ── Bulk selection + delete ──────────────────────────────────────────────
  function exitSelection() {
    setSelectionMode(false)
    setSelectedIds(new Set())
    setConfirmBulkDelete(false)
  }

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const allFilteredSelected = filtered.length > 0 && filtered.every(w => selectedIds.has(w.id))

  function toggleSelectAll() {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (filtered.every(w => next.has(w.id))) filtered.forEach(w => next.delete(w.id))
      else filtered.forEach(w => next.add(w.id))
      return next
    })
  }

  async function handleBulkDelete() {
    const ids = [...selectedIds]
    if (!ids.length) return
    const idStr = new Set(ids.map(String))
    words.forEach(w => idStr.has(String(w.id)) && (w.senses || []).forEach(s => s.imageUrl && deleteSenseImageByUrl(s.imageUrl)))
    await supabase.from('examples').delete().in('word_id', ids)
    await supabase.from('words').delete().in('id', ids).eq('user_id', user.id)
    setWords(prev => prev.filter(w => !idStr.has(String(w.id))))
    setMemberships(prev => prev.filter(r => !idStr.has(String(r.word_id))))
    if (selectedWord && idStr.has(String(selectedWord.id))) setSelectedId(null)
    exitSelection()
  }

  // Download the whole dictionary as JSON. Exists so the dictionary can be
  // AUDITED — duplicate senses, overstuffed translations and missing meanings
  // are only visible across the whole set, and there was previously no way to
  // see it except one word at a time in the UI. Also a plain backup.
  const [exporting, setExporting] = useState(false)
  const [showRegloss, setShowRegloss] = useState(false)
  const [showRepair, setShowRepair] = useState(false)
  async function handleExport() {
    if (exporting) return
    setExporting(true)
    try {
      const [w, s] = await Promise.all([
        supabase.from('words').select('*').eq('user_id', user.id).eq('target_language', targetLang),
        supabase.from('word_senses').select('*').eq('user_id', user.id).eq('target_language', targetLang),
      ])
      if (w.error || s.error) { alert(`Export failed: ${(w.error || s.error).message}`); return }
      const payload = {
        exportedAt: new Date().toISOString(),
        targetLanguage: targetLang,
        words: w.data ?? [],
        senses: s.data ?? [],
      }
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `verba-dictionary-${targetLang}-${new Date().toISOString().split('T')[0]}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Revoking immediately can cancel the download in some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (e) {
      alert(`Export failed: ${e?.message ?? e}`)
    } finally {
      setExporting(false)
    }
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

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('dict.title')}</h1>
            <p className="text-sm text-gray-500 mt-0.5">{loadingWords ? '…' : `${words.length} ${t('dict.entries')}`} · {t(`dict.lang${targetLanguageName}`)}</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setShowBulkModal(true)}
              className="border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 text-gray-600 hover:text-indigo-600 px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
            >
              {t('dict.importList')}
            </button>
            <button
              onClick={() => setShowRepair(true)}
              className="border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 text-gray-600 hover:text-indigo-600 px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
            >
              {lang === 'uk' ? 'Виправити нотатки' : 'Repair notes'}
            </button>
            <button
              onClick={() => setShowRegloss(true)}
              className="border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 text-gray-600 hover:text-indigo-600 px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
            >
              {lang === 'uk' ? 'Почистити переклади' : 'Clean up glosses'}
            </button>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 text-gray-600 hover:text-indigo-600 px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
            >
              {exporting ? (lang === 'uk' ? 'Експортую…' : 'Exporting…') : (lang === 'uk' ? 'Експорт' : 'Export')}
            </button>
            <button
              onClick={() => setShowBulkIdentify(true)}
              className="border border-gray-200 hover:border-amber-300 hover:bg-amber-50 text-gray-600 hover:text-amber-700 px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
              title="Identify all words missing translation or explanation"
            >
              {t('dict.identifyAll')}
            </button>
            <button
              onClick={() => setShowSortMode(true)}
              className="border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 text-gray-600 hover:text-indigo-600 px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
              title="Go through all words and assign status levels"
            >
              {t('dict.sortWords')}
            </button>
            <button
              onClick={() => selectionMode ? exitSelection() : setSelectionMode(true)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors border ${selectionMode ? 'border-indigo-300 bg-indigo-50 text-indigo-600' : 'border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 text-gray-600 hover:text-indigo-600'}`}
              title="Select multiple words to delete"
            >
              {selectionMode ? t('dict.cancel') : t('dict.select')}
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

        {/* Collections filter */}
        <div className="flex flex-wrap gap-2 items-center mb-2">
          <button
            onClick={() => setFilterCollection('all')}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${filterCollection === 'all' ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'}`}
          >
            {t('dict.allWords')}
          </button>
          {collections.map((c) => {
            const col = collectionColor(c.color)
            const active = filterCollection === c.id
            return (
              <button
                key={c.id}
                onClick={() => setFilterCollection(active ? 'all' : c.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors flex items-center gap-1.5 ${active ? col.active : `${col.chip} hover:opacity-80`}`}
              >
                <span className={`w-2 h-2 rounded-full ${active ? 'bg-white/80' : col.dot}`} />
                {c.name}
                <span className={active ? 'opacity-80' : 'opacity-50'}>{countByCollection[c.id] || 0}</span>
              </button>
            )
          })}
          <button
            onClick={() => setShowCollectionsModal(true)}
            className="px-3 py-1.5 rounded-full text-xs font-semibold border border-dashed border-gray-300 text-gray-400 hover:text-indigo-600 hover:border-indigo-300 transition-colors"
          >
            {collections.length ? t('dict.manage') : t('dict.newCollectionTitle')}
          </button>
        </div>

        {/* Practice banner — visible when a collection chip is active */}
        {filterCollection !== 'all' && (() => {
          const activeCol = collections.find(c => c.id === filterCollection)
          if (!activeCol) return null
          const wordCount = countByCollection[activeCol.id] || 0
          return (
            <div className="flex items-center justify-between px-4 py-2.5 rounded-2xl border border-indigo-100 bg-indigo-50 mb-3">
              <span className="text-xs text-indigo-600 font-medium">
                {wordCount} {wordCount === 1 ? 'word' : 'words'} in <span className="font-semibold">{activeCol.name}</span>
              </span>
              {/* Passive flip-through: nothing is graded and nothing is recorded.
                  The graded session lives on the dashboard ("Test me"), so these two
                  must not both read as "Practice". */}
              <button
                onClick={() => navigate(`/flashcards?collectionId=${activeCol.id}&collectionName=${encodeURIComponent(activeCol.name)}`)}
                className="text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-xl transition-colors"
              >
                {t('dict.flipThrough')}
              </button>
            </div>
          )
        })()}

        {/* Bulk selection bar */}
        {selectionMode && (
          <div className="flex items-center justify-between gap-3 mb-3 px-4 py-2.5 bg-indigo-50 border border-indigo-100 rounded-2xl">
            <div className="flex items-center gap-3">
              <button onClick={toggleSelectAll} className="text-xs font-semibold text-indigo-600 hover:text-indigo-800">
                {allFilteredSelected ? 'Clear all' : 'Select all'}
              </button>
              <span className="text-sm text-indigo-700 font-medium">{selectedIds.size} selected</span>
            </div>
            <button
              onClick={() => setConfirmBulkDelete(true)}
              disabled={selectedIds.size === 0}
              className="px-4 py-1.5 rounded-xl text-sm font-semibold bg-red-500 hover:bg-red-600 disabled:bg-red-200 disabled:cursor-not-allowed text-white transition-colors"
            >
              <TrashIcon size={14} /> {t('dict.deleteBtn')} {selectedIds.size > 0 ? selectedIds.size : ''}
            </button>
          </div>
        )}

        <p className="hidden md:flex text-xs text-gray-400 mb-4 items-center gap-1">
          <span>⠿</span> {t('dict.dragHint')}
        </p>

        {/* Table (desktop) */}
        <div className="hidden md:block bg-white rounded-2xl border border-gray-100 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase tracking-wide">
                {selectionMode && (
                  <th className="pl-5 pr-1 py-3 w-8">
                    <button
                      onClick={toggleSelectAll}
                      className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] ${allFilteredSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-300 hover:border-indigo-400'}`}
                    >
                      {allFilteredSelected && '✓'}
                    </button>
                  </th>
                )}
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
              {filtered.map((w, i) => {
                const isSelected = selectedIds.has(w.id)
                return (
                <tr key={w.id} onClick={() => selectionMode ? toggleSelect(w.id) : setSelectedId(w.id)}
                  className={`cursor-pointer transition-colors ${
                    i !== filtered.length - 1 ? 'border-b border-gray-50' : ''
                  } ${isSelected ? 'bg-indigo-50' : selectedWord?.id === w.id ? 'bg-indigo-50/60' : 'hover:bg-indigo-50/40'}`}
                >
                  {selectionMode && (
                    <td className="pl-5 pr-1 py-3.5" onClick={(e) => { e.stopPropagation(); toggleSelect(w.id) }}>
                      <span className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] ${isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-300'}`}>
                        {isSelected && '✓'}
                      </span>
                    </td>
                  )}
                  {columns.map((col) => (
                    <td key={col.id} className="px-5 py-3.5 whitespace-nowrap">
                      {renderCell(col.id, w, t, lang)}
                    </td>
                  ))}
                </tr>
              )})}
            </tbody>
          </table>
        </div>

        {/* Cards (mobile) */}
        <div className="md:hidden flex flex-col gap-2">
          {filtered.map((w) => {
            const isSelected = selectedIds.has(w.id)
            const memberColors = collections.filter(c => membershipByWord[w.id]?.has(c.id))
            const statusLabel = { new: t('dict.statusNew'), learning: t('dict.statusLearning'), known: t('dict.statusKnown'), mastered: t('dict.statusMastered') }[w.status] ?? w.status
            return (
              <div
                key={w.id}
                onClick={() => selectionMode ? toggleSelect(w.id) : setSelectedId(w.id)}
                className={`bg-white rounded-2xl border p-4 flex items-start gap-3 transition-colors ${isSelected ? 'border-indigo-300 bg-indigo-50' : 'border-gray-100'}`}
              >
                {selectionMode && (
                  <span className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center text-[11px] shrink-0 ${isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-300'}`}>{isSelected && '✓'}</span>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-semibold text-gray-900 truncate">{w.word}</span>
                    <span className={`ml-auto shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[w.status] || 'bg-gray-100 text-gray-500'}`}>{statusLabel}</span>
                  </div>
                  {w.translation && <p className="text-sm text-gray-500 truncate">{w.translation}</p>}
                  {memberColors.length > 0 && (
                    <div className="flex items-center gap-1 mt-1.5">
                      {memberColors.map(c => <span key={c.id} className={`w-2 h-2 rounded-full ${collectionColor(c.color).dot}`} />)}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

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
      </main>

      {selectedWord && <WordPanel word={selectedWord} onClose={() => setSelectedId(null)} onUpdate={handleUpdate} onDelete={handleDelete} onDeleteSense={handleDeleteSense} interfaceLanguage={interfaceLanguage} targetLanguageName={targetLanguageName} speechLocale={speechLocale} topics={topics}
        collections={collections} wordCollectionIds={membershipByWord[selectedWord.id]} onToggleCollection={toggleWordCollection} onQuickCreateCollection={handleQuickCreateCollection}
        userId={user.id} onSenseImageChange={handleSenseImageChange} onSenseStageChange={handleSenseStageChange} />}
      {confirmBulkDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 px-4" onClick={() => setConfirmBulkDelete(false)}>
          <div className="bg-white rounded-3xl shadow-2xl p-6 w-full max-w-sm text-center" onClick={e => e.stopPropagation()}>
            <div className="mb-2 flex justify-center text-red-400"><TrashIcon size={28} /></div>
            <p className="font-semibold text-gray-900 mb-1">Delete {selectedIds.size} word{selectedIds.size !== 1 ? 's' : ''}?</p>
            <p className="text-sm text-gray-400 mb-6">This permanently removes them and all their senses, examples, and collection memberships. This can't be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmBulkDelete(false)} className="flex-1 py-2.5 rounded-2xl border border-gray-200 text-sm text-gray-500 hover:bg-gray-50">{t('dict.cancel')}</button>
              <button onClick={handleBulkDelete} className="flex-1 py-2.5 rounded-2xl bg-red-500 hover:bg-red-600 text-white text-sm font-semibold">{t('dict.deleteBtn')}</button>
            </div>
          </div>
        </div>
      )}
      {showCollectionsModal && (
        <CollectionsModal
          collections={collections}
          words={words}
          membershipByWord={membershipByWord}
          countByCollection={countByCollection}
          targetLanguageName={targetLanguageName}
          onCreate={handleCreateCollection}
          onRename={handleRenameCollection}
          onDelete={handleDeleteCollection}
          onClose={() => setShowCollectionsModal(false)}
        />
      )}
      {showAddModal && <AddWordModal onAdd={handleAdd} onClose={() => setShowAddModal(false)} interfaceLanguage={interfaceLanguage} targetLanguageName={targetLanguageName} topics={topics} />}
      {showBulkModal && <BulkImportModal onClose={() => setShowBulkModal(false)} onImport={handleBulkImport} />}
      {showRepair && (
        <RepairNotesModal
          onClose={() => setShowRepair(false)}
          userId={user.id}
          targetLang={targetLang}
          lang={lang}
          onApplied={fetchWords}
        />
      )}
      {showRegloss && (
        <ReglossModal
          onClose={() => setShowRegloss(false)}
          userId={user.id}
          targetLang={targetLang}
          targetLanguageName={targetLanguageName}
          lang={lang}
          onApplied={fetchWords}
        />
      )}
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
          targetLanguageName={targetLanguageName}
          topics={topics}
        />
      )}
    </div>
  )
}
