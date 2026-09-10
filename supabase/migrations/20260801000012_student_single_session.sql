-- ============================================================================
-- Single active session for students (1 account = 1 device).
-- ----------------------------------------------------------------------------
-- Previously the auth edge function issued stateless JWTs with no server-side
-- session record, so the same student account could be signed in on any number
-- of devices at the same time (e.g. a classmate taking the exam from outside).
--
-- How enforcement works after this migration (+ redeployed auth-login edge
-- function which stores a per-login `jti`):
--   1. `user_sessions` holds exactly ONE row per user: the latest login's
--      session id (`session_jti`). A new student login overwrites it, which
--      instantly invalidates every older device.
--   2. `fn_session_valid()` compares the calling JWT's `jti` claim against the
--      stored row. Teachers always pass (unchanged behaviour). Students with
--      pre-rollout tokens (no `jti`, no row) still pass so nobody is locked
--      out by deploying this migration on its own.
--   3. Every student-facing RPC rejects stale sessions with a SESSION_TAKEN
--      error the app recognises to force a logout.
--   4. Student RLS read policies additionally require a valid session, so a
--      stale token cannot be used for direct table reads either.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Session table (one row per user = the latest login wins).
--    No policies: only the service role (edge function) and SECURITY DEFINER
--    functions below ever touch it; direct access is denied for anon/auth.
-- ----------------------------------------------------------------------------
create table if not exists public.user_sessions (
  user_id uuid primary key references public.users(id) on delete cascade,
  session_jti uuid not null,
  device_id text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '12 hours'
);

alter table public.user_sessions enable row level security;

-- ----------------------------------------------------------------------------
-- 2. Session check used by RPC guards and RLS policies.
-- ----------------------------------------------------------------------------
create or replace function public.fn_session_valid()
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.auth_app_role();
  v_uid uuid := auth.uid();
  v_jti text := nullif(auth.jwt() ->> 'jti', '');
  v_stored uuid;
begin
  -- Teachers (and any non-student caller) are not single-session restricted.
  if v_role <> 'student' then
    return true;
  end if;
  if v_uid is null then
    return false;
  end if;

  select session_jti into v_stored
  from public.user_sessions
  where user_id = v_uid;

  -- No session ever claimed: token predates the rollout (or edge function not
  -- yet redeployed). Grandfather it so deploys never lock students out.
  if not found then
    return true;
  end if;

  -- A row exists but this token carries no session id: an older device from
  -- before this account's latest login.
  if v_jti is null then
    return false;
  end if;

  return v_stored::text = v_jti;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Frontend polling endpoint: reports validity + refreshes last_seen_at.
-- ----------------------------------------------------------------------------
create or replace function public.fn_my_session_status()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.auth_app_role();
  v_uid uuid := auth.uid();
  v_ok boolean;
