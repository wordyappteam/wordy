// Per-day count of NEW words the guided session has introduced, stored locally.
// Device-local is fine for a single-learner-per-device app; it self-resets daily.
const key = (todayISO) => `wordy_new_today_${todayISO}`

export function getNewToday(todayISO) {
  try { return parseInt(localStorage.getItem(key(todayISO)) || "0", 10) || 0 } catch { return 0 }
}

export function addNewToday(todayISO, n) {
  try { localStorage.setItem(key(todayISO), String(getNewToday(todayISO) + n)) } catch { /* no storage */ }
}

// The per-day new-word budget. Single source of truth: the session planner and
// the Dashboard CTA must agree, or the CTA offers sessions the planner refuses.
// Raised 7 -> 15 for hardcore exam-prep pacing (~15 new words/day intake target).
export const NEW_PER_DAY = 15

export function remainingNewToday(todayISO) {
  return Math.max(0, NEW_PER_DAY - getNewToday(todayISO))
}
