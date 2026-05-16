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
export async function identifyWord(input, targetLanguage = 'German', interfaceLanguage = 'English') {
  const system = `You are a language expert specialising in ${targetLanguage}.
Return ONLY valid JSON — no markdown, no code blocks, no explanation outside the JSON.
Write all explanatory text (the "explanation" and "grammarNote" fields) in ${interfaceLanguage}.`

  const prompt = `The user is learning ${targetLanguage} and typed: "${input}"

The input may be in any language (e.g. Ukrainian, English, or ${targetLanguage} itself).
If it is NOT in ${targetLanguage}, treat it as a translation and find the best ${targetLanguage} equivalent.
Always return the ${targetLanguage} base form — never the input word itself unless it is already ${targetLanguage}.

Identify this entry and return ONLY this JSON structure:
{
  "word": "base/canonical form (with article for nouns, e.g. die Entscheidung)",
  "form": "for nouns: the plural form WITHOUT article e.g. 'Krankheiten', 'Häuser', 'Kinder', 'Autos'; if no plural exists write '–'; for verbs: conjugation e.g. 'macht / machte / gemacht'",
  "pos": "verb|noun|adjective|adverb|conjunction|preposition",
  "entryType": "word|phrase|idiom|phrasal-verb",
  "translation": "concise English translation",
  "grammarNote": "one key grammar rule, under 15 words",
  "explanation": "2-3 sentences on usage and nuance, under 60 words",
  "isException": true or false,
  "examples": [
    { "de": "natural example sentence in ${targetLanguage}", "en": "English translation", "tense": "present" },
    { "de": "natural example sentence in ${targetLanguage}", "en": "English translation", "tense": "past" },
    { "de": "natural example sentence in ${targetLanguage}", "en": "English translation", "tense": null }
  ],
  "conjugation": null
}

Rules:
- If input is an inflected form, return the base/infinitive in "word"
- For nouns always include the definite article in "word"
- For verbs with fixed prepositions include the preposition in "word", ALWAYS in the order verb + preposition (e.g. "achten auf", "sich erinnern an", "warten auf") — never preposition + verb, regardless of the order the user typed it
- isException is true only for irregular verbs, exceptional grammar, or fixed collocations
- "explanation" must always describe the BASE form (the word stored in "word"), not the inflected input the user typed
- Always include exactly 3 example sentences that showcase the word naturally
- For verbs: use present tense, past tense, and one more varied example; set "tense" accordingly
- For nouns/adjectives/other: set "tense" to null for all examples
- If isException is true AND pos is "verb", replace "conjugation": null with a full conjugation object:
  {
    "präsens":    { "ich": "...", "du": "...", "er/sie/es": "...", "wir": "...", "ihr": "...", "sie/Sie": "..." },
    "präteritum": { "ich": "...", "du": "...", "er/sie/es": "...", "wir": "...", "ihr": "...", "sie/Sie": "..." },
    "partizip_ii": "...",
    "auxiliary": "haben or sein"
  }
- For all other cases leave "conjugation" as null`

  const text = await callClaude({
    system,
    messages: [{ role: 'user', content: prompt }],
    model: 'claude-haiku-4-5',
    maxTokens: 1024,
  })

  console.log('identifyWord raw response:', text)
  const clean = text.replace(/```json|```/g, '').trim()
  const match = clean.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('No JSON object found in response')
  return JSON.parse(match[0])
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
- IMPORTANT — separable verbs: if the verb has a separable prefix (e.g. "eingehen", "anrufen", "aufhören"), the prefix MUST appear at the END of the sentence in your example. e.g. for "eingehen auf": "Der Professor geht ___ ___ Fragen der Studenten ein." not "Der Professor geht ___ ___ Fragen."
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

// ── Chat tutor ─────────────────────────────────────────────────────────────
export async function chatWithTutor(messages, targetLanguage = 'German', interfaceLanguage = 'English') {
  const system = `You are a friendly, knowledgeable ${targetLanguage} language tutor.
Always respond in ${interfaceLanguage}.
When explaining grammar, use examples in ${targetLanguage} with ${interfaceLanguage} translations.
Format responses clearly: use **bold** for key terms, *italics* for ${targetLanguage} words and examples.
Use tables (markdown pipe format) when comparing forms or cases.
Keep responses thorough but focused — no unnecessary padding.
After explaining a grammar topic, end with a brief note that the user can practice this topic if they want.`

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
