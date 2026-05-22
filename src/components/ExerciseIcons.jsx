// Consistent stroke-style icons for each exercise
// All use currentColor, strokeWidth 1.75, viewBox 0 0 24 24

const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

export function FlashcardsIcon({ size = 22, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      {/* Back card */}
      <rect x="5" y="6" width="14" height="10" rx="2" opacity="0.35" />
      {/* Front card */}
      <rect x="3" y="8" width="14" height="10" rx="2" />
      {/* Question mark — centered at x=10, baseline y=17 */}
      <path d="M10 11.5c0-1 .7-1.5 1.4-1.5s1.4.5 1.4 1.5c0 .8-.6 1.2-1.4 1.5v.5" />
      <circle cx="11.4" cy="16" r="0.55" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function PrepositionsIcon({ size = 22, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      {/* Left square */}
      <rect x="2" y="7" width="9" height="10" rx="2" />
      {/* Right square — overlaps to show binding */}
      <rect x="13" y="7" width="9" height="10" rx="2" />
      {/* Binding link in the middle */}
      <path d="M11 10.5h2M11 13.5h2" />
    </svg>
  )
}

export function FillBlankIcon({ size = 22, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      {/* Text lines */}
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="11" x2="11" y2="11" />
      {/* Blank / underline */}
      <line x1="13" y1="11" x2="20" y2="11" strokeDasharray="2 1.5" />
      {/* Pencil writing in blank */}
      <path d="M13 14.5l5-5 1.5 1.5-5 5z" />
      <path d="M13 14.5l-.5 2 2-.5" />
      <line x1="4" y1="15" x2="10" y2="15" />
    </svg>
  )
}

export function WordOrderIcon({ size = 22, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      {/* Word chips */}
      <rect x="2" y="5" width="6" height="5" rx="1.5" />
      <rect x="10" y="5" width="6" height="5" rx="1.5" />
      <rect x="6" y="14" width="6" height="5" rx="1.5" />
      <rect x="14" y="14" width="6" height="5" rx="1.5" />
      {/* Shuffle arrows */}
      <path d="M18.5 5.5l2 2-2 2" />
      <path d="M18 7.5h-1" />
      <path d="M3.5 18.5l-2-2 2-2" />
      <path d="M4 16.5h1" />
    </svg>
  )
}

export function ActiveRecallIcon({ size = 22, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      {/* Brain outline left */}
      <path d="M12 5C9.5 5 7 6.5 7 9c0 1.2.5 2 1.2 2.6C7.5 12.2 7 13.2 7 14c0 2 1.5 3 3 3" />
      {/* Brain outline right */}
      <path d="M12 5c2.5 0 5 1.5 5 4 0 1.2-.5 2-1.2 2.6.7.6 1.2 1.6 1.2 2.4 0 2-1.5 3-3 3" />
      {/* Center spine */}
      <line x1="12" y1="5" x2="12" y2="17" />
      {/* Recall arrow */}
      <path d="M9 20l3-3 3 3" />
    </svg>
  )
}

export function SentenceWritingIcon({ size = 22, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      {/* Page */}
      <rect x="4" y="3" width="13" height="16" rx="2" />
      {/* Lines on page */}
      <line x1="7" y1="8" x2="14" y2="8" />
      <line x1="7" y1="11" x2="14" y2="11" />
      <line x1="7" y1="14" x2="11" y2="14" />
      {/* Pen writing */}
      <path d="M16 14l3-3 2 2-3 3z" />
      <path d="M16 14l-1 2.5 2.5-1" />
    </svg>
  )
}

export function GrammarChatIcon({ size = 22, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      {/* Main bubble */}
      <path d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H8l-4 3V6a1 1 0 0 1 1-1z" />
      {/* Grammar marks inside */}
      <line x1="8" y1="10" x2="11" y2="10" />
      <line x1="13" y1="10" x2="16" y2="10" />
      <line x1="8" y1="13" x2="13" y2="13" />
    </svg>
  )
}
