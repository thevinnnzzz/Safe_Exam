import { getSupabase } from '@/lib/supabase'
import type {
  ActivityLog,
  Course,
  Exam,
  ExamQuestionPublic,
  QuestionBank,
  RiskScore,
  StudentAnswer,
  StudentExam,
  UserProfile,
} from '@/lib/types'

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await getSupabase().rpc(fn, args)
  if (error) throw error
  return data as T
}

async function single<T>(query: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await query
  if (error) throw error
  if (!data) throw new Error('Record not found')
  return data
}

// ---------------------------------------------------------------------------
// Auth / profiles
// ---------------------------------------------------------------------------

export const apiProfile = {
  async me(): Promise<UserProfile | null> {
    return null
  },
}

// ---------------------------------------------------------------------------
// Student API
// ---------------------------------------------------------------------------

export const studentApi = {
  async availableExams(): Promise<Exam[]> {
    const { data, error } = await getSupabase()
      .from('exams')
      .select('*, course:courses(name)')
      .eq('status', 'published')
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data ?? []).map((row) => ({
      ...row,
      course_name: row.course?.name ?? null,
    })) as unknown as Exam[]
  },

  async myExamAttempts(): Promise<StudentExam[]> {
    const { data, error } = await getSupabase()
      .from('student_exams')
      .select('*, exam:exams(*)')
      .order('updated_at', { ascending: false })
    if (error) throw error
    return (data ?? []).map((row) => ({ ...row, exam: row.exam ?? undefined })) as unknown as StudentExam[]
  },

  async startExam(examId: string): Promise<StudentExam> {
    return rpc<StudentExam>('fn_start_exam', { p_exam_id: examId })
  },

  async fetchExamQuestions(studentExamId: string): Promise<ExamQuestionPublic[]> {
    return rpc<ExamQuestionPublic[]>('fn_student_exam_questions', { p_student_exam_id: studentExamId })
  },

  async saveAnswer(studentExamId: string, questionId: string, choiceId: string | null, timeSpent: number) {
    await rpc('fn_save_answer', {
      p_student_exam_id: studentExamId,
      p_question_id: questionId,
      p_choice_id: choiceId,
      p_time_spent: timeSpent,
    })
  },

  async updateProgress(studentExamId: string, payload: Record<string, unknown>) {
    await rpc('fn_update_progress', { p_student_exam_id: studentExamId, p_payload: payload })
  },

  async logEvent(studentExamId: string, eventType: string, meta: Record<string, unknown> = {}) {
    await rpc('fn_log_event', { p_student_exam_id: studentExamId, p_event_type: eventType, p_meta: meta })
  },

  async submitExam(studentExamId: string, answers: Record<string, string | null>, timeUsed: number): Promise<StudentExam> {
    return rpc<StudentExam>('fn_submit_exam', {
      p_student_exam_id: studentExamId,
      p_answers: answers,
      p_time_used: timeUsed,
    })
  },

  async getResult(studentExamId: string) {
    return rpc('fn_result_detail', { p_student_exam_id: studentExamId })
  },

  async myActivity(studentExamId: string): Promise<ActivityLog[]> {
    const { data, error } = await getSupabase()
      .from('activity_logs')
      .select('*')
      .eq('student_exam_id', studentExamId)
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) throw error
    return (data ?? []) as ActivityLog[]
  },

  async myAnswers(studentExamId: string): Promise<Pick<StudentAnswer, 'question_id' | 'choice_id' | 'time_spent_seconds'>[]> {
    const { data, error } = await getSupabase()
      .from('student_answers')
      .select('question_id, choice_id, time_spent_seconds')
      .eq('student_exam_id', studentExamId)
    if (error) throw error
    return (data ?? []) as Pick<StudentAnswer, 'question_id' | 'choice_id' | 'time_spent_seconds'>[]
  },

  async exam(id: string): Promise<Exam> {
    const { data, error } = await getSupabase().from('exams').select('*').eq('id', id).maybeSingle()
    if (error) throw error
    if (!data) throw new Error('Exam not found')
    return data as Exam
  },
}

