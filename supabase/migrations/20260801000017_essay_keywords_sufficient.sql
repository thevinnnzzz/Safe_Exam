-- ============================================================================
-- Essay auto-grading: keywords alone are sufficient.
-- ----------------------------------------------------------------------------
-- Previously auto-grading additionally required the per-question
-- `essay_autograde` toggle, so questions with keywords but the toggle off
-- silently scored nothing — neither at submit nor on teacher re-run.
-- From here on, any essay question with at least one keyword is auto-graded
-- (at submit and on re-run). The `essay_autograde` column is kept for
-- compatibility but no longer gates anything.
-- ============================================================================

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
