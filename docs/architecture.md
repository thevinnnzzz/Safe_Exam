# Architecture

## System overview

Safe Exam is a client-rendered single-page application backed by Supabase. All business-critical logic (grading, risk scoring, progress updates) runs **server-side** in Postgres so students cannot tamper with scores, answer keys, or their own risk.

```
┌─────────────────────────┐         ┌─────────────────────────────────────────┐
│   React SPA (Vite)       │  HTTPS  │   Supabase                              │
│   ┌───────────────────┐  │ ──────▶ │   ┌───────────────────────────────────┐ │
│   │ Pages / UI        │  │         │   │  PostgREST (REST + RLS)           │ │
│   │ TanStack Query    │  │         │   │   ┌─────────────────────────────┐ │ │
│   │ Proctoring hook   │  │         │   │   │  Postgres (schema + RLS +   │ │ │
│   │ Auth (JWT session)│  │         │   │   │  SECURITY DEFINER functions) │ │ │
│   └───────────────────┘  │         │   │   └─────────────────────────────┘ │ │
│   Firebase-like client   │         │   └───────────────────────────────────┘ │
│   (Supabase JS)          │         │   ┌───────────────────────────────────┐ │
└─────────────────────────┘         │   │  Edge Function: auth-login         │ │
                                    │   │  (bcrypt + JWT signing)            │ │
                                    │   └───────────────────────────────────┘ │
                                    └─────────────────────────────────────────┘
```

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, TypeScript, Tailwind CSS, shadcn/ui, React Router, TanStack Query, React Hook Form + Zod, Chart.js |
| Backend | Supabase (PostgreSQL + PostgREST), Edge Functions (Deno) |
| Auth | Custom bcrypt (bcryptjs / pgcrypto) + HS256 JWT |
| Hosting | Netlify (frontend), Supabase (backend) |

## Repository layout

```
├── src/
│   ├── api/supabase-api.ts      # Typed data-access layer (studentApi / teacherApi / rpc)
│   ├── components/
│   │   ├── ui/                  # shadcn/ui primitives (button, table, dialog, …)
│   │   ├── common/              # PageHeader, badges, dialogs, loaders, stat cards
│   │   ├── features/            # student (answer-option, question-palette), teacher (charts, csv-import, question-form)
│   │   └── layout/              # student-layout, teacher-layout shells
│   ├── hooks/
│   │   ├── use-auth.tsx         # Auth context provider
│   │   └── use-proctoring.ts    # Anti-cheat engine (detection + queue + risk)
│   ├── lib/
│   │   ├── auth.ts              # login()/logout() → edge function
│   │   ├── supabase.ts          # Supabase client + session persistence
│   │   ├── risk.ts              # EVENT_POINTS, labels, riskLevel(), computeRisk()
│   │   ├── types.ts             # All shared TypeScript types
│   │   └── utils.ts             # formatting helpers (formatClock, formatDateTime, …)
│   └── pages/
│       ├── login.tsx
│       ├── student/             # dashboard, exam, result
│       └── teacher/             # dashboard, exams, exam-editor, monitor, results, result-detail, banks, bank-detail, students
├── supabase/
│   ├── migrations/              # 0000 init, 0001 functions, 0002 seed, 0003 students, 0004 keyboard shortcuts
│   └── functions/auth-login/    # custom authentication edge function
├── docs/                        # this documentation
├── .env.example
├── netlify.toml                 # SPA redirects for Netlify
└── README.md
```

## Request flow

1. **Login** — the SPA calls the `auth-login` edge function with `{ identifier, password, mode }`. The function looks up the user, verifies the bcrypt hash, and returns a signed JWT. The client stores it in `localStorage` and attaches it to every Supabase request as `Authorization: Bearer <token>`.

2. **Data access** — the Supabase JS client talks to PostgREST. Every table has Row Level Security so the JWT's `app_role` and `sub` claims decide what each user can see or write.

3. **Sensitive operations** (start exam, save answer, update progress, log event, submit/grade, result detail, teacher detail/export) go through `SECURITY DEFINER` Postgres functions (`fn_*`). These run as the table owner, enforce role + ownership, and never trust the client for scores or points.

## Data flow: student taking an exam

```
Start exam ──▶ fn_start_exam
                  │  lock exam row, validate published + window
                  │  idempotent: return existing in_progress row if present
                  │  build question_order (Fisher–Yates via ORDER BY random())
                  ▼
Fetch questions ──▶ fn_student_exam_questions   (no is_correct leaked)
                  ▼
Answer question ──▶ fn_save_answer              (upsert per question; is_correct written by grader only)
                  ▼
Heartbeat/progress ──▶ fn_update_progress       (answers snapshot, index, time, is_online)
                  ▼
Proctoring event ──▶ fn_log_event               (server assigns points → risk_scores + student_exams.risk_score)
                  ▼
Submit ──▶ fn_submit_exam                       (server grades, computes percent + passed, sets submitted)
                  ▼
View result ──▶ fn_result_detail                (reveal correct answers only if allow_review)
```

## Data flow: teacher monitoring

Teacher pages use TanStack Query with `refetchInterval` polling (monitor and exams scoreboard poll every **5s**). No websockets or realtime channels are used; polling is simpler and reliable enough for ~50 concurrent students.

- `teacherApi.examStudentRecords()` → per-student status, online flag, last_active_at, progress.
- `teacherApi.examRiskScores()` → aggregated risk breakdown per student.
- `teacherApi.recentActivity()` → latest activity_logs for the live feed.

**Online definition** — a student is shown as online when:

```
status === 'in_progress'
AND is_online === true
AND last_active_at is within ONLINE_WINDOW_MS (45 000 ms) of now
```

## Key design decisions

1. **Server-side grading** — students never send correct answers, scores, or `is_correct`. Grading loops over the server-stored `question_order`.
2. **Server-assigned risk points** — `fn_log_event` maps event type → points; clients can't under-report. Points accumulate in `risk_scores` (denormalized) and are mirrored onto `student_exams.risk_score`.
3. **Idempotent exam start** — re-opening an exam returns the existing attempt rather than creating a duplicate, and flips the student back to online.
4. **Reliable event delivery** — proctoring events queue in `localStorage` and flush in batches, so a refresh/tab-switch doesn't lose incidents. Failed sends are re-queued and retried.
5. **Per-student question order** — `question_order` is frozen at start, so a refresh cannot change the order mid-exam.
6. **Autosave** — answers save immediately per question; progress snapshots on an interval and on unmount/submit.
