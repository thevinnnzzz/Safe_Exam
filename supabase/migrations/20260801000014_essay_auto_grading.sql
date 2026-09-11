-- ============================================================================
-- Essay auto-grading from teacher-provided keywords (+ similar-phrase match).
-- ----------------------------------------------------------------------------
-- Teachers can attach a keyword/phrase list to an essay question and enable
-- auto-grading. At submit time each non-blank answer is scored automatically:
--   earned = round(max_points * matched_keywords / total_keywords, 2)
-- A keyword counts as matched when it (or every significant word of a phrase)
-- appears in the answer exactly (case-insensitive) OR as a similar word
-- (pg_trgm word-level similarity, tolerates minor misspellings).
-- Auto-graded answers still show in the teacher's grading view and can be
-- overridden at any time with the existing manual grade function.
-- ============================================================================

create extension if not exists pg_trgm;

alter table public.questions
  add column if not exists essay_keywords text[] not null default '{}';

alter table public.questions
  add column if not exists essay_autograde boolean not null default false;

alter table public.student_answers
  add column if not exists auto_graded boolean not null default false;

-- ----------------------------------------------------------------------------
-- Does one keyword/phrase match an answer? Exact (case-insensitive) substring
-- wins; otherwise every significant word (>= 4 chars) of the keyword must
-- appear exactly or as a trigram-similar word (handles "quite similar"
-- spellings). Short words require exact match to avoid false positives.
-- ----------------------------------------------------------------------------
create or replace function public.fn_essay_keyword_matched(p_answer text, p_keyword text)
returns boolean
language plpgsql
stable
set search_path = public, extensions, pg_temp
as $$
declare
  v_ans text := lower(coalesce(p_answer, ''));
  v_kw text := lower(trim(both from coalesce(p_keyword, '')));
  v_word text;
  v_aword text;
  v_found boolean;
begin
  if v_kw = '' or v_ans = '' then
    return false;
  end if;

  -- exact phrase / keyword present
  if position(v_kw in v_ans) > 0 then
    return true;
  end if;

  -- phrase: every significant word must be found (exactly or similarly)
  for v_word in select regexp_split_to_table(v_kw, '[^a-z0-9]+') loop
    if v_word = '' then
      continue;
    end if;
    if char_length(v_word) < 4 then
      if position(v_word in v_ans) = 0 then
        return false;
      end if;
      continue;
    end if;
    if position(v_word in v_ans) > 0 then
      continue;
    end if;
    v_found := false;
    for v_aword in select regexp_split_to_table(v_ans, '[^a-z0-9]+') loop
      if char_length(v_aword) >= 4 and similarity(v_aword, v_word) >= 0.5 then
        v_found := true;
        exit;
      end if;
    end loop;
    if not v_found then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

-- ----------------------------------------------------------------------------
-- Score one essay answer: { earned, matched[], total }.
-- ----------------------------------------------------------------------------
create or replace function public.fn_score_essay_answer(
  p_answer text,
  p_keywords text[],
  p_max_points numeric
)
returns jsonb
language plpgsql
stable
set search_path = public, extensions, pg_temp
as $$
declare
  v_kw text;
  v_matched text[] := '{}';
  v_total int := 0;
  v_count int := 0;
  v_earned numeric(8,2) := 0;
begin
  if p_keywords is null then
    p_keywords := '{}';
  end if;
  for v_kw in select trim(both from k) from unnest(p_keywords) as k loop
    if v_kw = '' then
      continue;
    end if;
    v_total := v_total + 1;
    if public.fn_essay_keyword_matched(p_answer, v_kw) then
      v_matched := v_matched || v_kw;
      v_count := v_count + 1;
    end if;
  end loop;

  if v_total > 0 then
    v_earned := round((coalesce(p_max_points, 0) * v_count)::numeric / v_total, 2);
  end if;

  return jsonb_build_object('earned', v_earned, 'matched', to_jsonb(v_matched), 'total', v_total);
