-- ============================================================================
-- Realtime delivery for the teacher Risk dialog (scalable, event-driven).
-- ----------------------------------------------------------------------------
-- The teacher Results page opens a per-student Risk dialog showing the trigger
-- breakdown + incident timeline. Instead of polling, the dialog subscribes to
-- a single channel with two server-filtered bindings:
--   activity_logs INSERT where student_exam_id = <attempt>
--   risk_scores  UPDATE where student_exam_id = <attempt>
-- The server pushes only on change (zero traffic when idle); payloads are
-- applied straight into the query cache (zero refetches per event).
-- RLS is unchanged: delivery is filtered by the existing teacher SELECT
-- policies on both tables (exams.teacher_id = auth.uid()), so a teacher only
-- ever receives their own exams' rows. Free-tier-safe: the channel is removed
-- when the dialog closes, so no sockets sit idle.
-- risk_scores needs replica identity full for UPDATE payloads; activity_logs
-- is INSERT-only (no replica identity strictly required) but set full anyway
-- for consistency. Guarded like 00020 in case the publication is absent.
-- ============================================================================

alter table public.activity_logs replica identity full;
alter table public.risk_scores replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'activity_logs'
    ) then
      alter publication supabase_realtime add table public.activity_logs;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'risk_scores'
    ) then
      alter publication supabase_realtime add table public.risk_scores;
    end if;
  end if;
end;
$$;
