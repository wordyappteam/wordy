# Dictionary & Identify Correctness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the identifier store what the learner meant — distinct words as distinct entries, canonical verb forms made explicit — and let the dictionary show prepositional verbs and set "known" per sense.

**Architecture:** Five sequential tasks. Task 1 changes `identifyWord`'s contract from one entry to a `candidates[]` array and enforces the spelling boundary in code (Haiku disobeys prompts); a `primaryEntry()` shim keeps the three non-picker callers unchanged. Tasks 2–5 build on that. Every task's core logic is a **pure function** in `src/lib/` (unit-tested with `node --test`), wired into React separately, so none of the logic needs the browser to test.

**Tech Stack:** React 19, Vite 8, Supabase, Claude Haiku 4.5. Tests: `node --test` (`npm test`). Pure logic lives in `src/lib/*.js`.

## Global Constraints

- Git commit email must be `wordy.app.team@gmail.com` (verify with `git config user.email`).
- Pre-commit hook runs `vite build` + `npm test`; a red suite or broken build blocks the commit. Never `--no-verify`.
- Apostrophes in single-quoted JS strings break the build — use double quotes.
- Interface explanatory text is Ukrainian or English, **never Russian**.
- The existing **113 tests must stay green**; this plan only adds tests.
- No schema migration: `word_senses` already has `interval_step`, `learning_stage`, `next_review_date`, `examples` (jsonb).
- Tasks are **sequential** — 1 → 2 → 3 → 4 → 5 — because they share `src/lib/claude.js` and `src/pages/Dictionary.jsx`. Do not run them in parallel worktrees.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `src/lib/identifyCandidates.js` (new) | Pure: split one parsed entry into candidate entries by spelling; strip a wordForm to its base spelling | 1 |
| `src/lib/identifyCandidates.test.js` (new) | Tests for the above | 1 |
| `src/lib/claude.js` | `identifyWord` returns `{ candidates }`; add `primaryEntry()`; canonical-form prompt rules | 1, 3 |
| `src/pages/Dictionary.jsx` | `AddWordModal` candidate picker; `handleAdd` inserts N entries; list headword; per-sense stage control; remove dead `status` writes | 1, 2, 4, 5 |
| `src/lib/senseFormat.js` (new) | Pure: `listHeadword(word)` — the dictionary-row label | 4 |
| `src/lib/senseFormat.test.js` (new) | Tests for `listHeadword` | 4 |
| `src/lib/srs.js` | `manualStagePatch(level, todayISO)` — the interval-step patch for a manual stage set | 5 |
| `src/lib/srs.test.js` | Tests for `manualStagePatch` | 5 |

---

## Task 1: `identifyWord` returns candidates; enforce the spelling boundary

**Files:**
- Create: `src/lib/identifyCandidates.js`, `src/lib/identifyCandidates.test.js`
- Modify: `src/lib/claude.js` (`identifyWord` return at `:234`, contract comment `:50`; add `primaryEntry`); the prompt "return multiple senses" rule at `:161`
- Modify (callers using the old shape): `src/pages/Dictionary.jsx:872` (per-word re-identify), `src/pages/Dictionary.jsx:1611` (`BulkIdentifyModal`)

**Interfaces:**
- Produces: `baseSpelling(wordForm: string) -> string` — the bare lemma, lowercased, stripped of a leading article (`der|die|das|to`), a leading reflexive (`sich|oneself`), and a trailing governed preposition token.
- Produces: `splitCandidates(entry: {word, entryType, senses}) -> Array<{word, entryType, senses}>` — senses grouped by `baseSpelling(sense.wordForm)`; one candidate per distinct base spelling; the entry's own `word` spelling is the first candidate.
- Produces: `identifyWord(...) -> { candidates: Array<{word, entryType, senses}> }` (was `{ word, entryType, senses }`).
- Produces: `primaryEntry(result) -> {word, entryType, senses}` — `result.candidates[0]`, for callers that only ever want one entry.

- [ ] **Step 1: Write the failing test for `baseSpelling`**

