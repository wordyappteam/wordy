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

### The five shapes

A verb sense's form is the base verb plus what it cannot stand without, ordered **reflexive · verb · preposition (+ case)**:

| Shape | Example | Gloss |
|---|---|---|
| Plain | `kämpfen` | to fight / struggle |
| Verb + prep (+ case) | `kämpfen gegen` + Akk | to fight against |
| Reflexive | `sich beeilen` | to hurry |
| Reflexive + prep | `sich freuen auf` + Akk | to look forward to |
| Separable (+ prep) | `aufhören mit` + Dat | to stop (doing sth) |

### Worked example: one word, senses that differ

*kämpfen* is one spelling → **one entry** (§1), but each meaning governs a different preposition, so each is its own sense with its own form:

| Sense form | Case | Ukrainian | English |
|---|---|---|---|
| `kämpfen gegen` | Akk | боротися проти | fight against (an enemy, an illness) |
| `kämpfen für` | Akk | боротися за | fight for (a cause) |
| `kämpfen mit` | Dat | боротися з | struggle with (difficulties) |
| `kämpfen um` | Akk | боротися за | fight for (to win — a title) |

Ties into §1: *"to fight someone"* transitively is *bekämpfen* — a **different spelling** (the *be-* prefix) → a **separate entry**, not a sense of *kämpfen*. Different preposition, same spelling → sense; different spelling → different word.

**On the card** the header is the bare base; each sense tab prints its own form (via `showSenseForm`) and its governed preposition appears twice — in the form (`kämpfen gegen`) and spelled out with its case in Граматика (`kämpfen gegen + Akkusativ`):

```
  kämpfen  🔊
  [ проти · gegen ]  [ за · für ]  [ з · mit ]        ← sense tabs
  ─────────────────────────────────────────────
  kämpfen gegen                     ← form printed (differs from header)
  боротися проти
  ┃ ЗНАЧЕННЯ   Протистояти комусь чи чомусь.
  ┃ ГРАМАТИКА  kämpfen gegen + Akkusativ
  ┌ Die Ärzte kämpfen gegen die Krankheit.
  └ Лікарі борються проти хвороби.
```

---

## 3. Prepositional/phrasal verbs display bare in the list

### The finding

Two *setzen* entries — one plain, one *setzen auf* (to bet on) — both show as bare **"setzen"** in the dictionary list, so they are indistinguishable and the governed preposition is hidden. The preposition is not lost: the sense's `word_form` is *"setzen auf"*; the list just renders the entry's `words.word` (`Dictionary.jsx:99, 506`), which is the bare lemma.

### The fix

The list headword shows the **primary sense's `wordForm`** when it carries more than the bare `word` (a reflexive or a governed preposition) — the same "print the form when it says more than the header" logic already used on the sense card (`showSenseForm`). So the row reads *"setzen auf"*, and the two *setzen* entries are visibly different. Fallback to `word` when the primary sense adds nothing.

**Multi-sense entries whose senses differ** (e.g. *kämpfen gegen / für / mit* under one entry) show the **primary sense's form plus a sense-count marker** — `kämpfen gegen ·3` — decided 2026-07-27 (option A). This keeps the row consistent with the single-sense *setzen auf* case (never bare) while signalling there is more than one sense to open. The primary sense is the first/most-common one, as ordered by the identifier.

```
  СЛОВО / ФРАЗА       ТИП       ФОРМА
  kämpfen gegen ·3    дієсл.    —          ← primary sense form + count
  setzen              дієсл.    setzt / …
  setzen auf          дієсл.    setzt auf / …
```

---

## 4. Manual "known" cannot be set

### The finding

Editing a word you already know and choosing **"known"** does nothing. Confirmed: the status picker writes `draft.status` → the legacy `words.status` column (`Dictionary.jsx:1418`, and `QuickSortMode` at `:1489`), but every status shown in the app is now **derived** from the senses' `learning_stage` via `badgeForWord` (`:104`). The picker writes a column nobody reads.

### The fix — per **sense**, not per word

The control writes the **SRS state of a single sense**, which is the real source of truth and the unit the scheduler works in. The manual stage lives on the **sense** (its stage badge on the sense card becomes the entry point), so setting one meaning to "known" leaves its siblings untouched. Map the four levels to interval steps:

| Level | `interval_step` | `next_review_date` |
|---|---|---|
| new | 0 | today |
| learning | 3 (mid) | today + interval for step 3 |
| known | 6 | today + interval for step 6 |
| mastered | 8 (max) | today + interval for step 8 |

**Why per-sense is the point.** A learner who already knows *die Bank* = bench but not *die Bank* = bank marks **that one sense** known; it drops out of the review rotation while the unknown sense keeps being taught — without deleting anything. Whole-word marking would force an all-or-nothing choice the sense model was built to avoid. A single-sense word is unaffected: the word is its one sense, so marking it known marks the word.

The word-level badge in the list stays **derived** from the senses (`badgeForWord`) — so a word with one known and one new sense reflects that honestly; there is no separate word-level status to keep in sync. The legacy `words.status` write is removed, and the current whole-word picker in edit mode is replaced by the per-sense control.

This is a real fast-track for the DTZ cohort — adults arrive already knowing many words, or one sense of a polysemous word, and need to skip those without losing them from the dictionary.

---

## Out of scope

Session/fill-in fixes are Spec 1. Pure AI-output errors (Abitur → "A-levels", *fortificована*, passive mistranslation) are the DTZ-pack calibration checklist. This spec does not touch the SRS scheduling maths, only the manual entry point into it (#4).

## Testing

- **Candidate splitting (#1):** `identifyWord` parsing — a correctly-spelled input yields one candidate; an ambiguous input yields several with distinct spellings; same-spelling polysemy stays as senses within one candidate. `handleAdd` inserts N entries from N chosen candidates. The prompt-obedience risk is real (Haiku bundled these before), so the parse layer must enforce the spelling-boundary invariant in code, `senseNotes.js`-style, not trust the model.
- **Reflexive canonical form (#2):** table-driven tests over the documented rules per language.
- **List headword (#3):** primary-sense `wordForm` with a preposition renders; a plain verb still shows the bare lemma.
- **Status write (#4):** setting a level on **one sense** writes the mapped `interval_step`/`next_review_date` to that sense only, its siblings unchanged, and the derived word badge updates; the dead-column write is gone.
- Existing 113 tests stay green.
