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
    case 2: return 'fill_in'            // mid: type the word in a context sentence
    case 3: return 'active_recall'      // late: type the word cold (or word_order)
    case 4: return 'sentence_writing'   // known: or active_recall
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

// Map a sentence review that judged meaning and form separately to a session
// outcome. Meaning wrong = 'wrong' (FAIL); meaning right but form wrong =
// 'almost' (HOLD) so a grammar slip never nukes a word; both right = 'correct'
// (PASS). Falls back to isCorrect when the meaning/form split is absent.
export function sentenceOutcome(review = {}) {
  const { meaningCorrect, formCorrect, isCorrect } = review
  if (meaningCorrect === undefined) return isCorrect ? 'correct' : 'wrong'
  if (!meaningCorrect) return 'wrong'
  return formCorrect ? 'correct' : 'almost'
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
    // "Almost": never advance. If the word was on a fail-retry, an almost is not
    // enough to earn the full interval back — re-test on a short leash; only a
    // clean PASS resumes normal spacing.
    nextDate = addDays(todayISO, slipped ? Math.min(2, INTERVALS[step]) : INTERVALS[step])
    slipped = false
  } else { // FAIL
    if (!slipped) {
      // First strike: one-day retry, no demotion, badge unchanged.
      slipped = true
      nextDate = addDays(todayISO, 1)
    } else {
      // Confirmed lapse across a gap: tighten schedule, maybe drop a band.
      // Floor at step 1 once past "new", but a word never answered correctly
      // (still step 0) stays new rather than being promoted by failing.
      nextStep = step <= 0 ? 0 : Math.max(1, step - 2)
      lapses += 1 // count every confirmed lapse so stuck words (even new ones) reach leech help
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

// ── Session assembly (v2) ────────────────────────────────────────────────────
// Pure planner. Given the learner's senses, produce an ordered list of steps.
// Each step is one exercise on one sense; exactly ONE step per selected sense is
// graded, and its outcome is what feeds completeSessionV2.
//
// A sense row needs: { id, word_id, interval_step, last_reviewed,
//   next_review_date, is_leech, word_form|word, translation }
//
// opts: { today, timeBudget, gradedCap, newCap, leechCap, antiClusterWindow }
export function planSessionV2(senses, opts = {}) {
  const {
    today = new Date().toISOString().split('T')[0],
    timeBudget = 15,
    gradedCap = capForBudget(timeBudget),
    newCap = 7,
    leechCap = 2,
    antiClusterWindow = 2,
  } = opts

  const isNew = (s) => !s.last_reviewed && (s.interval_step ?? 0) === 0
  const isDue = (s) => !isNew(s) && (!s.next_review_date || s.next_review_date <= today)

  const news    = shuffleArr(senses.filter(isNew)) // shuffle → a fresh, varied pack of new words each session
  const dueAll  = senses.filter(isDue)
  const leeches = dueAll.filter((s) => s.is_leech)
  const reviews = dueAll.filter((s) => !s.is_leech)

  // Oldest due first
  const byDate = (a, b) => String(a.next_review_date ?? '').localeCompare(String(b.next_review_date ?? ''))
  reviews.sort(byDate)
  leeches.sort(byDate)

  // Select within caps. New words and leeches get RESERVED slots up front so a
  // backlog of due reviews can never starve them; reviews take whatever budget
  // is left. Total still bounded by gradedCap.
  const newTake = news.slice(0, newCap)
  const leechTake = leeches.slice(0, leechCap).map((s) => ({ ...s, _remedial: true }))
  const reviewBudget = Math.max(0, gradedCap - newTake.length - leechTake.length)
  const selected = [...reviews.slice(0, reviewBudget), ...leechTake, ...newTake]
  if (selected.length === 0) return []

  // Build steps: a scaffold (encode) phase, then a graded (test) phase. Two
  // phases give every word maximum in-session spacing before its graded test.
  const display = (s) => ({ word: s.word_form ?? s.word ?? '', translation: s.translation ?? '' })
  const scaffoldSteps = []
  const gradedSteps = []
  for (const s of selected) {
    const step = s.interval_step ?? 0
    const remedial = !!s._remedial
    const base = { senseId: s.id, wordId: s.word_id, pos: s.pos, examples: s.examples ?? [], remedial, direction: directionFor(step), stage: stageName(step), ...display(s) }
    for (const ex of (remedial ? ['flashcard'] : scaffoldFor(step))) {
      scaffoldSteps.push({ ...base, exercise: ex, graded: false })
    }
    gradedSteps.push({ ...base, exercise: remedial ? 'word_choice' : gradedExerciseFor(step), graded: true })
  }

  // No two senses of the same lemma back-to-back (semantic-interference guard).
  return [
    ...antiCluster(scaffoldSteps, (x) => x.wordId, antiClusterWindow),
    ...antiCluster(gradedSteps, (x) => x.wordId, antiClusterWindow),
  ]
}

function capForBudget(min) { return min >= 45 ? 28 : min >= 30 ? 18 : 10 }

function shuffleArr(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Greedy reorder so no two items sharing keyOf sit within `window` positions.
function antiCluster(items, keyOf, window) {
  const remaining = [...items]
  const out = []
  while (remaining.length) {
    let idx = remaining.findIndex((it) => !out.slice(-window).some((o) => keyOf(o) === keyOf(it)))
    if (idx === -1) idx = 0 // unavoidable collision — accept it
    out.push(remaining.splice(idx, 1)[0])
  }
  return out
}

// ── Fill-in helpers (pure) ───────────────────────────────────────────────────
export function nextExampleIndex(cursor, total) {
  if (!total || total < 1) return 0
  const c = Number.isFinite(cursor) ? cursor : 0
  return ((c % total) + total) % total
}

// Turn one example into a fill-in: blank the target word, return the answer.
// Prefers the inflected `blank` surface form; falls back to a base-form regex.
export function buildFillBlank(example, lemma) {
  if (!example || !example.target) return null
  const text = example.target
  const surface = example.blank
  if (surface && text.includes(surface)) {
    return { sentence: text.replace(surface, "____"), answer: surface, target: text }
  }
  if (lemma) {
    const re = new RegExp(`\\b${escapeReSrs(lemma)}\\b`, "i")
    const m = text.match(re)
    if (m) return { sentence: text.replace(re, "____"), answer: m[0], target: text }
  }
  return null
}

function escapeReSrs(s) { return (s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&") }

// ── helpers ──────────────────────────────────────────────────────────────────
function clampStep(s) { return Math.max(0, Math.min(MAX_STEP, (s | 0))) }
function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().split('T')[0]
}
