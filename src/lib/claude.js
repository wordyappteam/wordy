import { parseSentenceSet } from './sentenceSet'
import { cleanGrammarNote, cleanUsageNote } from './senseNotes'
import { splitCandidates } from './identifyCandidates.js'

// Transient statuses worth an automatic retry: rate-limit, overload, gateway blips.
const RETRYABLE = [429, 500, 502, 503, 504, 529]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function callClaude({ system, messages, model = 'claude-haiku-4-5', maxTokens = 1024 }) {
  // In dev: Vite proxies /api/anthropic/v1/messages → Anthropic directly (vite.config.js)
  // In prod (Vercel): /api/anthropic is a serverless function that proxies the request
  const endpoint = import.meta.env.DEV
    ? '/api/anthropic/v1/messages'
    : '/api/anthropic'
  const body = JSON.stringify({ model, max_tokens: maxTokens, system, messages })

  // A single overload/network blip used to surface as a hard failure ("Could not
  // identify this word"). Retry transient errors a few times with backoff+jitter
  // so they self-heal instead of bothering the user.
  const attempts = 3
  let lastErr
  for (let i = 0; i < attempts; i++) {
    let res
    try {
      res = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
    } catch (netErr) {
      lastErr = netErr                                    // network error — retry
      if (i < attempts - 1) { await sleep(400 * 2 ** i + Math.random() * 200); continue }
      throw netErr
    }

    if (res.ok) {
      const data = await res.json()
      return data.content[0].text
    }

    const err = await res.json().catch(() => ({}))
    const e = new Error(err?.error?.message ?? `HTTP ${res.status}`)
    e.status = res.status
    // Overload / rate-limit / transient gateway errors → caller can show a
    // friendlier "AI is busy, try again" message and let the user retry.
    e.overloaded = RETRYABLE.includes(res.status)
    if (e.overloaded && i < attempts - 1) { lastErr = e; await sleep(400 * 2 ** i + Math.random() * 200); continue }
    console.error('Claude proxy error:', err)
    throw e
  }
  throw lastErr
}

// ── Word identification ────────────────────────────────────────────────────
// Returns { candidates: [ { word, entryType, senses: [...] }, ... ] }
// Each sense: { pos, wordForm, translation, form, grammarNote, explanation, isException, examples, conjugation, register, cefr }
// When context (sentence) is provided, returns only the matching sense.
// Adds script hint so Haiku doesn't confuse e.g. Ukrainian (Cyrillic) with Polish
function langWithScript(lang) {
  if (lang === 'Ukrainian') return 'Ukrainian (write in Cyrillic script, e.g. слово, речення, приклад)'
  return lang
}

// Haiku sometimes places the combining acute accent (U+0301) after a consonant.
// Deterministic cleanup: keep the accent only when it follows a Ukrainian vowel.
const UK_VOWELS = 'аеєиіїоуюяАЕЄИІЇОУЮЯ'
function fixUkrainianStress(str) {
  return str.replace(/^́/, '').replace(/(.)́/g, (m, ch) => (UK_VOWELS.includes(ch) ? m : ch))
}

function deepFixStress(value) {
  if (typeof value === 'string') return fixUkrainianStress(value)
  if (Array.isArray(value)) return value.map(deepFixStress)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deepFixStress(v)]))
  }
  return value
}

// Optional learner-interest steering, shared by identifyWord and chatWithTutor.
// `topics` is a string array; returns '' when there are none.
function topicsPromptSection(topics) {
  if (!Array.isArray(topics) || topics.length === 0) return ''
  return `\nThe learner is interested in: ${topics.join(', ')}. When it feels natural, set roughly half of your example sentences in these contexts — but keep the other half general and everyday. Never force a topic where it doesn't fit. If any listed topic is violent, sexual, hateful, or otherwise inappropriate for learning material, ignore it and use general everyday contexts.`
}

