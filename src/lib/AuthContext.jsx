import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'

const AuthContext = createContext({})

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else setLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else { setProfile(null); setLoading(false) }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile(userId) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    if (error) console.warn('[wordy] fetchProfile error:', error.message, error.code)
    setProfile(data)
    setLoading(false)
  }

  async function updateProfile(updates) {
    if (!user) return
    console.log('[wordy] updateProfile called with', updates, 'for user', user.id)

    // Try update first
    const { data: updated, error: updateErr } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', user.id)
      .select()
      .single()

    console.log('[wordy] update result:', updated, updateErr?.message)

    if (updated) { setProfile(updated); return updated }

    // No row exists yet — try insert
    const { data: inserted, error: insertErr } = await supabase
      .from('profiles')
      .insert({ id: user.id, ...updates })
      .select()
      .single()

    console.log('[wordy] insert result:', inserted, insertErr?.message)

    if (inserted) setProfile(inserted)
    return inserted
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  async function deleteAccount() {
    if (!user) return
    // Delete all user data. Order matters: join tables before parent tables.
    await supabase.from('word_collections').delete().eq('user_id', user.id)
    await supabase.from('word_senses').delete().eq('user_id', user.id)
    await supabase.from('words').delete().eq('user_id', user.id)
    await supabase.from('collections').delete().eq('user_id', user.id)
    await supabase.from('learner_memory').delete().eq('user_id', user.id)
    await supabase.from('profiles').delete().eq('id', user.id)
    // Auth account is kept — signing back in with the same credentials
    // will land on onboarding (no profile row).
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, updateProfile, signOut, deleteAccount }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
