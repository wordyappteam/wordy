import { supabase } from './supabase'

// ── Stage constants ────────────────────────────────────────────────────────
export const STAGE = {
  NEW:           0,
  EARLY:         1,  // learning — just introduced
  MID:           2,  // learning — recognises but not solid
  LATE:          3,  // learning — close to known, needs grammar checks
  KNOWN:         4,  // knows the word + basic grammar
  MASTERED:      5,  // uses it correctly in different tenses / contexts
}

export const STAGE_LABEL = {
  0: 'new',
  1: 'learning',
  2: 'learning',
  3: 'learning',
  4: 'known',
  5: 'mastered',
}

// Display status derived from stage (used for UI badges etc.)
export function stageToStatus(stage) {
  return STAGE_LABEL[stage] ?? 'new'
}

// ── Promotion criteria ─────────────────────────────────────────────────────
// Each stage gate: { minRecalls, minSessions, minDaysSinceFirst }
// Late learning (→ known) also requires grammar exercises — enforced by
// exercise gating, not just these counters.
const PROMOTION_CRITERIA = {
  [STAGE.NEW]:   { minRecalls: 1,  minSessions: 1, minDays: 0  },  // → EARLY
  [STAGE.EARLY]: { minRecalls: 3,  minSessions: 2, minDays: 1  },  // → MID
  [STAGE.MID]:   { minRecalls: 6,  minSessions: 4, minDays: 3  },  // → LATE
  [STAGE.LATE]:  { minRecalls: 8,  minSessions: 5, minDays: 5  },  // → KNOWN
  [STAGE.KNOWN]: { minRecalls: 12, minSessions: 8, minDays: 21 },  // → MASTERED
}

function daysSince(dateStr) {
  if (!dateStr) return 0
  const diff = Date.now() - new Date(dateStr).getTime()
  return Math.floor(diff / (1000 * 60 * 60 * 24))
}

// Returns the new stage if promotion criteria are met, otherwise current stage
export function checkPromotion(word) {
  const stage = word.learning_stage ?? STAGE.NEW
  if (stage >= STAGE.MASTERED) return stage

  const criteria = PROMOTION_CRITERIA[stage]
  if (!criteria) return stage

  const recalls   = word.correct_recall_count ?? 0
  const sessions  = word.session_count ?? 0
  const days      = daysSince(word.first_session_date)

  if (recalls >= criteria.minRecalls &&
      sessions >= criteria.minSessions &&
      days >= criteria.minDays) {
    return stage + 1
  }

  return stage
}