```js
// src/lib/identifyCandidates.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { baseSpelling, splitCandidates } from './identifyCandidates.js'

test('baseSpelling strips article, reflexive, and governed preposition', () => {
  assert.equal(baseSpelling('die Bank'), 'bank')
  assert.equal(baseSpelling('kämpfen gegen'), 'kämpfen')
  assert.equal(baseSpelling('sich freuen auf'), 'freuen')
  assert.equal(baseSpelling('to conduct oneself'), 'conduct')
  assert.equal(baseSpelling('callus'), 'callus')
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `node --test src/lib/identifyCandidates.test.js`
Expected: FAIL — `baseSpelling` is not exported (module not found).

- [ ] **Step 3: Implement `baseSpelling`**

```js
// src/lib/identifyCandidates.js
const ARTICLES = new Set(['der', 'die', 'das', 'to'])
const REFLEXIVES = new Set(['sich', 'oneself'])
// A short, closed set of the governed prepositions the identifier attaches.
const PREPS = new Set([
  'an', 'auf', 'aus', 'bei', 'für', 'gegen', 'in', 'mit', 'nach',
  'über', 'um', 'unter', 'von', 'vor', 'zu', 'oneself',
])

export function baseSpelling(wordForm) {
  const tokens = (wordForm || '').trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!tokens.length) return ''
  // drop a leading article
  if (ARTICLES.has(tokens[0])) tokens.shift()
  // drop a leading reflexive (English "oneself" trails; German "sich" leads)
  if (REFLEXIVES.has(tokens[0])) tokens.shift()
  // drop a trailing governed preposition / reflexive
  while (tokens.length > 1 && PREPS.has(tokens[tokens.length - 1])) tokens.pop()
  return tokens.join(' ')
}
```

- [ ] **Step 4: Run test, verify `baseSpelling` cases pass** (the `splitCandidates` import will still fail its own tests — that is next)

Run: `node --test src/lib/identifyCandidates.test.js`
Expected: the `baseSpelling` test PASSES.

- [ ] **Step 5: Write the failing test for `splitCandidates`**

```js
test('splitCandidates keeps same-spelling senses together', () => {
  const entry = { word: 'die Bank', entryType: 'word', senses: [
    { wordForm: 'die Bank', translation: 'bench' },
    { wordForm: 'die Bank', translation: 'bank (finance)' },
  ] }
  const out = splitCandidates(entry)
  assert.equal(out.length, 1)
  assert.equal(out[0].senses.length, 2)
})

test('splitCandidates separates different spellings into distinct entries', () => {
  const entry = { word: 'callous', entryType: 'word', senses: [
    { wordForm: 'callous', translation: 'unfeeling' },
    { wordForm: 'callus',  translation: 'hardened skin' },
  ] }
  const out = splitCandidates(entry)
  assert.equal(out.length, 2)
  assert.deepEqual(out.map(c => c.word).sort(), ['callous', 'callus'])
  assert.ok(out.every(c => c.senses.length === 1))
})

test('splitCandidates keeps a prepositional verb family as one entry', () => {
  const entry = { word: 'kämpfen', entryType: 'word', senses: [
    { wordForm: 'kämpfen gegen', translation: 'fight against' },
    { wordForm: 'kämpfen für',   translation: 'fight for' },
  ] }
  assert.equal(splitCandidates(entry).length, 1)
})
```

- [ ] **Step 6: Run it, verify it fails**

Run: `node --test src/lib/identifyCandidates.test.js`
Expected: FAIL — `splitCandidates` not defined.

- [ ] **Step 7: Implement `splitCandidates`**

```js
// append to src/lib/identifyCandidates.js
export function splitCandidates(entry) {
  const senses = entry.senses ?? []
  if (senses.length <= 1) return [entry]
  const groups = new Map() // base spelling -> senses[]
  for (const s of senses) {
    const key = baseSpelling(s.wordForm) || baseSpelling(entry.word)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(s)
  }
  if (groups.size === 1) return [entry]
  // The entry's own spelling leads; the rest follow in first-seen order.
  const entryKey = baseSpelling(entry.word)
  const keys = [...groups.keys()].sort((a, b) =>
    (a === entryKey ? -1 : 0) - (b === entryKey ? -1 : 0))
  return keys.map(key => {
    const group = groups.get(key)
    // Each candidate's display word is its first sense's wordForm, stripped of a
    // trailing preposition so the headword is the lemma (kämpfen, not kämpfen gegen).
    const lead = group[0].wordForm || entry.word
    return { word: stripTrailingPrep(lead), entryType: entry.entryType, senses: group }
  })
}

