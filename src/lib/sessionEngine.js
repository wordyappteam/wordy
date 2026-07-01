import { supabase } from './supabase'
import { applyVerdict, gradeRetrieval } from './srs'

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

// ── SRS v2 ───────────────────────────────────────────────────────────────────
// New scheduling model (see src/lib/srs.js + features/scoring-system-v2.md).
// One graded retrieval per sense per session -> one verdict -> one write.
// NOT yet wired into the session pages — flip to this deliberately at cutover.
//
// `senseResults`: [{ senseId, outcome }] where outcome is 'correct' | 'almost'
//   | 'wrong' (the result of that sense's single graded exercise this session).
export async function completeSessionV2(sessionId, userId, senseResults, todayISO = new Date().toISOString().split('T')[0]) {
  // Idempotency guard: if the session was already completed, don't re-apply.
  const { data: session } = await supabase
    .from('sessions')
    .select('completed_at')
    .eq('id', sessionId)
    .single()
  if (session?.completed_at) return

  await supabase
    .from('sessions')
    .update({ completed_at: new Date().toISOString() })
    .eq('id', sessionId)

  for (const { senseId, outcome } of senseResults) {
    const { data: sense } = await supabase
      .from('word_senses')
      .select('interval_step, lapses, slipped')
      .eq('id', senseId)
      .eq('user_id', userId)
      .single()
    if (!sense) continue

    const next = applyVerdict(sense, gradeRetrieval(outcome), todayISO)

    await supabase
      .from('word_senses')
      .update(next)
      .eq('id', senseId)
      .eq('user_id', userId)
  }
}
