# Security model

Safe Exam relies on defense-in-depth: **RLS** on every table, **SECURITY DEFINER** functions for sensitive operations, **column-level REVOKEs** for the answer key, and **server-side** enforcement of grades and risk points.

## 1. Role gate: `auth_app_role()`

Every function begins with:

```sql
if public.auth_app_role() <> 'student' then raise exception 'Forbidden'; end if;
```

`auth_app_role()` reads the `app_role` claim from the JWT (`auth.jwt() ->> 'app_role'`), which the `auth-login` edge function signs. PostgREST validates the token signature before RLS/functions run, so the claim can't be forged.

## 2. Row Level Security

RLS is enabled on all data tables. Policies:

**Students** (via `auth.uid()`):
- Can read/write **only their own** `student_exams`, `student_answers`, `activity_logs`, `risk_scores` (join on `student_user_id = auth.uid()`).
- Can read only their own `exams`/`questions`/`choices` **through the start/fetch flow** (correct answers stripped).

**Teachers** (via `auth.uid()`):
- Can read/write rows where `teacher_id = auth.uid()` (exams, courses, question banks, questions).
- Can read `student_exams`, `student_answers`, `activity_logs`, `risk_scores` for **their own exams** (join on exam → teacher_id).

**Public/anon:** no access (all policies target `authenticated`).

## 3. Column-level REVOKE (the answer key)

```sql
revoke select on public.choices (is_correct) from authenticated;
```

`is_correct` is never exposed through PostgREST. Only `SECURITY DEFINER` functions (running as the table owner) may read it, and only after verifying role + ownership:

- `fn_teacher_exam_detail` / `fn_teacher_bank_questions` → teachers see correct answers.
- `fn_student_exam_questions` → students get choices **without** `is_correct`.
- `fn_result_detail` → correct answers/explanations only when the caller is the teacher, or the student's exam has `allow_review`.

## 4. SECURITY DEFINER functions

`src/migrations/20260801000001_functions.sql` defines all `fn_*` functions as `SECURITY DEFINER` with `set search_path = public, pg_temp` (search-path hardening). They run as the table owner and:

- validate `auth_app_role()` **and** ownership of the target row,
- reject actions on other users' rows,
- never trust client-supplied scores, points, or correct answers.

Examples:

| Function | Guard |
|---|---|
| `fn_start_exam` | student; exam published + within window; row locked |
| `fn_student_exam_questions` | student; owns the attempt |
| `fn_save_answer` | student; attempt `in_progress` |
| `fn_update_progress` | student; owns the attempt |
| `fn_log_event` | student; owns the attempt; **points from server-side CASE** |
| `fn_submit_exam` | student; owns the attempt; not already submitted |
| `fn_result_detail` | student owns, or teacher owns the exam |
| `fn_teacher_exam_detail` / `fn_export_results` | teacher owns the exam |
| `fn_create_students` | teacher; server-side bcrypt hashing |

## 5. Server-side integrity invariants

1. **Grading** — `fn_submit_exam` recomputes correctness from stored questions/choices. Students never supply `is_correct` or scores.
2. **Risk points** — `fn_log_event` maps `event_type → points` server-side. A client cannot log a lower point value, and can't mark its own events as 0.
3. **Autosave safety** — `fn_save_answer` writes `is_correct = null`; only the grader may set correctness.
4. **No duplicate attempts** — `student_exams` unique per (exam, student); `fn_start_exam` returns the existing row.
5. **Time clamp** — submitted `time_used_seconds` is `least(reported, duration)`.
6. **Idempotent submit** — already-submitted attempts are rejected.

## 6. Authentication security

- Passwords stored as **bcrypt** hashes (never plaintext).
- JWT signed with the project's **HS256 JWT secret**; validated by PostgREST on every request.
- Sessions expire after **12 hours**.
- The edge function only returns a token if the role matches the requested mode and bcrypt verifies.

## 7. Client-side hardening (advisory)

- Proctoring blocks and records: devtools, copy/paste/cut, selection, right-click, refresh, back/forward nav, find, print, save, zoom, new tab, tab switch, window blur, fullscreen exit, 3-minute idle.
- These are **deterrents, not guarantees** — a determined student can bypass browser events. Server-side grading and RLS are the real integrity backstops.

## 8. Remaining risks / notes

- **Not tamper-proof against scripted attacks** — an attacker with the JWT could call `fn_log_event` repeatedly (raising only their own score). Consider rate-limiting or CAPTCHA if that becomes a concern.
- **No input beyond MCQs** — essay/typed answers would need additional sanitization (they're on the roadmap).
- `.env.example` currently contains real project credentials from the development copy — restore placeholder values before sharing.
