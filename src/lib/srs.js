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
// Badge from a stage's text name (word_senses.learning_stage). Null when the
// name is unknown/absent so callers can fall back to legacy words.status.
export function badgeForStage(stageText) {
  const i = STAGE_NAMES.indexOf(stageText)
  return i === -1 ? null : BADGE[i]
}
// A whole word's badge, for views that list words rather than senses (dictionary
// list, dashboard breakdown). The word takes its primary sense's stage — senses
// are fetched created_at ascending, so the primary sense is the first one.
// Words predating the sense cutover have no senses; they keep words.status,
// the legacy column that nothing writes to any more.
export function badgeForWord(senses, legacyStatus = 'new') {
  const primary = (senses ?? [])[0]
  return badgeForStage(primary?.learning_stage) ?? legacyStatus
}

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
    case 1: return ['flashcard', 'fill_blank']   // early: see it, then meet it in context
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
//   opts:    { practice } — the word was drilled in a collection session before it
//            was due. Returns null (write nothing) unless the learner FAILED.
//
// Why a correct cram must write nothing: if a PASS on a not-yet-due word advanced
// its interval, drilling a collection would push every word in it far into the
// future and the learner would stop seeing them — cramming would quietly damage
// retention. Not even last_reviewed may be written, because the FAIL path below
// measures how overdue a word was (gapReview); a crammed word would look freshly
// reviewed and a later genuine lapse would be misjudged.
//
// A FAILED cram is the opposite: real evidence that a word the learner believed
// they knew is gone. That counts, exactly as it would in a normal session.
export function applyVerdict(state, verdict, todayISO, { practice = false } = {}) {
  if (practice && verdict !== 'FAIL') return null

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
    const overdue = state.next_review_date ? daysBetween(state.next_review_date, todayISO) : 0
    const gapReview = overdue > INTERVALS[step] // reviewed more than its own interval late
    if (!slipped || gapReview) {
      // First strike OR a review after a real gap: one-day retry, no demotion, no lapse.
      slipped = true
      nextDate = addDays(todayISO, 1)
    } else {
      // Confirmed lapse (on-time second strike): tighten schedule, maybe drop a band.
      nextStep = step <= 0 ? 0 : Math.max(1, step - 2)
      lapses += 1
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

// Order a collection's senses the way the planner would rank them, for the
// "choose your words" list: what needs work first (due, then leeches, then new,
// then weakest practice words), so the useful ones sit at the top of the list
// rather than buried under words the learner already has.
export function orderForPractice(senses, today = new Date().toISOString().split('T')[0]) {
  const isNew = (s) => !s.last_reviewed && (s.interval_step ?? 0) === 0
  const isDue = (s) => !isNew(s) && (!s.next_review_date || s.next_review_date <= today)
  const rank = (s) => (isDue(s) ? 0 : isNew(s) ? 1 : 2)
  return [...senses].sort((a, b) =>
    rank(a) - rank(b) ||
    (a.interval_step ?? 0) - (b.interval_step ?? 0) ||
    String(a.word_form ?? '').localeCompare(String(b.word_form ?? ''))
  )
}

// ── Session assembly (v2) ────────────────────────────────────────────────────
// Pure planner. Given the learner's senses, produce an ordered list of steps.
// Each step is one exercise on one sense; exactly ONE step per selected sense is
// graded, and its outcome is what feeds completeSessionV2.
//
// A sense row needs: { id, word_id, interval_step, last_reviewed,
//   next_review_date, is_leech, word_form|word, translation }
//
// opts: { today, timeBudget, gradedCap, newPerDay, newToday, blockSize, leechCap, antiClusterWindow }
export function planSessionV2(senses, opts = {}) {
  const {
    today = new Date().toISOString().split('T')[0],
    timeBudget = 15,
    gradedCap = capForBudget(timeBudget),
    newPerDay = 7,
    newToday = 0,
    blockSize = 4,
    leechCap = 2,
    antiClusterWindow = 2,
    // Collection session: drill the WHOLE collection, not just what happens to be
    // due. Words that are neither new nor due come along as practice — graded for
    // feedback, but a correct answer on them writes nothing (see applyVerdict).
    practiceAll = false,
  } = opts

  const isNew = (s) => !s.last_reviewed && (s.interval_step ?? 0) === 0
  const isDue = (s) => !isNew(s) && (!s.next_review_date || s.next_review_date <= today)

  const news    = shuffleArr(senses.filter(isNew)) // shuffle → a fresh, varied pack of new words each session
  const dueAll  = senses.filter(isDue)
  // Weakest first: when a collection is bigger than one session, the words that
  // survive the cap should be the ones that still need the work, not the ones
  // already mastered.
  const practice = practiceAll
    ? senses.filter((s) => !isNew(s) && !isDue(s))
        .sort((a, b) => (a.interval_step ?? 0) - (b.interval_step ?? 0))
        .map((s) => ({ ...s, _practice: true }))
    : []
  const leeches = dueAll.filter((s) => s.is_leech)
  const reviews = dueAll.filter((s) => !s.is_leech)

  // Oldest due first
  const byDate = (a, b) => String(a.next_review_date ?? '').localeCompare(String(b.next_review_date ?? ''))
  reviews.sort(byDate)
  leeches.sort(byDate)

  const cap = gradedCap
  const leechTake = leeches.slice(0, leechCap).map((s) => ({ ...s, _remedial: true }))
  const roomAfterLeech = Math.max(0, cap - leechTake.length)
  const reviewTake = reviews.slice(0, roomAfterLeech)               // reviews take priority
  const behind = reviews.length >= cap                             // a full session already due
  const newBudget = behind ? 0 : Math.max(0, newPerDay - newToday) // per-DAY budget, 0 when behind
  const roomForNew = Math.max(0, cap - leechTake.length - reviewTake.length)
  const newTake = news.slice(0, Math.min(newBudget, roomForNew))
  // Practice words fill whatever room is left — they never crowd out a word that
  // is genuinely due, since cramming must not delay real reviews.
  const roomForPractice = Math.max(0, cap - leechTake.length - reviewTake.length - newTake.length)
  const practiceTake = practice.slice(0, roomForPractice)
  const selected = [...reviewTake, ...leechTake, ...newTake, ...practiceTake]
  if (selected.length === 0) return []

  // Sequencing v2.1: stage packs -> balanced encode->test cycles -> type
  // phases (all flashcards, then all context cards, then all tests; same
  // word order per phase). Spec: 2026-07-02-session-sequencing-design.md.
  const display = (s) => ({ word: s.word_form ?? s.word ?? '', translation: s.translation ?? '' })
  const out = []
  for (const pack of packSenses(selected)) {
    for (const chunk of balancedChunks(pack, blockSize)) {
      const flash = [], ctx = [], tests = []
      for (const s of chunk) {
        const step = s.interval_step ?? 0
        const remedial = !!s._remedial
        const base = { senseId: s.id, wordId: s.word_id, pos: s.pos, examples: s.examples ?? [], remedial, practice: !!s._practice, direction: directionFor(step), stage: stageName(step), newIntake: isNew(s), ...display(s) }
        const scaffolds = remedial ? ['flashcard'] : scaffoldFor(step)
        if (scaffolds.includes('flashcard')) flash.push({ ...base, exercise: 'flashcard', graded: false })
        if (scaffolds.includes('fill_blank')) ctx.push({ ...base, exercise: 'fill_blank', graded: false })
        tests.push({ ...base, exercise: remedial ? 'word_choice' : gradedExerciseFor(step), graded: true })
      }
      out.push(
        ...antiCluster(flash, (x) => x.wordId, antiClusterWindow),
        ...antiCluster(ctx, (x) => x.wordId, antiClusterWindow),
        ...antiCluster(tests, (x) => x.wordId, antiClusterWindow),
      )
    }
  }
  return out
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

// ── Sequencing v2.1 helpers (spec: 2026-07-02-session-sequencing-design.md) ──

// Split arr into ceil(n/maxSize) chunks of near-equal size, each <= maxSize.
// Balanced so a 9-word pack becomes 3+3+3, never 4+4+1 with a runt tail.
export function balancedChunks(arr, maxSize) {
  if (arr.length === 0) return []
  const n = Math.ceil(arr.length / maxSize)
  const out = []
  let start = 0
  for (let i = 0; i < n; i++) {
    const size = Math.ceil((arr.length - start) / (n - i))
    out.push(arr.slice(start, start + size))
    start += size
  }
  return out
}

// Pack index: 0..5 = stageOf(interval_step), 6 = leech-help (remedial tail).
const LEECH_PACK = 6
// Scaffold shape per mergeable pack: F = flashcard, C = context fill_blank.
const PACK_RECIPE = ['F', 'FC', 'FC', 'C']
const MERGE_MIN = 3

// Group selected senses into stage packs (emission order), merging tiny
// scaffolded packs (new/early/mid/late, <3 words) into the neighbor whose
// scaffold recipe matches best. Known+ packs (test-only) and the leech-help
// pack (deliberately tiny rescue tail, leechCap=2) never merge.
export function packSenses(selected) {
  const packOf = (s) => (s._remedial ? LEECH_PACK : stageOf(s.interval_step ?? 0))
  const packs = Array.from({ length: 7 }, () => [])
  for (const s of selected) packs[packOf(s)].push(s)

  const recipeDist = (a, b) => {
    const A = PACK_RECIPE[a], B = PACK_RECIPE[b]
    return (A.includes('F') !== B.includes('F') ? 1 : 0) + (A.includes('C') !== B.includes('C') ? 1 : 0)
  }
  for (;;) {
    const live = [0, 1, 2, 3].filter((p) => packs[p].length > 0)
    const tiny = live.find((p) => packs[p].length < MERGE_MIN)
    if (tiny === undefined || live.length < 2) break
    const target = live
      .filter((p) => p !== tiny)
      .sort((a, b) =>
        (recipeDist(tiny, a) - recipeDist(tiny, b)) ||
        (Math.abs(a - tiny) - Math.abs(b - tiny)) ||
        (a - b))[0]
    packs[target].push(...packs[tiny])
    packs[tiny] = []
    packs[target].sort((a, b) => packOf(a) - packOf(b)) // stable: stage order, original order within stage
  }
  return packs.filter((p) => p.length > 0)
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
  // The example's own translation rides along: on reveal the learner sees a full
  // sentence of context, and translating only the target word leaves the rest of
  // it unreadable. Null when the example has none, so the UI can omit the line.
  const translation = example.translation ?? null
  if (surface && text.includes(surface)) {
    return { sentence: text.replace(surface, "____"), answer: surface, target: text, translation }
  }
  if (lemma) {
    const re = new RegExp(`\\b${escapeReSrs(lemma)}\\b`, "i")
    const m = text.match(re)
    if (m) return { sentence: text.replace(re, "____"), answer: m[0], target: text, translation }
  }
  return null
}

function escapeReSrs(s) { return (s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&") }

// Scan a sense's examples (starting at the rotation cursor) and return the first
// that yields a usable blanked sentence. A single inflected example the matcher
// can't blank must never force the card into context-free fallback while other
// examples of the same sense would work.
export function firstFillBlank(examples, lemma, cursor = 0) {
  const exs = Array.isArray(examples) ? examples : []
  if (!exs.length) return null
  const start = nextExampleIndex(cursor, exs.length)
  for (let k = 0; k < exs.length; k++) {
    const fb = buildFillBlank(exs[(start + k) % exs.length], lemma)
    if (fb) return fb
  }
  return null
}

// ── Grading fill-in answers (pure) ───────────────────────────────────────────
// Grade a typed fill-in answer against the sentence's surface form.
// Right word in the wrong form is "almost" (HOLD), never "wrong" (FAIL).
export function gradeFillIn(input, { answer, lemma } = {}) {
  const a = normWordSrs(input)
  if (!a) return "wrong"
  const ans = normWordSrs(answer)
  if (ans && a === ans) return "correct"
  const lem = normWordSrs(lemma)
  if (lem && a === lem) return "almost"
  if (ans && levSrs(a, ans) <= 1) return "almost"
  return "wrong"
}

function normWordSrs(s) {
  return (s || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
}
function levSrs(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
  return dp[a.length][b.length]
}

// ── helpers ──────────────────────────────────────────────────────────────────
function clampStep(s) { return Math.max(0, Math.min(MAX_STEP, (s | 0))) }
function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().split('T')[0]
}
function daysBetween(fromISO, toISO) {
  return Math.round((Date.parse(toISO) - Date.parse(fromISO)) / 86400000)
}