export async function identifyWord(input, targetLanguage = 'German', interfaceLanguage = 'English', context = null, opts = {}) {
  const ifaceLang = langWithScript(interfaceLanguage)
  const { singleSense = false, themeHint = null, topics = [] } = opts
  const topicsSection = topicsPromptSection(topics)

  const isGerman = targetLanguage === 'German'
  const isUkrainian = targetLanguage === 'Ukrainian'
  // The INTERFACE language (what explanations are written in) — distinct from the
  // target language above. Haiku drifts into Russian when asked for Ukrainian
  // explanatory prose, which for these learners is not a cosmetic slip, so the
  // Ukrainian interface gets an explicit guard.
  const isUkrainianIface = interfaceLanguage === 'Ukrainian'

  const system = `You are a language expert specialising in ${targetLanguage}.
Return ONLY valid JSON — no markdown, no code blocks, no explanation outside the JSON.
Write all explanatory text (explanation and grammarNote fields) in ${ifaceLang}.${isUkrainianIface ? `
The interface language is Ukrainian: explanatory text must be Ukrainian, never Russian. Watch the near-misses — жіночий рід (not женский род), потребує (not требует), використовується (not используется), множина (not множественное число).` : ''}${isUkrainian ? `\nAll Ukrainian words, word forms, and example sentences must be written in Ukrainian Cyrillic script.\nCRITICAL: Ukrainian past-tense predicate forms ending in -ло, -ла, -ли (e.g. остогидло, набридло, минуло, болить) are VERBS — their pos MUST be "verb". Return the infinitive as the base form (остогидло → остогидіти, набридло → набридіти, минуло → минути). Never classify these as adverb or adjective.\nCRITICAL: Stress marking — place the acute accent (´) directly ON the stressed vowel. The character immediately before the accent mark must always be a vowel (а е є и і ї о у ю я). Never place the accent after a consonant.` : ''}${topicsSection}`

  const formNote = isGerman
    ? "for nouns: plural WITHOUT article e.g. 'Häuser'; if no plural write '–'; for verbs: 'macht / machte / gemacht'"
    : isUkrainian
    ? "for nouns: genitive singular WITH stress (e.g. 'рі́шення'); for verbs: leave empty ('')"
    : "for nouns: plural e.g. 'cats', 'children'; for verbs: 'goes / went / gone'"

  const wordFormNote = isGerman
    ? 'canonical form for this sense — with definite article for nouns (e.g. das Buch); for verbs, the plain infinitive (e.g. buchen), BUT attach a bound reflexive pronoun and/or governed preposition whenever this sense is not used without it — reflexive before the verb, preposition after (e.g. "sich kümmern um", "warten auf", "sich freuen auf", "sich erinnern an", "denken an", "bestehen aus"). Do NOT attach a preposition to a verb sense that is complete on its own (plain "denken" = to think).'
    : isUkrainian
    ? 'canonical form WITH stress marked using acute accents (е́ а́ и́ о́ у́ і́): nominative singular for nouns, infinitive for verbs; Cyrillic, no article; accent must fall directly on the vowel (а е є и і ї о у ю я), never on a consonant'
    : 'canonical form for this sense — plain form, no article'

  const wordNote = isUkrainian
    ? 'primary display form, stress-marked; for verbs use the imperfective infinitive'
    : isGerman
    ? 'primary display form — with article for German nouns (e.g. die Entscheidung); for verbs, plain infinitive (e.g. buchen) but WITH any bound reflexive pronoun and/or governed preposition this sense depends on attached (e.g. "sich kümmern um", "warten auf", "denken an"). Must exactly match the wordForm for this sense.'
    : 'primary display form — plain for nouns and verbs'

  const conjugationRules = isGerman ? `
- If isException is true AND pos is "verb", replace "conjugation": null with:
  { "präsens": {"ich":"...","du":"...","er/sie/es":"...","wir":"...","ihr":"...","sie/Sie":"..."}, "präteritum": {"ich":"...","du":"...","er/sie/es":"...","wir":"...","ihr":"...","sie/Sie":"..."}, "partizip_ii": "...", "auxiliary": "haben or sein" }
- Otherwise leave "conjugation" as null` : isUkrainian ? `
- For verb senses where isException is true, include "conjugation" with all forms stress-marked:
  - imperfective sense: { "present": {"я":"...","ти":"...","він/вона":"...","ми":"...","ви":"...","вони":"..."}, "past": {"ч":"...","ж":"...","с":"...","мн":"..."} }
  - perfective sense:   { "future":  {"я":"...","ти":"...","він/вона":"...","ми":"...","ви":"...","вони":"..."}, "past": {"ч":"...","ж":"...","с":"...","мн":"..."} }
- For regular verb senses (isException false) and all non-verbs, leave "conjugation" as null` : `
- Always leave "conjugation" as null`

  // German speakers use the Perfekt to talk about the past; the Präteritum is
  // mostly written narrative. Left to itself the model reaches for "Er nahm das
  // Buch", which the learner will hear and say far less often than "Er hat das
  // Buch genommen". sein/haben/modals are the genuine exceptions — "war",
  // "hatte", "konnte" ARE the everyday forms, and forcing Perfekt on them
  // ("ist gewesen") produces stilted German.
  const germanPastRule = isGerman
    ? `\n- When a VERB example is past, it MUST use the Perfekt (hat/ist + Partizip II) — that is how German speakers actually talk about the past — NOT the Präteritum. Exception: sein, haben and the modals (können, müssen, wollen, sollen, dürfen, mögen) use the Präteritum (war, hatte, konnte …), because those are their everyday past forms`
    : ''

  const nounArticleRule = isGerman
    ? '- In "wordForm": include the definite article for nouns (e.g. die Entscheidung). For verbs whose meaning depends on a reflexive pronoun and/or governed preposition, include those parts in BOTH "word" and "wordForm", ordered reflexive-verb-preposition (e.g. "sich erinnern an", "sich kümmern um", "warten auf"), never reversed. Attach only the parts THIS sense requires; keep a self-standing verb sense plain.'
    : isUkrainian
    ? '- In "wordForm": no article. For nouns set "gender" to m/f/n and put the genitive singular (stress-marked) in "form". For verbs set "aspect" and leave "gender" null.'
    : '- In "wordForm": no article for nouns.'

  // What to return for NON-verb words (verbs handled separately for Ukrainian).
  const nonVerbInstruction = context
    ? `return ONLY the sense matching the sentence: "${context}"`
    : singleSense
    ? (themeHint
        ? `return ONLY the single sense that makes the word belong to the collection "${themeHint}", even if that is not its most common meaning (e.g. if the theme is colours, the colour/shade it names, not the object it is named after)`
        : `return ONLY the single most common, everyday sense`)
    : `return all clearly distinct meanings (most words have just one)`

  const contextInstruction = isUkrainian
    ? `\nIf the word is a VERB: return EXACTLY TWO senses forming the aspect pair — one imperfective and one perfective. Both have pos:"verb"; set "aspect" accordingly; each gets its own wordForm, translation, examples and conjugation. Do this even if a sentence or single sense is requested — the aspect pair is one lexical unit.\nIf the word is NOT a verb: ${nonVerbInstruction}.`
    : context
    ? `\nThe word appears in this sentence: "${context}"\nReturn ONLY the one sense that matches this context. The senses array must contain exactly one entry.`
    : singleSense
    ? (themeHint
        ? `\nThe learner is adding this word as a member of the collection "${themeHint}". Define the word specifically as it functions within that theme — pick the meaning that makes it BELONG to "${themeHint}", even if that is not the word's most common meaning. For example, if the theme is colours, treat the word as the colour/shade it names (e.g. "canary" → the bright yellow colour), not the object or animal it is named after. Return ONLY that one sense; the senses array must contain exactly one entry.`
        : `\nReturn ONLY the single most common, everyday sense. The senses array must contain exactly one entry.`)
    : `\nReturn ALL senses that share this word's SPELLING (separate POS or clearly distinct meaning groups of the SAME written word). A meaning whose base spelling differs from "${input}" is a DIFFERENT word — do not include it here. Most words have exactly one sense.`

  const prompt = `The user is learning ${targetLanguage} and typed: "${input}"${contextInstruction}

The input may be in any language (Ukrainian, English, or ${targetLanguage}).
If it is NOT in ${targetLanguage}, find the best ${targetLanguage} equivalent.
Always return the ${targetLanguage} base form.

Return ONLY this JSON:
{
  "word": "${wordNote}",
  "entryType": "word|phrase|idiom|phrasal-verb",
  "senses": [
    {
      "pos": "verb|noun|adjective|adverb|conjunction|preposition",${isUkrainian ? `
      "aspect": "imperfective or perfective for verbs, otherwise null",
      "gender": "m, f or n for nouns, otherwise null",` : ''}
      "wordForm": "${wordFormNote}",
      "translation": "concise ${ifaceLang} translation for THIS sense only",
      "form": "${formNote}",
      "grammarNote": "how to BUILD with THIS word — or null. Telegraphic: under 12 words, no sentences, parts separated by ' · '. The test is whether the fact is specific to this word. NULL if it is true of the whole word class (every masculine noun takes den in the accusative; most verbs take haben) or already visible on the card (the article is in the headword, the plural is in \\"form\\", irregularity is in the conjugation table). WORTH SAYING, and belongs HERE rather than in usageNote: a governed preposition and its case — ALWAYS include this when the verb has one, it is the single most useful thing you can say (bestehen aus + Dativ · sich freuen auf + Akk · warten auf + Akk); an object case that is not the default; a separable prefix; auxiliary sein; an obligatory reflexive; uncountable or plural-only. NEVER write the word haben: haben is the default auxiliary and saying so is noise — mention an auxiliary ONLY when it is sein. Write it in ${ifaceLang}${isUkrainianIface ? ' — Ukrainian, NEVER Russian' : ''}, but keep German grammatical terms and forms in German (Akkusativ, Dativ, auf + Dat.)",
      "explanation": "WRITTEN IN ${ifaceLang.toUpperCase()} — every word of it. Not in ${targetLanguage}, not in English${isUkrainianIface ? ', and never in Russian' : ''}. A definition, and nothing else: say what the word MEANS, precisely, for an A2-B1 learner. No usage advice here (that is usageNote). Define it with words SIMPLER than the headword — never explain a word using harder words. Under 40 words.",
      "usageNote": "the ONE thing that trips a learner up on this word — or null. Null is the normal answer: most words have no trap, and inventing one is worse than leaving it out. A real trap is: a false friend, a fixed collocation, a register restriction, or a confusion with a near-synonym (bekommen vs erhalten). NOT grammar — a governed preposition, a case, a prefix or an auxiliary belongs in grammarNote, never here. It must not restate anything already in grammarNote: if the only thing you could say is already there, return null. Under 25 words, ${ifaceLang}${isUkrainianIface ? ', Ukrainian NEVER Russian' : ''}",
      "isException": true or false,
      "register": "neutral|formal|informal|colloquial|slang|archaic|vulgar",
      "cefr": "A1|A2|B1|B2|C1|C2",
      "examples": [
        { "target": "natural ${targetLanguage} example", "translation": "${ifaceLang} translation", "tense": "present|past|null", "blank": "the target word EXACTLY as written in target, including its inflected form" },
        { "target": "...", "translation": "...", "tense": "...", "blank": "..." },
        { "target": "...", "translation": "...", "tense": "...", "blank": "..." }
      ],
      "conjugation": null
    }
  ]
}

Rules:
- If input is an inflected form, return the base/infinitive
${nounArticleRule}
- isException: true only for irregular verbs, exceptional grammar, or fixed collocations
- Always include exactly 3 example sentences per sense
- For each example, "blank" must be the single target word copied verbatim from "target", in the exact inflected form used there (e.g. target "Sie isst ein Ei" → blank "isst"; for nouns include no article, e.g. blank "Hund" not "den Hund")
- Keep example sentences positive and everyday — avoid war, death, violence, illness, accidents, or tragedy unless the word itself specifically relates to such topics
- Example tense: for VERBS only, make one example present, one past, one varied, and set "tense" accordingly. For nouns, adjectives, adverbs and every other part of speech, ALL examples are "tense": null — a noun has no tense, so never tag a noun example "past" merely because its sentence refers to the past${germanPastRule}
- register: language register for this specific sense. Use "neutral" for everyday vocabulary with no special register
- cefr: CEFR level for this specific sense based on standard vocabulary lists. When between two levels, pick the more common/lower one
${isUkrainian ? '- Mark stress with an acute accent (е́ а́ и́ о́ у́ і́) on every multi-syllable Ukrainian word form, example sentence word, and conjugation form. The accent must sit on the stressed vowel itself — the character immediately before the accent mark must always be a vowel (а е є и і ї о у ю я); never place the accent after a consonant\n- Ukrainian past-tense forms (ending in -в, -ла, -ло, -ли) that function as predicates are VERBS — classify them as pos:"verb" and return the infinitive as the base form (e.g. остогидло → остогидіти, минуло → минути, набридло → набридіти)\n' : ''}${conjugationRules}`

  const text = await callClaude({
    system,
    messages: [{ role: 'user', content: prompt }],
    model: 'claude-haiku-4-5',
    // Polysemous irregular verbs return several senses, each with its own
    // conjugation table + 3 examples — 1500 truncated the JSON mid-table and
    // broke JSON.parse. Give enough headroom to finish multi-sense entries.
    maxTokens: 2500,
  })

  console.log('identifyWord raw response:', text)
  const clean = text.replace(/```json|```/g, '').trim()
  const match = clean.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('No JSON object found in response')
  const parsed = JSON.parse(match[0])

  // Enforce the note rules in code. The prompt asks for all of this, but Haiku
  // keeps emitting "auxiliary haben" (the default — no information) and usage
  // notes that just restate the grammar note. A section that says nothing must be
  // null so the card can hide it, rather than showing the learner filler.
  for (const sense of parsed.senses ?? []) {
    sense.grammarNote = cleanGrammarNote(sense.grammarNote)
    sense.usageNote   = cleanUsageNote(sense.usageNote, sense.grammarNote)
  }

  const entry = isUkrainian ? deepFixStress(parsed) : parsed
  return { candidates: splitCandidates(entry) }
}

