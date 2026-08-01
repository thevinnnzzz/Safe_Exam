# Exam workflow & grading algorithm

This page documents the full lifecycle of an exam attempt and the exact server-side grading algorithm.

## Lifecycle

```
not_started ──(start)──▶ in_progress ──(submit)──▶ submitted
                                      └──(time out)──▶ time_up ──(auto_submit)──▶ submitted
```

## 1. Start — `fn_start_exam`

Input: `p_exam_id`. Runs as the caller (must be `student`).

1. `SELECT ... FOR UPDATE` locks the exam row.
2. Validates: exam exists, `status = 'published'`, `start_time <= now()`, `end_time >= now()`.
3. **Idempotency:** if a `student_exams` row already exists for (exam, student), it flips `is_online = true, last_active_at = now()` and returns the existing row — no duplicate attempts, safe to re-open.
4. Builds question order:
   - Collect question IDs ordered by `exam_questions.position`.
   - If `randomize_questions`: shuffle with `ORDER BY random()` (Postgres Fisher–Yates variant).
   - Order is stored as JSONB in `student_exams.question_order` (frozen per attempt).
5. Inserts the attempt row (`status = 'in_progress'`, `started_at = now()`), logs a `started` activity event (0 points).

## 2. Fetch questions — `fn_student_exam_questions`

- Validates caller owns the attempt.
- Returns the questions **in `question_order` order** with their choices.
- `choices` expose `id`, `content`, `position` — **never `is_correct`** for students.

## 3. Answer autosave — `fn_save_answer`

Input: `p_student_exam_id`, `p_question_id`, `p_choice_id`, `p_time_spent`.

- Validates role + active (`in_progress`) session.
- UPSERT into `student_answers` keyed by `(student_exam_id, question_id)`.
- `is_correct` and `points_earned` are written as `null` — only the grader may set them.

## 4. Progress & heartbeat — `fn_update_progress`

Input: `p_student_exam_id`, `p_payload` (JSONB).

- Updates `answers` snapshot, `current_question_index`, `time_used_seconds` (clamped ≥ 0), `is_online`, and always refreshes `last_active_at = now()`.
- Called periodically by the client (heartbeat) and on submit.

## 5. Proctoring events — `fn_log_event`

Documented fully in [risk-scoring-algorithm.md](risk-scoring-algorithm.md). Server assigns points from the event type and updates `risk_scores` + `student_exams.risk_score`.

## 6. Submit + grading — `fn_submit_exam`

Input: `p_student_exam_id`, `p_answers` (JSONB: `{ question_id: choice_id }`), `p_time_used`.

1. Validates caller owns the attempt and status is `in_progress` or `time_up`.
2. Loads the exam (for `duration_minutes`, `passing_score`, `allow_review`).
3. Iterates the server-stored `question_order` (not the client's):

```
total   = 0   # Σ question points
earned  = 0   # Σ points of correct answers

for qid in question_order:
    choice_id  = p_answers[qid]            (cast to uuid, safe)
    q_points   = questions.points          (coalesce 0)
    correct_id = the choice where is_correct

    total += q_points

    upsert student_answers
      (choice_id, is_correct = choice_id == correct_id,
       points_earned = correct ? q_points : 0)

    if choice_id == correct_id: earned += q_points
```

4. Computes metrics:

```
score_percent = total > 0 ? round(earned / total × 100, 2) : 0
passed        = total > 0 AND score_percent >= passing_score
time_used     = least(p_time_used, duration_minutes × 60)   # clamp
```

5. Writes `status = 'submitted'`, `submitted_at = now()`, `score`, `score_percent`, `passed`, `time_used_seconds`, `is_online = false`.
6. Logs a `submitted` activity event with `{ score, percent, total }` (0 points).
7. Idempotent: refuses to re-grade an already-submitted attempt.

**Why server-side?** The answer key (`is_correct`) is never sent to the client; students cannot hand in their own score, and the grader re-derives correctness from the stored questions/choices.

## 7. Time-out / auto-submit

- The student client enforces the countdown and calls `submitExam` when time expires.
- If `auto_submit` is enabled the client auto-submits; otherwise the attempt remains `time_up` and can be submitted by the student.
- `fn_submit_exam` accepts both `in_progress` and `time_up` statuses.

## 8. Result — `fn_result_detail`

Shared by teacher and student; role + ownership validated.

- Returns `student_exam`, `exam`, `student`, `answers` (in question_order), `risk`.
- **Reveal rule:** `reveal = (role == teacher) OR (role == student AND exam.allow_review)`.
  - Teacher: always sees `is_correct` + explanations.
  - Student: sees correctness/explanations only when `allow_review` is true.

## Student client behavior (`src/pages/student/exam.tsx`)

- Loads attempt + questions on mount; `useProctoring` starts (enabled while fullscreen/exam active).
- `scheduleProgressSave(immediate, online)` sends progress snapshots + `is_online: true` heartbeats.
- On `document.hidden` → marks offline; on real unmount → flushes queued proctoring events.
- Countdown runs on a 1s ticker; uses the **server-synced** `time_used_seconds` to stay accurate across refreshes.
