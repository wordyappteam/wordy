import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

const AuthContext = createContext({})

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  // A profile that FAILED TO LOAD is not a user who HAS no profile. Keeping
  // them apart is the whole point: conflating them sends an existing learner
  // back through onboarding, which is what happened.
  const [profileError, setProfileError] = useState(null)

  // Whose profile is currently loaded. Guards against re-fetching on every
  // token refresh, which would otherwise flash the loading spinner hourly.
  const profileFor = useRef(null)

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
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
      setLoading(true)
      fetchProfile(u.id)
    })

    return () => subscription.unsubscribe()
  }, [])

  // `maybeSingle`, not `single`: single() treats "no row" as an ERROR, so a
  // brand-new user and a failed request came back identically — both as
  // `data: null` — and the route guard read either as "needs onboarding".
  // maybeSingle gives `data: null, error: null` for no row, which is the one
  // case that genuinely means new user.
  async function fetchProfile(userId, attempt = 0) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    if (error) {
      // A database that has just woken from Supabase's free-tier pause is slow
      // and flaky on its first queries, so retry before giving up.
      if (attempt < 2) {
        setTimeout(() => fetchProfile(userId, attempt + 1), 500 * (attempt + 1))
        return
      }
      console.warn('[wordy] fetchProfile FAILED (not a new user):', error.message, error.code)
      // Leave profileFor unset so a later auth event can try again, and report
      // the failure as a failure. Falling through to setProfile(null) here is
      // exactly the bug: it is indistinguishable from having no profile.
      profileFor.current = null
      setProfileError(error)
      setLoading(false)
      return
    }

    profileFor.current = userId // only once the profile has really arrived
    setProfileError(null)
    setProfile(data)            // null here genuinely means: no row yet, new user
    setLoading(false)
  }

  function retryProfile() {
    if (!user) return
    setProfileError(null)
    setLoading(true)
    fetchProfile(user.id)
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
    <AuthContext.Provider value={{ user, profile, profileError, loading, retryProfile, updateProfile, signOut, deleteAccount }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
