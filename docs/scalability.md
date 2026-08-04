# Scalability

This document explains what the Safe Exam system needs to scale from the current ~50 concurrent students to **1,000–10,000 concurrent students**, and lists the concrete optimization tricks that have the biggest impact. It is written against the current codebase and is meant to be updated whenever capacity targets or architecture change.

## Capacity targets

| Metric | Today | Target |
|---|---|---|
| Concurrent students | ~50 | 1,000 – 10,000 |
| `student_exams` rows | ~100s | 1M+ (10 exams × 100k students) |
| `activity_logs` rows | ~10k | 10M+ (proctoring events) |
| `student_answers` rows | ~10k | 10M+ (1 answer/question/attempt) |
| Teacher monitors live | 1 | dozens, each polling 5s |

## The good news (what already scales)

- **Static frontend.** The SPA is served from a CDN (Netlify today). Static asset serving scales to effectively unlimited users with zero backend involvement.
- **Supabase is serverless.** Postgres, PostgREST, and Edge Functions (Deno) scale up automatically with compute on the plan you choose. You do not manage servers.
- **RLS is per-row.** Filtering by `auth.uid()` at the database level means no data is ever shipped to the wrong client, and PostgREST pushes filters into SQL.
- **Batching already exists.** Proctoring events queue in `localStorage` and flush in batches (`fn_log_event`), so a burst of events per student becomes a few requests.

## Where the bottlenecks actually are

For a client-rendered SPA + PostgREST, the scaling ceiling is **never the CDN** and almost never the frontend. It is:

1. **Query cost per request** — too-wide `select()`s, fetching rows to compute aggregates client-side, and missing indexes.
2. **Request volume** — teacher pages polling every 5s multiply DB load linearly with the number of open monitors.
3. **Heavy hot tables** — `activity_logs` and `student_answers` grow the fastest and are written on every student action.

Everything below attacks those three.

## 1. Database: indexes

The fastest, cheapest wins. Every query that filters or sorts by a column needs an index; without one Postgres does a sequential scan that gets linearly slower as the table grows.

### Already present (migration `00000` + `00009`)

| Index | Table | Purpose |
|---|---|---|
| `idx_users_student_id` | `users` | Student login lookup |
| `idx_users_email` | `users` | Teacher login lookup |
| `idx_exams_teacher` | `exams` | Teacher dashboard lists |
| `idx_exams_status` | `exams` | Published-exam discovery |
| `idx_exam_questions_exam` | `exam_questions` | Questions of an exam |
| `idx_questions_bank` | `questions` | Bank detail page |
| `idx_questions_teacher` | `questions` | Teacher question lists |
| `idx_choices_question` | `choices` | Choices of a question |
| `idx_se_exam` | `student_exams` | Exam submissions/roster |
| `idx_se_student` | `student_exams` | Student's own attempts |
| `idx_se_status` | `student_exams` | Status filters |
| `idx_se_exam_student` | `student_exams` | Unique retake lookup |
| `idx_sa_student_exam` | `student_answers` | Answers of an attempt |
| `idx_activity_student_exam` | `activity_logs` | Incident timeline per attempt |
| `idx_activity_exam_time` | `activity_logs` | Live activity feed (exam, time desc) |
| `idx_risk_student_exam` | `risk_scores` | Risk per attempt |

### Missing — add before scaling

| Index | Why |
|---|---|
| `create index if not exists idx_exam_access_student on public.exam_access (student_user_id);` | `examAccess` / assigned-student queries filter by student; the table has no student index today. This is the single most important missing index. |
| `create index if not exists idx_risk_exam on public.risk_scores (exam_id);` | Risk breakdown per exam (monitor, results) scans without it. |

```sql
create index if not exists idx_exam_access_student
  on public.exam_access (student_user_id);
create index if not exists idx_risk_exam
  on public.risk_scores (exam_id);
```

Apply as a new migration in `supabase/migrations/` and run `supabase db push`.

### Tips
- Index **narrow columns**, not wide ones; composite indexes for query pairs (`exam_id, created_at desc` already exists for the feed).
- Never index columns you only `select`, only ones you **filter/sort/join** on.
- Add a **partial index** for the hot filter if one value dominates:
  ```sql
  create index idx_activity_online on activity_logs (exam_id)
  where created_at > now() - interval '5 minutes';
  ```

## 2. Never `select('*')` — fetch only what the UI renders

Every unused column costs bytes over the wire and memory in Postgres. This is already done in the current codebase for the hot queries (dashboard, monitor, exam lists, student attempt list). Keep that discipline for any new query.

- `select('*')` on `student_exams` pulls `question_order` (a full randomized question array) and `answers` (a JSONB snapshot) — huge, and never needed for lists.
- The correct answer column `choices.is_correct` must stay excluded from client-visible reads (it is `REVOKE`d and only exposed via `SECURITY DEFINER` functions).

**Checklist for any new query:** explicit column list → embedded relations listed column-by-column → no `.select('*, table(*)')`.

## 3. Stop shipping rows to the client for aggregates

Today two charts fetch **all** rows and aggregate in the browser:

| Query | Cost at 10k students | Fix |
|---|---|---|
| Dashboard difficulty chart (`difficultyQuery`) | Fetches every `questions` row for a 3-bucket chart | One aggregate SQL function returning `easy/medium/hard` counts |
| Exams `countsQuery` | Fetches every `exam_questions` row to count per exam | `select('exam_id', { count: 'exact', head: true })` or a `count(*)` function |

**Rule:** if the UI only needs a number or a few buckets, compute it in SQL and ship ≤10 rows, not 10k.

## 4. Polling: the request-volume multiplier

Teacher pages poll with TanStack Query `refetchInterval`. This is the fastest way to multiply database load: **N open monitors × Q queries × 1/5s** requests.

Current state:

| Query | Interval | Status at 10k students |
|---|---|---|
| Monitor activity feed (`activityQuery`) | 5s | Heavy but real-time by design |
| Monitor per-student status (`recordsQuery`) | 5s | Heavy nested query; the core monitor need |
| Monitor assigned roster (`assignedQuery`) | **No polling** (static, `staleTime: 60_000`) | Correct already |
| Exams scoreboard (`scoresQuery`) | 5s even when **no row is expanded** | Wasteful — refetches the whole live-scores result on the list page |
| Exams `countsQuery` | polling | Wasteful (see §3) |

**Recommended changes, in order of impact:**

1. **Gate `scoresQuery` polling on expansion** — only poll while a dialog/expanded row is actually open. The list page then only loads on mount + window focus.
2. **Replace 5s polling with Supabase Realtime** for the monitor. Publish the relevant tables (`student_exams`, `activity_logs`) and subscribe on the monitor page; PostgREST keeps the initial list, then updates stream in. This turns ~4 req/s/monitor into near-zero HTTP requests and is the right tool at 1k+ students.
3. If realtime is not adopted yet, **scale the interval with the class size** (e.g. 10s for >200 students) and keep the roster query at `staleTime: 60_000`.
4. Push the **online-window logic into the query** (`last_active_at > now() - interval '45 seconds'`) instead of client-side filtering, so Postgres returns only online students and can use an index.

## 5. Authentication & the edge function

- `auth-login` (bcrypt verify + JWT sign) runs on Deno edge, which scales automatically. **bcrypt compare is CPU-bound** — at sustained peak logins (all students arriving in the same minute), consider the paid Supabase plan's compute or raising concurrency on the function.
- The JWT carries the full user identity (12h expiry) so PostgREST never re-queries `users` on every request.
- Keep the anon key client-side only; the service role key stays server-side.

## 6. Frontend & CDN

- The bundle is already split: route pages are lazy-loaded (`React.lazy` + `Suspense`) and Chart.js lives in its own chunk. Keep any new heavy dependency out of the main bundle.
- `index.html`, JS/CSS, and images are cached by the CDN. Ensure cache headers (`public, max-age=31536000, immutable`) for hashed assets; the CDN default is fine.
- No server-side rendering is needed; do not add a backend just to render HTML.

## 7. Write-path tuning (the two hottest tables)

- `activity_logs` — **append-only.** Consider partitioning by month, or at minimum archiving/rolling old exam data out of the hot table.
- `student_answers` — one row per question per attempt. Upserts are fine; keep the unique index on `(student_exam_id, question_id)` so retries don't duplicate.
- Grading (`fn_submit_exam`) loops over the server-stored `question_order`. For very long exams this is a transaction that holds a row lock; it is correct, but consider an async grading path only if a single submit ever becomes slow at scale.

## 8. Capacity plan (recommended order)

Phase 1 — **day one, no schema risk** (biggest return first):
1. Add the two missing indexes (§1).
2. Gate `scoresQuery` polling on expansion (§4).
3. Replace client-side aggregate fetches with SQL functions (§3).
4. Re-verify: `explain analyze` on `exam_access` by `student_user_id`, `risk_scores` by `exam_id`, and the monitor queries.

Phase 2 — **when a class passes a few hundred live monitors:**
5. Move the live monitor to Supabase Realtime (§4).
6. Scale polling intervals by class size as a fallback.

Phase 3 — **when `activity_logs`/`student_answers` pass ~10M rows:**
7. Partition or archive the append-only log tables (§7).
8. Review the Supabase compute tier.

## Measuring impact

For any change, verify before/after with:

```sql
explain analyze select ...;
```

Look for `Seq Scan` on hot tables (bad) → `Index Scan` (good), and watch the query plan's estimated rows vs actual rows. In the Supabase dashboard, use **Database → Query Performance** to see the slowest queries and confirm the ones we already know about disappear.

## Summary

| Lever | Effort | Impact at 1k–10k |
|---|---|---|
| Missing indexes on `exam_access` / `risk_scores` | Low | High — eliminates sequential scans |
| SQL-side aggregates instead of client-side | Low | High — kills whole-table fetches |
| Gate/grow polling intervals, prefer realtime | Low–Med | High — linear request-volume reduction |
| Column-limited selects everywhere | Low | Med — wire + memory savings |
| Partition/archive log tables | Med | Med — keeps write path fast at 10M+ rows |
| CDN + lazy-loaded bundles | Done | Keeps frontend out of the picture |
