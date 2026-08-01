# Authentication

Safe Exam does **not** use Supabase Auth. It implements a custom credential check + JWT issuance flow because teachers and students log in with different identifiers (email vs. student ID) and roles.

## Flow

```
Student / Teacher
   │  { identifier, password, mode: 'student'|'teacher' }
   ▼
auth-login edge function (Deno)
   │  1. Load user from users table
   │     mode='student'  → match users.student_id = identifier
   │     mode='teacher'  → match users.email      = identifier
   │  2. Verify role matches requested mode
   │  3. bcrypt.compare(password, password_hash)   (bcryptjs)
   │  4. Sign HS256 JWT with project JWT secret
   ▼
{ token, user: { id, role, full_name, email, student_id } }
   ▼
Client stores session → attaches `Authorization: Bearer <token>` to all Supabase calls
```

Implementation: `supabase/functions/auth-login/index.ts`.

## JWT claims

```json
{
  "sub": "<user-uuid>",
  "role": "authenticated",
  "app_role": "student | teacher",
  "full_name": "...",
  "email": "...",
  "student_id": "...",
  "iat": 1785580000,
  "exp": 1785666400
}
```

- Signed **HS256** with the project's JWT secret (the legacy Supabase JWT secret), so PostgREST accepts the token and RLS can read `auth.uid()` and `auth.jwt() ->> 'app_role'`.
- `app_role` is the role gate used by every RLS policy and every `fn_*` function (`public.auth_app_role()`).
- Session lifetime: **12 hours**.

## Password storage

- Hashes are bcrypt, cost factor 10 (`gen_salt('bf',10)` in `pgcrypto`, compatible with bcryptjs).
- Teachers (seed data) and students (created via `fn_create_students`) are hashed server-side.
- bcryptjs and pgcrypto bcrypt verify against each other — verified round-trip.

## Client session handling

- `src/lib/supabase.ts` — creates the Supabase client, persists `token` + `user` in `localStorage` (`sb_token`/`sb_user`).
- `src/lib/auth.ts` — `login()`, `logout()`, `getCurrentUser()`, `AUTH_FUNCTION_URL`.
- `src/hooks/use-auth.tsx` — React context exposing the current user, login/logout, and loading state.
- `ProtectedRoute` (`src/components/common/protected-route.tsx`) blocks unauthenticated access and enforces role (`student` vs `teacher`) per route.

## Environment variables for the edge function

| Variable | Source | Notes |
|---|---|---|
| `SUPABASE_URL` | auto-injected | function runs in the same project |
| `SUPABASE_SERVICE_ROLE_KEY` | auto-injected | used to read `users` + verify via PostgREST |
| `JWT_SECRET` | **must be set manually** | `supabase secrets set JWT_SECRET=<legacy jwt secret>` |

> ⚠️ New-style Supabase projects do **not** inject `SUPABASE_JWT_SECRET` into functions (they expose `SUPABASE_SECRET_KEYS`/`SUPABASE_JWKS` instead). This project uses the **legacy JWT Secret** (HS256) via a manually-set `JWT_SECRET` secret because the anon key is HS256 and PostgREST validates against the same secret.

## Demo accounts (seed)

| Role | Identifier | Password |
|---|---|---|
| Teacher | `teacher@example.com` | `teacher123` |
| Student | `STU-2026-001` | `student123` |
| Student | `STU-2026-002` | `student123` |
| Student | `STU-2026-003` | `student123` |

Students created via the teacher UI (`fn_create_students`) get the password provided by the teacher.
