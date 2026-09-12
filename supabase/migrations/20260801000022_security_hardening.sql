-- ============================================================================
-- Security hardening for Supabase advisor lints.
-- ----------------------------------------------------------------------------
-- 1. function_search_path_mutable: fn_risk_level had no SET search_path.
-- 2. extension_in_public: pg_trgm lived in public; moved to extensions.
--    (Only fn_essay_keyword_matched / fn_score_essay_answer use similarity(),
--    and both resolve it via `extensions` in their search_path.)
-- 3. anon_security_definer_function_executable: no app flow calls RPCs
--    unauthenticated (frontend always attaches the custom JWT; only the edge
--    function uses the service key), so EXECUTE is revoked from anon/PUBLIC
--    and granted only to authenticated + service_role.
-- 4. Drops the stale 4-arg fn_save_answer overload left behind when the
--    5-arg version was added (arity change => second overload, dead code).
-- NOTE: authenticated_*_executable lints remain by design — the app IS the
-- authenticated caller; every function enforces role + ownership internally
-- (see docs/security-model.md §9).
-- ============================================================================

-- 1. Pin search_path ----------------------------------------------------------
create or replace function public.fn_risk_level(p_points int)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case when p_points >= 80 then 'high' when p_points >= 40 then 'medium' else 'low' end;
$$;

-- 2. Move pg_trgm out of public ------------------------------------------------
create schema if not exists extensions;
alter extension pg_trgm set schema extensions;

-- 4. Drop stale overload -------------------------------------------------------
drop function if exists public.fn_save_answer(uuid, uuid, uuid, int);

-- 3. Revoke anon / PUBLIC, grant authenticated + service_role ------------------
revoke all on function public.auth_app_role() from anon, public;
grant execute on function public.auth_app_role() to authenticated, service_role;

revoke all on function public.fn_start_exam(uuid) from anon, public;
grant execute on function public.fn_start_exam(uuid) to authenticated, service_role;

revoke all on function public.fn_save_answer(uuid, uuid, uuid, int, text) from anon, public;
grant execute on function public.fn_save_answer(uuid, uuid, uuid, int, text) to authenticated, service_role;

revoke all on function public.fn_update_progress(uuid, jsonb) from anon, public;
grant execute on function public.fn_update_progress(uuid, jsonb) to authenticated, service_role;

revoke all on function public.fn_log_event(uuid, text, jsonb) from anon, public;
grant execute on function public.fn_log_event(uuid, text, jsonb) to authenticated, service_role;

revoke all on function public.fn_submit_exam(uuid, jsonb, int) from anon, public;
grant execute on function public.fn_submit_exam(uuid, jsonb, int) to authenticated, service_role;

revoke all on function public.fn_student_exam_questions(uuid) from anon, public;
grant execute on function public.fn_student_exam_questions(uuid) to authenticated, service_role;

revoke all on function public.fn_teacher_exam_detail(uuid) from anon, public;
grant execute on function public.fn_teacher_exam_detail(uuid) to authenticated, service_role;

revoke all on function public.fn_teacher_bank_questions(uuid) from anon, public;
grant execute on function public.fn_teacher_bank_questions(uuid) to authenticated, service_role;

revoke all on function public.fn_result_detail(uuid) from anon, public;
grant execute on function public.fn_result_detail(uuid) to authenticated, service_role;

revoke all on function public.fn_export_results(uuid) from anon, public;
grant execute on function public.fn_export_results(uuid) to authenticated, service_role;

revoke all on function public.fn_create_students(jsonb) from anon, public;
grant execute on function public.fn_create_students(jsonb) to authenticated, service_role;

revoke all on function public.fn_update_student(uuid, uuid, text) from anon, public;
grant execute on function public.fn_update_student(uuid, uuid, text) to authenticated, service_role;

revoke all on function public.fn_set_student_exam_access(uuid, uuid[]) from anon, public;
grant execute on function public.fn_set_student_exam_access(uuid, uuid[]) to authenticated, service_role;

revoke all on function public.fn_delete_student(uuid) from anon, public;
grant execute on function public.fn_delete_student(uuid) to authenticated, service_role;

revoke all on function public.fn_set_exam_access(uuid, uuid[]) from anon, public;
grant execute on function public.fn_set_exam_access(uuid, uuid[]) to authenticated, service_role;

revoke all on function public.fn_my_current_attempt(uuid) from anon, public;
grant execute on function public.fn_my_current_attempt(uuid) to authenticated, service_role;

revoke all on function public.fn_grade_essay_answer(uuid, uuid, numeric, text) from anon, public;
grant execute on function public.fn_grade_essay_answer(uuid, uuid, numeric, text) to authenticated, service_role;

revoke all on function public.fn_pending_essay_count(uuid) from anon, public;
grant execute on function public.fn_pending_essay_count(uuid) to authenticated, service_role;

revoke all on function public.fn_session_valid() from anon, public;
grant execute on function public.fn_session_valid() to authenticated, service_role;

revoke all on function public.fn_my_session_status() from anon, public;
grant execute on function public.fn_my_session_status() to authenticated, service_role;

revoke all on function public.fn_autograde_attempt_essays(uuid) from anon, public;
grant execute on function public.fn_autograde_attempt_essays(uuid) to authenticated, service_role;

revoke all on function public.fn_autograde_student_exam(uuid) from anon, public;
grant execute on function public.fn_autograde_student_exam(uuid) to authenticated, service_role;

revoke all on function public.fn_grant_exam_access(uuid[], uuid[]) from anon, public;
grant execute on function public.fn_grant_exam_access(uuid[], uuid[]) to authenticated, service_role;

revoke all on function public.fn_touch_updated_at() from anon, public;
grant execute on function public.fn_touch_updated_at() to authenticated, service_role;

revoke all on function public.fn_auto_unpublish_expired() from anon, public;
grant execute on function public.fn_auto_unpublish_expired() to authenticated, service_role;

revoke all on function public.fn_exam_assigned_sections() from anon, public;
grant execute on function public.fn_exam_assigned_sections() to authenticated, service_role;

revoke all on function public.fn_grant_retake(uuid, uuid) from anon, public;
grant execute on function public.fn_grant_retake(uuid, uuid) to authenticated, service_role;