// ---------------------------------------------------------------------------
// Teacher API
// ---------------------------------------------------------------------------

export const teacherApi = {
  async courses(): Promise<Course[]> {
    const { data, error } = await getSupabase().from('courses').select('*').order('name')
    if (error) throw error
    return (data ?? []) as Course[]
  },

  async exams(): Promise<Exam[]> {
    const { data, error } = await getSupabase()
      .from('exams')
      .select('*, course:courses(name)')
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data ?? []).map((row) => ({ ...row, course_name: row.course?.name ?? null })) as unknown as Exam[]
  },

  async exam(id: string): Promise<Exam> {
    return single(getSupabase().from('exams').select('*').eq('id', id).maybeSingle())
  },

  async createExam(exam: Partial<Exam>): Promise<Exam> {
    return single(
      getSupabase()
        .from('exams')
        .insert({ ...exam, status: exam.status ?? 'draft' })
        .select()
        .single(),
    )
  },

  async updateExam(id: string, patch: Partial<Exam>) {
    const { error } = await getSupabase().from('exams').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw error
  },

  async deleteExam(id: string) {
    const { error } = await getSupabase().from('exams').delete().eq('id', id)
    if (error) throw error
  },

  async publishExam(id: string, publish: boolean) {
    const { error } = await getSupabase()
      .from('exams')
      .update({ status: publish ? 'published' : 'draft', published_at: publish ? new Date().toISOString() : null })
      .eq('id', id)
    if (error) throw error
  },

  async examDetail(id: string) {
    return rpc('fn_teacher_exam_detail', { p_exam_id: id })
  },

  async banks(): Promise<(QuestionBank & { question_count: number })[]> {
    const { data, error } = await getSupabase()
      .from('question_bank')
      .select('*, question_count:questions(count)')
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data ?? []).map((row) => ({
      ...row,
      question_count: Array.isArray(row.question_count) ? (row.question_count[0]?.count ?? 0) : 0,
    })) as unknown as (QuestionBank & { question_count: number })[]
  },

  async createBank(name: string, description: string | null): Promise<QuestionBank> {
    return single(getSupabase().from('question_bank').insert({ name, description }).select().single())
  },

  async deleteBank(id: string) {
    const { error } = await getSupabase().from('question_bank').delete().eq('id', id)
    if (error) throw error
  },

  async bankQuestions(bankId: string) {
    return rpc('fn_teacher_bank_questions', { p_bank_id: bankId })
  },

  async bankQuestionCounts(): Promise<Record<string, number>> {
    const { data, error } = await getSupabase()
      .from('questions')
      .select('question_bank_id')
      .not('question_bank_id', 'is', null)
    if (error) throw error
    const counts: Record<string, number> = {}
    for (const row of data ?? []) {
      const key = row.question_bank_id
      counts[key] = (counts[key] ?? 0) + 1
    }
    return counts
  },

  async createQuestion(
    bankId: string | null,
    q: { content: string; difficulty: string; category: string | null; points: number; explanation: string | null; choices: { content: string; is_correct: boolean }[] },
  ) {
    const { data: question, error: qError } = await getSupabase()
      .from('questions')
      .insert({ question_bank_id: bankId, content: q.content, difficulty: q.difficulty, category: q.category, points: q.points, explanation: q.explanation })
      .select()
      .single()
    if (qError) throw qError
    const { error: cError } = await getSupabase().from('choices').insert(
      q.choices.map((c, i) => ({ question_id: question.id, content: c.content, is_correct: c.is_correct, position: i })),
    )
    if (cError) throw cError
    return question
  },

  async updateQuestion(questionId: string, patch: Partial<{ content: string; difficulty: string; category: string | null; points: number; explanation: string | null }>) {
    const { error } = await getSupabase().from('questions').update(patch).eq('id', questionId)
    if (error) throw error
  },

  async replaceChoices(questionId: string, choices: { content: string; is_correct: boolean }[]) {
    const { error: delError } = await getSupabase().from('choices').delete().eq('question_id', questionId)
    if (delError) throw delError
    const { error: insError } = await getSupabase()
      .from('choices')
      .insert(choices.map((c, i) => ({ question_id: questionId, content: c.content, is_correct: c.is_correct, position: i })))
    if (insError) throw insError
  },

  async deleteQuestion(questionId: string) {
    const { error } = await getSupabase().from('questions').delete().eq('id', questionId)
    if (error) throw error
  },

  async examQuestions(examId: string): Promise<{ question_id: string; points: number }[]> {
    const { data, error } = await getSupabase().from('exam_questions').select('question_id, points').eq('exam_id', examId)
    if (error) throw error
    return (data ?? []) as { question_id: string; points: number }[]
  },

  async setExamQuestions(examId: string, questionIds: string[], points: number) {
    const { error: delError } = await getSupabase().from('exam_questions').delete().eq('exam_id', examId)
    if (delError) throw delError
    if (questionIds.length === 0) return
    const { error: insError } = await getSupabase().from('exam_questions').insert(
      questionIds.map((qid, i) => ({ exam_id: examId, question_id: qid, position: i, points })),
    )
    if (insError) throw insError
  },

  // Monitoring
  async examStudentRecords(examId: string): Promise<StudentExam[]> {
    const { data, error } = await getSupabase()
      .from('student_exams')
      .select('*, student:users(id, full_name, student_id)')
      .eq('exam_id', examId)
      .order('last_active_at', { ascending: false })
    if (error) throw error
    return (data ?? []).map((row) => ({ ...row, student: row.student ?? null })) as unknown as StudentExam[]
  },

  async examRiskScores(examId: string): Promise<RiskScore[]> {
    const { data, error } = await getSupabase().from('risk_scores').select('*').eq('exam_id', examId)
    if (error) throw error
    return (data ?? []) as RiskScore[]
  },

  async recentActivity(examId: string, limit = 60): Promise<ActivityLog[]> {
    const { data, error } = await getSupabase()
      .from('activity_logs')
      .select('*')
      .eq('exam_id', examId)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw error
    return (data ?? []) as ActivityLog[]
  },

  async questionBatch(questionIds: string[]): Promise<{ id: string; content: string }[]> {
    if (questionIds.length === 0) return []
    const { data, error } = await getSupabase().from('questions').select('id, content').in('id', questionIds)
    if (error) throw error
    return (data ?? []) as { id: string; content: string }[]
  },

  async teacherStudents(): Promise<UserProfile[]> {
    const { data, error } = await getSupabase()
      .from('users')
      .select('id, full_name, student_id, email, students(course_id, courses(name))')
      .eq('role_id', '00000000-0000-0000-0000-000000000001')
      .order('full_name')
    if (error) throw error
    return (data ?? []).map((row) => {
      const student = (Array.isArray(row.students) ? row.students[0] : row.students) as { course_id?: string | null; courses?: { name?: string }[] | { name?: string } | null } | undefined
      const course = student?.courses
      const courseName = Array.isArray(course) ? course[0]?.name : course?.name
      return {
        id: row.id,
        role: 'student',
        full_name: row.full_name,
        email: row.email ?? null,
        student_id: row.student_id ?? null,
        course_id: student?.course_id ?? null,
        course_name: courseName ?? null,
      }
    }) as UserProfile[]
  },

  async createStudents(rows: { full_name: string; student_id: string; email?: string | null; password: string; course_id?: string | null }[]) {
    return rpc<{ student_id: string; full_name: string; ok: boolean; error?: string }[]>('fn_create_students', {
      p_students: rows.map((r) => ({
        full_name: r.full_name,
        student_id: r.student_id,
        email: r.email ?? null,
        password: r.password,
        course_id: r.course_id ?? null,
      })),
    })
  },

  async resultDetail(studentExamId: string) {
    return rpc('fn_result_detail', { p_student_exam_id: studentExamId })
  },

  async exportResults(examId: string) {
    return rpc('fn_export_results', { p_exam_id: examId })
  },
}

export { rpc }
