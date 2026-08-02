-- ============================================================================
-- Delete a student account (teacher only).
-- SECURITY DEFINER so ownership + role are verified server-side. Deleting the
-- `users` row cascades to `students`, `student_exams`, `student_answers`,
-- `activity_logs`, `risk_scores` and `exam_access` (all FK on delete cascade).
-- ============================================================================

create or replace function public.fn_delete_student(p_student_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_name text;
begin
  if public.auth_app_role() <> 'teacher' then
    raise exception 'Forbidden';
  end if;

  select r.name, u.full_name into v_role, v_name
  from public.users u
  join public.roles r on r.id = u.role_id
  where u.id = p_student_user_id;

  if v_role is null then
    raise exception 'Student not found';
  end if;
  if v_role <> 'student' then
    raise exception 'Only student accounts can be deleted';
  end if;

  delete from public.users where id = p_student_user_id;

  return jsonb_build_object('deleted', true, 'full_name', v_name);
end;
$$;

revoke all on function public.fn_delete_student(uuid) from public, anon;
grant execute on function public.fn_delete_student(uuid) to authenticated;
