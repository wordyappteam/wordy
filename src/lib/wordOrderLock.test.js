import test from "node:test"
import assert from "node:assert/strict"
import { correctPrefix, placeChip, pullChip, LOCK_CAP } from "./wordOrderLock.js"

// The design, as decided: the first three words lock TOGETHER, the moment all
// three are in the right order. Never one at a time — per-word locking answers
// "is this one right?" on every tap, which is what makes guessing pay. The cap
// is a flat three whatever the sentence length. See docs/mockups/word-order.html.

const WORDS = ["Das", "Gesetz", "tritt", "morgen", "in", "Kraft"]
const chip = (w, i = 0) => ({ key: `${i}-${w}`, word: w })
const chips = (...ws) => ws.map((w, i) => chip(w, i))
const state = (placed = [], bank = [], lockedCount = 0) => ({ placed, bank, lockedCount })

// ── correctPrefix ───────────────────────────────────────────────────────────
test("correctPrefix counts the leading words that are in the right place", () => {
  assert.equal(correctPrefix(chips("Das", "Gesetz", "tritt"), WORDS), 3)
})

test("correctPrefix stops at the first word out of place", () => {
  assert.equal(correctPrefix(chips("Das", "tritt", "Gesetz"), WORDS), 1)
})

test("correctPrefix ignores case and punctuation", () => {
  assert.equal(correctPrefix(chips("das,", "GESETZ"), WORDS), 2)
})

test("correctPrefix compares by position, so a repeated word counts once per slot", () => {
  assert.equal(correctPrefix(chips("in", "in"), ["in", "der", "in"]), 1)
})

// ── the bundle lock ─────────────────────────────────────────────────────────
test("two correct words lock nothing — there is no per-tap signal", () => {
  const before = state(chips("Das"), [chip("Gesetz", 1)])
  const after = placeChip(before, chip("Gesetz", 1), { targetWords: WORDS })
  assert.equal(after.lockedCount, 0)
  assert.equal(after.justLocked, null)
})

test("the third correct word locks the opening three together", () => {
  const before = state(chips("Das", "Gesetz"), [chip("tritt", 2)])
  const after = placeChip(before, chip("tritt", 2), { targetWords: WORDS })
  assert.equal(after.lockedCount, LOCK_CAP)
  assert.deepEqual(after.justLocked, ["0-Das", "1-Gesetz", "2-tritt"])
})

test("a wrong third word locks nothing", () => {
  const before = state(chips("Das", "Gesetz"), [chip("morgen", 3)])
  const after = placeChip(before, chip("morgen", 3), { targetWords: WORDS })
  assert.equal(after.lockedCount, 0)
})

test("a correct opening still locks after a wrong third word is taken back", () => {
  let s = placeChip(state(chips("Das", "Gesetz"), [chip("morgen", 3)]), chip("morgen", 3), { targetWords: WORDS })
  s = pullChip(s, 2)
  s = placeChip(s, chip("tritt", 2), { targetWords: WORDS })
  assert.equal(s.lockedCount, LOCK_CAP)
})

test("the lock is a flat three — a fourth correct word does not extend it", () => {
  const locked = state(chips("Das", "Gesetz", "tritt"), [chip("morgen", 3)], LOCK_CAP)
  const after = placeChip(locked, chip("morgen", 3), { targetWords: WORDS })
  assert.equal(after.lockedCount, LOCK_CAP)
  assert.equal(after.justLocked, null)
})

test("a sentence shorter than the cap never locks", () => {
  const two = ["Ich", "schlafe"]
  const after = placeChip(state(chips("Ich"), [chip("schlafe", 1)]), chip("schlafe", 1), { targetWords: two })
  assert.equal(after.lockedCount, 0)
})

test("free-flowing mode never locks", () => {
  const before = state(chips("Das", "Gesetz"), [chip("tritt", 2)])
  const after = placeChip(before, chip("tritt", 2), { targetWords: WORDS, mode: "free" })
  assert.equal(after.lockedCount, 0)
})

// ── placing and pulling ─────────────────────────────────────────────────────
test("placing a chip moves it out of the bank and onto the end of the answer", () => {
  const after = placeChip(state([], [chip("Das", 0), chip("Gesetz", 1)]), chip("Gesetz", 1), { targetWords: WORDS })
  assert.deepEqual(after.placed.map((c) => c.word), ["Gesetz"])
  assert.deepEqual(after.bank.map((c) => c.word), ["Das"])
})

test("pulling an unlocked chip returns it to the bank", () => {
  const after = pullChip(state(chips("Das", "Gesetz"), []), 1)
  assert.deepEqual(after.placed.map((c) => c.word), ["Das"])
  assert.deepEqual(after.bank.map((c) => c.word), ["Gesetz"])
})

test("a locked chip cannot be pulled back", () => {
  const locked = state(chips("Das", "Gesetz", "tritt"), [], LOCK_CAP)
  const after = pullChip(locked, 1)
  assert.deepEqual(after.placed.map((c) => c.word), ["Das", "Gesetz", "tritt"])
  assert.deepEqual(after.bank, [])
})
