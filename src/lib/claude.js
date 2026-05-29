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

export async function identifyWord(input, targetLanguage = 'German', interfaceLanguage = 'English', context = null) {
  const ifaceLang = langWithScript(interfaceLanguage)

  const system = `You are a language expert specialising in ${targetLanguage}.
Return ONLY valid JSON — no markdown, no code blocks, no explanation outside the JSON.
Write all explanatory text (explanation and grammarNote fields) in ${ifaceLang}.`

  const isGerman = targetLanguage === 'German'

  const formNote = isGerman
    ? "for nouns: plural WITHOUT article e.g. 'Häuser'; if no plural write '–'; for verbs: 'macht / machte / gemacht'"
    : "for nouns: plural e.g. 'cats', 'children'; for verbs: 'goes / went / gone'"

  const wordFormNote = isGerman
    ? 'canonical form for this sense — with definite article for nouns (e.g. das Buch), plain infinitive for verbs (e.g. buchen), verb+prep for phrasal verbs (e.g. achten auf)'
    : 'canonical form for this sense — plain form, no article'

  const conjugationRules = isGerman ? `
- If isException is true AND pos is "verb", replace "conjugation": null with:
  { "präsens": {"ich":"...","du":"...","er/sie/es":"...","wir":"...","ihr":"...","sie/Sie":"..."}, "präteritum": {"ich":"...","du":"...","er/sie/es":"...","wir":"...","ihr":"...","sie/Sie":"..."}, "partizip_ii": "...", "auxiliary": "haben or sein" }
- Otherwise leave "conjugation" as null` : `
- Always leave "conjugation" as null`

  const nounArticleRule = isGerman
    ? '- In "wordForm": include the definite article for nouns (e.g. die Entscheidung). For verb+prep phrases always order verb then preposition (e.g. "sich erinnern an"), never the reverse.'
    : '- In "wordForm": no article for nouns.'

  const contextInstruction = context
    ? `\nThe word appears in this sentence: "${context}"\nReturn ONLY the one sense that matches this context. The senses array must contain exactly one entry.`
    : `\nReturn ALL commonly used senses (separate POS or clearly distinct meaning groups). Most words have exactly one sense — only return multiple when there are genuinely distinct usages worth learning separately.`

  const prompt = `The user is learning ${targetLanguage} and typed: "${input}"${contextInstruction}

The input may be in any language (Ukrainian, English, or ${targetLanguage}).
If it is NOT in ${targetLanguage}, find the best ${targetLanguage} equivalent.
Always return the ${targetLanguage} base form.

Return ONLY this JSON:
{
  "word": "primary display form — with article for ${isGerman ? 'German nouns (e.g. die Entscheidung)' : 'nouns'}, plain for verbs",
  "entryType": "word|phrase|idiom|phrasal-verb",
  "senses": [
    {
      "pos": "verb|noun|adjective|adverb|conjunction|preposition",
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
- For verbs: present, past, one varied — set "tense" accordingly. For nouns/adj/other: "tense": null
- register: language register for this specific sense. Use "neutral" for everyday vocabulary with no special register
- cefr: CEFR level for this specific sense based on standard vocabulary lists. When between two levels, pick the more common/lower one
${conjugationRules}`

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