end;
$$;

-- ----------------------------------------------------------------------------
-- Shared worker: auto-grade every still-ungraded, eligible essay answer of an
-- attempt. Used at submit time (student context) and on teacher re-run.
-- Returns { graded, pending }.
-- ----------------------------------------------------------------------------
create or replace function public.fn_autograde_attempt_essays(p_student_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_res jsonb;
  v_earned numeric(8,2);
  v_matched text[];
  v_matched_count int := 0;
  v_total int;
  v_graded int := 0;
  v_pending int := 0;
begin
  for v_row in
    select sa.question_id, sa.answer_text, q.points as qmax, q.essay_keywords
    from public.student_answers sa
    join public.questions q on q.id = sa.question_id
    where sa.student_exam_id = p_student_exam_id
      and coalesce(q.question_type, 'multiple_choice') = 'essay'
      and sa.answer_text is not null
      and sa.points_earned is null
      and coalesce(q.essay_autograde, false)
      and coalesce(array_length(q.essay_keywords, 1), 0) > 0
  loop
    v_res := public.fn_score_essay_answer(v_row.answer_text, v_row.essay_keywords, v_row.qmax);
    v_earned := coalesce((v_res->>'earned')::numeric, 0);
    v_matched := array(select jsonb_array_elements_text(v_res->'matched'));
    v_matched_count := coalesce(array_length(v_matched, 1), 0);
    v_total := coalesce((v_res->>'total')::int, 0);

    update public.student_answers
    set points_earned = v_earned,
        is_correct = (v_earned >= coalesce(v_row.qmax, 0)),
        feedback = format('Auto-graded: matched %s of %s keyword%s%s',
                          v_matched_count,
                          v_total,
                          case when v_total = 1 then '' else 's' end,
                          case when v_matched_count > 0
                               then ' (' || array_to_string(v_matched, ', ') || ')' else '' end),
        graded_by = null,
        graded_at = now(),
        auto_graded = true,
        updated_at = now()
    where student_exam_id = p_student_exam_id and question_id = v_row.question_id;

    v_graded := v_graded + 1;
  end loop;

  select count(*) into v_pending
  from public.student_answers sa
  join public.questions q on q.id = sa.question_id
  where sa.student_exam_id = p_student_exam_id
    and coalesce(q.question_type, 'multiple_choice') = 'essay'
    and sa.points_earned is null;

  return jsonb_build_object('graded', v_graded, 'pending', v_pending);
end;
$$;

-- ----------------------------------------------------------------------------
-- fn_submit_exam: same as the single-session version, but eligible essays are
-- auto-graded at submit time; only still-ungraded essays keep the attempt
-- pending. Teacher manual grades made before submit are never overwritten.
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
  v_qtype text;
  v_raw text;
  v_choice_id uuid;
  v_correct uuid;
  v_points int;
  v_text text;
  v_total int := 0;
  v_earned numeric(8,2) := 0;
  v_essay_earned numeric(8,2) := 0;
  v_percent numeric;
  v_passed boolean;
  v_pending boolean := false;
  v_duration int;
  v_auto jsonb;
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
        -- keep any existing grade (manual, or a previous auto-grade)
        insert into public.student_answers
          (student_exam_id, question_id, choice_id, answer_text, is_correct, points_earned, time_spent_seconds, auto_graded)
        values (p_student_exam_id, v_question_id, null, v_text, null, null, 0, false)
        on conflict (student_exam_id, question_id) do update
        set answer_text = excluded.answer_text,
            choice_id = null,
            is_correct = case when student_answers.points_earned is not null then student_answers.is_correct else null end,
            points_earned = case when student_answers.points_earned is not null then student_answers.points_earned else null end,
            auto_graded = case when student_answers.points_earned is not null then student_answers.auto_graded else false end;
      else
        insert into public.student_answers
          (student_exam_id, question_id, choice_id, answer_text, is_correct, points_earned, time_spent_seconds)
        values (p_student_exam_id, v_question_id, null, null, null, null, 0)
        on conflict (student_exam_id, question_id) do update
        set answer_text = excluded.answer_text,
            choice_id = null;
      end if;
      -- essay scoring/pending is resolved after the loop (auto-grade + aggregate)
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

  -- auto-grade eligible essays once, then resolve essay scoring: an essay
  -- keeps the attempt pending only while it still has no score (blank answers
  -- earn 0 but still pend until a teacher confirms them).
  v_auto := public.fn_autograde_attempt_essays(p_student_exam_id);

  select coalesce(sum(coalesce(sa.points_earned, 0)), 0),
         (count(*) filter (where sa.points_earned is null) > 0)
  into v_essay_earned, v_pending
  from lateral jsonb_array_elements_text(
         (select question_order from public.student_exams where id = p_student_exam_id)
       ) with ordinality as t(qid, pos)
  join public.questions q on q.id = t.qid::uuid
  left join public.student_answers sa
    on sa.student_exam_id = p_student_exam_id and sa.question_id = q.id
  where coalesce(q.question_type, 'multiple_choice') = 'essay';

  v_earned := v_earned + coalesce(v_essay_earned, 0);

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

-- ----------------------------------------------------------------------------
-- fn_grade_essay_answer: manual grades always win (clears the auto flag).
-- ----------------------------------------------------------------------------
create or replace function public.fn_grade_essay_answer(
  p_student_exam_id uuid,
  p_question_id uuid,
  p_points numeric,
  p_feedback text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_teacher uuid := auth.uid();
  v_se student_exams%rowtype;
  v_exam exams%rowtype;
  v_qmax int;
  v_total int := 0;
  v_earned numeric(8,2) := 0;
  v_pending_count int := 0;
  v_percent numeric;
  v_passed boolean;
begin
  if public.auth_app_role() <> 'teacher' then
    raise exception 'Forbidden';
  end if;

  select * into v_se from public.student_exams where id = p_student_exam_id;
  if v_se is null then
    raise exception 'Attempt not found';
  end if;

  select * into v_exam from public.exams where id = v_se.exam_id;
  if v_exam is null or v_exam.teacher_id <> v_teacher then
    raise exception 'Forbidden';
  end if;

  select points into v_qmax from public.questions where id = p_question_id;
  if v_qmax is null then
    raise exception 'Question not found';
  end if;
  if (select question_type from public.questions where id = p_question_id) <> 'essay' then
    raise exception 'Only essay answers can be graded manually';
  end if;
  if p_points is null or p_points < 0 or p_points > v_qmax then
    raise exception 'Score must be between 0 and %', v_qmax;
  end if;

  update public.student_answers
  set points_earned = p_points,
      is_correct = (p_points >= v_qmax),
      feedback = nullif(trim(coalesce(p_feedback, '')), ''),
      graded_by = v_teacher,
      graded_at = now(),
      auto_graded = false,
      updated_at = now()
  where student_exam_id = p_student_exam_id and question_id = p_question_id;

  if not found then
    raise exception 'Answer not found — the student has not submitted this question yet';
  end if;

  -- recompute totals across the attempt's question order
  select
    coalesce(sum(q.points), 0),
    coalesce(sum(coalesce(sa.points_earned, 0)), 0),
    count(*) filter (where q.question_type = 'essay' and sa.points_earned is null)
  into v_total, v_earned, v_pending_count
  from lateral jsonb_array_elements_text(v_se.question_order) with ordinality as t(qid, pos)
  join public.questions q on q.id = t.qid::uuid
  left join public.student_answers sa
    on sa.student_exam_id = p_student_exam_id and sa.question_id = q.id;

  v_percent := case when v_total > 0 then round((v_earned / v_total * 100)::numeric, 2) else 0 end;
  v_passed := case when v_pending_count > 0 then null
                   when v_total > 0 then v_percent >= v_exam.passing_score
                   else false end;

  update public.student_exams
  set score = v_earned,
      score_percent = v_percent,
      passed = v_passed,
      grading_status = case when v_pending_count > 0 then 'pending' else 'complete' end,
      last_active_at = now()
  where id = p_student_exam_id;

  return (select to_jsonb(se) from public.student_exams se where se.id = p_student_exam_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- Teacher: (re-)run auto-grading over an attempt's still-ungraded essays
-- (e.g. after adding keywords post-submit), then recompute the attempt.
-- ----------------------------------------------------------------------------
create or replace function public.fn_autograde_student_exam(p_student_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_teacher uuid := auth.uid();
  v_se student_exams%rowtype;
  v_exam exams%rowtype;
  v_auto jsonb;
  v_total int := 0;
  v_earned numeric(8,2) := 0;
  v_pending_count int := 0;
  v_percent numeric;
  v_passed boolean;
begin
  if public.auth_app_role() <> 'teacher' then
    raise exception 'Forbidden';
  end if;

  select * into v_se from public.student_exams where id = p_student_exam_id;
  if v_se is null then
    raise exception 'Attempt not found';
  end if;

  select * into v_exam from public.exams where id = v_se.exam_id;
  if v_exam is null or v_exam.teacher_id <> v_teacher then
    raise exception 'Forbidden';
  end if;

  v_auto := public.fn_autograde_attempt_essays(p_student_exam_id);

  select
    coalesce(sum(q.points), 0),
    coalesce(sum(coalesce(sa.points_earned, 0)), 0),
    count(*) filter (where q.question_type = 'essay' and sa.points_earned is null)
  into v_total, v_earned, v_pending_count
  from lateral jsonb_array_elements_text(v_se.question_order) with ordinality as t(qid, pos)
  join public.questions q on q.id = t.qid::uuid
  left join public.student_answers sa
    on sa.student_exam_id = p_student_exam_id and sa.question_id = q.id;

  v_percent := case when v_total > 0 then round((v_earned / v_total * 100)::numeric, 2) else 0 end;
  v_passed := case when v_pending_count > 0 then null
                   when v_total > 0 then v_percent >= v_exam.passing_score
                   else false end;

  update public.student_exams
  set score = v_earned,
      score_percent = v_percent,
      passed = v_passed,
      grading_status = case when v_pending_count > 0 then 'pending' else 'complete' end,
      last_active_at = now()
  where id = p_student_exam_id;

  return jsonb_build_object(
    'graded', coalesce((v_auto->>'graded')::int, 0),
    'pending', v_pending_count,
    'student_exam', (select to_jsonb(se) from public.student_exams se where se.id = p_student_exam_id)
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- Expose the new fields to teachers (bank / exam detail) and the auto flag
-- to result detail (keywords stay teacher-only, like model answers).
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
      'question_type', coalesce(q.question_type, 'multiple_choice'),
      'model_answer', q.model_answer,
      'min_words', coalesce(q.min_words, 0),
      'max_words', q.max_words,
      'essay_keywords', coalesce(q.essay_keywords, '{}'),
      'essay_autograde', coalesce(q.essay_autograde, false),
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
      'question_type', coalesce(q.question_type, 'multiple_choice'),
      'model_answer', q.model_answer,
      'min_words', coalesce(q.min_words, 0),
      'max_words', q.max_words,
      'essay_keywords', coalesce(q.essay_keywords, '{}'),
      'essay_autograde', coalesce(q.essay_autograde, false),
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
      'essay_keywords', case when v_role = 'teacher' then coalesce(q.essay_keywords, '{}') else '[]'::jsonb end,
      'essay_autograde', coalesce(q.essay_autograde, false),
      'min_words', coalesce(q.min_words, 0),
      'max_words', q.max_words,
      'choice_id', sa.choice_id,
      'answer_text', sa.answer_text,
      'feedback', case when v_reveal then sa.feedback else null end,
      'graded_at', sa.graded_at,
      'auto_graded', coalesce(sa.auto_graded, false),
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