// Callers that only ever want a single entry (re-identify, bulk) use this.
export function primaryEntry(result) {
  return result?.candidates?.[0] ?? null
}

// ── Goal parsing ────────────────────────────────────────────────────────────
// Turns a learner's free-text onboarding goal into structured tags + metadata.
// `tags` use the same ids as the Onboarding GOALS list.
// Returns { tags, summary, exam, deadline }; empty/gibberish → all null/[].
export async function parseGoal(goalText, interfaceLanguage = 'English') {
  const empty = { tags: [], summary: null, exam: null, deadline: null }
  if (!goalText?.trim()) return empty
  const ifaceLang = langWithScript(interfaceLanguage)

  const system = `You categorise a language learner's free-text goal into structured tags.
Return ONLY valid JSON — no markdown, no code blocks.`

  const prompt = `The learner wrote this about why they are learning the language:
"""
${goalText.trim()}
"""

Return exactly this JSON:
{
  "tags": ["1 to 3 of: travel, fluency, work, study, culture, curiosity"],
  "summary": "one sentence describing the goal, max 15 words, third person",
  "exam": "the exam name if one is mentioned, otherwise null",
  "deadline": "YYYY-MM if a month or deadline is mentioned, otherwise null"
}

Rules:
- "tags": pick the 1-3 ids from [travel, fluency, work, study, culture, curiosity] that best fit. Use only these ids.
- "summary": write in ${ifaceLang}, third person (e.g. "Wants to read German literature"), max 15 words
- If the text is empty, gibberish, or not a real learning goal, return { "tags": [], "summary": null, "exam": null, "deadline": null }`

  const text = await callClaude({
    system,
    messages: [{ role: 'user', content: prompt }],
    model: 'claude-haiku-4-5',
    maxTokens: 256,
  })

  const clean = text.replace(/```json|```/g, '').trim()
  const match = clean.match(/\{[\s\S]*\}/)
  if (!match) return empty
  try {
    const parsed = JSON.parse(match[0])
    const VALID = ['travel', 'fluency', 'work', 'study', 'culture', 'curiosity']
    return {
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter((t) => VALID.includes(t)).slice(0, 3) : [],
      summary: parsed.summary || null,
      exam: parsed.exam || null,
      deadline: parsed.deadline || null,
    }
  } catch {
    return empty
  }
}

