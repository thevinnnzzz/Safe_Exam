-- ============================================================================
-- Per-exam assigned-sections map for the teacher Exams tab.
-- ----------------------------------------------------------------------------
-- Additive only. Lets teachers filter exams by student section and manage
-- per-exam student-history visibility without opening the exam editor.
-- Returns one row per exam owned by the calling teacher:
--   [{ exam_id, assigned_count, sections: [..] }]
-- where sections are the distinct non-empty sections of assigned students.
-- ============================================================================

create or replace function public.fn_exam_assigned_sections()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_teacher uuid := auth.uid();
  v_rows jsonb;
begin
  if public.auth_app_role() <> 'teacher' then
    raise exception 'Forbidden';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'exam_id', x.id,
      'assigned_count', x.assigned_count,
      'sections', x.sections
    )), '[]'::jsonb) into v_rows
  from (
    select e.id,
      count(ea.student_user_id) as assigned_count,
      coalesce(
        (select jsonb_agg(s.sec order by s.sec)
         from (select distinct st.section as sec
               from public.exam_access ea2
               join public.students st on st.user_id = ea2.student_user_id
               where ea2.exam_id = e.id
                 and st.section is not null
                 and btrim(st.section) <> '') s),
        '[]'::jsonb) as sections
    from public.exams e
    left join public.exam_access ea on ea.exam_id = e.id
    where e.teacher_id = v_teacher
    group by e.id
  ) x;

  return v_rows;
end;
$$;

revoke all on function public.fn_exam_assigned_sections() from public, anon;
grant execute on function public.fn_exam_assigned_sections() to authenticated;
