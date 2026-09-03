// Planning the writes for an edited word's senses.
//
// This exists because the previous save path deleted every sense row for a word
// and re-inserted it. The insert carried no id and only three SRS columns, so
// each save minted new sense ids and discarded interval_step, lapses, is_leech,
// slipped, last_reviewed and image_url. Editing a note cost the learner the
// word's whole study history — and since the SRS hangs off sense ids, anything
// else keyed to them was orphaned too.
//
// The fix is not "remember to copy the SRS columns across". It is to never
// rewrite the row: an edit is an UPDATE, keyed by the id, of a closed list of
// columns a person can actually type into. A column that is not on that list
// cannot be written by this path at all.

// Everything the edit form can change, and nothing else. SRS state is written
// by the session engine and by setStage — never here.
export const EDITABLE_COLUMNS = [
  'translation', 'explanation', 'grammar_note', 'usage_note',
  'form', 'pos', 'word_form', 'aspect', 'gender',
  'is_exception', 'register', 'cefr', 'conjugation', 'examples',
]

// draft key -> column, for the fields the form actually edits.
const FIELD_TO_COLUMN = {
  translation: 'translation',
  explanation: 'explanation',
  grammarNote: 'grammar_note',
  usageNote: 'usage_note',
  form: 'form',
  pos: 'pos',
  wordForm: 'word_form',
  aspect: 'aspect',
  gender: 'gender',
  isException: 'is_exception',
  register: 'register',
  cefr: 'cefr',
  conjugation: 'conjugation',
  examples: 'examples',
}

// An empty string means the learner cleared the field; store that as null so a
// blank note and a missing note are the same thing to everything downstream.
const normalise = (v) => (v === '' || v === undefined ? null : v)

const same = (a, b) => JSON.stringify(normalise(a) ?? null) === JSON.stringify(normalise(b) ?? null)

function patchFor(previous, draft) {
  const patch = {}
  for (const [field, column] of Object.entries(FIELD_TO_COLUMN)) {
    if (!(field in draft)) continue
    if (same(previous[field], draft[field])) continue
    patch[column] = normalise(draft[field])
  }
  return patch
}

// previous: the sense rows as they are stored, each with an id.
// draft:    the senses as the form has them; a sense with no id is new.
export function planSenseWrites(previous = [], draft) {
  // No senses in the draft means the form had nothing to save — not an
  // instruction to empty the word. The old path read it as the latter.
  if (!Array.isArray(draft) || draft.length === 0) {
    return { updates: [], inserts: [], deletes: [] }
  }

  const before = new Map(previous.map((s) => [s.id, s]))
  const updates = []
  const inserts = []

  for (const sense of draft) {
    const existing = sense.id && before.get(sense.id)
    if (!existing) { inserts.push(sense); continue }
    const patch = patchFor(existing, sense)
    if (Object.keys(patch).length) updates.push({ id: sense.id, patch })
  }

  const kept = new Set(draft.map((s) => s.id).filter(Boolean))
  const deletes = previous.map((s) => s.id).filter((id) => !kept.has(id))

  return { updates, inserts, deletes }
}
