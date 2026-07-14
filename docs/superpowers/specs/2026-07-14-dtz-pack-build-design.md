# DTZ pack build — extraction, generation, tagging

**Date:** 2026-07-14
**Status:** approved
**Supersedes:** the input and prompt sections of `dtz-02-product-content-spec-2026-07-10.md` (§1.1–1.4, §2.1). Everything else in `dtz-02` stands.
**Incorporates:** `dtz-05-grammar-syllabus-2026-07-14.md` (the 19-topic syllabus, the slot plan, the deficit queue, the validators).
**Scope:** the offline build pipeline — PDF → lemma list → Claude Haiku → validated pack JSON. No app code, no UI, no schema migration.

## What changed today, and why this spec exists

Three things moved after `dtz-02` was written.

**1. We have the real list, and it is not a lemma list.** `dtz_wortliste.pdf` is the DTZ's own *9.2 Alphabetische Wortliste* — 81 pages, ~2,400 headwords, two columns. It is not a bare word list: every entry carries **its grammatical forms** and **example sentences**, with word families nested under their head (`die Achtung` under `achten auf`).

**2. That kills two assumptions.** `dtz-02` assumed ~3,300 lemmas (it is ~2,400 — Fable's quotas are proportions, so they rescale) and assumed Haiku would generate `pos` and `form`. It should not: **the PDF states them**. `die Angst, -"e` gives gender and plural; `ankommen, kommt an, kam an, ist angekommen` gives the full principal parts. Parsing beats generating — it is free, it is exact, and it removes the single largest hallucination surface in the run (a wrong plural or a wrong auxiliary is invisible until a learner is taught it).

**3. Examples get a grammar tag.** Each generated example carries a `construction` from a fixed 19-topic vocabulary, so the later grammar-pack feature is a *filter over sentences we already have* rather than a second $8 batch. This is nearly free now and expensive to retrofit.

## The hard constraint: the PDF's sentences are never used

The Wortliste's own example sentences are the copyrightable heart of the document. They are **not** extracted, **not** stored, and **not** placed in any prompt — not even as few-shot examples, since that produces derivative output. We take **lemma, part of speech, and grammatical forms** — facts about the German language, which the list reports rather than invents — and we write every sentence ourselves.

This is not a new position; `dtz-02` already required own glosses and own examples. It now has a concrete reason and a concrete boundary.

## 1. Extraction

**Script:** `scripts/extract-lemmas.mjs` → `scripts/data/lemmas.json` (committed).

The PDF's text is recovered with `pdftotext -layout`, cropped per column (`-x 0 -W 297` and `-x 297 -W 297` on a 595pt A4 page), then parsed. Four hazards, each of which fails **silently** if unhandled — which is why this is a tested script and not a shell one-liner:

| Hazard | What it looks like | What happens if ignored |
|---|---|---|
| Two columns | `damals … │ dauern, dauert,` | Every line is two half-entries spliced together |
| Wrapped form lines are flush-left | `anhaben, hat an,` / `hatte an, hat angehabt` | The wrap is counted as a new headword |
| Words hyphenate across lines | `hat ange-` / `meldet` | `angemeldet` silently becomes `ange-` |
| Families are indented, not flush-left | `die Achtung` under `achten auf` | Real vocabulary is dropped from the pack entirely |

**Output shape** — one record per entry, family members included as their own entries:

```json
{
  "lemma": "die Angst",
  "pos": "noun",
  "gender": "f",
  "plural": "Ängste",
  "form": "Ängste",
  "parent": null
}
{
  "lemma": "ankommen",
  "pos": "verb",
  "form": "kommt an / kam an / ist angekommen",
  "separable": true,
  "auxiliary": "sein",
  "parent": null
}
```

`pos` is inferred from the entry's own shape (leading article → noun; comma-separated principal parts → verb; `sich` → reflexive verb; otherwise adjective/adverb/particle, refined by the hosting matrix's needs). Verb flags (`separable`, `reflexive`, `auxiliary`, fixed preposition) are read off the forms, not guessed.

