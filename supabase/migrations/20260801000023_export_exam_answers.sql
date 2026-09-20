-- ============================================================================
-- Export Exam Answers for Teachers (CSV/TXT)
-- ----------------------------------------------------------------------------
-- Returns detailed answer data for an exam's latest submitted/time_up attempt
-- per student. Supports student filtering (p_student_user_ids) and column
-- validation (p_columns). Final column selection + file generation happen
-- client-side; this function returns the full normalized dataset.
-- ============================================================================

create or replace function public.fn_export_exam_answers(
  p_exam_id uuid,
  p_student_user_ids uuid[] default null,
  p_columns text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_exam exams%rowtype;
  v_allowed_columns text[] := array[
    'student_number', 'student_name', 'student_email', 'section',
    'attempt_number', 'status', 'started_at', 'submitted_at', 'time_used_seconds',
    'score', 'score_percent', 'passed', 'risk_score', 'risk_level',
    'question_id', 'question_position', 'question_content', 'question_type',
    'question_difficulty', 'question_category', 'question_points',
    'question_explanation', 'question_model_answer', 'question_min_words', 'question_max_words',
    'essay_keywords', 'essay_autograde',
    'choice_id', 'answer_text', 'choice_content', 'correct_choice_content', 'is_correct',
    'points_earned', 'points_possible', 'feedback',
    'graded_at', 'auto_graded', 'time_spent_seconds'
  ];
begin
  if public.auth_app_role() <> 'teacher' then
    raise exception 'Forbidden';
  end if;

  if not exists (
    select 1 from public.exams e
    where e.id = p_exam_id and e.teacher_id = auth.uid()
  ) then
    raise exception 'Forbidden';
  end if;

  if p_columns is not null and exists (
    select 1 from unnest(p_columns) col
    where not (col = any(v_allowed_columns))
  ) then
    raise exception 'Invalid column';
  end if;

  select * into v_exam from public.exams where id = p_exam_id;
  if v_exam is null then
    raise exception 'Exam not found';
  end if;

  return (
    with latest_attempts as (
      select se.*, row_number() over (
        partition by se.student_user_id
        order by se.attempt_number desc
      ) as rn
      from public.student_exams se
      where se.exam_id = p_exam_id
        and se.status in ('submitted', 'time_up')
        and (p_student_user_ids is null or se.student_user_id = any(p_student_user_ids))
    ),
    filtered_attempts as (
      select * from latest_attempts where rn = 1
    ),
    student_data as (
      select
        se.id as student_exam_id,
        u.student_id,
        u.full_name,
        u.email,
        s.section,
        se.attempt_number,
        se.status,
        se.started_at,
        se.submitted_at,
        se.time_used_seconds,
        se.score,
        se.score_percent,
        se.passed,
        se.risk_score,
        coalesce(rs.level, 'low') as risk_level
      from filtered_attempts se
      join public.users u on u.id = se.student_user_id
      left join public.students s on s.user_id = u.id
      left join public.risk_scores rs on rs.student_exam_id = se.id
    ),
    answers_data as (
      select
        se.id as student_exam_id,
        q.id as question_id,
        t.pos as question_position,
        q.content as question_content,
        coalesce(q.question_type, 'multiple_choice') as question_type,
        q.difficulty as question_difficulty,
        q.category as question_category,
        q.points as question_points,
        q.explanation as question_explanation,
        q.model_answer as question_model_answer,
        q.min_words as question_min_words,
        q.max_words as question_max_words,
        q.essay_keywords,
        q.essay_autograde,
        sa.choice_id,
        sa.answer_text,
        c.content as choice_content,
        cc.content as correct_choice_content,
        sa.is_correct,
        sa.points_earned,
        q.points as points_possible,
        sa.feedback,
        sa.graded_at,
        sa.auto_graded,
        sa.time_spent_seconds
      from public.student_exams se
      join lateral jsonb_array_elements_text(se.question_order) with ordinality as t(qid, pos) on true
      join public.questions q on q.id = t.qid::uuid
      left join public.student_answers sa on sa.student_exam_id = se.id and sa.question_id = q.id
      left join public.choices c on c.question_id = q.id and c.id = sa.choice_id
      left join lateral (
        select cc.content
        from public.choices cc
        where cc.question_id = q.id and cc.is_correct = true
        order by cc.position, cc.id
        limit 1
      ) cc on true
      where se.exam_id = p_exam_id
        and se.status in ('submitted', 'time_up')
        and (p_student_user_ids is null or se.student_user_id = any(p_student_user_ids))
        and se.attempt_number = (
          select max(se2.attempt_number) from public.student_exams se2
          where se2.exam_id = p_exam_id and se2.student_user_id = se.student_user_id
        )
    )
    select jsonb_build_object(
      'exam', jsonb_build_object(
        'id', v_exam.id,
        'title', v_exam.title,
        'description', v_exam.description,
        'duration_minutes', v_exam.duration_minutes,
        'passing_score', v_exam.passing_score
      ),
      'students', coalesce((
        select jsonb_agg(jsonb_build_object(
          'student_exam_id', sd.student_exam_id,
          'student_id', sd.student_id,
          'full_name', sd.full_name,
          'email', sd.email,
          'section', sd.section,
          'attempt_number', sd.attempt_number,
          'status', sd.status,
          'started_at', sd.started_at,
          'submitted_at', sd.submitted_at,
          'time_used_seconds', sd.time_used_seconds,
          'score', sd.score,
          'score_percent', sd.score_percent,
          'passed', sd.passed,
          'risk_score', sd.risk_score,
          'risk_level', sd.risk_level,
          'answers', coalesce((
            select jsonb_agg(jsonb_build_object(
              'question_id', ad.question_id,
              'question_position', ad.question_position,
              'question_content', ad.question_content,
              'question_type', ad.question_type,
              'question_difficulty', ad.question_difficulty,
              'question_category', ad.question_category,
              'question_points', ad.question_points,
              'question_explanation', ad.question_explanation,
              'question_model_answer', ad.question_model_answer,
              'question_min_words', ad.question_min_words,
              'question_max_words', ad.question_max_words,
              'essay_keywords', ad.essay_keywords,
              'essay_autograde', ad.essay_autograde,
              'choice_id', ad.choice_id,
              'answer_text', ad.answer_text,
              'choice_content', ad.choice_content,
              'correct_choice_content', ad.correct_choice_content,
              'is_correct', ad.is_correct,
              'points_earned', ad.points_earned,
              'points_possible', ad.points_possible,
              'feedback', ad.feedback,
              'graded_at', ad.graded_at,
              'auto_graded', ad.auto_graded,
              'time_spent_seconds', ad.time_spent_seconds
            ) order by ad.question_position)
            from answers_data ad
            where ad.student_exam_id = sd.student_exam_id
          ), '[]'::jsonb)
        ) order by sd.submitted_at nulls last, sd.started_at nulls last)
        from student_data sd
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.fn_export_exam_answers(uuid, uuid[], text[]) from public, anon;
grant execute on function public.fn_export_exam_answers(uuid, uuid[], text[]) to authenticated, service_role;