function stripTrailingPrep(wordForm) {
  const tokens = (wordForm || '').trim().split(/\s+/)
  while (tokens.length > 1 && PREPS.has(tokens[tokens.length - 1].toLowerCase())) tokens.pop()
  return tokens.join(' ')
}
```

- [ ] **Step 8: Run tests, verify all pass**

Run: `node --test src/lib/identifyCandidates.test.js`
Expected: PASS (all 4 tests).

- [ ] **Step 9: Wire `splitCandidates` into `identifyWord` and add `primaryEntry`**

In `src/lib/claude.js`, add the import at the top with the other imports:
```js
import { splitCandidates } from './identifyCandidates.js'
```
Replace the return at `:234`:
```js
  const entry = isUkrainian ? deepFixStress(parsed) : parsed
  return { candidates: splitCandidates(entry) }
}

// Callers that only ever want a single entry (re-identify, bulk) use this.
export function primaryEntry(result) {
  return result?.candidates?.[0] ?? null
}
```
Update the contract comment at `:50` to: `// Returns { candidates: [ { word, entryType, senses: [...] }, ... ] }`.
In the prompt at `:161`, change the multi-sense instruction so different **spellings** are different words, not senses:
```js
    : `\nReturn ALL senses that share this word's SPELLING (separate POS or clearly distinct meaning groups of the SAME written word). A meaning whose base spelling differs from "${input}" is a DIFFERENT word — do not include it here. Most words have exactly one sense.`
```

- [ ] **Step 10: Update the two single-entry callers to use `primaryEntry`**

In `src/pages/Dictionary.jsx`, import it:
```js
import { identifyWord as identifyWordAI, primaryEntry, suggestCollectionWords } from '../lib/claude'
```
At `:872` (per-word re-identify), replace `const result = await identifyWordAI(...)` usage so `result` becomes the primary entry:
```js
      const idResult = await identifyWordAI(word.word, targetLanguageName, lang, null, { topics })
      const result = primaryEntry(idResult) ?? { senses: word.senses }
```
At `:1611` (`BulkIdentifyModal`), likewise:
```js
        const idResult = await identifyWordAI(w.word, targetLanguageName, interfaceLanguage, null, { topics })
        const result = primaryEntry(idResult) ?? {}
```
(Leave the rest of both blocks unchanged — they already read `result.senses` / `result.translation`.)

- [ ] **Step 11: Run the full suite + build**

Run: `npm test`
Expected: PASS, 117 tests (113 + 4 new). Build is exercised by the pre-commit hook next.

- [ ] **Step 12: Commit**

```bash
git add src/lib/identifyCandidates.js src/lib/identifyCandidates.test.js src/lib/claude.js src/pages/Dictionary.jsx
git commit -m "feat(identify): split different-spelling meanings into candidate entries

identifyWord now returns { candidates } and enforces the spelling boundary in
code (splitCandidates), because Haiku bundles callous+callus despite the prompt.
primaryEntry() keeps re-identify and bulk callers on one entry.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `AddWordModal` picks candidates; `handleAdd` inserts N entries

**Files:**
- Modify: `src/pages/Dictionary.jsx` — `AddWordModal` (`:562`, result render `:655–700`, `handleAdd` `:590`), and the parent `handleAdd` (`:2267`).

