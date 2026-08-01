-- ============================================================================
-- SECURITY DEFINER functions
-- Run as the table owner (postgres) so they can read `choices.is_correct`,
-- enforce integrity, and gate access via auth.jwt() claims.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Start an exam: creates the student_exams row with a (possibly randomized)
-- question order. Returns the existing row if already started (idempotent).
-- ----------------------------------------------------------------------------
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
begin
  if public.auth_app_role() <> 'student' then
    raise exception 'Forbidden';
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

  select se.id into v_se_id from public.student_exams se
  where se.exam_id = p_exam_id and se.student_user_id = v_user_id;

  if v_se_id is not null then
    update public.student_exams
    set is_online = true, last_active_at = now()
    where id = v_se_id and status = 'in_progress';
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

  insert into public.student_exams
    (exam_id, student_user_id, status, started_at, question_order, current_question_index,
     time_used_seconds, is_online, last_active_at)
  values
    (p_exam_id, v_user_id, 'in_progress', now(), v_order, 0, 0, true, now())
  returning id into v_se_id;

  insert into public.activity_logs
    (student_exam_id, student_user_id, exam_id, event_type, risk_points, meta)
  values (v_se_id, v_user_id, p_exam_id, 'started', 0, '{}'::jsonb);

  return (select to_jsonb(se) from public.student_exams se where se.id = v_se_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- Upsert a single answer (autosave). is_correct/points are NOT writable by
-- students; they are computed at submission time.
-- ----------------------------------------------------------------------------
create or replace function public.fn_save_answer(
  p_student_exam_id uuid,
  p_question_id uuid,
  p_choice_id uuid,
  p_time_spent int
)
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
  if not exists (
    select 1 from public.student_exams
    where id = p_student_exam_id and student_user_id = v_user_id and status = 'in_progress'
  ) then
    raise exception 'Exam session not active';
  end if;

  insert into public.student_answers (student_exam_id, question_id, choice_id, time_spent_seconds, is_correct, points_earned)
  values (p_student_exam_id, p_question_id, p_choice_id, p_time_spent, null, null)
  on conflict (student_exam_id, question_id)
  do update set
    choice_id = excluded.choice_id,
    time_spent_seconds = excluded.time_spent_seconds,
    updated_at = now();
end;
$$;

-- ----------------------------------------------------------------------------
-- Update lightweight progress state (snapshot answers, current question index,
-- time used, online heartbeat). Prevents students from writing their own
-- scores/status directly.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- Log a proctoring event. Risk points are assigned server-side from the event
-- type (students cannot self-report lower points). Updates risk_scores +
-- student_exams.risk_score atomically.
-- ----------------------------------------------------------------------------
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
     devtools_attempts, idle_events, idle_seconds)
  values
    (p_student_exam_id, v_user_id, v_exam_id, v_points, public.fn_risk_level(v_points),
     case when p_event_type = 'tab_switch' then 1 else 0 end,
     case when p_event_type = 'fullscreen_exit' then 1 else 0 end,
     case when p_event_type = 'copy_attempt' then 1 else 0 end,
     case when p_event_type = 'paste_attempt' then 1 else 0 end,
     case when p_event_type = 'cut_attempt' then 1 else 0 end,
     case when p_event_type = 'devtools' then 1 else 0 end,
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

-- ----------------------------------------------------------------------------
-- Submit + grade an exam. Server-side grading only; students never supply
-- correct answers or scores.
-- ----------------------------------------------------------------------------
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
  v_choice_id uuid;
  v_correct uuid;
  v_points int;
  v_total int := 0;
  v_earned int := 0;
  v_percent numeric;
  v_passed boolean;
  v_duration int;
begin
  if public.auth_app_role() <> 'student' then
    raise exception 'Forbidden';
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
    v_choice_id := null;
    if p_answers ? v_question_id::text then
      begin
        v_choice_id := (p_answers->>v_question_id::text)::uuid;
      exception when others then
        v_choice_id := null;
      end;
    end if;

    select coalesce(points, 0) into v_points from public.questions where id = v_question_id;
    v_total := v_total + coalesce(v_points, 0);

    select c.id into v_correct
    from public.choices c
    where c.question_id = v_question_id and c.is_correct
    limit 1;

    insert into public.student_answers
      (student_exam_id, question_id, choice_id, is_correct, points_earned, time_spent_seconds)
    values
      (p_student_exam_id, v_question_id, v_choice_id,
       (v_choice_id is not null and v_choice_id = v_correct),
       case when v_choice_id is not null and v_choice_id = v_correct then v_points else 0 end,
       0)
    on conflict (student_exam_id, question_id) do update
    set choice_id = excluded.choice_id,
        is_correct = excluded.is_correct,
        points_earned = excluded.points_earned;

    if v_choice_id is not null and v_choice_id = v_correct then
      v_earned := v_earned + coalesce(v_points, 0);
    end if;
  end loop;

  v_percent := case when v_total > 0 then round((v_earned::numeric / v_total * 100)::numeric, 2) else 0 end;
  v_passed := v_total > 0 and v_percent >= v_exam.passing_score;

  update public.student_exams
  set status = 'submitted',
      submitted_at = now(),
      score = v_earned,
      score_percent = v_percent,
      passed = v_passed,
      time_used_seconds = least(coalesce(p_time_used, 0), v_duration),
      is_online = false,
      last_active_at = now()
  where id = p_student_exam_id;

  insert into public.activity_logs
    (student_exam_id, student_user_id, exam_id, event_type, risk_points, meta)
  values (p_student_exam_id, v_user_id, v_exam.id, 'submitted', 0,
          jsonb_build_object('score', v_earned, 'percent', v_percent, 'total', v_total));

  return (select to_jsonb(se) from public.student_exams se where se.id = p_student_exam_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- Student: fetch the questions for a live exam attempt, WITHOUT correct
-- answers. Only for the caller's own active exam within its availability.
-- ----------------------------------------------------------------------------
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
      'choices', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', c.id, 'content', c.content, 'position', c.position)
                    order by c.position), '[]'::jsonb)
                  from public.choices c where c.question_id = q.id)
    ) order by t.pos), '[]'::jsonb) into v_result
  from lateral jsonb_array_elements_text(v_se.question_order) with ordinality as t(qid, pos)
  join public.questions q on q.id = t.qid::uuid;

  return v_result;
