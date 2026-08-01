# API reference

Two surfaces: **Postgres RPC functions** (`fn_*`, called via PostgREST `/rest/v1/rpc/<fn>`) and the **typed client layer** (`src/api/supabase-api.ts`).

All RPC functions are `SECURITY DEFINER` and validate `auth_app_role()` + ownership.

## RPC functions (Postgres)

### Student

| Function | Args | Returns | Purpose |
|---|---|---|---|
| `fn_start_exam` | `p_exam_id uuid` | `student_exams` row (jsonb) | Start/idempotent re-open; randomizes question order |
| `fn_student_exam_questions` | `p_student_exam_id uuid` | question list (jsonb) | Fetch questions **without** `is_correct` |
| `fn_save_answer` | `p_student_exam_id uuid`, `p_question_id uuid`, `p_choice_id uuid`, `p_time_spent int` | void | Autosave per answer (upsert) |
| `fn_update_progress` | `p_student_exam_id uuid`, `p_payload jsonb` | void | Snapshot answers/index/time + online heartbeat |
| `fn_log_event` | `p_student_exam_id uuid`, `p_event_type text`, `p_meta jsonb` | logged row (jsonb) | Record proctoring event; server assigns points |
| `fn_submit_exam` | `p_student_exam_id uuid`, `p_answers jsonb`, `p_time_used int` | updated row (jsonb) | Server-side grading + submit |
| `fn_result_detail` | `p_student_exam_id uuid` | result bundle (jsonb) | Full result; reveal gated by `allow_review` |

### Teacher

| Function | Args | Returns | Purpose |
|---|---|---|---|
| `fn_teacher_exam_detail` | `p_exam_id uuid` | `{ exam, questions }` (jsonb) | Exam + questions + correct answers |
| `fn_teacher_bank_questions` | `p_bank_id uuid` | question list (jsonb) | Bank questions + correct answers |
| `fn_result_detail` | `p_student_exam_id uuid` | result bundle (jsonb) | Same function, teacher always sees answers |
| `fn_export_results` | `p_exam_id uuid` | rows (jsonb) | Compact CSV export payload |
| `fn_create_students` | `p_students jsonb` | per-row results (jsonb) | Bulk-create student accounts (server-side bcrypt) |

## Client API layer (`src/api/supabase-api.ts`)

### `studentApi`

| Method | Backend | Notes |
|---|---|---|
| `availableExams()` | `exams` (published) + course | student's available exams |
| `myExamAttempts()` | `student_exams` + exam | history |
| `startExam(examId)` | `fn_start_exam` | |
| `fetchExamQuestions(studentExamId)` | `fn_student_exam_questions` | |
| `saveAnswer(...)` | `fn_save_answer` | |
| `updateProgress(...)` | `fn_update_progress` | |
| `logEvent(...)` | `fn_log_event` | |
| `submitExam(...)` | `fn_submit_exam` | |
| `getResult(...)` | `fn_result_detail` | |
| `myActivity(studentExamId)` | `activity_logs` (own) | last 100 events |
| `myAnswers(studentExamId)` | `student_answers` (own, no correctness) | |
| `exam(id)` | `exams` | |

### `teacherApi`

| Method | Backend | Notes |
|---|---|---|
| `courses()` | `courses` | |
| `exams()` / `exam(id)` | `exams` + course | |
| `createExam` / `updateExam` / `deleteExam` / `publishExam` | `exams` | |
| `examDetail(id)` | `fn_teacher_exam_detail` | |
| `banks()` / `createBank` / `deleteBank` | `question_bank` + count | |
| `bankQuestions(bankId)` | `fn_teacher_bank_questions` | |
| `createQuestion` / `updateQuestion` / `replaceChoices` / `deleteQuestion` | `questions`, `choices` | |
| `setExamQuestions(examId, qids, points)` | `exam_questions` | delete+insert |
| `examStudentRecords(examId)` | `student_exams` + student | monitor rows |
| `examRiskScores(examId)` | `risk_scores` | |
| `recentActivity(examId, limit)` | `activity_logs` | live feed |
| `questionBatch(qids)` | `questions` | |
| `teacherStudents()` | `users` + `students` + `courses` | student roster |
| `createStudents(rows)` | `fn_create_students` | |
| `resultDetail(studentExamId)` | `fn_result_detail` | |
| `exportResults(examId)` | `fn_export_results` | |

### `rpc<T>(fn, args)` helper

Generic wrapper that throws on PostgREST error and casts the result.

## Authentication endpoint

`POST /functions/v1/auth-login`

```json
{ "identifier": "STU-2026-001", "password": "student123", "mode": "student" }
```

→ `{ token, user: { id, role, full_name, email, student_id } }`

## HTTP/query conventions

- All PostgREST calls use the **anon key** as `apikey` + the custom JWT as `Authorization: Bearer`.
- Read paths that don't need the answer key use plain table selects (RLS-filtered).
- Mutations that must enforce integrity use RPC (SECURITY DEFINER).
- Teacher monitoring pages use TanStack Query `refetchInterval` (5s) — no realtime channels.
