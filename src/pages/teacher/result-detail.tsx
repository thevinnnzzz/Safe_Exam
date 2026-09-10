import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  ListChecks,
  Loader2,
  ShieldAlert,
  TimerOff,
  Trophy,
  XCircle,
} from 'lucide-react'
import { getSupabase } from '@/lib/supabase'
import { teacherApi } from '@/api/supabase-api'
import { countWords } from '@/lib/types'
import { EVENT_LABELS } from '@/lib/risk'
import { formatClock, formatDateTime } from '@/lib/utils'
import { PageHeader } from '@/components/common/page-header'
import { PageLoader } from '@/components/common/page-loader'
import { RiskBadge } from '@/components/common/risk-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { ActivityLog, RiskScore } from '@/lib/types'

interface ReviewAnswer {
  question_id: string
  content: string
  difficulty: string
  category: string | null
  points: number
  explanation: string | null
  question_type?: 'multiple_choice' | 'essay'
  model_answer?: string | null
  choice_id: string | null
  answer_text: string | null
  feedback: string | null
  graded_at: string | null
  is_correct: boolean | null
  points_earned: number | null
  time_spent_seconds: number
  choices: { id: string; content: string; is_correct: boolean; position: number }[]
}

interface ResultPayload {
  student_exam: {
    id: string
    status: string
    grading_status?: 'complete' | 'pending'
    score: number | null
    score_percent: number | null
    passed: boolean | null
    time_used_seconds: number
    risk_score: number
    submitted_at: string | null
    started_at: string | null
  }
  exam: { id: string; title: string; passing_score: number }
  student: { id: string; full_name: string; student_id: string; email: string | null }
  answers: ReviewAnswer[]
  risk: RiskScore | null
}

