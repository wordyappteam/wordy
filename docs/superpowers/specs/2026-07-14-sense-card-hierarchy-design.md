# Sense card — visual hierarchy

**Date:** 2026-07-14
**Status:** approved
**Scope:** `WordPanel` view mode in `src/pages/Dictionary.jsx` (the `Section` component and the sense body). No data, prompt, or schema changes.

## The problem

The card has four kinds of content — a translation, three notes, and the examples — and they
all look the same. The three notes (Значення / Граматика / Варто знати) collapse open into a
`bg-gray-50 rounded-xl` box; the examples are also `bg-gray-50 rounded-xl` boxes. Under the
Willow & Paper palette `gray-50` is paper, so a definition, a grammar rule, a usage trap and a
sample sentence are four different jobs wearing one uniform. Nothing on the card is dominant
and nothing is findable — you can only get at a note by reading it.

The card is also opened for four different reasons (glance at the meaning · study the word ·
check one fact · check the AI got it right). That rules out designing it as a linear essay: it
has to be a **scannable reference**, where each part is a distinct landmark.

A second, smaller defect feeds the same flatness: **the headword is printed twice.** The panel
header renders `word.word` + `word.form` (`Dictionary.jsx:952,964`), and the sense body then
renders `sense.wordForm` + `sense.form` (`:1033-1034`). For a single-sense word these are the
same string, so the card opens by saying the same thing twice before reaching the meaning.

## The design

### 1. The notes stop folding

Delete the `Section` component and its `openSections` state. The three notes always render.

The folding was paying a click on *every* card to solve a problem only the rare fat card has:
`grammar_note` and `usage_note` are null for most words by design (the invariants in
`senseNotes.js` enforce this), so the typical card is a translation, one definition and two
examples. Folding also actively hurts the two heaviest use cases — studying and checking the
AI's output — and it was the mechanism that let the notes get away with having no visual
identity of their own.

### 2. Coloured spine

Each note becomes a labelled block with a **3px coloured left rule and no fill**:

| Note | Rule | Label colour | Body |
|---|---|---|---|
| Значення (`explanation`) | verba green | verba green | 13.5px, `text-gray-700` |
| Граматика (`grammar_note`) | neutral grey | grey | 12.5px, `text-gray-600` |
| Варто знати (`usage_note`) | wheat | wheat-dark | 12.5px, `text-gray-600` |

The definition is set one step larger and darker than the other two: it is the one note that is
always present and always the reason you opened the card.

Because the notes now have **no fill**, the examples keep their paper boxes and become the only
filled objects in the body. That is the primary separation — *notes are ink, examples are cards*
— with the rule colour as the secondary, letting you find the grammar note by colour without
reading a word.

A note with nothing to say still renders nothing at all. This is unchanged and load-bearing: an
empty "Граматика" on `der Tisch` would be worse than no section.

### 3. The exception badge does not tint the grammar note

Today `isException` passes `accent` to the grammar `Section`, turning it amber. Under the new
scheme wheat means **"this is a trap"**. Being irregular is not a trap, it is a fact, and it
already has its own badge in the header. One colour must not carry two meanings, so the grammar
rule stays grey regardless of `isException`.

### 4. The sense form prints only when it differs

Replace the unconditional headword line in the sense body with a conditional one:

> Render `sense.wordForm` **iff** it is not already what the header displays.

The header displays `aspectPairTitle || word.word`. So:

- Ordinary single-sense word (`bestehen`) → identical → **not printed**; the body starts at the translation.
- Phrase/collocation sense (`eine Entscheidung treffen` under the entry `die Entscheidung`) → differs → **printed**.
- Ukrainian aspect pair (`зробити` under the header `робити / зробити`) → differs → **printed**, so you always know which half of the pair you are studying.

`sense.form` (plural, principal parts) follows the same line: it renders only when the sense
form is printed, since otherwise the header is already showing it.

## Order within the sense body

1. Sense tabs (only when >1 sense) — unchanged
2. Sense form — conditional, per above
3. Translation
4. Значення · Граматика · Варто знати — in that order, each only if present
5. Examples
6. Conjugation table / image / collections — unchanged

The trap deliberately sits **before** the examples: it is a warning, and a warning read after
the evidence is a warning read too late.

## Out of scope

Meta row, tabs, conjugation table, image, collections, edit mode, and delete flow are all
untouched. This is the view-mode sense body only.

## Testing

The change is presentational and `WordPanel` has no unit tests today; the logic worth testing is
the one new predicate, so extract it as a pure function and test it:

```js
// showSenseForm(sense, headerTitle) -> boolean
```

Cases: identical form → false · phrase sense → true · aspect-pair half → true · missing
`wordForm` → false. The rest is verified by click-through on the four card shapes agreed in
the mockup: the fat multi-sense verb, the bare noun (no grammar/usage note), the phrase sense,
and the Ukrainian aspect pair.

Nothing here touches the SRS, the AI prompts, or the schema, so the existing 106 tests must
stay green untouched.