begin
  if v_role <> 'student' then
    return jsonb_build_object('valid', true);
  end if;
  if v_uid is null then
    return jsonb_build_object('valid', false, 'reason', 'Not authenticated.');
  end if;

  v_ok := public.fn_session_valid();
  if v_ok then
    update public.user_sessions set last_seen_at = now() where user_id = v_uid;
    return jsonb_build_object('valid', true);
  end if;

  return jsonb_build_object(
    'valid', false,
    'reason', 'SESSION_TAKEN: This account signed in on another device. You have been signed out.'
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Guard the student RPCs. Bodies are unchanged apart from the added
--    single-session check right after the role check.
-- ----------------------------------------------------------------------------

-- fn_start_exam (retakes version + session guard) -----------------------------
create or replace function public.fn_start_exam(p_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_exam exams%rowtype;
  v_qids uuid[];
  v_order jsonb;
  v_se_id uuid;
  v_attempt int;
begin
  if public.auth_app_role() <> 'student' then
    raise exception 'Forbidden';
  end if;

  if not public.fn_session_valid() then
    raise exception 'SESSION_TAKEN: This account signed in on another device. Please sign in again on this device to continue.';
  end if;

  if not exists (
    select 1 from public.exam_access
    where exam_id = p_exam_id and student_user_id = v_user_id
  ) then
    raise exception 'You are not assigned to this exam';
  end if;

  select * into v_exam from public.exams where id = p_exam_id for update;
  if v_exam is null or v_exam.status <> 'published' then
    raise exception 'Exam is not available';
  end if;
  if v_exam.start_time is not null and v_exam.start_time > now() then
    raise exception 'Exam has not started yet';
  end if;
  if v_exam.end_time is not null and v_exam.end_time < now() then
    raise exception 'Exam has ended';
  end if;

  -- resume the most recent in-progress attempt only
  select se.id into v_se_id from public.student_exams se
  where se.exam_id = p_exam_id and se.student_user_id = v_user_id
    and se.status = 'in_progress'
  order by se.started_at desc nulls last
  limit 1;

  if v_se_id is not null then
    update public.student_exams
    set is_online = true, last_active_at = now()
    where id = v_se_id;
    return (select to_jsonb(se) from public.student_exams se where se.id = v_se_id);
  end if;

  select array_agg(qid) into v_qids
  from (select eq.question_id as qid from public.exam_questions eq
        where eq.exam_id = p_exam_id order by eq.position) s;

  if v_qids is null then
    raise exception 'Exam has no questions';
  end if;

  v_order := to_jsonb(v_qids);
  if v_exam.randomize_questions then
    select jsonb_agg(qid) into v_order
    from (select unnest(v_qids) as qid order by random()) s;
  end if;

  select coalesce(max(attempt_number), 0) + 1 into v_attempt
  from public.student_exams
  where exam_id = p_exam_id and student_user_id = v_user_id;

  insert into public.student_exams
    (exam_id, student_user_id, status, started_at, question_order, current_question_index,
     time_used_seconds, is_online, last_active_at, attempt_number)
  values
    (p_exam_id, v_user_id, 'in_progress', now(), v_order, 0, 0, true, now(), v_attempt)
  returning id into v_se_id;

  insert into public.activity_logs
    (student_exam_id, student_user_id, exam_id, event_type, risk_points, meta)
  values (v_se_id, v_user_id, p_exam_id, 'started', 0, '{}'::jsonb);

  return (select to_jsonb(se) from public.student_exams se where se.id = v_se_id);
end;
$$;

-- fn_my_current_attempt (+ session guard) ------------------------------------
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

  if not public.fn_session_valid() then
    raise exception 'SESSION_TAKEN: This account signed in on another device. Please sign in again on this device to continue.';
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

-- fn_save_answer (essay-aware version + session guard) ------------------------
create or replace function public.fn_save_answer(
  p_student_exam_id uuid,
  p_question_id uuid,
  p_choice_id uuid default null,
  p_time_spent int default 0,
  p_answer_text text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_qtype text;
begin
  if public.auth_app_role() <> 'student' then
    raise exception 'Forbidden';
  end if;

  if not public.fn_session_valid() then
    raise exception 'SESSION_TAKEN: This account signed in on another device. Please sign in again on this device to continue.';
  end if;

  if not exists (
    select 1 from public.student_exams
    where id = p_student_exam_id and student_user_id = v_user_id and status = 'in_progress'
  ) then
    raise exception 'Exam session not active';
  end if;

  select question_type into v_qtype from public.questions where id = p_question_id;
  if v_qtype is null then
    raise exception 'Question not found';
  end if;

  if v_qtype = 'essay' then
    insert into public.student_answers (student_exam_id, question_id, choice_id, answer_text, time_spent_seconds, is_correct, points_earned)
    values (p_student_exam_id, p_question_id, null, nullif(trim(coalesce(p_answer_text, '')), ''), coalesce(p_time_spent, 0), null, null)
    on conflict (student_exam_id, question_id)
    do update set
      choice_id = null,
      answer_text = excluded.answer_text,
      time_spent_seconds = excluded.time_spent_seconds,
      -- preserve manual grades: never overwrite graded points on autosave
      is_correct = case when student_answers.graded_at is not null then student_answers.is_correct else null end,
      points_earned = case when student_answers.graded_at is not null then student_answers.points_earned else null end,
      updated_at = now();
  else
    insert into public.student_answers (student_exam_id, question_id, choice_id, answer_text, time_spent_seconds, is_correct, points_earned)
    values (p_student_exam_id, p_question_id, p_choice_id, null, coalesce(p_time_spent, 0), null, null)
    on conflict (student_exam_id, question_id)
    do update set
      choice_id = excluded.choice_id,
      answer_text = null,
      time_spent_seconds = excluded.time_spent_seconds,
      updated_at = now();
  end if;
end;
$$;

-- fn_update_progress (+ session guard) ----------------------------------------
create or replace function public.fn_update_progress(p_student_exam_id uuid, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if public.auth_app_role() <> 'student' then
    raise exception 'Forbidden';
  end if;

  if not public.fn_session_valid() then
    raise exception 'SESSION_TAKEN: This account signed in on another device. Please sign in again on this device to continue.';
  end if;

  if not exists (
    select 1 from public.student_exams
    where id = p_student_exam_id and student_user_id = v_user_id
  ) then
    raise exception 'Forbidden';
  end if;

  update public.student_exams
  set
    answers = coalesce(p_payload->'answers', answers),
    current_question_index = coalesce((p_payload->>'current_question_index')::int, current_question_index),
    time_used_seconds = greatest(coalesce((p_payload->>'time_used_seconds')::int, time_used_seconds), 0),
    is_online = coalesce((p_payload->>'is_online')::boolean, is_online),
    last_active_at = now()
  where id = p_student_exam_id;
end;
$$;

-- fn_log_event (keyboard-shortcut version + session guard) --------------------
create or replace function public.fn_log_event(
  p_student_exam_id uuid,
  p_event_type text,
  p_meta jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_exam_id uuid;
  v_points int;
  v_log_id bigint;
begin
  if public.auth_app_role() <> 'student' then
    raise exception 'Forbidden';
  end if;

  if not public.fn_session_valid() then
    raise exception 'SESSION_TAKEN: This account signed in on another device. Please sign in again on this device to continue.';
  end if;

  select exam_id into v_exam_id
  from public.student_exams
  where id = p_student_exam_id and student_user_id = v_user_id;

  if v_exam_id is null then
    raise exception 'Forbidden';
  end if;

  v_points := case p_event_type
    when 'tab_switch' then 10
    when 'window_blur' then 5
    when 'fullscreen_exit' then 15
    when 'copy_attempt' then 20
    when 'paste_attempt' then 20
    when 'cut_attempt' then 15
    when 'right_click' then 5
    when 'selection_attempt' then 5
    when 'devtools' then 25
    when 'refresh_attempt' then 15
    when 'navigate_attempt' then 10
    when 'find_attempt' then 10
    when 'print_attempt' then 15
    when 'save_attempt' then 15
    when 'zoom_attempt' then 5
    when 'new_tab' then 10
    when 'idle' then 10
    when 'warning' then 5
    else 0
  end;

  insert into public.activity_logs
    (student_exam_id, student_user_id, exam_id, event_type, risk_points, meta)
  values (p_student_exam_id, v_user_id, v_exam_id, p_event_type, v_points, p_meta)
  returning id into v_log_id;

  insert into public.risk_scores
    (student_exam_id, student_user_id, exam_id, total_points, level,
     tab_switches, fullscreen_exits, copy_attempts, paste_attempts, cut_attempts,
     devtools_attempts, refresh_attempts, navigate_attempts, find_attempts,
     print_attempts, save_attempts, zoom_attempts, new_tab_attempts,
     idle_events, idle_seconds)
  values
    (p_student_exam_id, v_user_id, v_exam_id, v_points, public.fn_risk_level(v_points),
     case when p_event_type = 'tab_switch' then 1 else 0 end,
     case when p_event_type = 'fullscreen_exit' then 1 else 0 end,
     case when p_event_type = 'copy_attempt' then 1 else 0 end,
     case when p_event_type = 'paste_attempt' then 1 else 0 end,
     case when p_event_type = 'cut_attempt' then 1 else 0 end,
     case when p_event_type = 'devtools' then 1 else 0 end,
     case when p_event_type = 'refresh_attempt' then 1 else 0 end,
     case when p_event_type = 'navigate_attempt' then 1 else 0 end,
     case when p_event_type = 'find_attempt' then 1 else 0 end,
     case when p_event_type = 'print_attempt' then 1 else 0 end,
     case when p_event_type = 'save_attempt' then 1 else 0 end,
     case when p_event_type = 'zoom_attempt' then 1 else 0 end,
     case when p_event_type = 'new_tab' then 1 else 0 end,
     case when p_event_type = 'idle' then 1 else 0 end,
     coalesce((p_meta->>'seconds')::int, 0))
  on conflict (student_exam_id) do update
  set total_points = risk_scores.total_points + excluded.total_points,
      level = public.fn_risk_level(risk_scores.total_points + excluded.total_points),
      tab_switches = risk_scores.tab_switches + excluded.tab_switches,
      fullscreen_exits = risk_scores.fullscreen_exits + excluded.fullscreen_exits,
      copy_attempts = risk_scores.copy_attempts + excluded.copy_attempts,
      paste_attempts = risk_scores.paste_attempts + excluded.paste_attempts,
      cut_attempts = risk_scores.cut_attempts + excluded.cut_attempts,
      devtools_attempts = risk_scores.devtools_attempts + excluded.devtools_attempts,
      refresh_attempts = risk_scores.refresh_attempts + excluded.refresh_attempts,
      navigate_attempts = risk_scores.navigate_attempts + excluded.navigate_attempts,
      find_attempts = risk_scores.find_attempts + excluded.find_attempts,
      print_attempts = risk_scores.print_attempts + excluded.print_attempts,
      save_attempts = risk_scores.save_attempts + excluded.save_attempts,
      zoom_attempts = risk_scores.zoom_attempts + excluded.zoom_attempts,
      new_tab_attempts = risk_scores.new_tab_attempts + excluded.new_tab_attempts,
      idle_events = risk_scores.idle_events + excluded.idle_events,
      idle_seconds = risk_scores.idle_seconds + excluded.idle_seconds,
      updated_at = now();

  update public.student_exams
  set risk_score = (select total_points from public.risk_scores where student_exam_id = p_student_exam_id),
      last_active_at = now()
  where id = p_student_exam_id;

  return (select to_jsonb(a) from public.activity_logs a where id = v_log_id);
end;
$$;

-- fn_submit_exam (essay-aware version + session guard) -------------------------
create or replace function public.fn_submit_exam(
  p_student_exam_id uuid,
  p_answers jsonb,
  p_time_used int
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_exam exams%rowtype;
  v_question_id uuid;
  v_qtype text;
  v_raw text;
  v_choice_id uuid;
  v_correct uuid;
  v_points int;
  v_text text;
  v_total int := 0;
  v_earned numeric(8,2) := 0;
  v_percent numeric;
  v_passed boolean;
  v_pending boolean := false;
  v_duration int;
begin
  if public.auth_app_role() <> 'student' then
    raise exception 'Forbidden';
  end if;

  if not public.fn_session_valid() then
    raise exception 'SESSION_TAKEN: This account signed in on another device. Please sign in again on this device to continue.';
  end if;

  select e.* into v_exam
  from public.student_exams se
  join public.exams e on e.id = se.exam_id
  where se.id = p_student_exam_id and se.student_user_id = v_user_id;

  if v_exam is null then
    raise exception 'Forbidden';
  end if;

  if not exists (
    select 1 from public.student_exams
    where id = p_student_exam_id and status in ('in_progress', 'time_up')
  ) then
    raise exception 'Exam already submitted';
  end if;

  v_duration := v_exam.duration_minutes * 60;

  for v_question_id in
    select t.qid::uuid
    from public.student_exams se
    join lateral jsonb_array_elements_text(se.question_order) as t(qid) on true
    where se.id = p_student_exam_id
  loop
    select question_type, coalesce(points, 0) into v_qtype, v_points
    from public.questions where id = v_question_id;
    v_qtype := coalesce(v_qtype, 'multiple_choice');
    v_total := v_total + coalesce(v_points, 0);
    v_raw := p_answers->>v_question_id::text;

    if v_qtype = 'essay' then
      v_text := nullif(trim(coalesce(v_raw, '')), '');
      if v_text is not null then
        -- keep any existing manual grade (e.g. re-submit edge cases)
        insert into public.student_answers
          (student_exam_id, question_id, choice_id, answer_text, is_correct, points_earned, time_spent_seconds)
        values (p_student_exam_id, v_question_id, null, v_text, null, null, 0)
        on conflict (student_exam_id, question_id) do update
        set answer_text = excluded.answer_text,
            choice_id = null,
            is_correct = case when student_answers.graded_at is not null then student_answers.is_correct else null end,
            points_earned = case when student_answers.graded_at is not null then student_answers.points_earned else null end;
      else
        insert into public.student_answers
          (student_exam_id, question_id, choice_id, answer_text, is_correct, points_earned, time_spent_seconds)
        values (p_student_exam_id, v_question_id, null, null, null, null, 0)
        on conflict (student_exam_id, question_id) do update
        set answer_text = excluded.answer_text,
            choice_id = null;
      end if;
      -- essays always need manual grading (blank answers earn 0 but still pending
      -- until a teacher confirms, so they show up in the grading queue)
      v_pending := true;
      -- add already-graded essay points (re-submits / teacher graded before submit edge)
      v_earned := v_earned + coalesce(
        (select points_earned from public.student_answers
         where student_exam_id = p_student_exam_id and question_id = v_question_id), 0);
    else
      v_choice_id := null;
      if v_raw is not null and v_raw <> '' then
        begin
          v_choice_id := v_raw::uuid;
        exception when others then
          v_choice_id := null;
        end;
      end if;

      select c.id into v_correct
      from public.choices c
      where c.question_id = v_question_id and c.is_correct
      limit 1;

      insert into public.student_answers
        (student_exam_id, question_id, choice_id, answer_text, is_correct, points_earned, time_spent_seconds)
      values
        (p_student_exam_id, v_question_id, v_choice_id, null,
         (v_choice_id is not null and v_choice_id = v_correct),
         case when v_choice_id is not null and v_choice_id = v_correct then v_points else 0 end,
         0)
      on conflict (student_exam_id, question_id) do update
      set choice_id = excluded.choice_id,
          answer_text = null,
          is_correct = excluded.is_correct,
          points_earned = excluded.points_earned;

      if v_choice_id is not null and v_choice_id = v_correct then
        v_earned := v_earned + coalesce(v_points, 0);
      end if;
    end if;
  end loop;

  v_percent := case when v_total > 0 then round((v_earned / v_total * 100)::numeric, 2) else 0 end;
  -- while essays are pending, don't auto-fail the student
  v_passed := case when v_pending then null
                   when v_total > 0 then v_percent >= v_exam.passing_score
                   else false end;

  update public.student_exams
  set status = 'submitted',
      submitted_at = now(),
      score = v_earned,
      score_percent = v_percent,
      passed = v_passed,
      grading_status = case when v_pending then 'pending' else 'complete' end,
      time_used_seconds = least(coalesce(p_time_used, 0), v_duration),
      is_online = false,
      last_active_at = now()
  where id = p_student_exam_id;

  insert into public.activity_logs
    (student_exam_id, student_user_id, exam_id, event_type, risk_points, meta)
  values (p_student_exam_id, v_user_id, v_exam.id, 'submitted', 0,
          jsonb_build_object('score', v_earned, 'percent', v_percent, 'total', v_total, 'pending_grading', v_pending));

  return (select to_jsonb(se) from public.student_exams se where se.id = p_student_exam_id);
end;
$$;

-- fn_student_exam_questions (essay-aware version + session guard) --------------
create or replace function public.fn_student_exam_questions(p_student_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_se student_exams%rowtype;
  v_exam exams%rowtype;
  v_result jsonb;
begin
  if public.auth_app_role() <> 'student' then
    raise exception 'Forbidden';
  end if;

  if not public.fn_session_valid() then
    raise exception 'SESSION_TAKEN: This account signed in on another device. Please sign in again on this device to continue.';
  end if;

  select * into v_se from public.student_exams
  where id = p_student_exam_id and student_user_id = v_user_id;

  if v_se is null then
    raise exception 'Forbidden';
  end if;

  select * into v_exam from public.exams where id = v_se.exam_id;
  if v_exam.status <> 'published' then
    raise exception 'Exam not available';
  end if;
  if v_exam.start_time is not null and v_exam.start_time > now() then
    raise exception 'Exam has not started yet';
  end if;
  if v_exam.end_time is not null and v_exam.end_time < now() then
    raise exception 'Exam has ended';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'exam_id', v_se.exam_id,
      'question_id', q.id,
      'position', t.pos,
      'points', q.points,
      'content', q.content,
      'difficulty', q.difficulty,
      'category', q.category,
      'explanation', null,
      'question_type', coalesce(q.question_type, 'multiple_choice'),
      'min_words', coalesce(q.min_words, 0),
      'max_words', q.max_words,
      'choices', case when coalesce(q.question_type, 'multiple_choice') = 'essay' then '[]'::jsonb
        else (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', c.id, 'content', c.content, 'position', c.position)
                  order by c.position), '[]'::jsonb)
                from public.choices c where c.question_id = q.id) end
    ) order by t.pos), '[]'::jsonb) into v_result
  from lateral jsonb_array_elements_text(v_se.question_order) with ordinality as t(qid, pos)
  join public.questions q on q.id = t.qid::uuid;

  return v_result;
end;
$$;

-- fn_result_detail (essay-aware version + session guard for students) ----------
create or replace function public.fn_result_detail(p_student_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.auth_app_role();
  v_user_id uuid := auth.uid();
  v_se student_exams%rowtype;
  v_exam exams%rowtype;
  v_answers jsonb;
  v_risk jsonb;
  v_reveal boolean;
begin
  select * into v_se from public.student_exams where id = p_student_exam_id;
  if v_se is null then
    raise exception 'Not found';
  end if;

  if v_role = 'student' and v_se.student_user_id <> v_user_id then
    raise exception 'Forbidden';
  end if;
  if v_role = 'teacher' and not exists (
    select 1 from public.exams e where e.id = v_se.exam_id and e.teacher_id = v_user_id
  ) then
    raise exception 'Forbidden';
  end if;

  -- single-session enforcement applies to students only (fn returns true for teachers)
  if not public.fn_session_valid() then
    raise exception 'SESSION_TAKEN: This account signed in on another device. Please sign in again on this device to continue.';
  end if;

  select * into v_exam from public.exams where id = v_se.exam_id;
  v_reveal := (v_role = 'teacher') or (v_role = 'student' and v_exam.allow_review);

  select coalesce(jsonb_agg(jsonb_build_object(
      'question_id', q.id,
      'content', q.content,
      'difficulty', q.difficulty,
      'category', q.category,
      'points', q.points,
      'explanation', case when v_reveal then q.explanation else null end,
      'question_type', coalesce(q.question_type, 'multiple_choice'),
      'model_answer', case when v_role = 'teacher' then q.model_answer else null end,
      'min_words', coalesce(q.min_words, 0),
      'max_words', q.max_words,
      'choice_id', sa.choice_id,
      'answer_text', sa.answer_text,
      'feedback', case when v_reveal then sa.feedback else null end,
      'graded_at', sa.graded_at,
      'is_correct', sa.is_correct,
      'points_earned', sa.points_earned,
      'time_spent_seconds', sa.time_spent_seconds,
      'choices', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', c.id, 'content', c.content,
                    'is_correct', case when v_reveal then c.is_correct else null end,
                    'position', c.position) order by c.position), '[]'::jsonb)
                  from public.choices c where c.question_id = q.id)
    ) order by t.pos), '[]'::jsonb) into v_answers
  from public.student_exams se
  join lateral jsonb_array_elements_text(se.question_order) with ordinality as t(qid, pos) on true
  join public.questions q on q.id = t.qid::uuid
  left join public.student_answers sa on sa.question_id = q.id and sa.student_exam_id = p_student_exam_id
  where se.id = p_student_exam_id;

  select to_jsonb(rs) into v_risk
  from public.risk_scores rs where rs.student_exam_id = p_student_exam_id;

  return jsonb_build_object(
    'student_exam', to_jsonb(v_se),
    'exam', to_jsonb(v_exam),
    'student', (select to_jsonb(u) from public.users u where u.id = v_se.student_user_id),
    'answers', coalesce(v_answers, '[]'::jsonb),
    'risk', coalesce(v_risk, '{}'::jsonb)
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Extend the student RLS read policies with the session check, so a stale
--    token cannot be used for direct table reads either. Teacher policies and
--    all write paths (already function-gated) are untouched.
-- ----------------------------------------------------------------------------

drop policy if exists "students can read their own profile" on public.users;
create policy "students can read their own profile"
  on public.users for select to authenticated
  using (public.auth_app_role() = 'student' and id = auth.uid() and public.fn_session_valid());

drop policy if exists "students can read courses" on public.courses;
create policy "students can read courses"
  on public.courses for select to authenticated
  using (public.auth_app_role() = 'student' and public.fn_session_valid());

drop policy if exists "students can read published exams in window" on public.exams;
create policy "students can read published exams in window"
  on public.exams for select to authenticated
  using (
    public.auth_app_role() = 'student'
    and status = 'published'
    and (start_time is null or start_time <= now())
    and (end_time is null or end_time >= now())
    and public.fn_session_valid()
  );

drop policy if exists "students can read their own exam access" on public.exam_access;
create policy "students can read their own exam access"
  on public.exam_access for select to authenticated
  using (
    public.auth_app_role() = 'student'
    and student_user_id = auth.uid()
    and public.fn_session_valid()
  );

drop policy if exists "students can read their own exam records" on public.student_exams;
create policy "students can read their own exam records"
  on public.student_exams for select to authenticated
  using (public.auth_app_role() = 'student' and student_user_id = auth.uid() and public.fn_session_valid());

drop policy if exists "students can read their own answers" on public.student_answers;
create policy "students can read their own answers"
  on public.student_answers for select to authenticated
  using (exists (
    select 1 from public.student_exams se
    where se.id = student_answers.student_exam_id and se.student_user_id = auth.uid()
  ) and public.fn_session_valid());

drop policy if exists "students can read their own activity logs" on public.activity_logs;
create policy "students can read their own activity logs"
  on public.activity_logs for select to authenticated
  using (exists (
    select 1 from public.student_exams se
    where se.id = activity_logs.student_exam_id and se.student_user_id = auth.uid()
  ) and public.fn_session_valid());

drop policy if exists "students can read their own risk scores" on public.risk_scores;
create policy "students can read their own risk scores"
  on public.risk_scores for select to authenticated
  using (exists (
    select 1 from public.student_exams se
    where se.id = risk_scores.student_exam_id and se.student_user_id = auth.uid()
  ) and public.fn_session_valid());
