-- ============================================================================
-- Teacher-gated exam retakes (default locked).
-- ----------------------------------------------------------------------------
-- Previously any student could retake an exam unlimited times: fn_start_exam
-- always created a fresh attempt when none was in progress, and the dashboard
-- advertised "Retake (attempt N+1)".
--
-- New behavior:
--   * The first attempt is always allowed for assigned students.
--   * After an attempt completes, a new one is allowed only while
--     existing_attempts < 1 + exam_access.retakes_allowed, else the student
--     gets NO_RETAKE. Resuming an in-progress attempt never consumes allowance.
--   * Teachers grant exactly one extra attempt per call via the new
--     fn_grant_retake (per student + exam), e.g. from the results table.
--   * fn_set_exam_access / fn_set_student_exam_access no longer wipe granted
--     retakes when assignments are re-saved (delete-revoked / insert-new
--     instead of delete-all / re-insert).
-- ============================================================================

alter table public.exam_access
  add column if not exists retakes_allowed int not null default 0
    check (retakes_allowed >= 0);

-- ----------------------------------------------------------------------------
-- fn_start_exam: retake gate (retakes version + session guard + retake check).
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
  v_existing int := 0;
  v_retakes int := 0;
begin
  if public.auth_app_role() <> 'student' then
    raise exception 'Forbidden';
  end if;

  if not public.fn_session_valid() then
    raise exception 'SESSION_TAKEN: This account signed in on another device. Please sign in again on this device to continue.';
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

  -- resume the most recent in-progress attempt only (never consumes allowance)
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

  -- retake gate: the first attempt is free, further ones need grants
  select count(*) into v_existing
  from public.student_exams
  where exam_id = p_exam_id and student_user_id = v_user_id;

  select coalesce(retakes_allowed, 0) into v_retakes
  from public.exam_access
  where exam_id = p_exam_id and student_user_id = v_user_id;

  if v_existing >= 1 + coalesce(v_retakes, 0) then
    raise exception 'NO_RETAKE: This exam is already submitted. Ask your instructor to allow another attempt.';
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

-- ----------------------------------------------------------------------------
-- fn_grant_retake: teacher grants one extra attempt to one student for one
-- of their own exams.
-- ----------------------------------------------------------------------------
create or replace function public.fn_grant_retake(
  p_exam_id uuid,
  p_student_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_retakes int;
begin
  if public.auth_app_role() <> 'teacher' then
    raise exception 'Forbidden';
  end if;

  if not exists (
    select 1 from public.exams e
    where e.id = p_exam_id and e.teacher_id = auth.uid()
  ) then
    raise exception 'Exam not found';
  end if;

  select r.name into v_role
  from public.users u
  join public.roles r on r.id = u.role_id
  where u.id = p_student_user_id;

  if v_role is null or v_role <> 'student' then
    raise exception 'Student not found';
  end if;

  update public.exam_access
  set retakes_allowed = retakes_allowed + 1
  where exam_id = p_exam_id and student_user_id = p_student_user_id
  returning retakes_allowed into v_retakes;

  if not found then
    raise exception 'Student is not assigned to this exam';
  end if;

  return jsonb_build_object('retakes_allowed', v_retakes);
end;
$$;

revoke all on function public.fn_grant_retake(uuid, uuid) from public, anon;
grant execute on function public.fn_grant_retake(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- fn_set_exam_access: preserve granted retakes for retained assignments
-- (delete-revoked + insert-new instead of delete-all + re-insert).
-- ----------------------------------------------------------------------------
create or replace function public.fn_set_exam_access(
  p_exam_id uuid,
  p_student_user_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_role text;
  v_count int;
begin
  if public.auth_app_role() <> 'teacher' then
    raise exception 'Forbidden';
  end if;

  if not exists (
    select 1 from public.exams e
    where e.id = p_exam_id and e.teacher_id = auth.uid()
  ) then
    raise exception 'Exam not found';
  end if;

  if p_student_user_ids is null then
    p_student_user_ids := '{}'::uuid[];
  end if;

  -- every id must resolve to a student
  foreach v_uid in array p_student_user_ids loop
    select r.name into v_role
    from public.users u
    join public.roles r on r.id = u.role_id
    where u.id = v_uid;

    if v_role is null or v_role <> 'student' then
      raise exception 'Student not found';
    end if;
  end loop;

  -- remove only revoked assignments (retained rows keep their retakes_allowed)
  if array_length(p_student_user_ids, 1) is null then
    delete from public.exam_access ea
    where ea.exam_id = p_exam_id;
  else
    delete from public.exam_access ea
    where ea.exam_id = p_exam_id
      and not (ea.student_user_id = any(p_student_user_ids));
  end if;

  -- insert the new set (existing rows untouched)
  insert into public.exam_access (exam_id, student_user_id)
  select p_exam_id, unnest(p_student_user_ids)
  on conflict (exam_id, student_user_id) do nothing;

  select count(*) into v_count
  from public.exam_access ea
  where ea.exam_id = p_exam_id;

  return jsonb_build_object('assigned_students', v_count);
end;
$$;

-- ----------------------------------------------------------------------------
-- fn_set_student_exam_access: same retake-preserving rewrite.
-- ----------------------------------------------------------------------------
create or replace function public.fn_set_student_exam_access(
  p_student_user_id uuid,
  p_exam_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exam uuid;
  v_role text;
  v_count int;
begin
  if public.auth_app_role() <> 'teacher' then
    raise exception 'Forbidden';
  end if;

  select r.name into v_role
  from public.users u
  join public.roles r on r.id = u.role_id
  where u.id = p_student_user_id;

  if v_role is null or v_role <> 'student' then
    raise exception 'Student not found';
  end if;

  if p_exam_ids is null then
    p_exam_ids := '{}'::uuid[];
  end if;

  -- every exam must belong to the calling teacher
  foreach v_exam in array p_exam_ids loop
    if not exists (
      select 1 from public.exams e
      where e.id = v_exam and e.teacher_id = auth.uid()
    ) then
      raise exception 'Exam % is not yours', v_exam;
    end if;
  end loop;

  -- remove only revoked assignments for the teacher's exams
  -- (retained rows keep their retakes_allowed)
  delete from public.exam_access ea
  where ea.student_user_id = p_student_user_id
    and exists (
      select 1 from public.exams e
      where e.id = ea.exam_id and e.teacher_id = auth.uid()
    )
    and not (ea.exam_id = any(p_exam_ids) and array_length(p_exam_ids, 1) is not null);

  -- insert the new set (existing rows untouched)
  insert into public.exam_access (exam_id, student_user_id)
  select unnest(p_exam_ids), p_student_user_id
  on conflict (exam_id, student_user_id) do nothing;

  select count(*) into v_count
  from public.exam_access ea
  where ea.student_user_id = p_student_user_id
    and exists (
      select 1 from public.exams e
      where e.id = ea.exam_id and e.teacher_id = auth.uid()
    );

  return jsonb_build_object('assigned_exams', v_count);
end;
$$;
