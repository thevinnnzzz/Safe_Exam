-- fn_set_exam_access: replace the set of students who may take an exam
-- (teacher only). Verifies the exam belongs to the calling teacher and every
-- id resolves to a student, then deletes the exam's existing assignments and
-- inserts the new set. Returns the number of assigned students.
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

  -- remove the exam's existing assignments
  delete from public.exam_access ea
  where ea.exam_id = p_exam_id;

  -- insert the new set
  insert into public.exam_access (exam_id, student_user_id)
  select p_exam_id, unnest(p_student_user_ids)
  on conflict (exam_id, student_user_id) do nothing;

  select count(*) into v_count
  from public.exam_access ea
  where ea.exam_id = p_exam_id;

  return jsonb_build_object('assigned_students', v_count);
end;
$$;

revoke all on function public.fn_set_exam_access(uuid, uuid[]) from public, anon;
grant execute on function public.fn_set_exam_access(uuid, uuid[]) to authenticated;
