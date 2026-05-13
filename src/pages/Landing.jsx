import { useNavigate } from 'react-router-dom'

export default function Landing() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex flex-col">
      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-5 max-w-6xl mx-auto w-full">
        <div className="text-2xl font-bold text-indigo-600 tracking-tight">wordy</div>
        <div className="flex gap-3">
          <button
            onClick={() => navigate('/auth')}
            className="text-gray-600 hover:text-gray-900 px-4 py-2 text-sm font-medium transition-colors"
          >
            Log in
          </button>
          <button
            onClick={() => navigate('/auth')}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-full text-sm font-medium transition-colors"
          >
            Get started
          </button>
        </div>
      </nav>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 text-center max-w-4xl mx-auto w-full py-20">
        <div className="inline-flex items-center gap-2 bg-indigo-50 border border-indigo-100 rounded-full px-4 py-1.5 text-sm text-indigo-700 font-medium mb-8">
          <span className="w-2 h-2 bg-indigo-500 rounded-full"></span>
          AI-powered vocabulary learning
        </div>

        <h1 className="text-6xl font-bold text-gray-900 leading-tight tracking-tight mb-6">
          Learn words that<br />
          <span className="text-indigo-600">actually stay</span> with you
        </h1>

        <p className="text-xl text-gray-500 max-w-2xl leading-relaxed mb-10">
          An intelligent app that adapts to how you learn. Build vocabulary in 10+ languages,
          300+ words a month — and actually remember them.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 items-center">
          <button
            onClick={() => navigate('/auth')}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-4 rounded-full text-base font-semibold transition-colors shadow-lg shadow-indigo-200"
          >
            Start learning for free
          </button>
          <button className="text-gray-600 hover:text-gray-900 px-8 py-4 text-base font-medium transition-colors">
            See how it works →
          </button>
        </div>

        {/* Feature pills */}
        <div className="flex flex-wrap gap-3 justify-center mt-14">
          {[
            '10+ languages',
            'Adaptive exercises',
            'Browser extension',
            'Personal dictionary',
            'Grammar chat',
            'Spaced repetition',
          ].map((f) => (
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
        Free for your first month · No credit card required
      </footer>
    </div>
  )
}