**Interfaces:**
- Consumes: `identifyWord(...) -> { candidates }` and `primaryEntry` from Task 1.
- Produces: `onAdd` is called with `{ candidates: Array<{word, entryType, senses}> }` (was one entry). The parent `handleAdd(payload)` loops over `payload.candidates` and inserts each as its own `words` row + `word_senses`.

- [ ] **Step 1: Adapt `AddWordModal` state to candidates**

The modal already has `checkedSenses` for a single entry's senses. Generalise to per-candidate checks. Replace the `setResult(data)` at `:577` — `data` is now `{ candidates }`. Add state near `:566`:
```js
  const [checked, setChecked] = useState({}) // "ci.si" -> bool, default all true
```
When a result arrives, default every sense of every candidate to checked:
```js
      const data = await identifyWordAI(input, targetLanguageName, translationLang, null, { topics })
      const init = {}
      ;(data.candidates || []).forEach((c, ci) =>
        (c.senses || []).forEach((_, si) => { init[`${ci}.${si}`] = true }))
      setChecked(init)
      setResult(data)
      setStage('result')
```

- [ ] **Step 2: Render each candidate as a titled group**

Replace the result block (`:655–700`) so it maps `result.candidates`, each with its `word` as a small heading, and its senses as the existing checkbox rows (reuse the row markup verbatim, keyed by `` `${ci}.${si}` ``). When `result.candidates.length > 1`, show a one-line hint: `"These are different words — pick the ones to add."` The existing per-sense row UI (translation, pos badge, checkbox) is unchanged; only the `checked[...]` key and the surrounding `.map` change.

- [ ] **Step 3: Build the selected payload in the modal's `handleAdd`**

Replace `:590–594`:
```js
  const handleAdd = () => {
    if (!result) return
    const chosen = (result.candidates || [])
      .map((c, ci) => ({
        ...c,
        senses: (c.senses || []).filter((_, si) => checked[`${ci}.${si}`]),
      }))
      .filter(c => c.senses.length > 0)
    if (!chosen.length) return
    onAdd({ candidates: chosen, source: 'manual' })
    onClose()
  }
```
Update the disabled guard at `:711` to `disabled={stage !== 'result' || Object.values(checked).every(v => !v)}`.

- [ ] **Step 4: Write the failing test for the parent insert loop**

The parent `handleAdd` is React+Supabase, so extract the row-building as a pure helper and test that. Add to `src/lib/identifyCandidates.js`:
```js
// (test-first — implement in Step 6)
```
Test:
```js
// src/lib/identifyCandidates.test.js
import { candidateToRows } from './identifyCandidates.js'

test('candidateToRows builds one word row + its sense rows', () => {
  const c = { word: 'kämpfen', entryType: 'word', senses: [
    { wordForm: 'kämpfen gegen', pos: 'verb', translation: 'fight against' },
  ] }
  const { wordRow, senseRows } = candidateToRows(c, { userId: 'u1', targetLang: 'de', source: 'manual' })
  assert.equal(wordRow.word, 'kämpfen')
  assert.equal(wordRow.user_id, 'u1')
  assert.equal(senseRows.length, 1)
  assert.equal(senseRows[0].word_form, 'kämpfen gegen')
  assert.equal(senseRows[0].learning_stage, 'new')
})
```

- [ ] **Step 5: Run it, verify it fails**

Run: `node --test src/lib/identifyCandidates.test.js`
Expected: FAIL — `candidateToRows` not defined.

- [ ] **Step 6: Implement `candidateToRows`** (mirrors the existing insert shapes at `Dictionary.jsx:2272` and `:2296`)

