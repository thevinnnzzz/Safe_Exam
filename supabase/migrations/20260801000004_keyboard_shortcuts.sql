-- ----------------------------------------------------------------------------
-- Add keyboard-shortcut proctoring events (refresh/navigate/find/print/save/
-- zoom/new tab) and their counters on risk_scores.
-- ----------------------------------------------------------------------------

alter table public.risk_scores
  add column if not exists refresh_attempts int not null default 0,
  add column if not exists navigate_attempts int not null default 0,
  add column if not exists find_attempts int not null default 0,
  add column if not exists print_attempts int not null default 0,
  add column if not exists save_attempts int not null default 0,
  add column if not exists zoom_attempts int not null default 0,
  add column if not exists new_tab_attempts int not null default 0;

-- ----------------------------------------------------------------------------
-- fn_log_event: assign points + update risk_scores for the new event types.
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
