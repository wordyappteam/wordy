// The three-word lock for the word-order exercise.
//
// The opening words lock TOGETHER, the moment all of them are in the right
// order — never one at a time. Locking each word as it lands answers "is this
// one right?" on every tap, which is exactly what makes guessing pay; locking
// only once the whole opening is correct answers nothing until an order has
// been committed to. The cap is a flat three whatever the sentence length: one
// rule a learner can hold in their head beats a formula that quietly changes
// with the sentence, and bundling already stops it being exploitable.
//
// Design + playable reference: docs/mockups/word-order.html

export const LOCK_CAP = 3

function normalise(w) {
  return w.toLowerCase().replace(/[.,!?;:"""„»«'']/g, '').trim()
}

// How many of the placed words, counting from the start, are where they belong.
export function correctPrefix(placed, targetWords) {
  let n = 0
  while (n < placed.length && n < targetWords.length && normalise(placed[n].word) === normalise(targetWords[n])) n++
  return n
}

// Every move that can leave a correct opening behind has to be checked, not
// just placements: pulling a wrong word out of the first slot shifts the rest
// left and can complete the bundle on its own. `justLocked` carries the keys of
// the chips that snapped shut, for the one-off animation; null otherwise.
function withLock({ placed, bank, lockedCount }, { targetWords = [], cap = LOCK_CAP, mode = 'lock' }) {
  const locks = mode === 'lock' && lockedCount === 0 &&
    placed.length >= cap && correctPrefix(placed, targetWords) >= cap

  return {
    placed,
    bank,
    lockedCount: locks ? cap : lockedCount,
    justLocked: locks ? placed.slice(0, cap).map((c) => c.key) : null,
  }
}

// Place a chip from the bank at the end of the answer.
export function placeChip({ placed, bank, lockedCount }, chip, opts) {
  return withLock({
    placed: [...placed, chip],
    bank: bank.filter((c) => c.key !== chip.key),
    lockedCount,
  }, opts)
}

// Take a placed chip back to the bank. Locked chips stay put.
export function pullChip({ placed, bank, lockedCount }, index, opts = {}) {
  if (index < lockedCount) return { placed, bank, lockedCount, justLocked: null }
  return withLock({
    placed: placed.filter((_, i) => i !== index),
    bank: [...bank, placed[index]],
    lockedCount,
  }, opts)
}
