// Per-step generated content, resolved once at planning time.
//
// A planned step names a sense and an exercise, but the thing the learner
// actually reads is generated on top of it: the multiple-choice distractors,
// and which of the sense's example sentences the fill-in uses. Both of those
// used to be derived inside the card component at mount — so leaving the page
// and coming back re-derived them, and the "resumed" session handed back a
// different question: fresh random distractors, and (because the example cursor
// advanced on every mount) the NEXT example sentence rather than the one that
// was on screen.
//
// Resolving them here, into the step objects, means they are part of `steps` —
// which the snapshot already persists in full. Resume is then byte-identical to
// what was abandoned, with no new snapshot fields and no new save/load paths.
//
// `store` is injected so none of this needs a browser: the app passes
// `window.localStorage`, the tests pass a fake or null.

import { firstFillBlank } from './srs.js'
import { displayTranslation } from './senseDisplay.js'

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

const norm = (s) => (s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

// Build multiple-choice options: correct value + distractors drawn from the deck.
export function makeOptions(correct, pool, valueOf, excludeWordId, n = 3) {
  const seen = new Set([norm(correct)])
  const ds = []
  for (const s of shuffle(pool ?? [])) {
    if (s.word_id === excludeWordId) continue // skip the word itself AND its sibling senses
    const v = valueOf(s)
    if (!v || seen.has(norm(v))) continue
    seen.add(norm(v)); ds.push(v)
    if (ds.length >= n) break
  }
  return shuffle([correct, ...ds])
}

// Advance the sense's example-rotation cursor and report where it was.
// Rotating is deliberate anti-memorization: the ungraded scaffold and the
// graded fill-in for the same word get different sentences. Because this now
// runs once per planned step instead of once per mount, abandoning a session no
// longer burns a rotation.
function takeCursor(store, senseId) {
  const key = `wordy_ex_cursor_${senseId}`
  let cursor = 0
  try { cursor = parseInt(store?.getItem(key) || '0', 10) || 0 } catch { /* no storage */ }
  try { store?.setItem(key, String(cursor + 1)) } catch { /* no storage */ }
  return cursor
}

// Does this step already carry whatever content its exercise needs?
// `fillBlank: null` counts — it means "planned, and this sense has no usable
// example", which is different from "never planned".
export function hasStepContent(step) {
  switch (step?.exercise) {
    case 'fill_in':
    case 'fill_blank': return step.fillBlank !== undefined
    case 'recognition':
    case 'word_choice': return Array.isArray(step.options)
    default: return true
  }
}

// Resolve every step's generated content. Returns a new array of new step
// objects; the input plan is untouched.
//
// Idempotent: a step that already has its content is returned as-is. That is
// what lets the resume path call this unconditionally to heal a snapshot
// written before content was planned, without re-rolling the steps that are
// already fixed.
export function attachStepContent(plan, pool, store = null) {
  return (plan ?? []).map((step) => {
    if (hasStepContent(step)) return step
    switch (step.exercise) {
      case 'fill_in':
      case 'fill_blank': {
        const exs = step.examples || []
        if (!exs.length) return { ...step, fillBlank: null }
        return { ...step, fillBlank: firstFillBlank(exs, step.word, takeCursor(store, step.senseId)) }
      }
      case 'recognition':
        return {
          ...step,
          options: makeOptions(
            displayTranslation(step.translation), pool,
            (s) => displayTranslation(s.translation), step.wordId,
          ),
        }
      case 'word_choice':
        return { ...step, options: makeOptions(step.word, pool, (s) => s.word_form, step.wordId) }
      default:
        return step
    }
  })
}
