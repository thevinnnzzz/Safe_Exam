import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { UserProfile } from '@/lib/types'
import { clearSession, getStoredUser, getToken, isTokenExpired } from '@/lib/supabase'
import { login as loginRequest, logout as logoutRequest, type LoginCredentials } from '@/lib/auth'

interface AuthContextValue {
  user: UserProfile | null
  isLoading: boolean
  login: (credentials: LoginCredentials) => Promise<UserProfile>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

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

  useEffect(() => {
    const token = getToken()
    if (token && isTokenExpired(token)) {
      clearSession()
      setUser(null)
    }
    setIsLoading(false)
  }, [])

  const login = useCallback(async (credentials: LoginCredentials) => {
    const payload = await loginRequest(credentials)
    setUser(payload.user)
    return payload.user
  }, [])

  const logout = useCallback(() => {
    logoutRequest()
    setUser(null)
  }, [])

  const value = useMemo(() => ({ user, isLoading, login, logout }), [user, isLoading, login, logout])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider')
  return context
}
