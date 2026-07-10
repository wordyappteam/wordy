import { useNavigate } from 'react-router-dom'
import { useLanguage } from '../lib/i18n'

export default function Landing() {
  const navigate = useNavigate()
  const { t, lang, switchLang } = useLanguage()

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex flex-col">
      {/* Nav */}
      <nav className="flex items-center justify-between px-5 sm:px-8 py-5 max-w-6xl mx-auto w-full gap-2">
        <div className="text-2xl font-bold text-indigo-600 tracking-tight">verba</div>
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Language switcher */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-semibold">
            <button
              onClick={() => switchLang('en')}
              className={`px-2.5 py-1 transition-colors ${lang === 'en' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-700'}`}
            >
              EN
            </button>
            <button
              onClick={() => switchLang('uk')}
              className={`px-2.5 py-1 transition-colors ${lang === 'uk' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-700'}`}
            >
              UA
            </button>
          </div>
          <button
            onClick={() => navigate('/auth')}
            className="text-gray-600 hover:text-gray-900 px-4 py-2 text-sm font-medium transition-colors"
          >
            {t('landing.login')}
          </button>
          <button
            onClick={() => navigate('/auth')}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-full text-sm font-medium transition-colors"
          >
            {t('landing.getStarted')}
          </button>
        </div>
      </nav>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 text-center max-w-4xl mx-auto w-full py-12 sm:py-20">
        <div className="inline-flex items-center gap-2 bg-indigo-50 border border-indigo-100 rounded-full px-4 py-1.5 text-xs sm:text-sm text-indigo-700 font-medium mb-8">
          <span className="w-2 h-2 bg-indigo-500 rounded-full" />
          {t('landing.badge')}
        </div>

        <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-gray-900 leading-tight tracking-tight mb-6">
          {t('landing.headline1')}<br />
          <span className="text-indigo-600">{t('landing.headlineAccent')}</span>{' '}
          {t('landing.headline2')}
        </h1>

        <p className="text-lg sm:text-xl text-gray-500 max-w-2xl leading-relaxed mb-10">
          {t('landing.sub')}
        </p>

        <div className="flex flex-col sm:flex-row gap-4 items-center">
          <button
            onClick={() => navigate('/auth')}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-4 rounded-full text-base font-semibold transition-colors shadow-lg shadow-indigo-200"
          >
            {t('landing.cta')}
          </button>
          <button className="text-gray-600 hover:text-gray-900 px-8 py-4 text-base font-medium transition-colors">
            {t('landing.howItWorks')}
          </button>
        </div>

        {/* Feature pills */}
        <div className="flex flex-wrap gap-3 justify-center mt-14">
          {t('landing.pills').map((f) => (
            <span
              key={f}
              className="bg-white border border-gray-200 text-gray-600 px-4 py-2 rounded-full text-sm font-medium shadow-sm"
            >
              {f}
            </span>
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="text-center py-6 text-sm text-gray-400">
        {t('landing.footer')}
      </footer>
    </div>
  )
}
