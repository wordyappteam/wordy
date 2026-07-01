// Per-day count of NEW words the guided session has introduced, stored locally.
// Device-local is fine for a single-learner-per-device app; it self-resets daily.
const key = (todayISO) => `wordy_new_today_${todayISO}`

export function getNewToday(todayISO) {
  try { return parseInt(localStorage.getItem(key(todayISO)) || "0", 10) || 0 } catch { return 0 }
}

export function addNewToday(todayISO, n) {
  try { localStorage.setItem(key(todayISO), String(getNewToday(todayISO) + n)) } catch { /* no storage */ }
}
