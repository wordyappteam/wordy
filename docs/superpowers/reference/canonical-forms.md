# Canonical forms for verb senses

## The five shapes

A verb sense's form is the base verb plus what it cannot stand without, ordered **reflexive · verb · preposition (+ case)**:

| Shape | Example | Gloss |
|---|---|---|
| Plain | `kämpfen` | to fight / struggle |
| Verb + prep (+ case) | `kämpfen gegen` + Akk | to fight against |
| Reflexive | `sich beeilen` | to hurry |
| Reflexive + prep | `sich freuen auf` + Akk | to look forward to |
| Separable (+ prep) | `aufhören mit` + Dat | to stop (doing sth) |

## Worked example: kämpfen

*kämpfen* is one spelling → **one entry**, but each meaning governs a different preposition, so each is its own sense with its own form:

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
