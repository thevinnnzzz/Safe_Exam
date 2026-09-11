-- ============================================================================
-- Student exam history visibility control.
-- ----------------------------------------------------------------------------
-- Adds `exams.allow_history` (default true). When a teacher turns it off for
-- an exam, students no longer see that exam's attempts in their history and
-- can no longer open its review page (prevents question spreading), while
-- teachers keep full access to results and grading.
-- `fn_result_detail` enforces the gate server-side for students; the frontend
-- additionally hides hidden attempts from the history/dashboard lists.
-- ============================================================================

alter table public.exams
  add column if not exists allow_history boolean not null default true;

-- ----------------------------------------------------------------------------
-- fn_result_detail: same as the auto-grading version, plus the history gate —
-- students may only open reviews for exams whose history is visible to them.
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

  -- single-session enforcement applies to students only (fn returns true for teachers)
  if not public.fn_session_valid() then
    raise exception 'SESSION_TAKEN: This account signed in on another device. Please sign in again on this device to continue.';
  end if;

  select * into v_exam from public.exams where id = v_se.exam_id;

  -- history hidden by the teacher: students cannot open the review at all
  if v_role = 'student' and coalesce(v_exam.allow_history, true) = false then
    raise exception 'HISTORY_HIDDEN: Your instructor has hidden the history for this exam.';
  end if;

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
