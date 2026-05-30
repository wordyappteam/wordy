import { useState } from 'react'
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
  const [menuOpen, setMenuOpen] = useState(false)

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

  function go(path) { setMenuOpen(false); navigate(path) }

  const targetToggle = (
    <div className="flex rounded-full border border-gray-200 overflow-hidden text-xs font-semibold">
      {SUPPORTED_LANGUAGES.map(({ code, label }) => (
        <button
          key={code}
          onClick={() => setTargetLang(code)}
          className={`px-3 py-1 transition-colors ${targetLang === code ? 'bg-brand-yellow text-white' : 'text-gray-400 hover:text-gray-700'}`}
        >
          {label}
        </button>
      ))}
    </div>
  )

  const interfaceToggle = (
    <div className="flex rounded-full border border-gray-200 overflow-hidden text-xs font-semibold">
      <button onClick={() => switchLang('en')} className={`px-3 py-1 transition-colors ${lang === 'en' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-700'}`}>EN</button>
      <button onClick={() => switchLang('uk')} className={`px-3 py-1 transition-colors ${lang === 'uk' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-700'}`}>UA</button>
    </div>
  )

  return (
    <nav className={`bg-white border-b border-gray-100 px-4 sm:px-6 py-4 shadow-sm ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-xl font-bold tracking-tight shrink-0">
          <span className="text-indigo-600">word</span><span className="text-brand-yellow">y</span>
        </div>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-6 text-sm font-medium text-gray-400">
          {links.map(({ path, label }) => (
            <button key={path} onClick={() => navigate(path)} className={activeClass(path)}>
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {/* Language toggles — desktop only */}
          <div className="hidden md:flex items-center gap-3">
            {targetToggle}
            {interfaceToggle}
          </div>

          {/* Right slot (profile dropdown / page actions) or fallback avatar */}
          {slot ?? (
            <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 text-sm font-bold">
              {(user?.email?.[0] ?? 'U').toUpperCase()}
            </div>
          )}

          {/* Hamburger (mobile only) */}
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="md:hidden w-9 h-9 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"
            aria-label="Menu"
          >
            {menuOpen ? '✕' : '☰'}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden mt-3 pt-3 border-t border-gray-100 flex flex-col gap-1">
          {links.map(({ path, label }) => (
            <button
              key={path}
              onClick={() => go(path)}
              className={`text-left px-3 py-2.5 rounded-xl text-sm font-medium ${pathname === path ? 'bg-indigo-50 text-indigo-600' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              {label}
            </button>
          ))}
          <div className="flex items-center gap-3 px-3 pt-3 mt-1 border-t border-gray-100">
            {targetToggle}
            {interfaceToggle}
          </div>
        </div>
      )}
    </nav>
  )
}