// ── Session planning ───────────────────────────────────────────────────────
// timeBudget: 15 | 30 | 45 (minutes)
// Returns array of plan objects, each describing one ~15-min block
export function planSession(words, timeBudget = 15, lang = 'en') {
  const uk = lang === 'uk'

  // Bucket words by stage
  const newWords      = words.filter(w => (w.learning_stage ?? 0) === STAGE.NEW)
  const earlyWords    = words.filter(w => (w.learning_stage ?? 0) === STAGE.EARLY)
  const midWords      = words.filter(w => (w.learning_stage ?? 0) === STAGE.MID)
  const lateWords     = words.filter(w => (w.learning_stage ?? 0) === STAGE.LATE)
  const knownWords    = words.filter(w => (w.learning_stage ?? 0) === STAGE.KNOWN)
  const masteredWords = words.filter(w => (w.learning_stage ?? 0) === STAGE.MASTERED)

  const freshLearning = [...earlyWords, ...midWords]    // needs introduction feel
  const deepLearning  = [...lateWords]                  // close to known
  const revision      = [...knownWords, ...masteredWords]

  const plans = []

  // ── Plan A: Introduce (new + early learning) ───────────────────────────
  const introduceWords = [
    ...newWords.slice(0, 5),
    ...freshLearning.slice(0, 10),
  ].slice(0, 15)

  if (introduceWords.length > 0) {
    plans.push({
      id:          'introduce',
      type:        'introduce',
      title:       uk ? 'Нові слова та свіже повторення' : 'New words & fresh review',
      description: uk
        ? `${newWords.slice(0,5).length} нових слів + ${Math.min(freshLearning.length, 10)} слів, які ви нещодавно вивчали`
        : `${newWords.slice(0,5).length} new words + ${Math.min(freshLearning.length, 10)} words you've seen recently`,
      exercises:   ['flashcards', 'word_order', 'fill_blank'],
      words:       introduceWords,
      durationMin: 15,
    })
  }

  // ── Plan B: Consolidate (mid + late learning → push to known) ─────────
  const consolidateWords = [
    ...midWords.slice(0, 8),
    ...lateWords.slice(0, 7),
  ].slice(0, 15)

  if (consolidateWords.length >= 3) {
    plans.push({
      id:          'consolidate',
      type:        'consolidate',
      title:       uk ? 'Закріпити та просунути' : 'Consolidate & push forward',
      description: uk
        ? `${consolidateWords.length} слів близьких до рівня «знаю» — флеш-картки, заповніть пропуск, активне відтворення`
        : `${consolidateWords.length} words close to known — flashcards, fill in blank, active recall`,
      exercises:   ['flashcards', 'fill_blank', 'active_recall'],
      words:       consolidateWords,
      durationMin: 15,
    })
  }

  // ── Plan C: Deepen (known + mastered — grammar + context) ─────────────
  const deepenWords = [
    ...lateWords.slice(0, 5),
    ...knownWords.slice(0, 7),
    ...masteredWords.slice(0, 3),
  ].slice(0, 15)

  if (deepenWords.length >= 3) {
    plans.push({
      id:          'deepen',
      type:        'deepen',
      title:       uk ? 'Поглиблене опрацювання' : 'Deep practice',
      description: uk
        ? `Активне відтворення, написання речень і порядок слів — граматика і контекст`
        : `Active recall, sentence writing & word order — grammar and context`,
      exercises:   ['active_recall', 'sentence_writing', 'word_order'],
      words:       deepenWords,
      durationMin: 15,
    })
  }

  // ── Filter plans by time budget & combine if needed ───────────────────
  const maxPlans = Math.floor(timeBudget / 15)
  const selected = plans.slice(0, maxPlans)

  if (timeBudget >= 45 && plans.length >= 3) {
    // Full mixed session — flatten all words, smooth flow
    const allWords = [
      ...introduceWords,
      ...consolidateWords.filter(w => !introduceWords.find(x => x.id === w.id)),
      ...deepenWords.filter(w => !consolidateWords.find(x => x.id === w.id) && !introduceWords.find(x => x.id === w.id)),
    ].slice(0, 40)

    return [{
      id:          'mixed',
      type:        'mixed',
      title:       uk ? 'Повна сесія' : 'Full session',
      description: uk
        ? `Все разом: нові слова, закріплення та поглиблення — повна тренування`
        : `Everything: new words, consolidation and deep practice in one flow`,
      exercises:   ['flashcards', 'fill_blank', 'active_recall', 'word_order'],
      words:       allWords,
      durationMin: 45,
    }]
  }

  return selected
}

// ── Session logging ────────────────────────────────────────────────────────
// Call this when starting a session — creates the session record, returns id
export async function startSession(userId, sessionType, wordCount) {
  const { data, error } = await supabase
    .from('sessions')
    .insert({ user_id: userId, session_type: sessionType, word_count: wordCount })
    .select('id')
    .single()
  if (error) { console.error('[wordy] startSession error:', error.message); return null }
  return data.id
}

// Call this after each word result within a session
export async function logWordResult(sessionId, wordId, exerciseType, result) {
  await supabase.from('session_words').insert({
    session_id:    sessionId,
    word_id:       wordId,
    exercise_type: exerciseType,
    result,
  })
}

// Call this when a session is fully complete — updates word counters + checks promotion
export async function completeSession(sessionId, userId, wordResults) {
  // Mark session completed
  await supabase
    .from('sessions')
    .update({ completed_at: new Date().toISOString() })
    .eq('id', sessionId)

  const today = new Date().toISOString().split('T')[0]

  // Group results by word
  const byWord = {}
  for (const r of wordResults) {
    if (!byWord[r.wordId]) byWord[r.wordId] = []
    byWord[r.wordId].push(r.result)
  }

  // Update each word's counters + check promotion
  for (const [wordIdStr, results] of Object.entries(byWord)) {
    const wordId = parseInt(wordIdStr)
    const correctCount = results.filter(r => r === 'correct').length

    // Fetch current word state
    const { data: word } = await supabase
      .from('words')
      .select('learning_stage, correct_recall_count, session_count, first_session_date')
      .eq('id', wordId)
      .single()

    if (!word) continue

    const newRecalls  = (word.correct_recall_count ?? 0) + correctCount
    const newSessions = (word.session_count ?? 0) + 1
    const firstDate   = word.first_session_date ?? today

    const updatedWord = {
      ...word,
      correct_recall_count: newRecalls,
      session_count:        newSessions,
      first_session_date:   firstDate,
    }

    const newStage  = checkPromotion(updatedWord)
    const newStatus = stageToStatus(newStage)

    await supabase
      .from('words')
      .update({
        correct_recall_count: newRecalls,
        session_count:        newSessions,
        first_session_date:   firstDate,
        learning_stage:       newStage,
        status:               newStatus,
      })
      .eq('id', wordId)
  }
}
