// Run with: node --test src/lib/dailyNew.test.js
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// dailyNew.js uses the global localStorage; give node a minimal in-memory one.
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
}

const { addNewToday, remainingNewToday, NEW_PER_DAY } = await import('./dailyNew.js')

beforeEach(() => store.clear())

test('remainingNewToday: full budget when nothing learned yet', () => {
  assert.equal(remainingNewToday('2026-07-02'), NEW_PER_DAY)
})

test('remainingNewToday: shrinks as new words are introduced, clamps at 0', () => {
  addNewToday('2026-07-02', 3)
  assert.equal(remainingNewToday('2026-07-02'), NEW_PER_DAY - 3)
  addNewToday('2026-07-02', NEW_PER_DAY - 3) // spend the rest of the budget
  assert.equal(remainingNewToday('2026-07-02'), 0, 'budget spent -> 0')
  addNewToday('2026-07-02', 2) // over-count (e.g. keep-going edge) must not go negative
  assert.equal(remainingNewToday('2026-07-02'), 0)
})

test('remainingNewToday: budget is per-day — a new date resets it', () => {
  addNewToday('2026-07-02', NEW_PER_DAY)
  assert.equal(remainingNewToday('2026-07-02'), 0)
  assert.equal(remainingNewToday('2026-07-03'), NEW_PER_DAY)
})
