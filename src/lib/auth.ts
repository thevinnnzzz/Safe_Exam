import type { AuthResponse, UserProfile } from '@/lib/types'
import { clearSession, getDeviceId, saveSession, getStoredUser } from '@/lib/supabase'

export const AUTH_FUNCTION_URL = `${
  import.meta.env.VITE_SUPABASE_FUNCTIONS_URL ?? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
}/auth-login`

export type LoginMode = 'student' | 'teacher'

export interface LoginCredentials {
  identifier: string
  password: string
  mode: LoginMode
  device_id?: string
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

export async function login(credentials: LoginCredentials): Promise<AuthResponse> {
  let response: Response
  try {
    response = await fetch(AUTH_FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ ...credentials, device_id: credentials.device_id ?? getDeviceId() }),
    })
  } catch {
    throw new AuthError('Cannot reach the authentication service. Please try again.')
  }

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { message?: string }
    throw new AuthError(data.message ?? 'Invalid credentials.')
  }

  const payload = (await response.json()) as AuthResponse
  saveSession(payload)
  return payload
}

export function logout() {
  clearSession()
}

/** True when a backend error means this device lost the single-session race. */
export function isSessionTakenError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '')
  return /SESSION_TAKEN|another device/i.test(message)
}

export const SESSION_TAKEN_MESSAGE =
  'This account signed in on another device. You have been signed out.'

export function getCurrentUser(): UserProfile | null {
  return getStoredUser()
}
