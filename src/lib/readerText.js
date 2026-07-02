// Pure text utilities for the Reader. tokenize/normalizeWordForm/getSentence
// are ports of the versions previously inside src/pages/Reader.jsx.

export function tokenize(text) {
  return text.split(/([\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*)/gu).map((t, i) => ({
    text: t,
    isWord: /[\p{L}]/u.test(t),
    key: i,
  }))
}

export function normalizeWordForm(w) {
  return w.toLowerCase().replace(/^(der|die|das|ein|eine)\s+/i, '').trim()
}

export function getSentence(blockText, word) {
  const sentences = blockText.match(/[^.!?…]+[.!?…]*/g) ?? [blockText]
  const target = word.toLowerCase()
  for (const s of sentences) {
    if (s.toLowerCase().includes(target)) return s.trim()
  }
  return blockText.slice(0, 300).trim()
}

export function blockPlainText(block) {
  if (!block.runs) return ''
  return block.runs.map(r => (r.br ? ' ' : r.text)).join('').replace(/\s+/g, ' ').trim()
}

function sameFlags(a, b) {
  return !!a.em === !!b.em && !!a.strong === !!b.strong && !!a.sup === !!b.sup
}

export function mergeRuns(runs) {
  const out = []
  for (const run of runs) {
    if (run.br) { out.push({ br: true }); continue }
    if (!run.text) continue
    const prev = out[out.length - 1]
    if (prev && !prev.br && sameFlags(prev, run)) {
      prev.text = (prev.text + run.text).replace(/  +/g, ' ')
    } else {
      out.push({ ...run })
    }
  }
  // trim text runs at edges and around br
  for (let i = 0; i < out.length; i++) {
    if (out[i].br) continue

    // trim leading spaces if at start or after br
    if (i === 0 || out[i - 1].br) {
      out[i].text = out[i].text.replace(/^\s+/, '')
    }

    // trim trailing spaces if at end or before br
    if (i === out.length - 1 || out[i + 1].br) {
      out[i].text = out[i].text.replace(/\s+$/, '')
    }
  }
  return out.filter(r => r.br || r.text)
}
