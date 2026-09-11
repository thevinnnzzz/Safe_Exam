# Realtime (students)

Student pages update without manual refresh through a deliberately small
realtime footprint, designed to stay inside Supabase **Free-tier quotas**
(200 concurrent connections, 100 messages/sec) at ~500 students.

## What is live, and how

| Surface | Mechanism | Freshness | Cost |
|---|---|---|---|
| Result page (`/student/result/:id`) | One websocket, one `postgres_changes` binding: `UPDATE` on `student_exams` filtered to the open attempt id. Any change (manual grade, auto-grade re-run) refetches the result + toasts "Your grade was updated". | Instant | ~1 message per grading action; sockets only while results are open (dozens concurrent) |
| Dashboard + history | **No socket.** React Query `refetchInterval: 30_000` (auto-pauses on hidden tabs). Teacher publishes/assignments appear within ~30s. | ≤ 30s | ~17 req/s at 500 students of cheap indexed reads |
| Exam-taking page | Nothing. No socket, no polling. | N/A | Zero risk to live exams |

Teacher monitor/scoreboard intentionally stay on 5s polling (unchanged).

## Why not full realtime everywhere?

~500 idle student sockets would sit at/over the Free plan's 200-concurrent cap
during synchronized peaks, and over-cap sockets are rejected (degrading to
refresh behavior anyway). Scoping realtime to the result page keeps peak
concurrency in the dozens. Moving to Pro ($25/mo, 500 concurrent) would allow
full realtime; the hook (`src/hooks/use-realtime.ts`) is written so the
dashboard/history subscription is a ~10-line addition.

## Critical implementation detail: custom-JWT auth

This project signs its own JWTs (no supabase-auth session), so the realtime
socket **must** be handed the student's token explicitly via
`realtime.setAuth(token)` before subscribing. Without it the socket
authenticates as `anon` and RLS (`to authenticated`) silently delivers
nothing — no error, just no events. See `useAttemptRealtime`.

## Backend requirements

- Migration `20260801000020_student_realtime.sql`:
  `student_exams` is `REPLICA IDENTITY FULL` (UPDATE events need row identity
  through RLS) and a member of the `supabase_realtime` publication
  (guarded, re-runnable).
- RLS unchanged: deliveries are filtered by the existing student SELECT
  policies, so a student only ever receives their own rows.
- Failure mode is always today's behavior: dropped sockets / rejected
  connections just mean "refresh to see changes" — realtime can never corrupt
  state because handlers only *invalidate* React Query keys (refetch), never
  write cache data directly.

## Ops runbook

- Watch usage: Supabase dashboard → Reports → Realtime (Connected Clients,
  messages/sec). Expected: small tens of sockets, single-digit msg/s peaks.
- If connections approach the plan cap: sockets get rejected with 429/too-many
  errors — students fall back to refresh; consider Pro or narrower scoping.
- Throttle guard: handlers refetch at most once per event; grading actions are
  human-paced, so no burst control is needed today. If broadcasts ever fan out
  widely, add 0–3s jitter before refetch (same pattern as the teacher publish
  flow).
- Deploy note: `supabase db push` for the migration; no edge-function or RLS
  changes required.
