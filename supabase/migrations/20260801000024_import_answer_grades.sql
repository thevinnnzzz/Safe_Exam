-- ============================================================================
-- Bulk import essay grades from CSV (teacher-only)
-- ----------------------------------------------------------------------------
-- Teachers export answers (Student # / Question # identify each row), fill
-- Points Earned + Feedback offline, and re-import. Only essay answers are
-- graded — MCQ rows are skipped. Feedback-only rows (blank points) are
-- skipped entirely. Points are validated 0..max and overwrite any auto-graded
-- value (manual grade wins: auto_graded = false). After all rows, each
-- affected attempt is recomputed once (score/percent/passed/grading_status).
-- The CSV columns expected are:
--   Student # | Student Name | Question # | Question | Feedback | Points Earned
-- Identifiers are Student # (= users.student_id) + Question # (1-based position
-- in the student's question_order from their latest submitted/time_up attempt).
-- ============================================================================

-- Helper: recompute a single attempt's totals from its question_order.
-- Extracted so the import can reuse the same logic as manual grading.
create or replace function public.fn_recompute_student_exam(p_student_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_se student_exams%rowtype;
  v_exam exams%rowtype;
  v_total int := 0;
  v_earned numeric(8,2) := 0;
  v_pending int := 0;
  v_percent numeric;
  v_passed boolean;
begin
  select * into v_se from public.student_exams where id = p_student_exam_id;
  if v_se is null then
    return jsonb_build_object('error', 'Attempt not found');
  end if;

  select * into v_exam from public.exams where id = v_se.exam_id;
  if v_exam is null then
    return jsonb_build_object('error', 'Exam not found');
  end if;

  select
    coalesce(sum(q.points), 0),
    coalesce(sum(coalesce(sa.points_earned, 0)), 0),
    count(*) filter (where coalesce(q.question_type, 'multiple_choice') = 'essay' and sa.points_earned is null)
  into v_total, v_earned, v_pending
  from lateral jsonb_array_elements_text(v_se.question_order) with ordinality as t(qid, pos)
  join public.questions q on q.id = t.qid::uuid
  left join public.student_answers sa
    on sa.student_exam_id = p_student_exam_id and sa.question_id = q.id;

  v_percent := case when v_total > 0 then round((v_earned / v_total * 100)::numeric, 2) else 0 end;
  v_passed := case when v_pending > 0 then null
                   when v_total > 0 then v_percent >= v_exam.passing_score
                   else false end;

  update public.student_exams
  set score = v_earned,
      score_percent = v_percent,
      passed = v_passed,
      grading_status = case when v_pending > 0 then 'pending' else 'complete' end,
      last_active_at = now()
  where id = p_student_exam_id;

  return jsonb_build_object(
    'total', v_total,
    'earned', v_earned,
    'pending', v_pending,
    'percent', v_percent,
    'passed', v_passed
  );
end;
$$;

create or replace function public.fn_import_answer_grades(
  p_exam_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_teacher uuid := auth.uid();
  v_exam exams%rowtype;
  v_row jsonb;
  v_student_number text;
  v_question_pos int;
  v_points_raw text;
  v_points numeric;
  v_feedback text;
  v_user_id uuid;
  v_attempt student_exams%rowtype;
  v_qid uuid;
  v_qtype text;
  v_qmax int;
  v_expected_question text;

  v_applied int := 0;
  v_skipped int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_affected uuid[] := '{}';
  v_seen_student uuid;
begin
  if public.auth_app_role() <> 'teacher' then
    raise exception 'Forbidden';
  end if;

  select * into v_exam from public.exams where id = p_exam_id;
  if v_exam is null then
    raise exception 'Exam not found';
  end if;
  if v_exam.teacher_id <> v_teacher then
    raise exception 'Forbidden';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Invalid import rows';
  end if;

  if jsonb_array_length(p_rows) = 0 then
    return jsonb_build_object('applied', 0, 'skipped', 0, 'errors', '[]'::jsonb);
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_student_number := nullif(trim(both from coalesce(v_row->>'student_number', v_row->>'Student #'::text, '')), '');
    if v_student_number is null then
      v_student_number := nullif(trim(both from coalesce(v_row->>'student_id', '')), '');
    end if;

    v_question_pos := null;
    begin
      v_question_pos := coalesce(
        nullif(trim(both from coalesce(v_row->>'question_position', v_row->>'Question #'::text, '')), '')::int,
        nullif(trim(both from coalesce(v_row->>'question_number', '')), '')::int
      );
    exception when others then
      v_question_pos := null;
    end;

    v_points_raw := nullif(trim(both from coalesce(v_row->>'points_earned', v_row->>'Points Earned'::text, v_row->>'points', '')), '');
    v_feedback := nullif(trim(both from coalesce(v_row->>'feedback', v_row->>'Feedback'::text, '')), '');

    -- Rule: feedback-only rows (no points) are skipped entirely
    if v_points_raw is null or v_points_raw = '' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if v_student_number is null then
      v_errors := v_errors || jsonb_build_object(
        'student_number', coalesce(v_student_number, ''),
        'question_position', coalesce(v_question_pos::text, ''),
        'reason', 'Missing Student #'
      );
      continue;
    end if;

    if v_question_pos is null or v_question_pos < 1 then
      v_errors := v_errors || jsonb_build_object(
        'student_number', v_student_number,
        'question_position', coalesce(v_question_pos::text, ''),
        'reason', 'Invalid Question #'
      );
      continue;
    end if;

    begin
      v_points := v_points_raw::numeric;
    exception when others then
      v_errors := v_errors || jsonb_build_object(
        'student_number', v_student_number,
        'question_position', v_question_pos::text,
        'reason', 'Points Earned must be a number'
      );
      continue;
    end;

    -- Resolve student by users.student_id (unique per creation migration)
    select id into v_user_id
    from public.users
    where student_id = v_student_number
    limit 1;

    if v_user_id is null then
      v_errors := v_errors || jsonb_build_object(
        'student_number', v_student_number,
        'question_position', v_question_pos::text,
        'reason', 'Student not found'
      );
      continue;
    end if;

    -- Latest submitted/time_up attempt for this student+exam (matches export)
    select * into v_attempt
    from public.student_exams
    where exam_id = p_exam_id
      and student_user_id = v_user_id
      and status in ('submitted', 'time_up')
    order by attempt_number desc
    limit 1;

    if v_attempt.id is null then
      v_errors := v_errors || jsonb_build_object(
        'student_number', v_student_number,
        'question_position', v_question_pos::text,
        'reason', 'No submitted attempt for this student'
      );
      continue;
    end if;

    -- Question at this position from the attempt's own question_order
    -- (so randomized exams still match the export's per-student ordering)
    begin
      select (v_attempt.question_order->>(v_question_pos - 1))::uuid into v_qid;
    exception when others then
      v_qid := null;
    end;

    if v_qid is null then
      v_errors := v_errors || jsonb_build_object(
        'student_number', v_student_number,
        'question_position', v_question_pos::text,
        'reason', 'Question # out of range for this student''s attempt'
      );
      continue;
    end if;

    select question_type, points into v_qtype, v_qmax
    from public.questions where id = v_qid;

    if v_qtype is null then
      v_errors := v_errors || jsonb_build_object(
        'student_number', v_student_number,
        'question_position', v_question_pos::text,
        'reason', 'Question not found'
      );
      continue;
    end if;

    -- Only essay questions are import-graded. MCQ rows are skipped (reported).
    if coalesce(v_qtype, 'multiple_choice') <> 'essay' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if v_points < 0 or v_points > coalesce(v_qmax, 0) then
      v_errors := v_errors || jsonb_build_object(
        'student_number', v_student_number,
        'question_position', v_question_pos::text,
        'reason', format('Score must be between 0 and %s', coalesce(v_qmax, 0))
      );
      continue;
    end if;

    -- Overwrite auto-graded points (manual wins): essay only, upsert answer row if needed
    insert into public.student_answers
      (student_exam_id, question_id, answer_text, points_earned, is_correct, feedback, graded_by, graded_at, auto_graded, time_spent_seconds)
    values (
      v_attempt.id, v_qid, null, null, null, null, null, null, false, 0
    )
    on conflict (student_exam_id, question_id) do nothing;

    update public.student_answers
    set points_earned = v_points,
        is_correct = (v_points >= coalesce(v_qmax, 0)),
        feedback = v_feedback,
        graded_by = v_teacher,
        graded_at = now(),
        auto_graded = false,
        updated_at = now()
    where student_exam_id = v_attempt.id and question_id = v_qid;

    if not found then
      v_errors := v_errors || jsonb_build_object(
        'student_number', v_student_number,
        'question_position', v_question_pos::text,
        'reason', 'Could not write answer — missing student answer row'
      );
      continue;
    end if;

    v_applied := v_applied + 1;
    if not (v_attempt.id = any(v_affected)) then
      v_affected := v_affected || v_attempt.id;
    end if;
  end loop;

  -- Recompute each affected attempt once (batch)
  foreach v_seen_student in array v_affected loop
    perform public.fn_recompute_student_exam(v_seen_student);
  end loop;

  return jsonb_build_object(
    'applied', v_applied,
    'skipped', v_skipped,
    'errors', v_errors,
    'attempts_affected', coalesce(array_length(v_affected, 1), 0)
  );
end;
$$;

revoke all on function public.fn_recompute_student_exam(uuid) from public, anon;
grant execute on function public.fn_recompute_student_exam(uuid) to authenticated, service_role;

revoke all on function public.fn_import_answer_grades(uuid, jsonb) from public, anon;
grant execute on function public.fn_import_answer_grades(uuid, jsonb) to authenticated, service_role;
