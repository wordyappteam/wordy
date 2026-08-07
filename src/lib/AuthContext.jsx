import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

const AuthContext = createContext({})

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  // Whose profile is currently loaded. Guards against re-fetching on every
  // token refresh, which would otherwise flash the loading spinner hourly.
  const profileFor = useRef(null)

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) { profileFor.current = session.user.id; fetchProfile(session.user.id) }
      else setLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null
      setUser(u)
      if (!u) { profileFor.current = null; setProfile(null); setLoading(false); return }
      if (profileFor.current === u.id) return // already have this user's profile
      // BACK TO LOADING. Without this, signing in re-rendered with `user` set,
      // `profile` still null and `loading` already false from the no-session
      // check — so the route guard read "no profile" as "needs onboarding" and
      // redirected there before the profile had a chance to arrive.
      profileFor.current = u.id
      setLoading(true)
      fetchProfile(u.id)
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