// ── Sentence translation ───────────────────────────────────────────────────
// Batch-translate sentences into `toLanguage`. Returns an array of strings in
// the same order. Used by Word Order when the stored prompt is in the wrong
// language (e.g. English example for an English learner).
export async function translateSentences(sentences, toLanguage = 'English') {
  if (!sentences?.length) return []
  const lang = langWithScript(toLanguage)
  const system = `You are a translator. Translate each numbered sentence into ${lang}.
Return ONLY a JSON array of the translated strings, in the same order, nothing else.`
  const numbered = sentences.map((s, i) => `${i + 1}. ${s}`).join('\n')
  const text = await callClaude({
    system,
    messages: [{ role: 'user', content: `Translate these into ${lang}:\n${numbered}` }],
    model: 'claude-haiku-4-5',
    maxTokens: 1024,
  })
  const clean = text.replace(/```json|```/g, '').trim()
  const arrMatch = clean.match(/\[[\s\S]*\]/)
  if (!arrMatch) throw new Error('No JSON array found in translation response')
  return JSON.parse(arrMatch[0])
}

// ── Collection suggestions ──────────────────────────────────────────────────
// Given a theme name and the user's dictionary, return the ids of words that
// fit the theme. User-chosen grouping assisted by AI — not auto clustering.
// `words` is [{ id, word, translation }]. Returns an array of ids.
export async function suggestCollectionWords(theme, words, targetLanguage = 'German') {
  if (!words?.length || !theme?.trim()) return []
  const list = words
    .map(w => `${w.id}: ${w.word}${w.translation ? ` (${w.translation})` : ''}`)
    .join('\n')
  const system = `You help a learner organise their ${targetLanguage} vocabulary into a themed collection.
Return ONLY a JSON array of the matching word ids (numbers) — nothing else.`
  const prompt = `Collection theme: "${theme.trim()}"

From this ${targetLanguage} word list, return the ids of words that clearly belong to this theme.
Include clear matches generously, but do not force in unrelated words. If none fit, return [].

Words:
${list}`
  const text = await callClaude({
    system,
    messages: [{ role: 'user', content: prompt }],
    model: 'claude-haiku-4-5',
    maxTokens: 1024,
  })
  const clean = text.replace(/```json|```/g, '').trim()
  const match = clean.match(/\[[\s\S]*\]/)
  if (!match) return []
  try {
    const ids = JSON.parse(match[0])
    return Array.isArray(ids) ? ids : []
  } catch {
    return []
  }
}

