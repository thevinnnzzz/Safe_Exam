-- ============================================================================
-- Batch recompute pass/fail after passing_score edits
-- ----------------------------------------------------------------------------
-- The Edit Exam page saves exams.passing_score, but student_exams.passed is
-- a stored snapshot. Without this, 79% rows keep their old Failed/Passed
-- until individually re-graded. This wrapper reuses the existing helper
-- fn_recompute_student_exam (from 00024) to refresh every submitted/time_up
-- attempt for an exam in one teacher-owned RPC.
-- ============================================================================

create or replace function public.fn_recompute_exam_passfail(p_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_teacher uuid := auth.uid();
  v_count int := 0;
  r record;
begin
  if public.auth_app_role() <> 'teacher' then
    raise exception 'Forbidden';
  end if;

  if not exists (
    select 1 from public.exams
    where id = p_exam_id and teacher_id = v_teacher
  ) then
    raise exception 'Forbidden';
  end if;

  for r in
    select id from public.student_exams
    where exam_id = p_exam_id and status in ('submitted', 'time_up')
  loop
    perform public.fn_recompute_student_exam(r.id);
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('recomputed', v_count);
end;
$$;

revoke all on function public.fn_recompute_exam_passfail(uuid) from public, anon;
grant execute on function public.fn_recompute_exam_passfail(uuid) to authenticated, service_role;
