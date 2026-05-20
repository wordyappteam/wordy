// Shared helpers for session chaining across exercise pages

export function inSession() {
  return !!sessionStorage.getItem('wordy_session')
}

export function getSessionMeta() {
  const plan = JSON.parse(sessionStorage.getItem('wordy_session') ?? 'null')
  const step = parseInt(sessionStorage.getItem('wordy_session_current_step') ?? '0')
  if (!plan) return null
  const exercises = plan.exercises ?? []
  const isLast    = step >= exercises.length - 1
  const nextLabel = isLast ? null : exercises[step + 1]
  return { plan, step, exercises, isLast, nextLabel }
}

export function advanceSession(navigate) {
  const meta = getSessionMeta()
  if (!meta) { navigate('/dashboard'); return }
  const nextStep = meta.step + 1
  sessionStorage.setItem('wordy_session_current_step', String(nextStep))
  navigate('/session')
}

export function clearSession() {
  sessionStorage.removeItem('wordy_session')
  sessionStorage.removeItem('wordy_session_current_step')
  sessionStorage.removeItem('wordy_session_id')
}

const EXERCISE_NAMES = {
  flashcards:       { en: 'Flashcards',       uk: 'Флеш-картки' },
  word_order:       { en: 'Word order',        uk: 'Порядок слів' },
  fill_blank:       { en: 'Fill in the blank', uk: 'Заповніть пропуск' },
  active_recall:    { en: 'Active recall',     uk: 'Активне відтворення' },
  sentence_writing: { en: 'Sentence writing',  uk: 'Написання речень' },
}

export function nextExerciseName(lang = 'en') {
  const meta = getSessionMeta()
  if (!meta || !meta.nextLabel) return null
  const names = EXERCISE_NAMES[meta.nextLabel]
  return names ? names[lang] ?? names.en : null
}