// ── Extract vocabulary from a chat message ──────────────────────────────────
// Pulls the target-language words a chat reply is offering the learner, plus a
// suggested collection name. Used by "Add to dictionary" in the chat.
// Returns { theme, words: [{ word, translation }] }.
export async function extractVocabFromChat(text, targetLanguage = 'German', interfaceLanguage = 'English') {
  if (!text?.trim()) return { theme: '', words: [] }
  const ifaceLang = langWithScript(interfaceLanguage)
  const system = `You extract vocabulary a learner wants to add to their ${targetLanguage} dictionary.
Return ONLY JSON: { "theme": "...", "words": [{ "word": "...", "translation": "..." }] }
- "word": the ${targetLanguage} word or phrase being offered${targetLanguage === 'German' ? ' (include the article for nouns, e.g. "das Rot")' : ''}.
- "translation": a short ${ifaceLang} gloss.
- "theme": a short collection name for the set (e.g. "Color shades"), or "" if the message is not presenting a themed group of words.
Only include genuine ${targetLanguage} vocabulary being suggested for learning. If there is none, return an empty words array.`
  const prompt = `Message:
"""
${text}
"""

Extract the ${targetLanguage} vocabulary words being offered to the learner.`
  const out = await callClaude({
    system,
    messages: [{ role: 'user', content: prompt }],
    model: 'claude-haiku-4-5',
    maxTokens: 1024,
  })
  const clean = out.replace(/```json|```/g, '').trim()
  const match = clean.match(/\{[\s\S]*\}/)
  if (!match) return { theme: '', words: [] }
  try {
    const parsed = JSON.parse(match[0])
    return {
      theme: parsed.theme || '',
      words: Array.isArray(parsed.words) ? parsed.words.filter(w => w?.word) : [],
    }
  } catch {
    return { theme: '', words: [] }
  }
}

