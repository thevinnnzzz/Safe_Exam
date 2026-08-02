-- Allow multiple attempts per student per exam (retakes).
-- ----------------------------------------------------------------------------
-- Previously student_exams had a unique (exam_id, student_user_id) constraint
-- and fn_start_exam re-opened whatever attempt existed — so a student who had
-- finished (and failed) an exam was sent straight back to the old result when
-- the teacher republished the exam.
--
-- This migration:
--   1. Drops the unique constraint so multiple attempts can coexist.
--   2. Adds attempt_number to distinguish attempts.
--   3. Rewrites fn_start_exam so it only resumes an in_progress attempt and
--      otherwise creates a brand-new attempt starting from question 1.
-- ----------------------------------------------------------------------------
alter table public.student_exams
  drop constraint if exists student_exams_exam_id_student_user_id_key;

alter table public.student_exams
  add column if not exists attempt_number int not null default 1;

create index if not exists idx_se_exam_student
  on public.student_exams (exam_id, student_user_id);

-- ----------------------------------------------------------------------------
-- fn_start_exam: resume an in-progress attempt, otherwise start fresh.
-- ----------------------------------------------------------------------------
create or replace function public.fn_start_exam(p_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_exam exams%rowtype;
  v_qids uuid[];
  v_order jsonb;
  v_se_id uuid;
  v_attempt int;
begin
  if public.auth_app_role() <> 'student' then
    raise exception 'Forbidden';
  end if;

  if not exists (
    select 1 from public.exam_access
    where exam_id = p_exam_id and student_user_id = v_user_id
  ) then
    raise exception 'You are not assigned to this exam';
  end if;

  select * into v_exam from public.exams where id = p_exam_id for update;
  if v_exam is null or v_exam.status <> 'published' then
    raise exception 'Exam is not available';
  end if;
  if v_exam.start_time is not null and v_exam.start_time > now() then
    raise exception 'Exam has not started yet';
  end if;
  if v_exam.end_time is not null and v_exam.end_time < now() then
    raise exception 'Exam has ended';
  end if;

  -- resume the most recent in-progress attempt only
  select se.id into v_se_id from public.student_exams se
  where se.exam_id = p_exam_id and se.student_user_id = v_user_id
    and se.status = 'in_progress'
  order by se.started_at desc nulls last
  limit 1;

  if v_se_id is not null then
    update public.student_exams
    set is_online = true, last_active_at = now()
    where id = v_se_id;
    return (select to_jsonb(se) from public.student_exams se where se.id = v_se_id);
  end if;

  select array_agg(qid) into v_qids
  from (select eq.question_id as qid from public.exam_questions eq
        where eq.exam_id = p_exam_id order by eq.position) s;

  if v_qids is null then
    raise exception 'Exam has no questions';
  end if;

  v_order := to_jsonb(v_qids);
  if v_exam.randomize_questions then
    select jsonb_agg(qid) into v_order
    from (select unnest(v_qids) as qid order by random()) s;
  end if;

  select coalesce(max(attempt_number), 0) + 1 into v_attempt
  from public.student_exams
  where exam_id = p_exam_id and student_user_id = v_user_id;

  insert into public.student_exams
    (exam_id, student_user_id, status, started_at, question_order, current_question_index,
     time_used_seconds, is_online, last_active_at, attempt_number)
  values
    (p_exam_id, v_user_id, 'in_progress', now(), v_order, 0, 0, true, now(), v_attempt)
  returning id into v_se_id;

  insert into public.activity_logs
    (student_exam_id, student_user_id, exam_id, event_type, risk_points, meta)
  values (v_se_id, v_user_id, p_exam_id, 'started', 0, '{}'::jsonb);

  return (select to_jsonb(se) from public.student_exams se where se.id = v_se_id);
end;
$$;
