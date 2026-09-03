#!/usr/bin/env node
// Run the note audit over an exported dictionary and print what it finds.
//
//   npm run audit:notes -- ~/Downloads/verba-dictionary-de-2026-09-02.json
//
// Reads an export (Dictionary → Export), never the database — the notes are
// text, and text is the only thing this touches. Nothing is written back.

import { readFileSync } from 'node:fs'
import { auditDictionary } from '../src/lib/noteAudit.js'
import { proposeRepair } from '../src/lib/noteRepair.js'

const path = process.argv[2]
if (!path) {
  console.error('usage: npm run audit:notes -- <export.json>')
  process.exit(2)
}

const dump = JSON.parse(readFileSync(path, 'utf8'))
const senses = dump.senses ?? dump
const findings = auditDictionary(senses)

const byCode = new Map()
for (const f of findings) {
  if (!byCode.has(f.code)) byCode.set(f.code, [])
  byCode.get(f.code).push(f)
}

console.log(`\n${senses.length} senses audited · ${findings.length} findings in ${new Set(findings.map((f) => f.word)).size} words\n`)

// A finding whose correction is derivable from the defect itself carries a
// proposal; the rest are listed as needing a person, and counted separately, so
// an automatic pass can never be mistaken for a finished repair.
const byId = new Map(senses.map((s) => [s.id, s]))
const fieldText = (f) => byId.get(f.senseId)?.[f.field] ?? ''
let proposed = 0

for (const [code, group] of [...byCode].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`── ${code} (${group.length}) ${'─'.repeat(Math.max(0, 56 - code.length))}`)
  console.log(`   ${group[0].detail}\n`)
  for (const f of group) {
    const before = fieldText(f)
    const after = proposeRepair(f, before)
    console.log(`   ${f.word}  ·  ${f.field}`)
    if (f.excerpt) console.log(`     → ${f.excerpt}`)
    if (after) {
      proposed++
      console.log(`     ✎ ${after}`)
    } else {
      console.log(`     ✋ needs a person`)
    }
  }
  console.log()
}

console.log(`${proposed} of ${findings.length} findings have a derivable correction; ${findings.length - proposed} need a person.\n`)

if (!findings.length) console.log('Nothing the audit can be sure of.\n')

// Class 3 — a well-formed note that is simply wrong — is invisible here by
// design. Say so, so an empty report is never read as a clean dictionary.
console.log('The audit reports only what it can be sure of: script-level')
console.log('impossibilities and disagreement inside the grammar vocabulary.')
console.log('A note in fluent Ukrainian that states a falsehood will not appear.\n')
