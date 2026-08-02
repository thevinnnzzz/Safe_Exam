-- Resume an in-progress attempt without creating a new one.
-- ----------------------------------------------------------------------------
-- fn_start_exam both resumes an in_progress attempt AND creates a brand-new
-- one when none exists. The exam page needs a way to check "is there an attempt
-- I should return to?" so that a reload (e.g. caused by a fullscreen exit on
-- mobile) does not dump the student back on the instructions screen forcing a
-- second "Begin exam" click.
--
-- This function only returns the most recent in_progress attempt for the given
-- exam (or null), and never inserts anything.
-- ----------------------------------------------------------------------------
create or replace function public.fn_my_current_attempt(p_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_se_id uuid;
begin
  if public.auth_app_role() <> 'student' then
    raise exception 'Forbidden';
  end if;

  select se.id into v_se_id
  from public.student_exams se
  where se.exam_id = p_exam_id
    and se.student_user_id = v_user_id
    and se.status = 'in_progress'
  order by se.started_at desc nulls last
  limit 1;

  if v_se_id is null then
    return null;
  end if;

  update public.student_exams
  set is_online = true, last_active_at = now()
  where id = v_se_id;

  return (select to_jsonb(se) from public.student_exams se where se.id = v_se_id);
end;
$$;
