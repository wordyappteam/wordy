import test from "node:test"
import assert from "node:assert/strict"
import { planSenseWrites, EDITABLE_COLUMNS } from "./senseWrites.js"

// Saving an edited word used to DELETE every sense row and re-INSERT it. The
// insert carried no id and only three of the SRS columns, so every save minted
// new sense ids and discarded interval_step, lapses, is_leech, slipped,
// last_reviewed and image_url. Editing a note cost the learner the word's
// entire study history — and the SRS hangs off those ids.
//
// So the plan is keyed by id, and the patch is a closed list of columns a
// person can actually edit. Anything not on that list cannot be written by this
// path, which is the point: the invariant is enforced where the patch is BUILT.

const studied = {
  id: "s1", translation: "перевіряти", grammarNote: "регулярний дієслово",
  explanation: "уважно дослідити", usageNote: null, pos: "verb",
  intervalStep: 4, lapses: 2, isLeech: false, learningStage: "known",
  nextReviewDate: "2026-09-20", imageUrl: "https://img/x.png",
}

test("an edited sense is an update keyed by its id", () => {
  const plan = planSenseWrites([studied], [{ ...studied, grammarNote: "регулярне дієслово" }])
  assert.equal(plan.deletes.length, 0)
  assert.equal(plan.inserts.length, 0)
  assert.deepEqual(plan.updates.map((u) => u.id), ["s1"])
  assert.equal(plan.updates[0].patch.grammar_note, "регулярне дієслово")
})

test("the patch never carries SRS state, so an edit cannot cost a learner their history", () => {
  const plan = planSenseWrites([studied], [{ ...studied, explanation: "нове пояснення" }])
  const patch = plan.updates[0].patch
  for (const forbidden of ["id", "interval_step", "lapses", "is_leech", "slipped",
                           "last_reviewed", "learning_stage", "next_review_date",
                           "correct_recall_count", "image_url", "created_at"]) {
    assert.equal(forbidden in patch, false, `${forbidden} must not be written by an edit`)
  }
})

test("every column the patch does carry is one a person can edit", () => {
  const plan = planSenseWrites([studied], [{ ...studied, translation: "звіряти" }])
  for (const key of Object.keys(plan.updates[0].patch)) {
    assert.ok(EDITABLE_COLUMNS.includes(key), `${key} is not an editable column`)
  }
})

test("a sense with no id is an insert", () => {
  const plan = planSenseWrites([studied], [studied, { translation: "новий сенс", pos: "verb" }])
  assert.equal(plan.updates.length, 0)
  assert.equal(plan.inserts.length, 1)
  assert.equal(plan.inserts[0].translation, "новий сенс")
})

test("a sense dropped from the draft is deleted by its own id, and siblings are untouched", () => {
  const other = { ...studied, id: "s2", translation: "інше" }
  const plan = planSenseWrites([studied, other], [studied])
  assert.deepEqual(plan.deletes, ["s2"])
  assert.equal(plan.updates.length, 0)
})

test("a sense nobody changed produces no write at all", () => {
  const plan = planSenseWrites([studied], [{ ...studied }])
  assert.deepEqual(plan, { updates: [], inserts: [], deletes: [] })
})

test("an empty draft deletes nothing — it means the form had nothing to save", () => {
  assert.deepEqual(planSenseWrites([studied], []), { updates: [], inserts: [], deletes: [] })
  assert.deepEqual(planSenseWrites([studied], undefined), { updates: [], inserts: [], deletes: [] })
})

test("clearing a note writes null rather than dropping the field", () => {
  const plan = planSenseWrites([studied], [{ ...studied, grammarNote: "" }])
  assert.equal(plan.updates[0].patch.grammar_note, null)
})
