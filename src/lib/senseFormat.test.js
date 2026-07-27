import { test } from "node:test"
import assert from "node:assert/strict"
import { listHeadword } from "./senseFormat.js"

test("a plain word shows its bare form", () => {
  assert.equal(listHeadword({ word: "setzen", senses: [{ wordForm: "setzen" }] }), "setzen")
})
test("a single prepositional sense shows the form", () => {
  assert.equal(listHeadword({ word: "setzen", senses: [{ wordForm: "setzen auf" }] }), "setzen auf")
})
test("a multi-sense verb shows the primary form + count", () => {
  assert.equal(listHeadword({ word: "kämpfen", senses: [
    { wordForm: "kämpfen gegen" }, { wordForm: "kämpfen für" }, { wordForm: "kämpfen mit" },
  ] }), "kämpfen gegen ·3")
})
