// Run with: node --test src/lib/dailyNew.test.js
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// dailyNew.js uses the global localStorage; give node a minimal in-memory one.
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
}

const { addNewToday, remainingNewToday, DEFAULT_NEW_PER_DAY } = await import('./dailyNew.js')

beforeEach(() => store.clear())

// The budget is the learner's own (profiles.daily_new_words), so it is passed in.
// These tests state the limit explicitly rather than leaning on a module constant:
// the earlier version asserted "3 + 4 spends the budget", which quietly became
// false the day the cap moved 7 -> 15.
test('remainingNewToday: full budget when nothing learned yet', () => {
  assert.equal(remainingNewToday('2026-07-02', 10), 10)
  assert.equal(remainingNewToday('2026-07-02', 30), 30)
})

test('remainingNewToday: shrinks as new words are introduced, clamps at 0', () => {
  addNewToday('2026-07-02', 3)
  assert.equal(remainingNewToday('2026-07-02', 10), 7)
  addNewToday('2026-07-02', 7)
  assert.equal(remainingNewToday('2026-07-02', 10), 0, 'budget spent -> 0')
  addNewToday('2026-07-02', 2) // over-count (e.g. keep-going edge) must not go negative
  assert.equal(remainingNewToday('2026-07-02', 10), 0)
})

test('remainingNewToday: budget is per-day — a new date resets it', () => {
  addNewToday('2026-07-02', 10)
  assert.equal(remainingNewToday('2026-07-02', 10), 0)
  assert.equal(remainingNewToday('2026-07-03', 10), 10)
})

// Lowering the goal below what today already introduced must simply end the day's
// new intake — not go negative, and not rewrite the counter.
test('remainingNewToday: a goal lowered below today’s count yields 0, never negative', () => {
  addNewToday('2026-07-02', 12)
  assert.equal(remainingNewToday('2026-07-02', 5), 0)
})

test('remainingNewToday: falls back to the default while the profile has not loaded', () => {
  assert.equal(remainingNewToday('2026-07-02'), DEFAULT_NEW_PER_DAY)
  addNewToday('2026-07-02', 5)
  assert.equal(remainingNewToday('2026-07-02'), DEFAULT_NEW_PER_DAY - 5)
})
