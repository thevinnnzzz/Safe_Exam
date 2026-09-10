import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { UserProfile } from '@/lib/types'
import { clearSession, getStoredUser, getToken, isTokenExpired } from '@/lib/supabase'
import { SESSION_TAKEN_MESSAGE, isSessionTakenError, login as loginRequest, logout as logoutRequest, type LoginCredentials } from '@/lib/auth'
import { studentApi } from '@/api/supabase-api'

interface AuthContextValue {
  user: UserProfile | null
  isLoading: boolean
  /** Set when this device was signed out because the account logged in elsewhere. */
  takeover: string | null
  clearTakeover: () => void
  login: (credentials: LoginCredentials) => Promise<UserProfile>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

// How often a signed-in student re-validates ownership of the single session.
const SESSION_CHECK_MS = 60_000

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(() => {
    const stored = getStoredUser()
    if (stored) {
      const token = getToken()
      if (token && !isTokenExpired(token)) return stored
      clearSession()
    }
    return null
  })
  const [isLoading, setIsLoading] = useState(true)
  const [takeover, setTakeover] = useState<string | null>(null)
  const userRef = useRef(user)
  userRef.current = user

  useEffect(() => {
    const token = getToken()
    if (token && isTokenExpired(token)) {
      clearSession()
      setUser(null)
    }
    setIsLoading(false)
  }, [])

  // Single-session enforcement (students only): if this account signs in on
  // another device, the backend invalidates this one — sign out here so the
  // old device cannot keep browsing or taking exams.
  useEffect(() => {
    if (!user || user.role !== 'student') return
    let cancelled = false
    let interval: number | null = null

    const check = async () => {
      // Skip while logged out / switched user mid-flight.
      if (!userRef.current || userRef.current.role !== 'student') return
      let status: { valid: boolean; reason?: string }
      try {
        status = await studentApi.sessionStatus()
      } catch (err) {
        // RPC-level failures (e.g. SESSION_TAKEN raised as an error, or the
        // function missing pre-migration) — only force logout on takeover.
        if (isSessionTakenError(err)) {
          status = { valid: false, reason: SESSION_TAKEN_MESSAGE }
        } else {
          return
        }
      }
      if (!cancelled && !status.valid) {
        clearSession()
        setUser(null)
        setTakeover(status.reason ?? SESSION_TAKEN_MESSAGE)
      }
    }

    void check()
    interval = window.setInterval(() => void check(), SESSION_CHECK_MS)
    const onFocus = () => void check()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void check()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      if (interval !== null) window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [user?.id, user?.role])

  const login = useCallback(async (credentials: LoginCredentials) => {
    const payload = await loginRequest(credentials)
    setTakeover(null)
    setUser(payload.user)
    return payload.user
  }, [])

  const logout = useCallback(() => {
    logoutRequest()
    setUser(null)
  }, [])

  const clearTakeover = useCallback(() => setTakeover(null), [])

  const value = useMemo(
    () => ({ user, isLoading, takeover, clearTakeover, login, logout }),
    [user, isLoading, takeover, clearTakeover, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider')
  return context
}
