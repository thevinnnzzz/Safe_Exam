# Deployment & operations

## Requirements

- Node.js 20+ and npm
- A Supabase project
- Supabase CLI (optional, recommended for migrations)

## Environment variables

Copy `.env.example` → `.env` and fill in:

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | anon key (Settings → API) |
| `VITE_SUPABASE_FUNCTIONS_URL` | `https://<project-ref>.supabase.co/functions/v1` (base URL; the client appends `/auth-login`) |

## Backend setup (Supabase)

### 1. Apply migrations

With the CLI (recommended):

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

Or run the SQL files in order in the Dashboard → SQL Editor:
`20260801000000_init.sql` → `0001_functions.sql` → `0002_seed.sql` → `0003_students.sql` → `0004_keyboard_shortcuts.sql`

### 2. Deploy the auth edge function

```bash
supabase functions deploy auth-login
```

### 3. Set the JWT secret for the function

New-style Supabase projects do **not** inject `SUPABASE_JWT_SECRET` into functions. Set the legacy secret manually:

```bash
supabase secrets set JWT_SECRET="<your-project-legacy-jwt-secret>"
```

Where can you find it? In many dashboards it's the legacy JWT Secret / JWT Secret from the API settings. Because the anon key is HS256-signed, PostgREST validates tokens signed with this same secret.

### 4. Verify

- Student login returns HTTP 200 with a token.
- PostgREST accepts the token (RLS works).
- `choices.is_correct` is not exposed to authenticated requests (returns `[]` when selected directly).

## Frontend setup

```bash
npm install
cp .env.example .env   # fill values
npm run dev            # local dev
npm run build          # typecheck + production build
```

## Deploying to Netlify

1. Push the repo to GitHub and add it to Netlify ("New site from Git").
2. Build settings (already in `netlify.toml`): build command `npm run build`, publish directory `dist`.
3. Add environment variables in Netlify → Site settings → Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_FUNCTIONS_URL`.
4. `netlify.toml` handles SPA redirects (`/* → /index.html`).

## Commands

```bash
npm run dev        # start dev server
npm run build      # typecheck + build
npm run lint       # oxlint
npm run preview    # preview production build
```

## Monitoring & checks

- **Live monitor page** (`/teacher/exams/:id/monitor`) polls every 5s; shows online/offline/suspicious status, current question, progress, time remaining, and risk.
- **Live scoreboard** (`/teacher/exams`) shows submitted students' scores, average per exam, and per-student risk, refreshing every 5s.
- **Results page** (`/teacher/exams/:id/results`) offers CSV export via `fn_export_results`.

## Operational notes

- **Migration tracking:** migrations are recorded in `supabase_migrations.schema_migrations`. If a project was set up by running SQL manually, `db push` may say "up to date" while the tracker is empty — insert the migration rows manually or use `supabase migration repair`.
- **Online window:** students appear offline after 45s without a heartbeat (`ONLINE_WINDOW_MS`). If the timer looks aggressive, adjust the constant in `monitor.tsx` and the dashboard.
- **Rate limiting:** `fn_log_event` has no rate limit; a scripted client could inflate its own risk score. Add throttling if needed.
- **Credential hygiene:** don't commit real keys — restore `.env.example` to placeholder values before sharing the repo.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Login 500 "JWT secret missing" | `JWT_SECRET` not set | `supabase secrets set JWT_SECRET=...` + redeploy |
| Login 500 "Authentication service error" | service role key not available / DB error | check function logs in Supabase dashboard |
| `db push` "up to date" but schema missing | migration tracker empty | `supabase migration repair --status reverted` or insert rows |
| 401 on RPC | token missing/expired | re-login (12h session) |
| Chart crash on `/teacher` | Chart.js registers missing | ensure `import '@/lib/chartjs'` in chart pages |