end;
$$;

-- ----------------------------------------------------------------------------
-- Teacher: full exam detail with questions and correct answers.
-- ----------------------------------------------------------------------------
create or replace function public.fn_teacher_exam_detail(p_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_teacher uuid := auth.uid();
  v_exam jsonb;
  v_questions jsonb;
begin
  if public.auth_app_role() <> 'teacher' then
    raise exception 'Forbidden';
  end if;
  if not exists (select 1 from public.exams where id = p_exam_id and teacher_id = v_teacher) then
    raise exception 'Forbidden';
  end if;

  select to_jsonb(e) into v_exam from public.exams e where e.id = p_exam_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', q.id,
      'question_bank_id', q.question_bank_id,
      'content', q.content,
      'difficulty', q.difficulty,
      'category', q.category,
      'points', q.points,
      'explanation', q.explanation,
      'position', eq.position,
      'choices', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', c.id, 'content', c.content, 'is_correct', c.is_correct, 'position', c.position)
                    order by c.position), '[]'::jsonb)
                  from public.choices c where c.question_id = q.id)
    ) order by eq.position), '[]'::jsonb) into v_questions
  from public.exam_questions eq
  join public.questions q on q.id = eq.question_id
  where eq.exam_id = p_exam_id;

  return jsonb_build_object('exam', v_exam, 'questions', v_questions);
end;
$$;

-- ----------------------------------------------------------------------------
-- Teacher: all questions of a question bank with correct answers.
-- ----------------------------------------------------------------------------
create or replace function public.fn_teacher_bank_questions(p_bank_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_teacher uuid := auth.uid();
  v_questions jsonb;
begin
  if public.auth_app_role() <> 'teacher' then
    raise exception 'Forbidden';
  end if;
  if not exists (select 1 from public.question_bank where id = p_bank_id and teacher_id = v_teacher) then
    raise exception 'Forbidden';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', q.id,
      'question_id', q.id,
      'question_bank_id', q.question_bank_id,
      'content', q.content,
      'difficulty', q.difficulty,
      'category', q.category,
      'points', q.points,
      'explanation', q.explanation,
      'created_at', q.created_at,
      'choices', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', c.id, 'content', c.content, 'is_correct', c.is_correct, 'position', c.position)
                    order by c.position), '[]'::jsonb)
                  from public.choices c where c.question_id = q.id)
    ) order by q.created_at desc), '[]'::jsonb) into v_questions
  from public.questions q
  where q.question_bank_id = p_bank_id;

  return v_questions;
end;
$$;

-- ----------------------------------------------------------------------------
-- Result detail (teacher OR student). Students only receive correct answers /
-- explanations when the exam allows review.
-- ----------------------------------------------------------------------------
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

  select * into v_exam from public.exams where id = v_se.exam_id;
  v_reveal := (v_role = 'teacher') or (v_role = 'student' and v_exam.allow_review);

  select coalesce(jsonb_agg(jsonb_build_object(
      'question_id', q.id,
      'content', q.content,
      'difficulty', q.difficulty,
      'category', q.category,
      'points', q.points,
      'explanation', case when v_reveal then q.explanation else null end,
      'choice_id', sa.choice_id,
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
-- Teacher: compact results export for CSV.
-- ----------------------------------------------------------------------------
create or replace function public.fn_export_results(p_exam_id uuid)
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
  if not exists (select 1 from public.exams where id = p_exam_id and teacher_id = v_teacher) then
    raise exception 'Forbidden';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'student_exam_id', se.id,
      'student_id', u.student_id,
      'full_name', u.full_name,
      'status', se.status,
      'started_at', se.started_at,
      'submitted_at', se.submitted_at,
      'time_used_seconds', se.time_used_seconds,
      'score', se.score,
      'score_percent', se.score_percent,
      'passed', se.passed,
      'risk_score', se.risk_score,
      'risk_level', coalesce((select rs.level from public.risk_scores rs where rs.student_exam_id = se.id), 'low')
    ) order by se.submitted_at nulls last), '[]'::jsonb) into v_rows
  from public.student_exams se
  join public.users u on u.id = se.student_user_id
  where se.exam_id = p_exam_id;

  return v_rows;
end;
$$;
