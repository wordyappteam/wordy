// In-flight session persistence.
//
// The v2 runner held `steps`/`idx`/`outcomes` in React state only and re-planned
// on every mount, so a tab switch (or any route change) threw away the session —
// including reviews already answered, which were never written anywhere. These
// functions let the runner snapshot itself after every card and pick the same
// session back up.
//
// `store` is injected so none of this needs a browser: the app passes
// `window.localStorage`, the tests pass a fake.

export function snapshotKey(userId, targetLang) {
  return `verba.session.v2:${userId}:${targetLang}`
}

export function saveSnapshot(store, key, snapshot) {
  try {
    store.setItem(key, JSON.stringify(snapshot))
    return true
  } catch {
    // Private mode or quota. Persistence is a nicety — losing it must never
    // cost the learner the session they are in.
    return false
  }
}

export function loadSnapshot(store, key) {
  try {
    const raw = store.getItem(key)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    // Unreadable or corrupt: behave exactly as if there were no snapshot.
    return null
  }
}

export function clearSnapshot(store, key) {
  try {
    store.removeItem(key)
  } catch { /* nothing to do — see saveSnapshot */ }
}

// Is this snapshot still the session the learner is asking for?
//
// Same day (overnight the due set changes, so a stale queue is wrong), same
// collection (a collection session and the daily session are different queues),
// and genuinely mid-flight.
export function resumableSnapshot(snapshot, { today, collectionId = null } = {}) {
  if (!snapshot) return null
  if (snapshot.date !== today) return null
  if ((snapshot.collectionId ?? null) !== (collectionId ?? null)) return null
  const steps = snapshot.steps
  if (!Array.isArray(steps) || !steps.length) return null
  const idx = snapshot.idx
  if (!Number.isInteger(idx) || idx < 0 || idx >= steps.length) return null
  return snapshot
}