**Verification gate:** the script prints its entry count and a POS histogram. The count is *checked against a hand-count of three sample pages* before anything downstream runs. A parser that quietly drops 8% of the list is the worst outcome available here, because nothing downstream will ever notice.

## 2. What Haiku writes

Per lemma, Haiku produces **only** what it is actually good at: Ukrainian and English glosses, the three notes, and three fresh example sentences. `pos`, `form`, gender, plural and principal parts are **passed in** from `lemmas.json` and echoed back unchanged — never invented.

The three notes keep the jobs they already have in the app (`senseNotes.js`): `explanation` = Значення (always), `grammar_note` = Граматика (only if specific to this word), `usage_note` = Варто знати (only a real trap).

### The slot plan

Every sense's three examples have **fixed roles**. This *replaces* `dtz-02`'s "one present, one past, one varied" rule:

- **Slot A — basic.** Präsens main clause. Supplies `praesens_v2`, `modalverben`, `akkusativ`, `dativ` in bulk.
- **Slot B — past.** Perfekt (unchanged). For adjectives, `adjektivdeklination` instead — adjectives don't need a tense tour.
- **Slot C — requested.** One construction, named per lemma by the deficit queue below. For intrinsic lemmas (adjective → `komparation`; conjunction/preposition → its own topic; reflexive verb → `reflexive_verben`) the topic is free and slot C simply carries it.

**Only slot C carries a hard construction requirement.** Slots A and B are labelled after the fact by the auto-tagger. This is deliberate: constraint pressure lands first on the field nobody is looking at, and here that field is the machine-checked `blank`. Three constrained sentences would buy grammar coverage by corrupting the blanks.

The everyday-topic constraint (Amt / Arzt / Wohnung / Arbeit / Einkaufen …) stays **set-level** — at least 2 of the 3 sentences, as `dtz-02` §1.3 already says. It is not tightened to per-sentence.

### The deficit queue

Computed over the whole lemma list **before** the batch is submitted (batch mode is one shot), in fixed lemma order with deterministic tie-breaks, so a resume after a checkpoint reproduces identical assignments:

```js
function assignSlotC(lemma, quotas) {
  if (intrinsicTopic(lemma)) return intrinsicTopic(lemma)
  const eligible = HOSTING_MATRIX[lemma.pos].filter(t => quotas[t] > 0)
  if (!eligible.length) return null                    // slot C runs free, label-only
  const pick = eligible.sort((a, b) => quotas[b] - quotas[a] || a.localeCompare(b))[0]
  quotas[pick]--
  return pick
}
```

Quotas are **proportions of the requestable slot-C pool**, not absolutes, and are recomputed from the real extracted lemma count. At ~2,400 lemmas the requestable pool is ≈1,880, and the seven deficit topics (`konjunktiv_ii`, `nebensatz_b1`, `relativsatz`, `zu_infinitiv_final`, `passiv`, `wechselpraepositionen`, `imperativ`) split it in the ratios of `dtz-05` §2.4, each clearing a 150-sentence floor. The hosting matrix (`dtz-05` §2.2) keeps requests natural: relative clauses to nouns, imperatives to verbs, passive to transitive verbs and patient nouns.

### Prompt deltas

One new field on each example: **`construction`** (an id from the 19-topic list). **`level` is not requested** — it is derivable from the construction (that is what the tag encodes) and asking for it adds constraint load and a mislabel surface for zero information. It is derived at emit time.

The construction list goes in the **cached system prompt**; the per-lemma user message carries the slot recipe, naming required surface forms where Haiku is known to cheat (`würde/hätte/wäre/könnte — NOT möchte`). Cost delta on the run: under $1.

## 3. Validation

Machine wins over Haiku's self-label, in the `senseNotes.js` pattern — predicates over the produced sentence, each test written from a **real violating output**, not an imagined one:

- **Strong** (verifiable from the text): `perfekt` (haben/sein + ge-participle), `konjunktiv_ii` (würde/hätte/wäre/könnte, and **`möchte` is not Konjunktiv II** — the predicted top cheat), `passiv` (werden + Partizip II), `nebensatz_*` (subordinator present **and verb final** — this catches the classic `weil ich habe Zeit`).
- **Lemma-bound:** `trennbare_verben`, `reflexive_verben`, `verben_mit_praeposition` — checkable against the lemma's own flags from the PDF.
- **Presence-only:** `wechselpraepositionen` — the preposition is checkable, the *case correctness* is not.
- **Never requested, never validated:** `akkusativ` / `dativ` as tags — trusted, since they are ambient rather than demonstrable.

**Failure policy:** a **requested** slot-C that fails its predicate is **retried once**, then dropped to label-only. A **free** slot (A or B) whose label doesn't match is **relabelled, not rejected** — the sentence is fine, only its tag was wrong.

`blank` keeps its existing hard check: a single word copied verbatim from `target`.

## 4. The `installPack` bug

`dtz-02` §2.1 flattens each example to exactly `{target, translation, tense, blank}` on install. As written it would **silently drop `construction` and `level`** — the pack would ship, the app would work, and the grammar feature would later find zero tagged sentences. `installPack` must carry `construction` and `level` through to `word_senses.examples`. No migration is needed: `examples` is already jsonb.

## 5. The calibration run — 50 lemmas, before anything else

The batch is one shot and the validators cannot be written from imagination. So: a **50-lemma interactive run** first.

**The 50 are stratified, not the first 50 alphabetically.** An alphabetical head is all *ab-* words: no adjective spread, no conjunctions, no prepositions, and it exercises perhaps three of the nineteen constructions. The sample must contain, deliberately: nouns (concrete and abstract), plain verbs, a separable verb, a reflexive verb, a fixed-preposition verb, adjectives, an adverb, a conjunction, a preposition — and enough slot-C requests to hit **each of the seven deficit constructions at least twice**.

What it produces, in order of importance:

1. **The real validator-failure modes** — actual violating outputs, which is the only thing the predicates can honestly be written against.
2. **The real pass rate.** Fable's distribution assumes **0.65**, and says plainly that this is a guess and the one number that can silently break the whole quota plan. Measured here, quotas are reweighted before the batch.
3. **Tone.** Twenty sentences read by Nika and her mother, against the "warm, never bureaucratic-parody, never condescending about migrants" constraint — the one quality no predicate can check, and the one that makes this pack hers rather than a scraped deck.

If tone or pass rate is bad, that is an afternoon lost, not a run.

## Build order

1. `extract-lemmas.mjs` + tests → `lemmas.json`, count verified against a hand-count.
2. Assignment: hosting matrix, intrinsic topics, deficit queue + tests (deterministic, checkpoint-stable).
3. Validators + tests — stubs first; the real cases land after step 5.
4. `build-pack.mjs` — prompt assembly, checkpointing, resume.
5. **50-lemma calibration run** → measure pass rate, write predicates from real violations, review tone → reweight quotas.
6. `installPack` carries the tags through.
7. Full batch (~2,400 lemmas, ~$8 + <$1).

## Out of scope

The grammar-pack UI (topic list, explanations, chat follow-up, exercises) is its own spec. Note that Fable's honest correction stands: tagging solves the *exercise pool*, but each of the 19 topics still needs a hand-written explanation and 3–5 curated minimal-pair examples in teaching order — budget ~1 hour per topic when that feature is built. Tagging now is still right; it is the expensive half.

## Testing

Everything above is pure and offline, so all of it is unit-testable and none of it needs the app: the parser (against real PDF fragments, including all four hazards), the assignment (determinism, quota exhaustion, hosting-matrix respect), the validators (each case from a real violating output), and the emit step (tags survive to the pack JSON). The existing 113 app tests must stay green and untouched — this spec adds no app code.