// ── Preposition exercises ──────────────────────────────────────────────────
export async function generatePrepExercises(verbs, interfaceLanguage = 'English') {
  const verbList = verbs.map((v) => `- ${v.word} (${v.translation})`).join('\n')

  const system = `You are a German grammar teacher creating exercises.
Return ONLY valid JSON — no markdown, no code blocks.`

  const prompt = `Create fill-in-the-blank exercises for these German verbs with fixed prepositions:
${verbList}

Each exercise tests TWO blanks in the sentence:
1. The correct preposition
2. The correct article/adjective form showing the grammatical case

Return a JSON array — one object per verb:
[
  {
    "verb": "sich erinnern an",
    "sentence": "Ich erinnere mich ___ ___ ersten Schultag.",
    "preposition": "an",
    "article": "den",
    "nounGender": "der",
    "nominativeNoun": "der Schultag",
    "caseLabel": "Akkusativ · maskulin",
    "explanation": "sich erinnern an always takes Akkusativ. 'der Tag' → 'den Tag'."
  }
]

Rules:
- Write the sentence so the first blank is ALWAYS the preposition and the second is ALWAYS the article/determiner
- Choose nouns where the case change is clearly visible (avoid neuter Nom=Akk)
- Keep sentences natural and realistic
- "nounGender" is the NOMINATIVE article of the noun (der/die/das) before any case change
- "nominativeNoun" is the full noun with its nominative article, e.g. "der Zug", "die Frau", "das Kind"
- explanation must be in ${interfaceLanguage} — explain which case the preposition governs and how the article changed
- Vary the cases across exercises (some Akkusativ, some Dativ) for good practice
- CRITICAL — separable verbs: verbs like "eingehen", "einsetzen", "anrufen", "aufhören", "vorstellen" have a separable prefix. In a main clause the prefix splits off and goes to the END of the sentence. You MUST include this prefix at the end. Examples: "eingehen auf" → "Der Professor geht ___ ___ Fragen ein." (NOT "…geht ___ ___ Fragen."); "einsetzen für" → "Er setzt sich ___ ___ Umwelt ein." Never omit the separable prefix from the sentence.
- Generate exactly 5 exercises, no more`

  const text = await callClaude({
    system,
    messages: [{ role: 'user', content: prompt }],
    model: 'claude-haiku-4-5',
    maxTokens: 3072,
  })

  console.log('generatePrepExercises raw response:', text)
  const clean = text.replace(/```json|```/g, '').trim()
  // Extract just the JSON array if there's surrounding text
  const match = clean.match(/\[[\s\S]*\]/)
  if (!match) throw new Error('No JSON array found in response')
  return JSON.parse(match[0])
}

// ── Word bank exercises (Phase 2 of deep prep session) ────────────────────
export async function generateWordBankExercises(verbs, interfaceLanguage = 'English') {
  const verbList = verbs.map((v, i) => `${i + 1}. ${v.word} (${v.translation})`).join('\n')

  const system = `You are a German grammar teacher creating exercises.
Return ONLY valid JSON — no markdown, no code blocks.`

  const prompt = `Create fill-in-the-blank sentences for these German verbs with fixed prepositions:
${verbList}

For each verb create ONE sentence with exactly TWO blanks marked ___:
- First blank: the correctly conjugated verb form
- Second blank: the correct preposition

Return a JSON array, one object per verb (same order as the list):
[
  {
    "verbBase": "sich erinnern an",
    "sentence": "Ich ___ mich ___ unseren ersten Schultag.",
    "verbAnswer": "erinnere",
    "prepAnswer": "an",
    "case": "Akkusativ"
  }
]

Rules:
- First blank is ALWAYS the conjugated verb, second blank is ALWAYS the preposition
- Vary subjects: ich, du, er/sie, wir, ihr — don't repeat the same subject
- Keep sentences short and natural (6–10 words)
- For separable verbs (eingehen, einsetzen, anrufen, aufhören, etc.): the separable prefix stays as plain text at the END of the sentence — only the verb stem goes in the blank. Example: "eingehen auf" → "Der Lehrer ___ ausführlich ___ die Frage ein." with verbAnswer "geht"
- The two blanks must appear in order: verb blank first, preposition blank second — always
- Generate exactly one sentence per verb, in the same order as the input list`

  const text = await callClaude({
    system,
    messages: [{ role: 'user', content: prompt }],
    model: 'claude-haiku-4-5',
    maxTokens: 3072,
  })

  console.log('generateWordBankExercises raw response:', text)
  const clean = text.replace(/```json|```/g, '').trim()
  const match = clean.match(/\[[\s\S]*\]/)
  if (!match) throw new Error('No JSON array found in response')
  return JSON.parse(match[0])
}

