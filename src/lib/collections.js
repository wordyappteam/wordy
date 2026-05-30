import { supabase } from './supabase'

// Color tokens → Tailwind classes for collection chips/dots.
// Literal class strings so Tailwind's JIT picks them up.
export const COLLECTION_COLORS = {
  indigo:  { dot: 'bg-indigo-500',  chip: 'bg-indigo-50 text-indigo-700 border-indigo-200',    active: 'bg-indigo-600 text-white border-indigo-600' },
  rose:    { dot: 'bg-rose-500',    chip: 'bg-rose-50 text-rose-700 border-rose-200',          active: 'bg-rose-500 text-white border-rose-500' },
  amber:   { dot: 'bg-amber-500',   chip: 'bg-amber-50 text-amber-700 border-amber-200',       active: 'bg-amber-500 text-white border-amber-500' },
  emerald: { dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', active: 'bg-emerald-600 text-white border-emerald-600' },
  sky:     { dot: 'bg-sky-500',     chip: 'bg-sky-50 text-sky-700 border-sky-200',             active: 'bg-sky-600 text-white border-sky-600' },
  violet:  { dot: 'bg-violet-500',  chip: 'bg-violet-50 text-violet-700 border-violet-200',    active: 'bg-violet-600 text-white border-violet-600' },
  orange:  { dot: 'bg-orange-500',  chip: 'bg-orange-50 text-orange-700 border-orange-200',    active: 'bg-orange-500 text-white border-orange-500' },
  teal:    { dot: 'bg-teal-500',    chip: 'bg-teal-50 text-teal-700 border-teal-200',          active: 'bg-teal-600 text-white border-teal-600' },
}

export const COLLECTION_COLOR_KEYS = Object.keys(COLLECTION_COLORS)

export function collectionColor(key) {
  return COLLECTION_COLORS[key] || COLLECTION_COLORS.indigo
}

// A reasonable default color for a new collection: first unused, else cycle.
export function nextColor(existing = []) {
  const used = new Set(existing.map(c => c.color))
  const free = COLLECTION_COLOR_KEYS.find(k => !used.has(k))
  return free || COLLECTION_COLOR_KEYS[existing.length % COLLECTION_COLOR_KEYS.length]
}

// Load collections + membership rows for a user/target language.
export async function fetchCollectionsData(userId, targetLang) {
  const [{ data: collections }, { data: memberships }] = await Promise.all([
    supabase.from('collections')
      .select('id, name, color')
      .eq('user_id', userId)
      .eq('target_language', targetLang)
      .order('created_at', { ascending: true }),
    supabase.from('word_collections')
      .select('collection_id, word_id')
      .eq('user_id', userId),
  ])
  return { collections: collections || [], memberships: memberships || [] }
}

export async function createCollection(userId, targetLang, name, color, wordIds = []) {
  const { data, error } = await supabase
    .from('collections')
    .insert({ user_id: userId, target_language: targetLang, name: name.trim(), color })
    .select('id')
    .single()
  if (error || !data) throw error || new Error('Failed to create collection')
  if (wordIds.length) {
    await supabase.from('word_collections').insert(
      wordIds.map(word_id => ({ user_id: userId, collection_id: data.id, word_id }))
    )
  }
  return data.id
}

export async function renameCollection(id, name) {
  await supabase.from('collections').update({ name: name.trim() }).eq('id', id)
}

export async function deleteCollection(id) {
  await supabase.from('collections').delete().eq('id', id)
}

export async function addWordToCollection(userId, collectionId, wordId) {
  await supabase.from('word_collections').insert({ user_id: userId, collection_id: collectionId, word_id: wordId })
}

export async function removeWordFromCollection(collectionId, wordId) {
  await supabase.from('word_collections').delete().eq('collection_id', collectionId).eq('word_id', wordId)
}
