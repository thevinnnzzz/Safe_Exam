-- ============================================================================
-- Scoped realtime for students (Free-tier-safe design).
-- ----------------------------------------------------------------------------
-- Only `student_exams` is published: the result page subscribes to UPDATEs of
-- the student's own attempt (e.g. a teacher grade landing live). Dashboard /
-- history lists use 30s polling instead, so no per-student sockets sit idle
-- there and concurrent connections stay in the dozens.
-- RLS is unchanged: deliveries are filtered by the existing student SELECT
-- policies, so a student only ever receives their own rows.
-- ============================================================================

alter table public.student_exams replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'student_exams'
     ) then
    alter publication supabase_realtime add table public.student_exams;
  end if;
end;
$$;