// ── Sentence review ────────────────────────────────────────────────────────
export async function reviewSentence(word, translation, sentence, interfaceLanguage = 'English', targetLanguage = 'German') {
  const system = `You are a ${targetLanguage} language teacher reviewing a student's sentence.
Return ONLY valid JSON — no markdown, no code blocks.`

  const prompt = `The student is practising the ${targetLanguage} word: "${word}" (${translation})

They wrote this ${targetLanguage} sentence:
"${sentence}"

Evaluate it and return exactly this JSON:
{
  "meaningCorrect": true or false,
  "formCorrect": true or false,
  "isCorrect": true or false,
  "corrected": "the corrected sentence (identical to input if already correct)",
  "feedback": "your feedback in ${interfaceLanguage}"
}

Judge meaning and form SEPARATELY:
- "meaningCorrect": true if the sentence uses "${word}" with its correct meaning and is comprehensible — i.e. the student clearly knows what the word means and used it appropriately — EVEN IF there are grammar or spelling mistakes. False if the word is misused, means something else here, or the sentence doesn't use "${word}" at all.
- "formCorrect": true if the sentence is grammatically and orthographically correct (cases, endings, gender, word order, spelling, compounding, punctuation). False if there is any such error.
- "isCorrect": true only if BOTH meaningCorrect AND formCorrect are true.

Feedback format rules:
- If both correct: one short encouraging sentence confirming it's right. Max 15 words.
- Otherwise: list each mistake as a numbered point. Max 3 points. Example format:
  1. "träume Stelle" → **Traumstelle** — nouns form compounds in German; write as one word, capitalised.
  2. Missing comma before **zu bewerben** — infinitive clauses with "zu" need a comma.
- Wrap corrections and key grammar terms in **double asterisks** so they render bold
- Show the wrong part first, then → then the correction in bold, then a dash and brief rule
- Be direct — name the case, ending, or rule. No filler phrases, no "Great try"

Other rules:
- Correct minor typos in "corrected" too`

  const text = await callClaude({
    system,
    messages: [{ role: 'user', content: prompt }],
    model: 'claude-haiku-4-5',
    maxTokens: 512,
  })

  const clean = text.replace(/```json|```/g, '').trim()
  const match = clean.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('No JSON in review response')
  return JSON.parse(match[0])
}

// ── Chat tutor ─────────────────────────────────────────────────────────────
export async function chatWithTutor(messages, targetLanguage = 'German', interfaceLanguage = 'English', memory = null, topics = []) {
  const memorySection = memory
    ? `\n\nLEARNER MEMORY (from previous sessions):\n${memory}\n\nUse this context to personalise your responses — reference their known struggles, build on topics they've already studied, adjust your explanations to their level.`
    : ''
  const topicsSection = topicsPromptSection(topics)

  const system = `You are a friendly, knowledgeable ${targetLanguage} language tutor.
Always respond in ${interfaceLanguage}.
When explaining grammar, use examples in ${targetLanguage} with ${interfaceLanguage} translations.
You are multilingual: if the learner asks you to translate words or phrases into another language (for example their native language such as Ukrainian), just do it directly and helpfully. Never refuse or redirect them to external tools — give your best translation, noting any nuance briefly if a word is hard to translate precisely.
Format responses clearly: use **bold** for key terms, *italics* for ${targetLanguage} words and examples.
Use tables (markdown pipe format) when comparing forms or cases.
Keep responses thorough but focused — no unnecessary padding.
After explaining a grammar topic, end with a brief note that the user can practice this topic if they want.${memorySection}${topicsSection}`

  const apiMessages = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.text }))

  return callClaude({
    system,
    messages: apiMessages,
    model: 'claude-sonnet-4-6',
    maxTokens: 1024,
  })
}

