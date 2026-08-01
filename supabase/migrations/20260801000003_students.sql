-- ============================================================================
-- Student management for teachers.
-- fn_create_students: securely create student accounts from the teacher UI.
--   - Verifies the caller is a teacher (SECURITY DEFINER + app_role check).
--   - Hashes passwords server-side with bcrypt (pgcrypto), so plaintext
--     passwords never touch the database.
--   - Creates the `users` row and the `students` profile in one transaction.
--   - Accepts an array so the UI can bulk-import students; returns a per-row
--     status so partial failures can be reported instead of failing the batch.
-- ============================================================================

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

      insert into public.students (user_id, course_id)
      values (
        v_user_id,
        nullif(btrim(coalesce(v_student->>'course_id', '')), '')::uuid
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
