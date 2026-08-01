import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { decodeJwt } from 'jose'
import type { Role, UserProfile } from '@/lib/types'

const url = import.meta.env.VITE_SUPABASE_URL as string
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!url || !anonKey) {
  console.warn(
    'Supabase environment variables are missing. Copy .env.example to .env and add your project URL + anon key.',
  )
}

const SESSION_KEY = 'safe_exam.session'

export interface SessionPayload {
  token: string
  user: UserProfile
}

export interface JwtClaims {
  sub: string
  app_role: Role
  full_name: string
  student_id?: string
  email?: string
  exp: number
}

export function saveSession(payload: SessionPayload) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(payload))
  resetSupabaseClient()
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY)
  resetSupabaseClient()
}

export function getToken(): string | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null')?.token ?? null
  } catch {
    return null
  }
}

export function getStoredUser(): UserProfile | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null')?.user ?? null
  } catch {
    return null
  }
}

export function isTokenExpired(token: string): boolean {
  try {
    const claims = decodeJwt(token) as JwtClaims
    return claims.exp * 1000 <= Date.now()
  } catch {
    return true
  }
}

let client: SupabaseClient | null = null

/**
 * Returns a Supabase client authenticated with the custom JWT.
 * The client is recreated whenever the session changes.
 */
export function getSupabase(): SupabaseClient {
  const token = getToken()
  if (!client) {
    client = createClient(url, anonKey, {
      global: {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
  }
  return client
}

export function resetSupabaseClient() {
  client = null
}
