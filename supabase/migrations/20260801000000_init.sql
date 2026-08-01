-- ============================================================================
-- Online Examination System — Schema
-- Run in Supabase SQL Editor or via `supabase db push`.
-- Uses custom JWT auth (signed with SUPABASE_JWT_SECRET) whose claims are:
--   { sub, role: 'authenticated', app_role: 'student'|'teacher', ... }
-- RLS policies read `auth.jwt() ->> 'app_role'` and `auth.uid()`.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- Helper: current app role from the custom JWT
-- ----------------------------------------------------------------------------
create or replace function public.auth_app_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select nullif(current_setting('request.jwt.claims', true)::json ->> 'app_role', '')::text
$$;

create or replace function public.fn_risk_level(p_points int)
returns text
language sql
immutable
as $$
  select case when p_points >= 80 then 'high' when p_points >= 40 then 'medium' else 'low' end;
$$;

-- ----------------------------------------------------------------------------
-- roles
-- ----------------------------------------------------------------------------
create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);

-- ----------------------------------------------------------------------------
-- users
-- ----------------------------------------------------------------------------
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.roles(id),
  full_name text not null,
  email text unique,
  student_id text unique,
  password_hash text not null,
  created_at timestamptz not null default now(),
  constraint users_student_id_xor_email check (student_id is not null or email is not null)
);

-- ----------------------------------------------------------------------------
-- courses
-- ----------------------------------------------------------------------------
create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  teacher_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- students / teachers (profiles extending users)
-- ----------------------------------------------------------------------------
create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  course_id uuid references public.courses(id),
  created_at timestamptz not null default now()
);

create table if not exists public.teachers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  title text,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- question_bank
-- ----------------------------------------------------------------------------
create table if not exists public.question_bank (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- questions / choices
-- ----------------------------------------------------------------------------
create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  question_bank_id uuid references public.question_bank(id) on delete set null,
  teacher_id uuid not null references public.users(id) on delete cascade,
  content text not null,
  difficulty text not null default 'medium' check (difficulty in ('easy', 'medium', 'hard')),
  category text,
  points int not null default 1 check (points > 0),
  explanation text,
  created_at timestamptz not null default now()
);

create table if not exists public.choices (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  content text not null,
  is_correct boolean not null default false,
  position int not null default 0
);

-- Never expose the correct answer to the postgrest "authenticated" role.
-- Both students AND teachers only read full choice data through the
-- SECURITY DEFINER functions defined below (running as the table owner).
revoke select (is_correct) on table public.choices from anon, authenticated;

-- ----------------------------------------------------------------------------
-- exams
-- ----------------------------------------------------------------------------
create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.users(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  title text not null,
  description text,
  instructions text,
  start_time timestamptz,
  end_time timestamptz,
  duration_minutes int not null default 60 check (duration_minutes between 1 and 600),
  passing_score numeric(5,2) not null default 50,
  randomize_questions boolean not null default false,
  randomize_choices boolean not null default false,
  show_score_after boolean not null default true,
  allow_review boolean not null default true,
  auto_submit boolean not null default true,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.exam_questions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  position int not null default 0,
  points int not null default 1,
  unique (exam_id, question_id)
);

-- ----------------------------------------------------------------------------
-- student_exams
-- ----------------------------------------------------------------------------
create table if not exists public.student_exams (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  student_user_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'submitted', 'time_up')),
  started_at timestamptz,
  submitted_at timestamptz,
  time_used_seconds int not null default 0,
  score numeric(8,2),
  score_percent numeric(5,2),
  passed boolean,
  current_question_index int not null default 0,
  question_order jsonb,
  answers jsonb,
  risk_score int not null default 0,
  is_online boolean not null default false,
  last_active_at timestamptz,
  unique (exam_id, student_user_id)
);

