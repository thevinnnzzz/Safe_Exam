-- ============================================================================
-- Essay type questions + manual grading
-- ----------------------------------------------------------------------------
-- Adds first-class essay support alongside multiple choice WITHOUT breaking
-- existing MCQ behaviour:
--   questions.question_type : 'multiple_choice' (default) | 'essay'
--   questions.model_answer  : reference answer shown only to teachers
--   questions.min_words / max_words : soft guidance enforced client-side,
--                                     validated server-side as non-negative
--   student_answers.answer_text : essay response body
--   student_answers.feedback / graded_by / graded_at : manual grading fields
--   student_exams.grading_status : 'complete' | 'pending'
--     'pending' means at least one essay answer still needs manual grading.
-- Grading flow: MCQ auto-graded at submit; essays stay NULL until a teacher
-- calls fn_grade_essay_answer, which re-computes score/percent/passed.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Schema additions
-- ----------------------------------------------------------------------------
alter table public.questions
  add column if not exists question_type text not null default 'multiple_choice'
    check (question_type in ('multiple_choice', 'essay'));

alter table public.questions
  add column if not exists model_answer text;

alter table public.questions
  add column if not exists min_words int not null default 0
    check (min_words >= 0);

alter table public.questions
  add column if not exists max_words int check (max_words is null or max_words > 0);

-- Essays have no choices; guard at the DB level is intentionally soft
-- (teachers may convert types), butChoices UIs hide choices for essays.

alter table public.student_answers
  add column if not exists answer_text text;

alter table public.student_answers
  add column if not exists feedback text;

alter table public.student_answers
  add column if not exists graded_by uuid references public.users(id) on delete set null;

alter table public.student_answers
  add column if not exists graded_at timestamptz;

alter table public.student_exams
  add column if not exists grading_status text not null default 'complete'
    check (grading_status in ('complete', 'pending'));

create index if not exists idx_questions_type on public.questions (question_type);
create index if not exists idx_sa_needs_grading on public.student_answers (student_exam_id)
  where points_earned is null and answer_text is not null;

-- Backfill: existing rows are MCQ / complete.
update public.questions set question_type = 'multiple_choice' where question_type is null;
update public.student_exams set grading_status = 'complete' where grading_status is null;

-- ----------------------------------------------------------------------------
-- 2. fn_save_answer: accept essay text (backwards compatible).
--    Named-arg RPC calls from the old MCQ client keep working because the new
--    parameter has a default.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 3. fn_submit_exam: grade MCQ automatically, leave essays pending.
--    p_answers maps question_id -> choice_id (MCQ) OR free text (essay).
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
  v_percent numeric;
  v_passed boolean;
  v_pending boolean := false;
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
      select coalesce(points_earned, 0) into v_points
      from public.student_answers
      where student_exam_id = p_student_exam_id and question_id = v_question_id;
      -- v_points reuse is safe: graded value only; ungraded rows have NULL
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

-- ----------------------------------------------------------------------------
-- 4. Teacher: manually grade one essay answer, then recompute the attempt.
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
-- 5. Student: fetch live exam questions WITH essay metadata (no model answers,
--    no correct choices).
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

-- ----------------------------------------------------------------------------
-- 6. Teacher: full exam detail (essay fields + answer text placeholders).
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
-- 7. Teacher: bank questions with essay fields.
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
      'question_type', coalesce(q.question_type, 'multiple_choice'),
      'model_answer', q.model_answer,
      'min_words', coalesce(q.min_words, 0),
      'max_words', q.max_words,
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
-- 8. Result detail (teacher OR student): essay answers with text, feedback,
--    grading state. Model answers revealed to teachers only.
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
-- 9. Teacher: count ungraded essays per exam (grading queue badge).
-- ----------------------------------------------------------------------------
create or replace function public.fn_pending_essay_count(p_exam_id uuid)
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
      'pending_count', count(sa.*)
    )), '[]'::jsonb) into v_rows
  from public.student_exams se
  join public.student_answers sa on sa.student_exam_id = se.id
  join public.questions q on q.id = sa.question_id
  where se.exam_id = p_exam_id
    and se.status in ('submitted', 'time_up')
    and coalesce(q.question_type, 'multiple_choice') = 'essay'
    and sa.answer_text is not null
    and sa.points_earned is null
  group by se.id;

  return v_rows;
end;
$$;
