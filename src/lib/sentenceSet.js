// Pure parser/validator for the generateSentenceSet AI response.
// No network, no React — unit-testable.
export function parseSentenceSet(rawText) {
  const clean = (rawText || "").replace(/```json|```/g, "").trim()
  const start = clean.indexOf("{")
  const end = clean.lastIndexOf("}")
  if (start === -1 || end === -1) throw new Error("No JSON object in sentence-set response")
  let data
  try {
    data = JSON.parse(clean.slice(start, end + 1))
  } catch (e) {
    throw new Error("Sentence-set response is not valid JSON: " + e.message)
  }
  if (!Array.isArray(data.sentences) || data.sentences.length === 0) {
    throw new Error("Sentence-set response has no sentences")
  }
  const bank = Array.isArray(data.bank) ? data.bank : []
  const sentences = data.sentences.map((s) => ({
    text: String(s.text || ""),
    senseId: s.senseId ?? null,
    answerLemma: String(s.answerLemma || ""),
    answerForm: String(s.answerForm || ""),
    hint: s.hint ? String(s.hint) : null,
    explanation: s.explanation ? String(s.explanation) : null,
  }))
  return { bank, sentences }
}
