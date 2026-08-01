export type Role = 'student' | 'teacher'

export type Difficulty = 'easy' | 'medium' | 'hard'

export type ExamStatus = 'draft' | 'published' | 'archived'

export type StudentExamStatus = 'not_started' | 'in_progress' | 'submitted' | 'time_up'

export type RiskLevel = 'low' | 'medium' | 'high'

export interface UserProfile {
  id: string
  role: Role
  full_name: string
  email?: string | null
  student_id?: string | null
  course_id?: string | null
  course_name?: string | null
}

export interface Course {
  id: string
  name: string
  code: string
  teacher_id: string
}

export interface QuestionBank {
  id: string
  teacher_id: string
  name: string
  description: string | null
  created_at: string
  question_count?: number
}

export interface Choice {
  id: string
  question_id: string
  content: string
  is_correct: boolean
  position: number
}

/** Choice as exposed to students (no is_correct). */
export interface PublicChoice {
  id: string
  question_id: string
  content: string
  position: number
}

export interface Question {
  id: string
  question_bank_id: string | null
  teacher_id: string
  content: string
  difficulty: Difficulty
  category: string | null
  points: number
  explanation: string | null
  created_at: string
  choices?: Choice[]
}

export interface Exam {
  id: string
  teacher_id: string
  course_id: string | null
  title: string
  description: string | null
  instructions: string | null
  start_time: string | null
  end_time: string | null
  duration_minutes: number
  passing_score: number
  randomize_questions: boolean
  randomize_choices: boolean
  show_score_after: boolean
  allow_review: boolean
  auto_submit: boolean
  status: ExamStatus
  published_at: string | null
  created_at: string
  updated_at: string
  course_name?: string | null
  question_count?: number
  total_points?: number
}

export interface ExamQuestion {
  id: string
  exam_id: string
  question_id: string
  position: number
  points: number
}

export interface StudentExam {
  id: string
  exam_id: string
  student_user_id: string
  status: StudentExamStatus
  started_at: string | null
  submitted_at: string | null
  time_used_seconds: number
  score: number | null
  score_percent: number | null
  passed: boolean | null
  current_question_index: number
  question_order: string[] | null
  answers: Record<string, string | null> | null
  risk_score: number
  is_online: boolean
  last_active_at: string | null
  exam?: Exam
  student?: { id: string; full_name: string; student_id: string } | null
}

export interface StudentAnswer {
  id: string
  student_exam_id: string
  question_id: string
  choice_id: string | null
  is_correct: boolean | null
  points_earned: number | null
  time_spent_seconds: number
  updated_at: string
  question?: Question
  choice?: Choice | null
}

export type ActivityEventType =
  | 'tab_switch'
  | 'window_blur'
  | 'fullscreen_exit'
  | 'copy_attempt'
  | 'paste_attempt'
  | 'cut_attempt'
  | 'right_click'
  | 'selection_attempt'
  | 'devtools'
  | 'refresh_attempt'
  | 'navigate_attempt'
  | 'find_attempt'
  | 'print_attempt'
  | 'save_attempt'
  | 'zoom_attempt'
  | 'new_tab'
  | 'idle'
  | 'started'
  | 'submitted'
  | 'time_up'
  | 'warning'

export interface ActivityLog {
  id: number
  student_exam_id: string
  student_user_id: string
  exam_id: string
  event_type: ActivityEventType
  risk_points: number
  meta: Record<string, unknown> | null
  created_at: string
}

export interface RiskScore {
  id: string
  student_exam_id: string
  student_user_id: string
  exam_id: string
  total_points: number
  level: RiskLevel
  tab_switches: number
  fullscreen_exits: number
  copy_attempts: number
  paste_attempts: number
  cut_attempts: number
  devtools_attempts: number
  refresh_attempts: number
  navigate_attempts: number
  find_attempts: number
  print_attempts: number
  save_attempts: number
  zoom_attempts: number
  new_tab_attempts: number
  idle_events: number
  idle_seconds: number
  updated_at: string
}

/** Payload returned by the auth edge function. */
export interface AuthResponse {
  token: string
  user: UserProfile
}

export interface ExamQuestionPublic {
  exam_id: string
  question_id: string
  position: number
  points: number
  content: string
  difficulty: Difficulty
  category: string | null
  explanation: string | null
  choices: PublicChoice[]
}