-- ----------------------------------------------------------------------------
-- student_answers
-- ----------------------------------------------------------------------------
create table if not exists public.student_answers (
  id uuid primary key default gen_random_uuid(),
  student_exam_id uuid not null references public.student_exams(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  choice_id uuid references public.choices(id),
  is_correct boolean,
  points_earned numeric(8,2),
  time_spent_seconds int not null default 0,
  updated_at timestamptz not null default now(),
  unique (student_exam_id, question_id)
);

revoke select (is_correct) on table public.student_answers from anon, authenticated;

-- ----------------------------------------------------------------------------
-- activity_logs
-- ----------------------------------------------------------------------------
create table if not exists public.activity_logs (
  id bigint generated always as identity primary key,
  student_exam_id uuid not null references public.student_exams(id) on delete cascade,
  student_user_id uuid not null references public.users(id) on delete cascade,
  exam_id uuid not null references public.exams(id) on delete cascade,
  event_type text not null,
  risk_points int not null default 0,
  meta jsonb,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- risk_scores (denormalized, updated server-side from activity_logs)
-- ----------------------------------------------------------------------------
create table if not exists public.risk_scores (
  id uuid primary key default gen_random_uuid(),
  student_exam_id uuid not null unique references public.student_exams(id) on delete cascade,
  student_user_id uuid not null references public.users(id) on delete cascade,
  exam_id uuid not null references public.exams(id) on delete cascade,
  total_points int not null default 0,
  level text not null default 'low' check (level in ('low', 'medium', 'high')),
  tab_switches int not null default 0,
  fullscreen_exits int not null default 0,
  copy_attempts int not null default 0,
  paste_attempts int not null default 0,
  cut_attempts int not null default 0,
  devtools_attempts int not null default 0,
  idle_events int not null default 0,
  idle_seconds int not null default 0,
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------------------
create index if not exists idx_users_student_id on public.users (student_id);
create index if not exists idx_users_email on public.users (email);
create index if not exists idx_exams_teacher on public.exams (teacher_id);
create index if not exists idx_exams_status on public.exams (status);
create index if not exists idx_exam_questions_exam on public.exam_questions (exam_id);
create index if not exists idx_questions_bank on public.questions (question_bank_id);
create index if not exists idx_questions_teacher on public.questions (teacher_id);
create index if not exists idx_choices_question on public.choices (question_id);
create index if not exists idx_se_exam on public.student_exams (exam_id);
create index if not exists idx_se_student on public.student_exams (student_user_id);
create index if not exists idx_se_status on public.student_exams (status);
create index if not exists idx_sa_student_exam on public.student_answers (student_exam_id);
create index if not exists idx_activity_student_exam on public.activity_logs (student_exam_id);
create index if not exists idx_activity_exam_time on public.activity_logs (exam_id, created_at desc);
create index if not exists idx_risk_student_exam on public.risk_scores (student_exam_id);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table public.roles enable row level security;
alter table public.users enable row level security;
alter table public.courses enable row level security;
alter table public.students enable row level security;
alter table public.teachers enable row level security;
alter table public.question_bank enable row level security;
alter table public.questions enable row level security;
alter table public.choices enable row level security;
alter table public.exams enable row level security;
alter table public.exam_questions enable row level security;
alter table public.student_exams enable row level security;
alter table public.student_answers enable row level security;
alter table public.activity_logs enable row level security;
alter table public.risk_scores enable row level security;

-- roles ----------------------------------------------------------------------
create policy "roles are readable by authenticated users"
  on public.roles for select to authenticated using (true);

-- users ----------------------------------------------------------------------
create policy "students can read their own profile"
  on public.users for select to authenticated
  using (public.auth_app_role() = 'student' and id = auth.uid());

create policy "teachers can read all profiles"
  on public.users for select to authenticated
  using (public.auth_app_role() = 'teacher');

-- courses --------------------------------------------------------------------
create policy "students can read courses"
  on public.courses for select to authenticated
  using (public.auth_app_role() = 'student');

create policy "teachers can manage own courses"
  on public.courses for all to authenticated
  using (public.auth_app_role() = 'teacher' and teacher_id = auth.uid())
  with check (public.auth_app_role() = 'teacher' and teacher_id = auth.uid());

-- question_bank --------------------------------------------------------------
create policy "teachers can manage own question banks"
  on public.question_bank for all to authenticated
  using (public.auth_app_role() = 'teacher' and teacher_id = auth.uid())
  with check (public.auth_app_role() = 'teacher' and teacher_id = auth.uid());

-- questions ------------------------------------------------------------------
create policy "teachers can manage own questions"
  on public.questions for all to authenticated
  using (public.auth_app_role() = 'teacher' and teacher_id = auth.uid())
  with check (public.auth_app_role() = 'teacher' and teacher_id = auth.uid());

-- choices --------------------------------------------------------------------
create policy "teachers can manage choices of their questions"
  on public.choices for all to authenticated
  using (exists (
    select 1 from public.questions q
    where q.id = choices.question_id and q.teacher_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.questions q
    where q.id = choices.question_id and q.teacher_id = auth.uid()
  ));

-- exams ----------------------------------------------------------------------
create policy "students can read published exams in window"
  on public.exams for select to authenticated
  using (
    public.auth_app_role() = 'student'
    and status = 'published'
    and (start_time is null or start_time <= now())
    and (end_time is null or end_time >= now())
  );

create policy "teachers can manage own exams"
  on public.exams for all to authenticated
  using (public.auth_app_role() = 'teacher' and teacher_id = auth.uid())
  with check (public.auth_app_role() = 'teacher' and teacher_id = auth.uid());

-- exam_questions -------------------------------------------------------------
create policy "teachers can manage own exam questions"
  on public.exam_questions for all to authenticated
  using (exists (
    select 1 from public.exams e
    where e.id = exam_questions.exam_id and e.teacher_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.exams e
    where e.id = exam_questions.exam_id and e.teacher_id = auth.uid()
  ));

-- student_exams --------------------------------------------------------------
create policy "students can read their own exam records"
  on public.student_exams for select to authenticated
  using (public.auth_app_role() = 'student' and student_user_id = auth.uid());

create policy "teachers can read records for their exams"
  on public.student_exams for select to authenticated
  using (public.auth_app_role() = 'teacher' and exists (
    select 1 from public.exams e
    where e.id = student_exams.exam_id and e.teacher_id = auth.uid()
  ));

-- student_answers ------------------------------------------------------------
create policy "students can read their own answers"
  on public.student_answers for select to authenticated
  using (exists (
    select 1 from public.student_exams se
    where se.id = student_answers.student_exam_id and se.student_user_id = auth.uid()
  ));

create policy "teachers can read answers for their exams"
  on public.student_answers for select to authenticated
  using (exists (
    select 1 from public.student_exams se
    join public.exams e on e.id = se.exam_id
    where se.id = student_answers.student_exam_id and e.teacher_id = auth.uid()
  ));

-- activity_logs --------------------------------------------------------------
create policy "students can read their own activity logs"
  on public.activity_logs for select to authenticated
  using (exists (
    select 1 from public.student_exams se
    where se.id = activity_logs.student_exam_id and se.student_user_id = auth.uid()
  ));

create policy "teachers can read activity logs for their exams"
  on public.activity_logs for select to authenticated
  using (exists (
    select 1 from public.student_exams se
    join public.exams e on e.id = se.exam_id
    where se.id = activity_logs.student_exam_id and e.teacher_id = auth.uid()
  ));

-- risk_scores ----------------------------------------------------------------
create policy "students can read their own risk scores"
  on public.risk_scores for select to authenticated
  using (exists (
    select 1 from public.student_exams se
    where se.id = risk_scores.student_exam_id and se.student_user_id = auth.uid()
  ));

create policy "teachers can read risk scores for their exams"
  on public.risk_scores for select to authenticated
  using (exists (
    select 1 from public.student_exams se
    join public.exams e on e.id = se.exam_id
    where se.id = risk_scores.student_exam_id and e.teacher_id = auth.uid()
  ));

-- students / teachers profile tables (read-only, informational) --------------
create policy "teachers can read students"
  on public.students for select to authenticated
  using (public.auth_app_role() = 'teacher');

create policy "teachers can read teachers"
  on public.teachers for select to authenticated
  using (public.auth_app_role() = 'teacher');
