// Custom authentication for the Online Examination System.
//
// Verifies a Student ID + password (students) or email + password (teachers),
// compares against a bcrypt hash, and returns a signed JWT that the frontend
// attaches to every Supabase request.
//
// The JWT is signed with the project's JWT secret so PostgREST accepts it and
// exposes the claims to RLS via auth.uid() / auth.jwt() ->> 'app_role'.
//
// Deploy:  supabase functions deploy auth-login
import { createClient } from 'npm:@supabase/supabase-js@^2.45.0'
import bcrypt from 'npm:bcryptjs@^2.4.3'

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const jwtSecret = Deno.env.get('JWT_SECRET') ?? Deno.env.get('SUPABASE_JWT_SECRET') ?? ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function signJwt(payload: Record<string, unknown>): Promise<string> {
  const encoder = new TextEncoder()
  const header = { alg: 'HS256', typ: 'JWT' }
  const headerB64 = base64url(encoder.encode(JSON.stringify(header)))
  const payloadB64 = base64url(encoder.encode(JSON.stringify(payload)))
  const data = `${headerB64}.${payloadB64}`
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(jwtSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
  return `${data}.${base64url(new Uint8Array(signature))}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ message: 'Method not allowed' }, 405)

  try {
    if (!jwtSecret) return json({ message: 'Server misconfiguration: JWT secret missing.' }, 500)

    const body = await req.json().catch(() => ({}))
    const { identifier, password, mode } = body as {
      identifier?: string
      password?: string
      mode?: string
    }

    if (!identifier || !password || !mode) {
      return json({ message: 'Student ID / email, password and role are required.' }, 400)
    }
    if (mode !== 'student' && mode !== 'teacher') {
      return json({ message: 'Invalid role.' }, 400)
    }

    const supabase = createClient(supabaseUrl, serviceKey)

    const query = supabase
      .from('users')
      .select('id, full_name, email, student_id, password_hash, role_id, roles!inner(name)')
      .limit(1)

    const filtered =
      mode === 'student' ? query.eq('student_id', identifier) : query.eq('email', identifier)

    const { data, error } = await filtered.maybeSingle()
    if (error) return json({ message: 'Authentication service error.' }, 500)

    const user = data as
      | { id: string; full_name: string; email: string | null; student_id: string | null; password_hash: string; roles: { name: string } }
      | null

    if (!user) return json({ message: 'Invalid credentials.' }, 401)

    const role = user.roles?.name
    if (role !== mode) return json({ message: 'Invalid credentials.' }, 401)

    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) return json({ message: 'Invalid credentials.' }, 401)

    const now = Math.floor(Date.now() / 1000)
    const claims = {
      sub: user.id,
      role: 'authenticated',
      app_role: role,
      full_name: user.full_name,
      email: user.email ?? undefined,
      student_id: user.student_id ?? undefined,
      iat: now,
      exp: now + 60 * 60 * 12, // 12h session
    }

    const token = await signJwt(claims)

    return json(
      {
        token,
        user: {
          id: user.id,
          role,
          full_name: user.full_name,
          email: user.email,
          student_id: user.student_id,
        },
      },
      200,
    )
  } catch (err) {
    console.error('auth-login error', err)
    return json({ message: 'Unexpected error.' }, 500)
  }
})
