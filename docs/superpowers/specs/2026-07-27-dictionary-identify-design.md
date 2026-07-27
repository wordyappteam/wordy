# Dictionary & identify correctness

**Date:** 2026-07-27
**Status:** approved
**Scope:** `src/lib/claude.js` (`identifyWord`), `src/pages/Dictionary.jsx` (the add flow, the list headword, the status picker). No exercise/session code — that is Spec 1. No schema migration.

Four findings from 2026-07-27 testing about what the identifier stores and how the dictionary shows it.

---

## 1. Different words must not be bundled as senses of one entry

### The finding

Looking up *callous* returned **one entry with two senses**: *callus* (noun, мозоль — hardened skin) and *callous* (adjective, чорствий — unfeeling). Its own usage note admitted *«Це різні слова»*. But `identifyWord` always returns a single `{ word, entryType, senses[] }`, and the prompt says to return "ALL commonly used senses (separate POS or clearly distinct meaning groups)" (`claude.js:161`) — so it swept a **different, differently-spelled word** into the typed word's senses.

### The rule (decided 2026-07-27)

**Spelling is the boundary.** Two meanings that share a spelling are senses of one word (*die Bank* = bench / bank). Two meanings with **different spellings are different words** and must never be merged.

- **Correctly-spelled input → one entry.** If what the learner typed is itself a valid word, return only that word, with its genuine same-spelling senses. *callous* → the adjective only; *callus* does not appear.
- **Ambiguous / mistyped input → candidate entries.** When the input is not cleanly one word — a likely misspelling that could be two or more *differently-spelled* real words — return those as **separate candidates**, and let the learner add one or more, each as its **own dictionary entry**.

### What changes

`identifyWord` gains a plural contract: it returns **candidate entries**, not one entry.

```js
{ candidates: [ { word, entryType, senses: [...] }, ... ] }
```

- Usual case: `candidates.length === 1` → the add flow behaves exactly as today.
- Ambiguous case: `> 1` → the add modal lists the candidates (it already has the checkbox UI seen in the 2026-07-27 shots); each checked candidate is inserted as its own `words` row with its own `word_senses`.

**Prompt change:** meanings with **different spellings** are different words → different candidates; only same-spelling POS / meaning groups are senses within a candidate. A correctly-spelled input returns exactly one candidate. Multiple candidates are only for genuine input ambiguity, not for homophones of a word the learner spelled correctly.

`handleAdd` (`Dictionary.jsx:2267`) already inserts one entry + its senses; it is generalised to loop over the chosen candidates.

---

## 2. The reflexive / phrasal canonical form — make the implicit rules explicit

### The finding

*conduct oneself* was stored with the literal placeholder *oneself*, and the question was whether that is right and what the rule is.

### The position

It **is** right — *conduct oneself* is the correct English citation form, like *pride oneself on*. The rules already exist, but only implicitly, buried in one prompt string and written around German *sich* (`claude.js:107, 115, 139`): nouns carry their article; a verb that depends on a reflexive and/or governed preposition carries them attached, ordered **reflexive · verb · preposition** (*sich erinnern an*, *warten auf*), and a self-standing verb sense stays plain (*denken*, not *denken an*, unless that sense needs it).

This spec **documents** those rules as an explicit, per-language canonical-form table (German *sich* + case; English *oneself*; Ukrainian *-ся*), so the behaviour is a stated contract rather than an emergent property of prose. No behavioural change for German; the English/Ukrainian reflexive citation forms are pinned so they stop looking arbitrary.

---

## 3. Prepositional/phrasal verbs display bare in the list

### The finding

Two *setzen* entries — one plain, one *setzen auf* (to bet on) — both show as bare **"setzen"** in the dictionary list, so they are indistinguishable and the governed preposition is hidden. The preposition is not lost: the sense's `word_form` is *"setzen auf"*; the list just renders the entry's `words.word` (`Dictionary.jsx:99, 506`), which is the bare lemma.

### The fix

The list headword shows the **primary sense's `wordForm`** when it carries more than the bare `word` (a reflexive or a governed preposition) — the same "print the form when it says more than the header" logic already used on the sense card (`showSenseForm`). So the row reads *"setzen auf"*, and the two *setzen* entries are visibly different. Fallback to `word` when the primary sense adds nothing.

---

## 4. Manual "known" cannot be set

### The finding

Editing a word you already know and choosing **"known"** does nothing. Confirmed: the status picker writes `draft.status` → the legacy `words.status` column (`Dictionary.jsx:1418`, and `QuickSortMode` at `:1489`), but every status shown in the app is now **derived** from the senses' `learning_stage` via `badgeForWord` (`:104`). The picker writes a column nobody reads.

### The fix

The picker writes the **SRS state of the word's senses**, which is the real source of truth. Map the four buttons to interval steps and set all of the word's senses accordingly:

| Button | `interval_step` | `next_review_date` |
|---|---|---|
| new | 0 | today |
| learning | 3 (mid) | today + interval for step 3 |
| known | 6 | today + interval for step 6 |
| mastered | 8 (max) | today + interval for step 8 |

Writing all senses (not just the primary) matches the intent — "I know this word" — and keeps the derived badge honest. This makes the picker a genuine fast-track for words the learner arrives already knowing, which for the DTZ cohort (adults with existing vocabulary) is a real need, not a nicety. The legacy `words.status` write is removed.

---

## Out of scope

Session/fill-in fixes are Spec 1. Pure AI-output errors (Abitur → "A-levels", *fortificована*, passive mistranslation) are the DTZ-pack calibration checklist. This spec does not touch the SRS scheduling maths, only the manual entry point into it (#4).

## Testing

- **Candidate splitting (#1):** `identifyWord` parsing — a correctly-spelled input yields one candidate; an ambiguous input yields several with distinct spellings; same-spelling polysemy stays as senses within one candidate. `handleAdd` inserts N entries from N chosen candidates. The prompt-obedience risk is real (Haiku bundled these before), so the parse layer must enforce the spelling-boundary invariant in code, `senseNotes.js`-style, not trust the model.
- **Reflexive canonical form (#2):** table-driven tests over the documented rules per language.
- **List headword (#3):** primary-sense `wordForm` with a preposition renders; a plain verb still shows the bare lemma.
- **Status write (#4):** each button sets the mapped `interval_step` on all senses and the derived badge updates; the dead-column write is gone.
- Existing 113 tests stay green.
