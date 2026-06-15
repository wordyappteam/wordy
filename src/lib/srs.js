// Wordy SRS v2 — pure scheduling/scoring core.
// No DB, no React: every function is (inputs) -> outputs, so it is trivially
// testable and cannot drift out of sync with the UI. See
// features/scoring-system-v2.md for the design rationale.

// ── Interval ladder (days), indexed by interval_step 0..8 ────────────────────
// interval_step is the SINGLE source of truth. Everything else derives from it.
export const INTERVALS = [1, 2, 4, 7, 12, 21, 35, 60, 90]
export const MAX_STEP = INTERVALS.length - 1 // 8
export const LEECH_THRESHOLD = 4

// ── Stage derivation (single source of truth: step) ──────────────────────────
// 0=new 1=early 2=mid 3=late 4=known 5=mastered (matches word_senses text stages)
const STAGE_NAMES = ['new', 'early', 'mid', 'late', 'known', 'mastered']
// User-facing badge: early/mid/late all read as "learning"
const BADGE = ['new', 'learning', 'learning', 'learning', 'known', 'mastered']

export function stageOf(step) {
  const s = clampStep(step)
  if (s <= 0) return 0          // new
  if (s <= 2) return 1          // early
  if (s <= 4) return 2          // mid
  if (s === 5) return 3         // late
  if (s <= 7) return 4          // known
  return 5                      // mastered
}
export function stageName(step) { return STAGE_NAMES[stageOf(step)] } // for word_senses.learning_stage
export function badge(step) { return BADGE[stageOf(step)] }           // for UI badges

// ── Exercise plan per stage (research-aligned: TOPRA, productive, scaffold) ───
// Direction flips to production (L1->L2) once form is established (mid+).
export function directionFor(step) {
  return stageOf(step) >= 2 ? 'L1->L2' : 'L2->L1'
}
// The one decisive exercise that produces the session verdict.
export function gradedExerciseFor(step) {
  switch (stageOf(step)) {
    case 0: return 'recognition'        // multiple-choice L2->L1
    case 1: return 'word_choice'        // assemble — recognition->production bridge
    case 2: return 'active_recall'      // type the word, L1->L2
    case 3: return 'active_recall'      // or word_order
    case 4: return 'sentence_writing'   // or active_recall
    default: return 'sentence_writing'  // mastered spot-check
  }
}
// Ungraded exposures for encoding (flashcard implies TTS + delayed reveal in UI).
export function scaffoldFor(step) {
  switch (stageOf(step)) {
    case 0: return ['flashcard']
    case 1: return ['flashcard']
    case 2: return ['flashcard', 'fill_blank']
    case 3: return ['fill_blank']
    default: return []
  }
}

// ── Grading: raw exercise outcome -> session verdict ─────────────────────────
// `outcome` is decided by the exercise component:
//   'correct' — exact / unaided        -> PASS
//   'almost'  — hint, 2nd try, form-only slip, Levenshtein<=1, meaning-ok/form-bad -> HOLD
//   'wrong'   — meaning wrong / no answer -> FAIL
export function gradeRetrieval(outcome) {
  if (outcome === 'correct') return 'PASS'
  if (outcome === 'almost') return 'HOLD'
  return 'FAIL'
}

// ── The core transition: (sense state, verdict) -> next state ────────────────
// Pure. One call per sense per session. Returns the exact columns to write to
// word_senses (so the caller does a single idempotent update).
//   state:   { interval_step, lapses, slipped }
//   verdict: 'PASS' | 'HOLD' | 'FAIL'
//   todayISO:'YYYY-MM-DD'
export function applyVerdict(state, verdict, todayISO) {
  const step = clampStep(state.interval_step ?? 0)
  let lapses = state.lapses ?? 0
  let slipped = !!state.slipped
  let nextStep = step
  let nextDate

  if (verdict === 'PASS') {
    nextDate = addDays(todayISO, INTERVALS[step]) // schedule by current step…
    nextStep = clampStep(step + 1)                // …then advance one step
    slipped = false
  } else if (verdict === 'HOLD') {
    nextDate = addDays(todayISO, INTERVALS[step]) // same spacing, no advance
    slipped = false
  } else { // FAIL
    if (!slipped) {
      // First strike: one-day retry, no demotion, badge unchanged.
      slipped = true
      nextDate = addDays(todayISO, 1)
    } else {
      // Confirmed lapse across a gap: tighten schedule, maybe drop a band.
      nextStep = Math.max(1, step - 2)
      if (stageOf(step) >= 2) lapses += 1 // only count lapses once form was established (mid+)
      slipped = false
      nextDate = addDays(todayISO, 1)
    }
  }

  return {
    interval_step:    nextStep,
    lapses,
    slipped,
    is_leech:         lapses >= LEECH_THRESHOLD,
    last_reviewed:    todayISO,
    next_review_date: nextDate,
    learning_stage:   stageName(nextStep), // keep the derived text stage in sync
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────
function clampStep(s) { return Math.max(0, Math.min(MAX_STEP, (s | 0))) }
function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().split('T')[0]
}
