// Per-day count of NEW words the guided session has introduced, stored locally.
// Device-local is fine for a single-learner-per-device app; it self-resets daily.
const key = (todayISO) => `wordy_new_today_${todayISO}`

export function getNewToday(todayISO) {
  try { return parseInt(localStorage.getItem(key(todayISO)) || "0", 10) || 0 } catch { return 0 }
}

export function addNewToday(todayISO, n) {
  try { localStorage.setItem(key(todayISO), String(getNewToday(todayISO) + n)) } catch { /* no storage */ }
}

// The per-day new-word budget is the learner's own pacing choice, held on the
// profile (profiles.daily_new_words) and passed in here — the count is local, the
// budget is not. This value is only the fallback for when the profile has not
// loaded yet, and the default for a fresh profile (it matches the DB default).
export const DEFAULT_NEW_PER_DAY = 15

// Callers (the session planner and the Dashboard CTA) must pass the SAME limit,
// or the CTA offers sessions the planner then refuses. Both read it off the
// profile, which is what keeps them in agreement.
export function remainingNewToday(todayISO, limit = DEFAULT_NEW_PER_DAY) {
  return Math.max(0, limit - getNewToday(todayISO))
}
