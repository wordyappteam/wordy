import test from "node:test"
import assert from "node:assert/strict"
import { canonicalStem, CANONICAL_TERMS } from "./grammarTerms.js"

// One concept, one word. Nika's English dictionary carried FOURTEEN spellings
// of "countable noun" — лічильна, лічуваний, рахункова, зліченна, обчислюваний,
// лічивна, лічива … several of which are not Ukrainian words at all. Agreement
// alone would only have tidied the endings and left fourteen terms standing.

test("every variant of countable maps to the one canonical stem", () => {
  for (const variant of ["Лічильна", "лічильний", "Лічуваний", "Лічуване", "Рахункова",
                         "Зліченна", "Обчислюваний", "обчислювальне", "Лічивна", "Лічива"]) {
    assert.equal(canonicalStem(variant), "злічуван", `${variant} should map to злічуван`)
  }
})

test("the negative variants map to the negative canonical stem", () => {
  for (const variant of ["Незліченна", "невраховний", "неполічуване", "необчислюваний", "Незлічувана"]) {
    assert.equal(canonicalStem(variant), "незлічуван", `${variant} should map to незлічуван`)
  }
})

test("a term already canonical maps to itself", () => {
  assert.equal(canonicalStem("Злічуваний"), "злічуван")
  assert.equal(canonicalStem("незлічуваний"), "незлічуван")
})

test("регулярний is a calque for правильне дієслово", () => {
  assert.equal(canonicalStem("регулярний"), "правильн")
})

test("terms that were already right are left alone", () => {
  for (const term of ["правильний", "неправильне", "перехідний", "неперехідне",
                      "атрибутивний", "предикативна"]) {
    assert.equal(canonicalStem(term), null, `${term} is already canonical`)
  }
})

test("an ordinary Ukrainian word is not a grammar term", () => {
  for (const word of ["сила", "гребінь", "лічильник", "рахунок"]) {
    assert.equal(canonicalStem(word), null)
  }
})

test("the canon names a term for each concept, for the prompt to state", () => {
  assert.equal(CANONICAL_TERMS.countable, "злічуваний іменник")
  assert.equal(CANONICAL_TERMS.uncountable, "незлічуваний іменник")
  assert.equal(CANONICAL_TERMS.regular, "правильне дієслово")
})
