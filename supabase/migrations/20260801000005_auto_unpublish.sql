-- ----------------------------------------------------------------------------
-- Auto-unpublish exams once their availability window / duration has elapsed.
--
-- An exam is considered finished (and auto-unpublished to 'draft') when:
--   * its explicit end_time has passed, OR
--   * it has a start_time but no end_time, and start_time + duration_minutes
--     has passed.
-- Runs every minute via pg_cron.
-- ----------------------------------------------------------------------------

create extension if not exists pg_cron;

create or replace function public.fn_auto_unpublish_expired()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.exams
  set status = 'draft',
      updated_at = now()
  where status = 'published'
    and (
      (end_time is not null and end_time <= now())
      or (end_time is null and start_time is not null
          and start_time + make_interval(mins => duration_minutes) <= now())
    );
end;
$$;

-- Schedule once a minute. `cron.schedule` is idempotent per job name.
select cron.schedule(
  'safe-exam-auto-unpublish',
  '* * * * *',
  $$select public.fn_auto_unpublish_expired()$$
);
