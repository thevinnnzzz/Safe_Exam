-- ============================================================================
-- Bulk exam-access grant for teacher-selected students.
-- ----------------------------------------------------------------------------
-- Additive only: no existing function, policy or table is modified.
-- Teachers pick students (e.g. a whole course / section) in the UI and grant
-- them access to one or more of their own exams in a single call.
-- Unlike fn_set_student_exam_access (which REPLACES one student's list),
-- this function only ADDS rows (insert … on conflict do nothing), so other
-- assignments are never removed.
-- ============================================================================

create or replace function public.fn_grant_exam_access(
  p_student_user_ids uuid[],
  p_exam_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exam uuid;
  v_student uuid;
  v_role text;
  v_granted int := 0;
begin
  if public.auth_app_role() <> 'teacher' then
    raise exception 'Forbidden';
  end if;

  if p_student_user_ids is null then
    p_student_user_ids := '{}'::uuid[];
  end if;
  if p_exam_ids is null then
    p_exam_ids := '{}'::uuid[];
  end if;

  if array_length(p_exam_ids, 1) is null then
    raise exception 'Select at least one exam';
  end if;
  if array_length(p_student_user_ids, 1) is null then
    raise exception 'Select at least one student';
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

  -- every target must be a student account
  foreach v_student in array p_student_user_ids loop
    select r.name into v_role
    from public.users u
    join public.roles r on r.id = u.role_id
    where u.id = v_student;
    if v_role is null or v_role <> 'student' then
      raise exception 'Student % not found', v_student;
    end if;
  end loop;

  insert into public.exam_access (exam_id, student_user_id)
  select e, s
  from unnest(p_exam_ids) as e
  cross join unnest(p_student_user_ids) as s
  on conflict (exam_id, student_user_id) do nothing;

  get diagnostics v_granted = row_count;

  return jsonb_build_object('granted', v_granted);
end;
$$;

revoke all on function public.fn_grant_exam_access(uuid[], uuid[]) from public, anon;
grant execute on function public.fn_grant_exam_access(uuid[], uuid[]) to authenticated;