```js
export function candidateToRows(candidate, { userId, targetLang, source = 'manual' }) {
  const primary = candidate.senses?.[0]
  const today = new Date().toISOString().slice(0, 10)
  const wordRow = {
    user_id: userId, word: candidate.word, entry_type: candidate.entryType || 'word',
    target_language: targetLang, status: 'new', source, date_added: today, last_reviewed: '—',
    translation: primary?.translation ?? '', pos: primary?.pos ?? 'noun',
    form: primary?.form ?? null, grammar_note: primary?.grammarNote ?? null,
    explanation: primary?.explanation ?? null, is_exception: primary?.isException ?? false,
    conjugation: primary?.conjugation ?? null,
  }
  const senseRows = (candidate.senses ?? []).map(s => ({
    user_id: userId, target_language: targetLang, pos: s.pos,
    word_form: s.wordForm || candidate.word, aspect: s.aspect ?? null, gender: s.gender ?? null,
    translation: s.translation, form: s.form || null, grammar_note: s.grammarNote || null,
    usage_note: s.usageNote || null, explanation: s.explanation || null,
    is_exception: s.isException || false, register: s.register || 'neutral', cefr: s.cefr || null,
    conjugation: s.conjugation || null, examples: s.examples || [],
    learning_stage: 'new', correct_recall_count: 0,
  }))
  return { wordRow, senseRows }
}
```

- [ ] **Step 7: Run tests, verify pass**

Run: `node --test src/lib/identifyCandidates.test.js`
Expected: PASS.

- [ ] **Step 8: Rewrite the parent `handleAdd` to loop candidates** (`Dictionary.jsx:2267`)

```js
  async function handleAdd(payload) {
    if (!user) return
    const candidates = payload.candidates ?? [payload] // tolerate a single entry
    for (const c of candidates) {
      const { wordRow, senseRows } = candidateToRows(c, { userId: user.id, targetLang, source: payload.source })
      const { data: newWord, error } = await supabase.from('words').insert(wordRow).select('id').single()
      if (error || !newWord) continue
      if (senseRows.length) {
        await supabase.from('word_senses').insert(senseRows.map(r => ({ ...r, word_id: newWord.id })))
      }
    }
    fetchWords()
  }
```
Add the import: `import { splitCandidates, candidateToRows } from '../lib/identifyCandidates'` (or extend the existing import line).

- [ ] **Step 9: Manual verification (click-through)**

Run: `npx vite --port 5173`. In the dictionary, Add word → type `callous` → the result shows **two candidate groups** (callous / callus); add both; confirm two separate dictionary rows. Then type `kämpfen` → **one** group with its senses.

- [ ] **Step 10: Commit**

```bash
git add src/pages/Dictionary.jsx src/lib/identifyCandidates.js src/lib/identifyCandidates.test.js
git commit -m "feat(dictionary): add multiple candidate entries from one lookup

The add modal groups candidates by word and inserts each as its own entry via
candidateToRows; a single-candidate lookup is unchanged.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Make the canonical-form rules explicit

**Files:**
- Modify: `src/lib/claude.js` (`wordFormNote` at `:106–110`, `wordNote` at `:112`).
- Create: `docs/superpowers/reference/canonical-forms.md` — the per-language rule table (documentation the spec §2 asks for).

**Interfaces:** none new — this refines an existing prompt string and adds a doc. No behavioural change for German (the rule already exists); English/Ukrainian reflexive citation forms are pinned.

- [ ] **Step 1: Write the canonical-forms reference doc**

Create `docs/superpowers/reference/canonical-forms.md` with the five shapes and the per-language table from spec §2 (Plain / Verb+prep / Reflexive / Reflexive+prep / Separable; German `sich` + case ordering, English `oneself` citation, Ukrainian `-ся`). Copy the `kämpfen` worked example from the spec verbatim.

- [ ] **Step 2: Pin the English reflexive citation in the prompt**

The German `wordFormNote` (`:107`) is already correct. Extend the English branch (`:110`) from the bare `'canonical form for this sense — plain form, no article'` to state the reflexive/preposition rule explicitly:
```js
    : 'canonical form for this sense — the plain verb, no article; BUT attach a bound reflexive ("oneself", e.g. "conduct oneself", "pride oneself on") and/or a governed preposition when this sense is not used without it, ordered verb-then-preposition ("wait for", "belong to"). Keep a self-standing verb plain.'
