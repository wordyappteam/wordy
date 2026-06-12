async function callClaude({ system, messages, model = 'claude-haiku-4-5', maxTokens = 1024 }) {
  // In dev: Vite proxies /api/anthropic/v1/messages → Anthropic directly (vite.config.js)
  // In prod (Vercel): /api/anthropic is a serverless function that proxies the request
  const endpoint = import.meta.env.DEV
    ? '/api/anthropic/v1/messages'
    : '/api/anthropic'

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    console.error('Claude proxy error:', err)
    throw new Error(err?.error?.message ?? `HTTP ${res.status}`)
  }

  const data = await res.json()
  return data.content[0].text
}

// ── Word identification ────────────────────────────────────────────────────
// Returns { word, entryType, senses: [...] }
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

export async function identifyWord(input, targetLanguage = 'German', interfaceLanguage = 'English', context = null, opts = {}) {
  const ifaceLang = langWithScript(interfaceLanguage)
  const { singleSense = false, themeHint = null } = opts

  const isGerman = targetLanguage === 'German'
  const isUkrainian = targetLanguage === 'Ukrainian'

  const system = `You are a language expert specialising in ${targetLanguage}.
Return ONLY valid JSON — no markdown, no code blocks, no explanation outside the JSON.
Write all explanatory text (explanation and grammarNote fields) in ${ifaceLang}.${isUkrainian ? `\nAll Ukrainian words, word forms, and example sentences must be written in Ukrainian Cyrillic script.\nCRITICAL: Ukrainian past-tense predicate forms ending in -ло, -ла, -ли (e.g. остогидло, набридло, минуло, болить) are VERBS — their pos MUST be "verb". Return the infinitive as the base form (остогидло → остогидіти, набридло → набридіти, минуло → минути). Never classify these as adverb or adjective.\nCRITICAL: Stress marking — place the acute accent (´) directly ON the stressed vowel. The character immediately before the accent mark must always be a vowel (а е є и і ї о у ю я). Never place the accent after a consonant.` : ''}`

  const formNote = isGerman
    ? "for nouns: plural WITHOUT article e.g. 'Häuser'; if no plural write '–'; for verbs: 'macht / machte / gemacht'"
    : isUkrainian
    ? "for nouns: genitive singular WITH stress (e.g. 'рі́шення'); for verbs: leave empty ('')"
    : "for nouns: plural e.g. 'cats', 'children'; for verbs: 'goes / went / gone'"

  const wordFormNote = isGerman
    ? 'canonical form for this sense — with definite article for nouns (e.g. das Buch), plain infinitive for verbs (e.g. buchen), verb+prep for phrasal verbs (e.g. achten auf)'
    : isUkrainian
    ? 'canonical form WITH stress marked using acute accents (е́ а́ и́ о́ у́ і́): nominative singular for nouns, infinitive for verbs; Cyrillic, no article; accent must fall directly on the vowel (а е є и і ї о у ю я), never on a consonant'
    : 'canonical form for this sense — plain form, no article'

  const wordNote = isUkrainian
    ? 'primary display form, stress-marked; for verbs use the imperfective infinitive'
    : isGerman
    ? 'primary display form — with article for German nouns (e.g. die Entscheidung), plain for verbs'
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

  const nounArticleRule = isGerman
    ? '- In "wordForm": include the definite article for nouns (e.g. die Entscheidung). For verb+prep phrases always order verb then preposition (e.g. "sich erinnern an"), never the reverse.'
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
    : `\nReturn ALL commonly used senses (separate POS or clearly distinct meaning groups). Most words have exactly one sense — only return multiple when there are genuinely distinct usages worth learning separately.`

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
      "grammarNote": "one key grammar rule, under 15 words",
      "explanation": "2-3 sentences on usage and nuance, under 60 words",
      "isException": true or false,
      "register": "neutral|formal|informal|colloquial|slang|archaic|vulgar",
      "cefr": "A1|A2|B1|B2|C1|C2",
      "examples": [
        { "target": "natural ${targetLanguage} example", "translation": "${ifaceLang} translation", "tense": "present|past|null" },
        { "target": "...", "translation": "...", "tense": "..." },
        { "target": "...", "translation": "...", "tense": "..." }
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
- Keep example sentences positive and everyday — avoid war, death, violence, illness, accidents, or tragedy unless the word itself specifically relates to such topics
- For verbs: present, past, one varied — set "tense" accordingly. For nouns/adj/other: "tense": null
- register: language register for this specific sense. Use "neutral" for everyday vocabulary with no special register
- cefr: CEFR level for this specific sense based on standard vocabulary lists. When between two levels, pick the more common/lower one
${isUkrainian ? '- Mark stress with an acute accent (е́ а́ и́ о́ у́ і́) on every multi-syllable Ukrainian word form, example sentence word, and conjugation form. The accent must sit on the stressed vowel itself — the character immediately before the accent mark must always be a vowel (а е є и і ї о у ю я); never place the accent after a consonant\n- Ukrainian past-tense forms (ending in -в, -ла, -ло, -ли) that function as predicates are VERBS — classify them as pos:"verb" and return the infinitive as the base form (e.g. остогидло → остогидіти, минуло → минути, набридло → набридіти)\n' : ''}${conjugationRules}`

  const text = await callClaude({
    system,
    messages: [{ role: 'user', content: prompt }],
    model: 'claude-haiku-4-5',
    maxTokens: 1500,
  })

  console.log('identifyWord raw response:', text)
  const clean = text.replace(/```json|```/g, '').trim()
  const match = clean.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('No JSON object found in response')
  const parsed = JSON.parse(match[0])
  return isUkrainian ? deepFixStress(parsed) : parsed
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
    maxTokens: 2048,
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
    maxTokens: 2048,
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
  "isCorrect": true or false,
  "corrected": "the corrected sentence (identical to input if already correct)",
  "feedback": "your feedback in ${interfaceLanguage}"
}

Feedback format rules:
- If correct: one short encouraging sentence confirming it's right. Max 15 words.
- If incorrect: list each mistake as a numbered point. Max 3 points. Example format:
  1. "träume Stelle" → **Traumstelle** — nouns form compounds in German; write as one word, capitalised.
  2. Missing comma before **zu bewerben** — infinitive clauses with "zu" need a comma.
- Wrap corrections and key grammar terms in **double asterisks** so they render bold
- Show the wrong part first, then → then the correction in bold, then a dash and brief rule
- Be direct — name the case, ending, or rule. No filler phrases, no "Great try"

Other rules:
- isCorrect is true only if the sentence is grammatically correct AND uses the target word naturally
- Correct minor typos in "corrected" too
- If the sentence doesn't use the target word at all, isCorrect is false`

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
export async function chatWithTutor(messages, targetLanguage = 'German', interfaceLanguage = 'English', memory = null) {
  const memorySection = memory
    ? `\n\nLEARNER MEMORY (from previous sessions):\n${memory}\n\nUse this context to personalise your responses — reference their known struggles, build on topics they've already studied, adjust your explanations to their level.`
    : ''

  const system = `You are a friendly, knowledgeable ${targetLanguage} language tutor.
Always respond in ${interfaceLanguage}.
When explaining grammar, use examples in ${targetLanguage} with ${interfaceLanguage} translations.
You are multilingual: if the learner asks you to translate words or phrases into another language (for example their native language such as Ukrainian), just do it directly and helpfully. Never refuse or redirect them to external tools — give your best translation, noting any nuance briefly if a word is hard to translate precisely.
Format responses clearly: use **bold** for key terms, *italics* for ${targetLanguage} words and examples.
Use tables (markdown pipe format) when comparing forms or cases.
Keep responses thorough but focused — no unnecessary padding.
After explaining a grammar topic, end with a brief note that the user can practice this topic if they want.${memorySection}`

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