export function TeacherResultDetailPage() {
  const { examId, studentExamId } = useParams<{ examId: string; studentExamId: string }>()
  const [expanded, setExpanded] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const resultQuery = useQuery({
    queryKey: ['teacher-result-detail', studentExamId],
    queryFn: () => teacherApi.resultDetail(studentExamId!) as Promise<ResultPayload>,
    enabled: !!studentExamId,
  })

  const activityQuery = useQuery({
    queryKey: ['teacher-result-activity', studentExamId],
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('activity_logs')
        .select('*')
        .eq('student_exam_id', studentExamId!)
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) throw error
      return (data ?? []) as ActivityLog[]
    },
    enabled: !!studentExamId,
  })

  if (resultQuery.isLoading) return <PageLoader />
  if (resultQuery.isError || !resultQuery.data) {
    return (
      <div className="py-16 text-center">
        <p className="font-semibold">Result not found</p>
        <Button asChild variant="outline" className="mt-4">
          <Link to={`/teacher/exams/${examId}/results`}>Back to results</Link>
        </Button>
      </div>
    )
  }

  const { student_exam, exam, student, answers, risk } = resultQuery.data
  const activity = activityQuery.data ?? []
  const gradeMutation = useMutation({
    mutationFn: ({ questionId, points, feedback }: { questionId: string; points: number; feedback: string | null }) =>
      teacherApi.gradeEssayAnswer(studentExamId!, questionId, points, feedback),
    onSuccess: () => {
      toast.success('Essay graded')
      queryClient.invalidateQueries({ queryKey: ['teacher-result-detail', studentExamId] })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not save the grade.'),
  })
  const answered = answers.filter((a) => a.choice_id || (a.answer_text ?? '').trim()).length
  const correct = answers.filter((a) => a.is_correct).length
  const pendingEssays = answers.filter(
    (a) => (a.question_type ?? 'multiple_choice') === 'essay' && a.points_earned === null,
  )
  const incidents = risk
    ? risk.tab_switches + risk.fullscreen_exits + risk.copy_attempts + risk.paste_attempts + risk.cut_attempts + risk.devtools_attempts + risk.idle_events
    : 0
  const riskSummary: { label: string; value: string | number }[] = risk
    ? [
        { label: 'Tab switches', value: risk.tab_switches },
        { label: 'Fullscreen exits', value: risk.fullscreen_exits },
        { label: 'Copy attempts', value: risk.copy_attempts },
        { label: 'Paste attempts', value: risk.paste_attempts },
        { label: 'Cut attempts', value: risk.cut_attempts },
        { label: 'DevTools attempts', value: risk.devtools_attempts },
        { label: 'Idle events', value: risk.idle_events },
        { label: 'Idle time', value: `${Math.round(risk.idle_seconds / 60)} min` },
      ]
    : []

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Student result" description="Detailed review of a single attempt.">
        <Button variant="ghost" asChild>
          <Link to={`/teacher/exams/${exam.id}/results`}>
            <ArrowLeft className="h-4 w-4" />
            Results
          </Link>
        </Button>
      </PageHeader>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>{student.full_name}</CardTitle>
              <CardDescription>
                {student.student_id} · {student.email ?? 'No email'}
              </CardDescription>
            </div>
            <RiskBadge level={risk?.level ?? 'low'} points={student_exam.risk_score} />
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Metric icon={Trophy} label="Score" value={student_exam.score_percent !== null ? `${student_exam.score_percent}%` : '—'} sub={student_exam.score !== null ? `${student_exam.score} points` : undefined} />
            <Metric
              icon={student_exam.passed ? CheckCircle2 : XCircle}
              label="Result"
              value={student_exam.passed === null ? '—' : student_exam.passed ? 'Passed' : 'Failed'}
              sub={`Passing: ${exam.passing_score}%`}
              accent={student_exam.passed ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}
            />
            <Metric icon={Clock3} label="Time used" value={formatClock(student_exam.time_used_seconds)} sub={`Started ${student_exam.started_at ? formatDateTime(student_exam.started_at) : '—'}`} />
            <Metric
              icon={student_exam.status === 'time_up' ? TimerOff : CheckCircle2}
              label="Status"
              value={student_exam.status === 'submitted' ? 'Submitted' : student_exam.status === 'time_up' ? 'Time up' : student_exam.status}
              sub={student_exam.submitted_at ? `Submitted ${formatDateTime(student_exam.submitted_at)}` : undefined}
            />
          </div>
        </CardContent>
      </Card>

      {pendingEssays.length > 0 ? (
        <div className="flex items-center gap-3 rounded-xl border border-amber-300/60 bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          <Clock3 className="h-5 w-5 shrink-0" />
          <p>
            <span className="font-medium">{pendingEssays.length} essay{pendingEssays.length === 1 ? '' : 's'} awaiting grading.</span>{' '}
            Scores below are partial until you grade them.
          </p>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <ListChecks className="h-4 w-4 text-primary" />
                Answers ({correct}/{answers.length} correct{pendingEssays.length > 0 ? ` · ${pendingEssays.length} pending` : ''})
              </CardTitle>
              <CardDescription>Green shows the correct answer. Essays are graded manually below.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {answers.map((answer, idx) => {
                const isOpen = expanded === answer.question_id || (answer.question_type ?? 'multiple_choice') === 'essay'
                const isEssay = (answer.question_type ?? 'multiple_choice') === 'essay'

                return (
                  <div key={answer.question_id} className="rounded-lg border">
                    <button type="button" onClick={() => setExpanded(isOpen ? null : answer.question_id)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                      {isEssay ? (
                        answer.points_earned === null ? (
                          <Clock3 className="h-5 w-5 shrink-0 text-amber-500" />
                        ) : (
                          <CheckCircle2 className="h-5 w-5 shrink-0 text-sky-500" />
                        )
                      ) : answer.is_correct ? (
                        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                      ) : (
                        <XCircle className="h-5 w-5 shrink-0 text-rose-500" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="font-medium leading-snug">
                          {idx + 1}. {answer.content}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {answer.points} pts ·{' '}
                          {isEssay ? (
                            <>
                              <span className="font-medium">Essay</span> ·{' '}
                              {answer.points_earned === null ? 'Needs grading' : `${answer.points_earned}/${answer.points}`}
                            </>
                          ) : (
                            <>{answer.choice_id ? (answer.is_correct ? 'Correct' : 'Incorrect') : 'Unanswered'}</>
                          )}
                          {!isEssay && answer.points_earned !== null ? ` · ${answer.points_earned}/${answer.points}` : ''}
                          {answer.time_spent_seconds > 0 ? ` · ${Math.round(answer.time_spent_seconds / 60)} min spent` : ''}
                        </p>
                      </div>
                      <Badge variant={isEssay ? 'info' : 'secondary'}>{isEssay ? 'Essay' : 'MCQ'}</Badge>
                      {isOpen ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
                    </button>
                    {isOpen ? (
                      <div className="space-y-2 border-t px-4 py-3">
                        {isEssay ? (
                          <EssayGradingBlock
                            answer={answer}
                            saving={gradeMutation.isPending}
                            onSave={(points, feedback) =>
                              gradeMutation.mutate({ questionId: answer.question_id, points, feedback })
                            }
                          />
                        ) : (
                        answer.choices.map((choice) => {
                          const isSelected = choice.id === answer.choice_id
                          return (
                            <div
                              key={choice.id}
                              className={
                                choice.is_correct
                                  ? 'flex items-center gap-2 rounded-md border border-emerald-400 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300'
                                  : isSelected
                                    ? 'flex items-center gap-2 rounded-md border border-rose-400 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-500/10 dark:text-rose-300'
                                    : 'flex items-center gap-2 rounded-md border border-transparent px-3 py-2 text-sm'
                              }
                            >
                              {choice.is_correct ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : isSelected ? <XCircle className="h-4 w-4 shrink-0" /> : null}
                              {choice.content}
                              {isSelected ? <Badge variant="secondary" className="ml-auto">Student's answer</Badge> : null}
                              {choice.is_correct ? <Badge variant="success" className="ml-auto">Correct</Badge> : null}
                            </div>
                          )
                        })
                        )}
                        {answer.explanation ? (
                          <p className="rounded-md bg-muted px-3 py-2 text-sm">
                            <span className="font-medium">Explanation: </span>
                            {answer.explanation}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <ShieldAlert className="h-4 w-4 text-primary" />
                Risk breakdown
              </CardTitle>
            </CardHeader>
            <CardContent>
              {incidents === 0 ? (
                <p className="text-sm text-muted-foreground">No suspicious incidents recorded.</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {riskSummary.map((item) => (
                    <div key={item.label} className="rounded-lg bg-muted/50 p-2.5">
                      <p className="text-[11px] text-muted-foreground">{item.label}</p>
                      <p className="text-lg font-bold">{item.value}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Incident timeline</CardTitle>
            </CardHeader>
            <CardContent className="max-h-[420px] space-y-0 overflow-y-auto">
              {activity.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">No events.</p>
              ) : (
                activity.map((log) => (
                  <div key={log.id} className="flex items-start gap-2 border-b py-2 last:border-0">
                    <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted">
                      {log.risk_points > 0 ? <ShieldAlert className="h-3.5 w-3.5 text-rose-500" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium">{EVENT_LABELS[log.event_type as keyof typeof EVENT_LABELS] ?? log.event_type}</p>
                      <p className="text-[11px] text-muted-foreground">{formatDateTime(log.created_at)}</p>
                    </div>
                    {log.risk_points > 0 ? <span className="text-xs font-semibold text-rose-500">+{log.risk_points}</span> : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 text-xs text-muted-foreground">
              <p>
                <span className="font-semibold text-foreground">Summary:</span> {answered} answered, {correct} correct, {incidents} risk incidents ({risk?.level ?? 'low'} overall).
                Risk scores are advisory only — the system never fails a student automatically.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function EssayGradingBlock({
  answer,
  saving,
  onSave,
}: {
  answer: ReviewAnswer
  saving: boolean
  onSave: (points: number, feedback: string | null) => void
}) {
  const [points, setPoints] = useState<string>(answer.points_earned !== null ? String(answer.points_earned) : '')
  const [feedback, setFeedback] = useState<string>(answer.feedback ?? '')
  const words = countWords(answer.answer_text)
  const parsed = Number(points)
  const valid = points.trim() !== '' && Number.isFinite(parsed) && parsed >= 0 && parsed <= answer.points

  return (
    <div className="space-y-2">
      <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm whitespace-pre-line">
        {answer.answer_text || <span className="text-muted-foreground">No answer submitted.</span>}
      </div>
      <p className="text-xs text-muted-foreground">
        {words} word{words === 1 ? '' : 's'}
        {answer.graded_at ? ` · graded ${formatDateTime(answer.graded_at)}` : ' · not graded yet'}
      </p>
      {answer.model_answer ? (
        <p className="rounded-md border border-dashed px-3 py-2 text-sm">
          <span className="font-medium">Model answer (only you see this): </span>
          {answer.model_answer}
        </p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-[140px_1fr_auto]">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Score (max {answer.points})</label>
          <input
            type="number"
            min={0}
            max={answer.points}
            step="0.5"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            placeholder={`0–${answer.points}`}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Feedback (shown to student)</label>
          <input
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            placeholder="e.g. Good argument, missing citation…"
          />
        </div>
        <div className="flex items-end">
          <Button size="sm" disabled={!valid || saving} onClick={() => onSave(parsed, feedback.trim() || null)}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Save grade
          </Button>
        </div>
      </div>
      {!valid && points.trim() !== '' ? (
        <p className="text-xs text-destructive">Enter a score between 0 and {answer.points}.</p>
      ) : null}
    </div>
  )
}

function Metric({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: typeof Trophy
  label: string
  value: string
  sub?: string
  accent?: string
}) {
  return (
    <div className="rounded-xl border bg-background p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className={`mt-1 text-xl font-bold ${accent ?? ''}`}>{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  )
}