```

- [ ] **Step 3: Verify the build (prompt is a string; no unit test)**

Run: `npm test` then let the pre-commit build run at commit.
Expected: 117 tests still PASS (no logic changed).

- [ ] **Step 4: Commit**

```bash
git add src/lib/claude.js docs/superpowers/reference/canonical-forms.md
git commit -m "docs(identify): make canonical-form rules explicit + pin English reflexive

The German rule already existed in the prompt; this documents all five shapes
per language and pins 'conduct oneself' so the English form stops looking arbitrary.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Dictionary list shows the prepositional form + sense count

**Files:**
- Create: `src/lib/senseFormat.js`, `src/lib/senseFormat.test.js`
- Modify: `src/pages/Dictionary.jsx` — the list headword render at `:506`.

**Interfaces:**
- Produces: `listHeadword(word: {word, senses}) -> string` — the primary sense's `wordForm` when it carries more than the bare `word`; append ` ·N` when the entry has N>1 senses whose base spellings agree but forms differ; else the bare `word`.

- [ ] **Step 1: Write the failing test**

```js
// src/lib/senseFormat.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { listHeadword } from './senseFormat.js'

test('a plain word shows its bare form', () => {
  assert.equal(listHeadword({ word: 'setzen', senses: [{ wordForm: 'setzen' }] }), 'setzen')
})
test('a single prepositional sense shows the form', () => {
  assert.equal(listHeadword({ word: 'setzen', senses: [{ wordForm: 'setzen auf' }] }), 'setzen auf')
})
test('a multi-sense verb shows the primary form + count', () => {
  assert.equal(listHeadword({ word: 'kämpfen', senses: [
    { wordForm: 'kämpfen gegen' }, { wordForm: 'kämpfen für' }, { wordForm: 'kämpfen mit' },
  ] }), 'kämpfen gegen ·3')
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `node --test src/lib/senseFormat.test.js`
Expected: FAIL — `listHeadword` not defined.

- [ ] **Step 3: Implement `listHeadword`**

```js
// src/lib/senseFormat.js
export function listHeadword(word) {
  const senses = word.senses ?? []
  const primary = senses[0]
  const form = primary?.wordForm?.trim()
  const base = form && form.toLowerCase() !== (word.word || '').trim().toLowerCase() ? form : word.word
  return senses.length > 1 ? `${base} ·${senses.length}` : base
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `node --test src/lib/senseFormat.test.js`
Expected: PASS.

- [ ] **Step 5: Wire into the list render** (`Dictionary.jsx:506`)

Import: `import { listHeadword } from '../lib/senseFormat'`. Replace `<span>{w.word}</span>` at `:506` with `<span>{listHeadword(w)}</span>`. Leave the `(form)` span at `:508` unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/lib/senseFormat.js src/lib/senseFormat.test.js src/pages/Dictionary.jsx
git commit -m "feat(dictionary): show the governed preposition + sense count in the list

setzen auf no longer displays as bare setzen; a multi-sense verb reads
kämpfen gegen ·3. Pure listHeadword(), unit-tested.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Set "known" per sense

**Files:**
- Modify: `src/lib/srs.js` (add `manualStagePatch`), `src/lib/srs.test.js` (tests)
- Modify: `src/pages/Dictionary.jsx` — add a per-sense stage control on the sense card (badge at `:1013/:1027`); the write path; remove the dead word-level `status` writes (edit-mode picker `:1411–1429`, `QuickSortMode.handleStatus` `:1489`).

**Interfaces:**
- Consumes: `INTERVALS`, `stageName`, `MAX_STEP` from `srs.js`.
- Produces: `manualStagePatch(level: 'new'|'learning'|'known'|'mastered', todayISO: string) -> { interval_step, learning_stage, next_review_date }` — the exact `word_senses` update for a manual set.

- [ ] **Step 1: Write the failing test**

```js
// append to src/lib/srs.test.js
import { manualStagePatch } from './srs.js'

test('manualStagePatch maps levels to interval steps and stage names', () => {
  const p = manualStagePatch('known', '2026-07-27')
  assert.equal(p.interval_step, 6)
  assert.equal(p.learning_stage, 'known')
  assert.equal(p.next_review_date, '2026-08-31') // +35 days (INTERVALS[6])
})
test('manualStagePatch: new is due today', () => {
  const p = manualStagePatch('new', '2026-07-27')
  assert.equal(p.interval_step, 0)
  assert.equal(p.learning_stage, 'new')
  assert.equal(p.next_review_date, '2026-07-27')
})
test('manualStagePatch: mastered is the max step', () => {
  assert.equal(manualStagePatch('mastered', '2026-07-27').interval_step, 8)
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `node --test src/lib/srs.test.js`
Expected: FAIL — `manualStagePatch` not defined.

- [ ] **Step 3: Implement `manualStagePatch`** (reuse the existing `addDays` helper in `srs.js:410`)

```js
// src/lib/srs.js
const MANUAL_STEP = { new: 0, learning: 3, known: 6, mastered: MAX_STEP }
export function manualStagePatch(level, todayISO) {
  const step = MANUAL_STEP[level] ?? 0
  const next = step === 0 ? todayISO : addDays(todayISO, INTERVALS[step])
  return { interval_step: step, learning_stage: stageName(step), next_review_date: next }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `node --test src/lib/srs.test.js`
Expected: PASS.

- [ ] **Step 5: Add the per-sense stage control on the card**

In `WordPanel`'s sense render, make the stage badge (`Dictionary.jsx:1013`/`:1027`) open a small 4-button picker (new/learning/known/mastered) for **that sense**. On click, write:
```js
  async function setSenseStage(senseId, level) {
    const patch = manualStagePatch(level, new Date().toISOString().slice(0, 10))
    await supabase.from('word_senses').update(patch).eq('id', senseId).eq('user_id', userId)
    onUpdate?.()   // re-fetch so the derived word badge refreshes
  }
```
Import `manualStagePatch` from `../lib/srs`.

- [ ] **Step 6: Remove the dead word-level status writes**

Delete the edit-mode "Status" picker block (`Dictionary.jsx:1411–1429`) and the `draft.status` writes it feeds. In `QuickSortMode` (`:1480`), repoint `handleStatus` to set the primary sense's stage via the same `word_senses` update (not `words.status`); if `QuickSortMode` is not worth keeping per the reviewer, remove its status buttons rather than leave them writing a dead column.

- [ ] **Step 7: Manual verification**

Run the app. Open a multi-sense word (e.g. a word with two senses), set **one** sense to "known", confirm the other stays as-is and the list badge reflects the mix; confirm the known sense stops appearing as due in a session.

- [ ] **Step 8: Commit**

```bash
git add src/lib/srs.js src/lib/srs.test.js src/pages/Dictionary.jsx
git commit -m "feat(dictionary): set learning stage per sense, writing real SRS state

manualStagePatch maps new/learning/known/mastered to interval_step and writes
word_senses (not the dead words.status). Marking one sense known leaves siblings
untouched. Unit-tested.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:** §1 homonyms → Tasks 1–2. §2 canonical forms → Task 3 (+ the German rule already present). §3 list display → Task 4. §4 per-sense known → Task 5. All four spec sections covered.
- **Placeholder scan:** every code step contains real code; the only prose-only steps are UI wiring (Task 2 Step 2, Task 5 Steps 5–6) anchored to exact line numbers and reusing existing markup, plus the doc in Task 3.
- **Type consistency:** `identifyWord` → `{ candidates }` (Task 1) is consumed by `AddWordModal`/`handleAdd` (Task 2) and by `primaryEntry` (Task 1). `candidateToRows` shapes match the existing insert at `Dictionary.jsx:2272/2296`. `manualStagePatch` returns the three `word_senses` columns used in Task 5's update. `listHeadword` consumes `{word, senses:[{wordForm}]}`, the shape the list already has.
- **Ordering:** 1 → 2 → 3 → 4 → 5. Task 2 depends on Task 1's contract; Tasks 3–5 are independent of each other but all touch `Dictionary.jsx`, so they stay sequential.
