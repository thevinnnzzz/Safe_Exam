-- ============================================================================
-- Add missing student_exams.updated_at (+ auto-touch trigger).
-- ----------------------------------------------------------------------------
-- The frontend orders attempts by updated_at, but the column was never
-- created — every such query failed with 400
-- ("column student_exams.updated_at does not exist"), silently emptying the
-- student dashboard's recent attempts and breaking the history page.
-- ============================================================================

alter table public.student_exams
  add column if not exists updated_at timestamptz not null default now();

-- backfill something sensible for existing rows (runs before the trigger below
-- is created, so these values stick)
update public.student_exams
set updated_at = coalesce(submitted_at, started_at, last_active_at, now());

create or replace function public.fn_touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_student_exams_updated_at on public.student_exams;
create trigger trg_student_exams_updated_at
  before update on public.student_exams
  for each row execute function public.fn_touch_updated_at();
