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

// Place a chip from the bank at the end of the answer, locking the opening
// bundle if this is the tap that completes it. `justLocked` carries the keys of
// the chips that snapped shut, for the one-off animation; it is null otherwise.
export function placeChip({ placed, bank, lockedCount }, chip, { targetWords, cap = LOCK_CAP, mode = 'lock' }) {
  const nextPlaced = [...placed, chip]
  const nextBank = bank.filter((c) => c.key !== chip.key)

  const locks = mode === 'lock' && lockedCount === 0 &&
    nextPlaced.length >= cap && correctPrefix(nextPlaced, targetWords) >= cap

  return {
    placed: nextPlaced,
    bank: nextBank,
    lockedCount: locks ? cap : lockedCount,
    justLocked: locks ? nextPlaced.slice(0, cap).map((c) => c.key) : null,
  }
}

// Take a placed chip back to the bank. Locked chips stay put.
export function pullChip({ placed, bank, lockedCount }, index) {
  if (index < lockedCount) return { placed, bank, lockedCount }
  return {
    placed: placed.filter((_, i) => i !== index),
    bank: [...bank, placed[index]],
    lockedCount,
  }
}
