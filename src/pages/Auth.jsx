import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Auth() {
  const navigate = useNavigate()
  const [mode, setMode]         = useState('login') // 'login' | 'signup' | 'reset' | 'new-password'
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [name, setName]         = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const [success, setSuccess]   = useState(null)

  // Detect when user arrives via a password reset link
  useEffect(() => {
    supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setMode('new-password')
      }
    })
  }, [])

  async function handleSetNewPassword(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) setError(error.message)
    else navigate('/dashboard')
    setLoading(false)
  }

  async function handleReset(e) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth`,
    })
    if (error) setError(error.message)
    else setSuccess('Check your email for a password reset link.')
    setLoading(false)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setLoading(true)

    if (mode === 'signup') {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { display_name: name } },
      })
      if (error) setError(error.message)
      else if (data.session) navigate('/dashboard')
      else setSuccess('Check your email to confirm your account, then log in.')
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
      else navigate('/dashboard')
    }

    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <nav className="bg-white border-b border-gray-100 px-6 py-4">
        <button onClick={() => navigate('/')} className="text-xl font-bold text-indigo-600">wordy</button>
      </nav>

      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm w-full max-w-md p-8">

          {/* Set new password (after clicking reset link in email) */}
          {mode === 'new-password' && (
            <>
              <h1 className="text-2xl font-bold text-gray-900 mb-1">Set a new password</h1>
              <p className="text-sm text-gray-400 mb-6">Choose a new password for your account.</p>
              <form onSubmit={handleSetNewPassword} className="flex flex-col gap-4">
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1.5 block">New password</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    required
                    minLength={6}
                    autoFocus
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-400 transition-colors"
                  />
                </div>
                {error && <div className="bg-red-50 border border-red-100 text-red-600 text-sm px-4 py-3 rounded-xl">{error}</div>}
                <button type="submit" disabled={loading}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white py-3 rounded-xl font-semibold text-sm transition-colors mt-2">
                  {loading ? '...' : 'Save new password →'}
                </button>
              </form>
            </>
          )}

          {/* Toggle (login / signup only) */}
          {mode !== 'new-password' && mode !== 'reset' && (
            <div className="flex bg-gray-100 rounded-2xl p-1 mb-8">
              <button onClick={() => { setMode('login'); setError(null); setSuccess(null) }}
                className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-colors ${mode === 'login' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                Log in
              </button>
              <button onClick={() => { setMode('signup'); setError(null); setSuccess(null) }}
                className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-colors ${mode === 'signup' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                Sign up
              </button>
            </div>
          )}

          {mode !== 'new-password' && (
            <h1 className="text-2xl font-bold text-gray-900 mb-1">
              {mode === 'login' ? 'Welcome back' : mode === 'signup' ? 'Create your account' : 'Reset your password'}
            </h1>
          )}
          {mode !== 'new-password' && (
            <p className="text-sm text-gray-400 mb-6">
              {mode === 'login' ? 'Log in to continue learning.'
                : mode === 'signup' ? 'Start building your vocabulary today.'
                : "Enter your email and we'll send you a reset link."}
            </p>
          )}

          {/* Forgot password form */}
          {mode === 'reset' && (
            <form onSubmit={handleReset} className="flex flex-col gap-4">
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1.5 block">Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com" required
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-400 transition-colors" />
              </div>
              {error && <div className="bg-red-50 border border-red-100 text-red-600 text-sm px-4 py-3 rounded-xl">{error}</div>}
              {success && <div className="bg-green-50 border border-green-100 text-green-700 text-sm px-4 py-3 rounded-xl">{success}</div>}
              <button type="submit" disabled={loading}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white py-3 rounded-xl font-semibold text-sm transition-colors mt-2">
                {loading ? '...' : 'Send reset link →'}
              </button>
              <button type="button" onClick={() => { setMode('login'); setError(null); setSuccess(null) }}
                className="text-sm text-gray-400 hover:text-gray-600 text-center transition-colors">
                ← Back to login
              </button>
            </form>
          )}

          {/* Login / signup form */}
          {(mode === 'login' || mode === 'signup') && (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {mode === 'signup' && (
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1.5 block">Your name</label>
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                    placeholder="Nika" required
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-400 transition-colors" />
                </div>
              )}
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1.5 block">Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com" required
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-400 transition-colors" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-gray-500">Password</label>
                  {mode === 'login' && (
                    <button type="button" onClick={() => { setMode('reset'); setError(null); setSuccess(null) }}
                      className="text-xs text-indigo-500 hover:text-indigo-700 transition-colors">
                      Forgot password?
                    </button>
                  )}
                </div>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'signup' ? 'At least 6 characters' : '••••••••'}
                  required minLength={6}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-400 transition-colors" />
              </div>
              {error && <div className="bg-red-50 border border-red-100 text-red-600 text-sm px-4 py-3 rounded-xl">{error}</div>}
              {success && <div className="bg-green-50 border border-green-100 text-green-700 text-sm px-4 py-3 rounded-xl">{success}</div>}
              <button type="submit" disabled={loading}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white py-3 rounded-xl font-semibold text-sm transition-colors mt-2">
                {loading ? '...' : mode === 'login' ? 'Log in →' : 'Create account →'}
              </button>
            </form>
          )}

        </div>
      </div>
    </div>
  )
}
