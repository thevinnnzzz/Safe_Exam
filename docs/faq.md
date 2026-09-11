# FAQ

## General

### What is Safe Exam?
A production-ready online examination system for IT instructors supporting ~50 concurrent students. It combines automatic grading, server-enforced security, live proctoring telemetry, and post-exam analytics.

### What are the two portals?
- **Student portal** (`/student`): view available exams, take timed/proctored exams, view results.
- **Teacher portal** (`/teacher`): dashboards, exam authoring, question banks, live monitor, results & CSV export, student roster management.

## Proctoring / risk scoring

### What events are detected and what are they worth?
See [risk-scoring-algorithm.md](risk-scoring-algorithm.md) for the full metric table. Highlights: DevTools +25, copy/paste +20 each, fullscreen exit / cut / refresh / print / save +15, tab switch / find / new tab / navigate / idle +10, blur / right-click / selection / zoom / warning +5.

### Does the system auto-fail students?
No. Risk scores are advisory. Levels: low < 40, medium 40–79, high ≥ 80. The teacher decides.

### Can a student hide their risk?
Points are assigned server-side from the event type in `fn_log_event`. The client only reports the event type, so it cannot report a lower point value. A scripted client could *inflate* its own risk, but not reduce it.

### What is the "online" definition?
`in_progress AND is_online AND last_active_at within 45s`. Students send `is_online: true` heartbeats during the exam; the start function also re-marks them online when they reopen the exam.

### Why does the monitor poll instead of using realtime?
Polling every 5s via TanStack Query is simpler and reliable at this scale (~50 students). Student result pages do use a realtime subscription (see `docs/realtime.md`); the monitor is a possible future optimization.

## Grading

### Who grades the exam?
The server (`fn_submit_exam`). It iterates the server-stored `question_order`, compares each answer to the stored correct choice, and writes `score`, `score_percent`, `passed`. Students never supply correct answers or scores.

### What is the pass calculation?
`score_percent = round(earned / total × 100, 2)`; `passed = score_percent >= passing_score`. Time used is clamped to the exam duration.

### Can a student see the answer key?
Only if the exam has `allow_review` enabled. Teachers always see it. `choices.is_correct` is REVOKEd from the `authenticated` role entirely.

## Authentication

### Why isn't Supabase Auth used?
The app needs per-role logins (student ID vs email) and custom claims. A custom edge function handles bcrypt verification and signs an HS256 JWT with the project's JWT secret, which PostgREST validates.

### Session length?
12 hours (`exp = iat + 12h`).

### Why set `JWT_SECRET` manually?
New-style Supabase projects don't inject `SUPABASE_JWT_SECRET` into edge functions. The project uses the legacy HS256 JWT secret (matching the anon key) set as the `JWT_SECRET` function secret.

## Data & schema

### What tables exist?
`roles`, `users`, `students`, `teachers`, `courses`, `question_bank`, `questions`, `choices`, `exams`, `exam_questions`, `student_exams`, `student_answers`, `activity_logs`, `risk_scores`. Details in [data-model.md](data-model.md).

### Are duplicate attempts possible?
No. `student_exams` is unique per (exam, student); `fn_start_exam` is idempotent and returns the existing attempt.

### Is question order stable across refreshes?
Yes. `question_order` is stored per attempt at start time (randomized only if the exam opts in) and never changes mid-exam.

## Deployment

### The edge function returns "JWT secret missing"
Set the secret and redeploy:
`supabase secrets set JWT_SECRET="..."` then `supabase functions deploy auth-login`.

### `supabase db push` says up-to-date but the schema is missing
The migration tracker is empty (project was set up via SQL editor). Use `supabase migration repair --status reverted` or insert the migration rows into `supabase_migrations.schema_migrations`.

### Where do I find the project ref / anon key?
Supabase dashboard → Settings → API: project URL, anon key, and JWT secret.

### How do I deploy the frontend?
Netlify with build `npm run build` and publish dir `dist` (`netlify.toml` handles SPA redirects). Set the three `VITE_*` env vars in Netlify.

## Feature requests / roadmap

Webcam AI proctoring, face detection, QR attendance, essay/coding questions, AI-generated quizzes, LMS integration, email notifications, printable reports, mobile app.
