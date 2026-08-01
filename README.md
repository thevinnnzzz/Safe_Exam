# Safe Exam — Online Examination System

A production-ready, secure, responsive web application for running proctored online exams. Built for IT instructors supporting ~50 concurrent students, with live monitoring, anti-cheating telemetry, automatic grading, and detailed post-exam analytics.

## Highlights

- **Student + teacher portals** with role-based access
- **Custom authentication** — Student ID + password for students, email + password for teachers. Passwords hashed with **bcrypt**; sessions use **signed JWTs** verified by Supabase/PostgREST.
- **Exam engine** — scheduled availability, duration, passing score, question/choice randomization, flag-for-review, question palette, countdown timer, auto-submit on time-out.
- **Auto-save** — every answer is saved immediately (optimistic UI), progress + remaining time are snapshotted, and nothing is lost on refresh.
- **Anti-cheating monitoring** — detects tab switches, window blur, fullscreen exits, copy/paste/cut, right-click, text selection, DevTools shortcuts (F12, Ctrl+Shift+I), and 3-minute idle. Every event is timestamped, stored server-side with risk points, and rolled into a **risk score** (low / medium / high). The system **never auto-fails** a student.
- **Teacher dashboard** — live stats (online / finished / remaining, avg/high/low score, avg risk), charts (submission timeline, difficulty, time used, risk distribution), recent activity and a live events feed.
- **Live monitor** — per-student status (online / offline / finished / suspicious), current question, progress, time remaining, risk score.
- **Results & analytics** — scores, percentages, time used, risk breakdown, incident timeline, full answer review, and **CSV export**.
- **Question banks + CSV import** — reusable banks, full MC question CRUD, bulk import.
- **Security** — Row Level Security everywhere, correct answers never exposed to the client (column-level `REVOKE` + `SECURITY DEFINER` functions), server-side grading, immutable server-assigned risk points.
- **UI** — clean academic white theme with a blue accent, dark mode, responsive, accessible (shadcn/ui).

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, TypeScript, Tailwind CSS, shadcn/ui, React Router, TanStack Query, React Hook Form + Zod, Chart.js |
| Backend | Supabase (PostgreSQL + PostgREST), Row Level Security, Edge Functions |
| Auth | Custom bcrypt + HS256 JWT (signed with the Supabase JWT secret) |
| Hosting | Netlify (frontend) + Supabase (backend) |

## Repository layout

```
├── src/
│   ├── api/                 # Typed data-access layer (student & teacher)
│   ├── components/
│   │   ├── ui/              # shadcn/ui primitives
│   │   ├── common/          # Shared layout/UI helpers
│   │   ├── features/        # Feature-specific components
│   │   └── layout/          # Teacher & student shells
│   ├── hooks/               # Auth context, proctoring (anti-cheat), etc.
│   ├── lib/                 # Supabase client, JWT session, risk engine, utils
│   └── pages/               # Route-level pages (auth, student, teacher)
├── supabase/
│   ├── migrations/          # Schema + RLS + functions + seed data
│   └── functions/auth-login/# Custom authentication edge function
├── docs/example-questions.csv
├── .env.example
├── netlify.toml
└── README.md
```

## Getting started

### 1. Create a Supabase project

1. Sign up at [supabase.com](https://supabase.com) and create a new project.
2. Copy the project URL and anon key (Settings → API).
3. Deploy the schema and seed data. Easiest way — run these files in the **SQL Editor** in order:
   - `supabase/migrations/20260801000000_init.sql`
   - `supabase/migrations/20260801000001_functions.sql`
   - `supabase/migrations/20260801000002_seed.sql`

   Alternatively, with the [Supabase CLI](https://supabase.com/docs/guides/cli) and the repo linked:
   ```bash
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```

### 2. Deploy the auth edge function

```bash
supabase functions deploy auth-login
```

The function verifies credentials with bcrypt and signs the JWT using the project JWT secret, so PostgREST accepts it and RLS sees the `app_role` claim.

### 3. Configure the frontend

```bash
cp .env.example .env
```

Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

### 4. Run locally

```bash
npm install
npm run dev
```

## Demo accounts (from seed data)

| Role | Identifier | Password |
|---|---|---|
| Teacher | `teacher@example.com` | `teacher123` |
| Student | `STU-2026-001` | `student123` |
| Student | `STU-2026-002` | `student123` |
| Student | `STU-2026-003` | `student123` |

The seed includes a published **CS101 Midterm** exam with 10 questions.

## Deploying to Netlify

1. Push the repo to GitHub and add it to Netlify (New site from Git).
2. Build command: `npm run build` · Publish directory: `dist` (already configured in `netlify.toml`).
3. Add environment variables in Netlify → Site settings → Environment variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_SUPABASE_FUNCTIONS_URL`
4. Deploy. The included `netlify.toml` handles SPA redirects.

## Authentication & security model

- Credentials are checked by the `auth-login` edge function against bcrypt hashes in `users`.
- On success the function returns a JWT (`HS256`, signed with the project JWT secret) with claims:
  ```json
  { "sub": "<user-uuid>", "role": "authenticated", "app_role": "student|teacher",
    "full_name": "...", "student_id": "...", "exp": "..." }
  ```
- The frontend attaches it to every Supabase request. PostgREST exposes it to RLS via `auth.uid()` and `auth.jwt()`.
- **Students can only read/write their own** exam attempts, answers, activity logs, and risk scores. Teachers can read all records for their own exams.
- The correct answer column (`choices.is_correct`) is `REVOKE`d from the `authenticated` role. Only `SECURITY DEFINER` functions (running as the table owner) expose it, after verifying `app_role`.
- **Grading happens server-side** (`fn_submit_exam`); students can never supply their own score or the answer key.
- **Risk points are assigned server-side** (`fn_log_event`) from the event type, so clients cannot under-report incidents.

## Anti-cheating events & risk points

| Event | Points |
|---|---|
| Tab switch | +10 |
| Fullscreen exit | +15 |
| Copy / paste attempt | +20 each |
| Cut attempt | +15 |
| DevTools shortcut (F12, Ctrl+Shift+I…) | +25 |
| Idle 3 minutes | +10 |
| Window blur / right-click / selection / warning | +5 |

Risk levels: **Low** < 40 · **Medium** 40–79 · **High** ≥ 80. Risk scores are advisory only.

## CSV import format

`docs/example-questions.csv` shows the expected format:

```
question,choice_a,choice_b,choice_c,choice_d,correct,difficulty,category,points,explanation
```

- `correct` is a letter (`A`–`D`) or the exact text of the right choice.
- `difficulty` is `easy | medium | hard` (defaults to `medium`).

## Database tables

`roles`, `users`, `students`, `teachers`, `courses`, `question_bank`, `questions`, `choices`, `exams`, `exam_questions`, `student_exams`, `student_answers`, `activity_logs`, `risk_scores`.

Key integrity guarantees:

- `student_exams` unique per (exam, student) with a server-generated randomized question order.
- `student_answers` unique per (student_exam, question), correct/points only written by the grader.
- `risk_scores` aggregates `activity_logs` (append-only, server-assigned points).

## Commands

```bash
npm run dev        # start dev server
npm run build      # typecheck + production build
npm run lint       # oxlint
npm run preview    # preview the production build
```

## Roadmap (nice-to-haves)

Webcam AI proctoring, face detection, QR-code attendance, essay/coding questions, AI-generated quizzes, LMS integration, email notifications, printable reports, mobile app.

## License

MIT — use freely for teaching and learning.