// ── Session memory ──────────────────────────────────────────────────────────
export async function generateSessionMemory(messages, existingProfile = null, interfaceLanguage = 'English', targetLanguage = 'German') {
  const conversation = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => `${m.role === 'user' ? 'Student' : 'Tutor'}: ${m.text}`)
    .join('\n\n')

  const profileContext = existingProfile
    ? `\n\nEXISTING LEARNER PROFILE:\n${existingProfile}`
    : ''

  const system = `You are summarising a ${targetLanguage ?? 'German'} language tutoring session to build a learner memory.
Return ONLY valid JSON — no preamble, no markdown, no code blocks.`

  const prompt = `Here is a tutoring session transcript:${profileContext}

TRANSCRIPT:
${conversation}

Return exactly this JSON:
{
  "profile": "Updated cumulative learner profile (max 120 words). Merge the existing profile with new observations. Include: level estimate, recurring struggles, strengths, learning style, topics covered across sessions.",
  "last_session": "What happened in THIS session only (max 80 words). Topics discussed, vocabulary that came up, specific questions asked, what the student seemed to find difficult or easy."
}

Write in ${interfaceLanguage}. Be specific and factual.`

  const text = await callClaude({
    system,
    messages: [{ role: 'user', content: prompt }],
    model: 'claude-haiku-4-5',
    maxTokens: 512,
  })

  const clean = text.replace(/```json|```/g, '').trim()
  const match = clean.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('No JSON found in memory response')
  return JSON.parse(match[0])
}

// ── Sentence-set practice (target-aware fill-the-sentences) ──────────────────
export async function generateSentenceSet(words, { targetLanguage = "German", interfaceLanguage = "English", theme = null } = {}) {
  const list = words.map((w, i) => `${i + 1}. ${w.lemma} (${w.translation}) [${w.pos}]`).join("\n")
  const themeLine = theme ? `Theme/topic to weave in if natural: "${theme}".` : "No fixed theme."

  const system = `You create ${targetLanguage} fill-in-the-blank practice. Return ONLY valid JSON — no markdown, no code fences.`

  const prompt = `Make a "fill the sentences" exercise in ${targetLanguage} for these words:
${list}

${themeLine}

Rules:
- Write exactly 5 short, natural, SELF-CONTAINED sentences. They do NOT need to connect to each other.
- Each sentence has exactly ONE blank marked with ___ , filled by ONE of the words above.
- CRITICAL — one right answer per blank: give enough specific context (who/what/where, collocations) that ONLY the intended word fits. No other word in the list — answer word OR distractor — may plausibly complete the blank. If two listed words could both fit (e.g. two colours, two adjectives), add detail until only one does.
- CRITICAL — force the form: the grammar around the blank must require a SINGLE correct inflection. Use agreement, articles, quantifiers and number/tense cues so exactly one form is grammatical. If both singular and plural (or two tenses) would read naturally in the blank, rewrite the sentence until only one is correct.
- Use 5 different words from the list for the 5 blanks; the remaining listed words become distractors.
- The blank uses the word in the form the sentence needs (conjugated / declined). Keep articles and prepositions visible — blank only the content word.
- Blank a real content word — a head noun, a main/finite verb, or an adjective in its normal spot (an adjective before its noun, like "the brazen doorknob", is fine). Do NOT blank a NOUN used as a modifier of another noun (avoid "lilac blossoms", "stone wall", where the blank isn't the head and can't inflect).
- "bank" = base/infinitive forms of all answer words PLUS 2 plausible distractor base forms (7 chips total).
- For every sentence return: target-language "text" with ___, the "senseId" of the word used, "answerLemma" (base form), "answerForm" (exact form that fills the blank), a short "hint", and a one-line "explanation".
- "hint" = a PLAIN, everyday nudge about the expected FORM only, max ~5 words, no grammar jargon. Use terms learners know: "plural", "past tense", "infinitive" (prefer "infinitive" over "base form"). Only name a grammatical case when ${targetLanguage} marks case. Describe ONLY the blanked word's own form — never another word's agreement, and never the meaning.
- If the blanked word is in its plain base form (unchanged from the bank word): for an English adjective or adverb (these never inflect), set "hint" to just its part of speech — "adjective" or "adverb"; for a noun or verb that simply doesn't change here (e.g. a mass noun like "mustard"), set "hint" to null. Never invent grammatical detail, and never call an English adjective "singular"/"plural".
- Write "hint" and "explanation" in ${interfaceLanguage}. Keep explanations POS-shaped: nouns → gender/case/plural; verbs → tense/person; adjectives → declension.
- Everything except hint/explanation must be in ${targetLanguage}.

Return JSON exactly:
{
  "bank": [ { "lemma": "…", "senseId": "…" } ],
  "sentences": [
    { "text": "… ___ …", "senseId": "…", "answerLemma": "…", "answerForm": "…", "hint": "… or null", "explanation": "…" }
  ]
}`

  const text = await callClaude({
    system,
    messages: [{ role: "user", content: prompt }],
    model: "claude-haiku-4-5",
    maxTokens: 2048,
  })
  return parseSentenceSet(text)
}
