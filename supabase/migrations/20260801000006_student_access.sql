-- ============================================================================
-- Student section + per-student exam access control.
--   - Adds `students.section` (free-form class/section label).
--   - Adds `exam_access` table: explicit allow-list of exams each student may
--     take. Students see ONLY exams they are assigned to.
--   - Seeds access for existing demo students so current behavior is preserved.
--   - fn_start_exam now enforces access (defense in depth).
--   - fn_create_students accepts an optional `section`.
--   - fn_update_student updates course/section (SECURITY DEFINER, teacher-only).
--   - fn_set_student_exam_access replaces a student's exam assignments.
-- ============================================================================

alter table public.students add column if not exists section text;

-- ----------------------------------------------------------------------------
-- exam_access: explicit allow-list of exams a student may take
-- ----------------------------------------------------------------------------
create table if not exists public.exam_access (
  exam_id uuid not null references public.exams(id) on delete cascade,
  student_user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (exam_id, student_user_id)
);

alter table public.exam_access enable row level security;

-- students can read their own assignments
create policy "students can read their own exam access"
  on public.exam_access for select to authenticated
  using (
    public.auth_app_role() = 'student'
    and student_user_id = auth.uid()
  );

-- teachers can read assignments for their exams
create policy "teachers can read exam access for their exams"
  on public.exam_access for select to authenticated
  using (
    public.auth_app_role() = 'teacher'
    and exists (
      select 1 from public.exams e
      where e.id = exam_access.exam_id and e.teacher_id = auth.uid()
    )
  );

-- Writes are only done through the SECURITY DEFINER functions below so that
-- ownership is verified server-side.

-- ----------------------------------------------------------------------------
-- Seed: existing students keep access to the teacher's current exams so the
-- switch to assignments-only does not hide anything that was already visible.
-- ----------------------------------------------------------------------------
insert into public.exam_access (exam_id, student_user_id)
select e.id, u.id
from public.exams e
join public.users u on u.role_id = (select id from public.roles where name = 'student')
where e.teacher_id = '11111111-1111-1111-1111-111111111111'
on conflict (exam_id, student_user_id) do nothing;

-- ----------------------------------------------------------------------------
-- fn_start_exam: enforce exam access
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

  select se.id into v_se_id from public.student_exams se
  where se.exam_id = p_exam_id and se.student_user_id = v_user_id;

  if v_se_id is not null then
    update public.student_exams
    set is_online = true, last_active_at = now()
    where id = v_se_id and status = 'in_progress';
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

  insert into public.student_exams
    (exam_id, student_user_id, status, started_at, question_order, current_question_index,
     time_used_seconds, is_online, last_active_at)
  values
    (p_exam_id, v_user_id, 'in_progress', now(), v_order, 0, 0, true, now())
  returning id into v_se_id;

  insert into public.activity_logs
    (student_exam_id, student_user_id, exam_id, event_type, risk_points, meta)
  values (v_se_id, v_user_id, p_exam_id, 'started', 0, '{}'::jsonb);

  return (select to_jsonb(se) from public.student_exams se where se.id = v_se_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- fn_create_students: add optional `section`
-- ----------------------------------------------------------------------------
create or replace function public.fn_create_students(p_students jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_student jsonb;
  v_user_id uuid;
  v_role_id uuid;
  v_results jsonb := '[]'::jsonb;
begin
  if public.auth_app_role() <> 'teacher' then
    raise exception 'Forbidden';
  end if;

  if p_students is null or jsonb_typeof(p_students) <> 'array' then
    raise exception 'p_students must be a JSON array';
  end if;

  select id into v_role_id from public.roles where name = 'student';
  if v_role_id is null then
    raise exception 'Student role is not configured.';
  end if;

  for v_student in select * from jsonb_array_elements(p_students)
  loop
    begin
      -- normalize + validate a single row
      if v_student->>'full_name' is null or btrim(v_student->>'full_name') = '' then
        raise exception 'full_name is required';
      end if;
      if v_student->>'student_id' is null or btrim(v_student->>'student_id') = '' then
        raise exception 'student_id is required';
      end if;
      if v_student->>'password' is null or length(v_student->>'password') < 6 then
        raise exception 'password must be at least 6 characters';
      end if;

      if exists (select 1 from public.users where student_id = btrim(v_student->>'student_id')) then
        raise exception 'Student ID % already exists', btrim(v_student->>'student_id');
      end if;

      insert into public.users (role_id, full_name, email, student_id, password_hash)
      values (
        v_role_id,
        btrim(v_student->>'full_name'),
        nullif(btrim(coalesce(v_student->>'email', '')), ''),
        btrim(v_student->>'student_id'),
        crypt(v_student->>'password', gen_salt('bf', 10))
      )
      returning id into v_user_id;

      insert into public.students (user_id, course_id, section)
      values (
        v_user_id,
        nullif(btrim(coalesce(v_student->>'course_id', '')), '')::uuid,
        nullif(btrim(coalesce(v_student->>'section', '')), '')
      );

      v_results := v_results || jsonb_build_object(
        'student_id', btrim(v_student->>'student_id'),
        'full_name', btrim(v_student->>'full_name'),
        'ok', true
      );
    exception
      when unique_violation then
        v_results := v_results || jsonb_build_object(
          'student_id', coalesce(v_student->>'student_id', ''),
          'full_name', coalesce(v_student->>'full_name', ''),
          'ok', false,
          'error', 'Student ID or email already exists'
        );
      when others then
        v_results := v_results || jsonb_build_object(
          'student_id', coalesce(v_student->>'student_id', ''),
          'full_name', coalesce(v_student->>'full_name', ''),
          'ok', false,
          'error', sqlerrm
        );
    end;
  end loop;

  return v_results;
end;
$$;

revoke all on function public.fn_create_students(jsonb) from public, anon;
grant execute on function public.fn_create_students(jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- fn_update_student: update a student's course / section (teacher only).
-- Returns the updated profile.
-- ----------------------------------------------------------------------------
create or replace function public.fn_update_student(
  p_student_user_id uuid,
  p_course_id uuid default null,
  p_section text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_row public.students%rowtype;
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

  update public.students
  set course_id = p_course_id,
      section   = nullif(btrim(coalesce(p_section, '')), '')
  where user_id = p_student_user_id
  returning * into v_row;

  if v_row is null then
    raise exception 'Student profile not found';
  end if;

  return jsonb_build_object(
    'user_id', p_student_user_id,
    'course_id', v_row.course_id,
    'section', v_row.section
  );
end;
$$;

revoke all on function public.fn_update_student(uuid, uuid, text) from public, anon;
grant execute on function public.fn_update_student(uuid, uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- fn_set_student_exam_access: replace a student's exam assignments (teacher only).
-- Verifies every exam belongs to the calling teacher, then deletes the
-- student's existing assignments (for that teacher's exams) and inserts the
-- new set.
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

  -- remove existing assignments for the teacher's exams
  delete from public.exam_access ea
  where ea.student_user_id = p_student_user_id
    and exists (
      select 1 from public.exams e
      where e.id = ea.exam_id and e.teacher_id = auth.uid()
    );

  -- insert the new set
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

revoke all on function public.fn_set_student_exam_access(uuid, uuid[]) from public, anon;
grant execute on function public.fn_set_student_exam_access(uuid, uuid[]) to authenticated;
