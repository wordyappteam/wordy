import { useLocation, useNavigate } from 'react-router-dom'
import { useLanguage } from '../lib/i18n'
import { useTargetLang, SUPPORTED_LANGUAGES } from '../lib/TargetLangContext'
import { useAuth } from '../lib/AuthContext'

export default function NavBar({ slot, className = '' }) {
  const navigate       = useNavigate()
  const { pathname }   = useLocation()
  const { lang, switchLang, t } = useLanguage()
  const { targetLang, setTargetLang } = useTargetLang()
  const { user }       = useAuth()

  const links = [
    { path: '/dashboard',  label: t('nav.dashboard')  },
    { path: '/dictionary', label: t('nav.dictionary') },
    { path: '/exercises',  label: t('nav.exercises')  },
    { path: '/reader',     label: 'Reader'            },
    { path: '/chat',       label: t('nav.chat')       },
  ]

  function activeClass(path) {
    if (pathname !== path) return 'hover:text-gray-800 transition-colors'
    return path === '/dictionary' ? 'text-brand-yellow font-semibold' : 'text-indigo-600 font-semibold'
  }

  return (
    <nav className={`bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between shadow-sm ${className}`}>
      <div className="text-xl font-bold tracking-tight">
        <span className="text-indigo-600">word</span><span className="text-brand-yellow">y</span>
      </div>

      <div className="flex items-center gap-6 text-sm font-medium text-gray-400">
        {links.map(({ path, label }) => (
          <button key={path} onClick={() => navigate(path)} className={activeClass(path)}>
            {label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3">
        {/* Target language switcher */}
        <div className="flex rounded-full border border-gray-200 overflow-hidden text-xs font-semibold">
          {SUPPORTED_LANGUAGES.map(({ code, label }) => (
            <button
              key={code}
              onClick={() => setTargetLang(code)}
              className={`px-3 py-1 transition-colors ${
                targetLang === code ? 'bg-brand-yellow text-white' : 'text-gray-400 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Interface language toggle */}
        <div className="flex rounded-full border border-gray-200 overflow-hidden text-xs font-semibold">
          <button onClick={() => switchLang('en')} className={`px-3 py-1 transition-colors ${lang === 'en' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-700'}`}>EN</button>
          <button onClick={() => switchLang('uk')} className={`px-3 py-1 transition-colors ${lang === 'uk' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-700'}`}>UA</button>
        </div>

        {/* Right slot (profile dropdown) or fallback avatar */}
        {slot ?? (
          <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 text-sm font-bold">
            {(user?.email?.[0] ?? 'U').toUpperCase()}
          </div>
        )}
      </div>
    </nav>
  )
}
