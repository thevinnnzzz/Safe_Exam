# Data model

All tables live in the `public` schema. Primary schema: `supabase/migrations/20260801000000_init.sql`.

## Entity-relationship overview

```
roles ──┬──< users ──┬──< students        (course_id) ──> courses ──< exams
        │            └──< teachers                     
users ──< students (student_user_id)
courses ──< exams (course_id, teacher_id)
exams ──< exam_questions ──> questions
questions ──< choices
question_bank ──< questions (question_bank_id)
users ──< student_exams (student_user_id, exam_id) ──> exams
student_exams ──< student_answers ──> questions
student_exams ──< activity_logs
student_exams ──< risk_scores
```

## Tables

### roles
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | fixed: student = `0000…0001`, teacher = `0000…0002` |
| name | text unique | `student` \| `teacher` |

### users
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| role_id | uuid FK → roles | role discriminator |
| full_name | text | |
| email | text nullable | used for teacher login |
| student_id | text nullable unique | used for student login |
| password_hash | text | bcrypt (`$2a$`/`$2b$`) |
| created_at | timestamptz | |

### students / teachers
Profiles keyed 1:1 to `users.id`.
- `students`: `student_user_id`, `course_id` (FK → courses, nullable)
- `teachers`: `teacher_user_id`

### courses
`id`, `teacher_id` (FK), `name`, `code`.

### question_bank
`id`, `teacher_id`, `name`, `description`, `created_at`.

### questions
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| question_bank_id | uuid FK nullable | |
| teacher_id | uuid FK | |
| content | text | |
| difficulty | text | `easy` \| `medium` \| `hard` |
| category | text nullable | |
| points | int | points this question awards |
| explanation | text nullable | revealed per `allow_review` |
| created_at | timestamptz | |

### choices
`id`, `question_id` (FK), `content`, `is_correct` (boolean, **REVOKEd from authenticated**), `position`.

### exams
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| teacher_id | uuid FK | |
| course_id | uuid FK nullable | |
| title | text | |
| description / instructions | text nullable | |
| start_time / end_time | timestamptz nullable | availability window |
| duration_minutes | int | |
| passing_score | int | percent to pass |
| randomize_questions / randomize_choices | boolean | |
| show_score_after | boolean | |
| allow_review | boolean | reveal answer key to students |
| auto_submit | boolean | submit on timeout |
| status | text | `draft` \| `published` \| `archived` |
| published_at | timestamptz nullable | |
| created_at / updated_at | timestamptz | |

### exam_questions
`id`, `exam_id` (FK), `question_id` (FK), `position`, `points`.

### student_exams
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| exam_id | uuid FK | unique per (exam, student) |
| student_user_id | uuid FK | |
| status | text | `not_started` \| `in_progress` \| `submitted` \| `time_up` |
| started_at / submitted_at | timestamptz nullable | |
| time_used_seconds | int | clamped to duration at submit |
| score | int nullable | server-written |
| score_percent | numeric nullable | server-written |
| passed | boolean nullable | server-written |
| current_question_index | int | |
| question_order | jsonb | frozen per-student order (possibly shuffled) |
| answers | jsonb | progress snapshot (denormalized) |
| risk_score | int | mirrored from risk_scores |
| is_online | boolean | heartbeat flag |
| last_active_at | timestamptz | used for the 45s online window |

### student_answers
Unique per `(student_exam_id, question_id)`.
| Column | Notes |
|---|---|
| choice_id | student's pick |
| is_correct | **server-written only** at grading |
| points_earned | **server-written only** at grading |
| time_spent_seconds | |

### activity_logs (append-only proctoring feed)
`id` (bigint), `student_exam_id`, `student_user_id`, `exam_id`, `event_type`, `risk_points` (server-assigned), `meta` (jsonb, e.g. `{ keys: "Ctrl+F" }`), `created_at`.

### risk_scores (denormalized aggregate)
One row per student_exam, updated atomically by `fn_log_event`:
`total_points`, `level` (`low`/`medium`/`high`), plus one counter per event type:
`tab_switches`, `fullscreen_exits`, `copy_attempts`, `paste_attempts`, `cut_attempts`, `devtools_attempts`, `refresh_attempts`, `navigate_attempts`, `find_attempts`, `print_attempts`, `save_attempts`, `zoom_attempts`, `new_tab_attempts`, `idle_events`, `idle_seconds`, `updated_at`.

## Indexes

- `users`: `student_id`, `email`
- `exams`: `teacher_id`, `status`
- `exam_questions`: `exam_id`
- `questions`: `question_bank_id`, `teacher_id`
- `choices`: `question_id`
- `student_exams`: `exam_id`, `student_user_id`, `status`
- `student_answers`: `student_exam_id`
- `activity_logs`: `student_exam_id`, `(exam_id, created_at desc)`
- `risk_scores`: `student_exam_id`

## Integrity guarantees

1. `student_exams` is unique per (exam, student) — no duplicate attempts.
2. `question_order` is stored per attempt at start time; it never changes mid-exam.
3. `student_answers` is unique per (student_exam, question); `is_correct`/`points_earned` are written only by `fn_submit_exam`.
4. `risk_scores` is a server-side aggregate of `activity_logs`; the client only *reports* event types, never points.
5. `risk_score` on `student_exams` mirrors `risk_scores.total_points` and is updated in the same transaction as each logged event.

## Migration history

| File | Purpose |
|---|---|
| `20260801000000_init.sql` | Schema, indexes, RLS policies, seed roles/users/exam |
| `20260801000001_functions.sql` | All `fn_*` SECURITY DEFINER functions |
| `20260801000002_seed.sql` | Question banks, questions, choices, courses, exam questions |
| `20260801000003_students.sql` | `fn_create_students` (teacher bulk-add students) |
| `20260801000004_keyboard_shortcuts.sql` | New proctoring event types + `risk_scores` counters |
