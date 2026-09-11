import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  ListChecks,
  ShieldAlert,
  Trophy,
  XCircle,
} from 'lucide-react'
import { studentApi } from '@/api/supabase-api'
import { useAttemptRealtime } from '@/hooks/use-realtime'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PageLoader } from '@/components/common/page-loader'
import { RiskBadge } from '@/components/common/risk-badge'
import { formatClock } from '@/lib/utils'
import type { RiskScore } from '@/lib/types'

interface ResultAnswer {
  question_id: string
  content: string
  difficulty: string
  category: string | null
  points: number
  explanation: string | null
  question_type?: 'multiple_choice' | 'essay'
  choice_id: string | null
  answer_text: string | null
  feedback: string | null
  graded_at: string | null
  auto_graded?: boolean
  is_correct: boolean | null
  points_earned: number | null
  time_spent_seconds: number
  choices: { id: string; content: string; is_correct: boolean | null; position: number }[]
}

interface ResultPayload {
  student_exam: {
    id: string
    status: string
    attempt_number?: number
    grading_status?: 'complete' | 'pending'
    score: number | null
    score_percent: number | null
    passed: boolean | null
    time_used_seconds: number
    risk_score: number
    submitted_at: string | null
  }
  exam: {
    id: string
    title: string
    course_name?: string | null
    show_score_after: boolean
    allow_review: boolean
    passing_score: number
    total_points?: number
  }
  answers: ResultAnswer[]
  risk: RiskScore | null
}

export function StudentResultPage() {
  const { studentExamId } = useParams<{ studentExamId: string }>()
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState<string | null>(null)

  const resultQuery = useQuery({
    queryKey: ['student-result', studentExamId],
    queryFn: () => studentApi.getResult(studentExamId!) as Promise<ResultPayload>,
    enabled: !!studentExamId,
    retry: 1,
  })

  // Live grade updates (teacher grading lands without refresh).
  useAttemptRealtime(studentExamId ?? null)

  if (resultQuery.isLoading) return <PageLoader />
  if (resultQuery.isError || !resultQuery.data) {
    const hidden =
      resultQuery.error instanceof Error && /HISTORY_HIDDEN|hidden/i.test(resultQuery.error.message)
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
        <ShieldAlert className="h-10 w-10 text-muted-foreground" />
        <p className="font-semibold">{hidden ? 'History hidden' : 'Result not available'}</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          {hidden
            ? 'Your instructor has hidden the history for this exam, so it cannot be reviewed right now.'
            : 'This result could not be loaded. It may not exist or is no longer available.'}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate('/student/history')}>View history</Button>
          <Button onClick={() => navigate('/student')}>Back to dashboard</Button>
        </div>
      </div>
    )
  }

  const { exam, student_exam, answers, risk } = resultQuery.data
  const showScore = exam.show_score_after
  const revealAnswers = exam.allow_review
  const gradingPending = student_exam.grading_status === 'pending'
  const pendingEssays = answers.filter((a) => (a.question_type ?? 'multiple_choice') === 'essay' && a.points_earned === null).length
  const autoGradedEssays = answers.filter(
    (a) => (a.question_type ?? 'multiple_choice') === 'essay' && a.auto_graded && a.points_earned !== null,
  )

  return (
    <div className="mx-auto max-w-4xl animate-fade-in space-y-6">
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-r from-primary to-sky-500 px-6 py-8 text-primary-foreground">
          <p className="text-sm opacity-90">{exam.title}</p>
          <h1 className="mt-1 text-2xl font-bold">
            {showScore ? 'Exam submitted — here is your result' : 'Exam submitted successfully'}
          </h1>
          <p className="mt-1 text-sm opacity-90">
            {student_exam.attempt_number && student_exam.attempt_number > 1 ? `Attempt ${student_exam.attempt_number} · ` : ''}
            Submitted {student_exam.submitted_at ? new Date(student_exam.submitted_at).toLocaleString() : '—'}
            {gradingPending ? ' · Some essays are still being graded' : ''}
            {!gradingPending && autoGradedEssays.length > 0 ? ' · Essay scores are auto-graded and subject to review' : ''}
          </p>
        </div>
        {gradingPending && showScore ? (
          <div className="border-b bg-amber-50 px-6 py-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            Your score below is partial — {pendingEssays} essay{pendingEssays === 1 ? '' : 's'} still {pendingEssays === 1 ? 'needs' : 'need'} manual grading by your instructor.
          </div>
        ) : null}
        {!gradingPending && autoGradedEssays.length > 0 && showScore ? (
          <div className="border-b bg-sky-50 px-6 py-3 text-sm text-sky-900 dark:bg-sky-500/10 dark:text-sky-300">
            Your essay score{autoGradedEssays.length === 1 ? ' was' : 's were'} graded automatically by keyword matching — this is provisional.
            Your instructor will still review your {autoGradedEssays.length === 1 ? 'answer' : 'answers'} and may adjust your score, so this result is not final.
          </div>
        ) : null}
        <CardContent className="p-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <ResultTile
              icon={Trophy}
              label="Score"
              value={showScore ? `${student_exam.score_percent ?? 0}%` : '—'}
              hint={showScore ? `${student_exam.score ?? 0} points` : 'Hidden by instructor'}
            />
            <ResultTile
              icon={gradingPending ? Clock3 : CheckCircle2}
              label="Result"
              value={showScore ? (gradingPending ? 'Pending review' : student_exam.passed ? 'Passed' : 'Failed') : '—'}
              hint={
                showScore
                  ? gradingPending
                    ? 'Your instructor is still grading the essay part'
                    : autoGradedEssays.length > 0
                      ? 'Auto-graded only — instructor review pending'
                      : `Passing: ${exam.passing_score}%`
                  : undefined
              }
              accent={
                gradingPending
                  ? 'text-amber-600 dark:text-amber-400'
                  : student_exam.passed
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400'
              }
            />
            <ResultTile
              icon={Clock3}
              label="Time used"
              value={formatClock(student_exam.time_used_seconds)}
              hint="of the allotted time"
            />
            <ResultTile
              icon={ShieldAlert}
              label="Risk score"
              value={<RiskBadge level={risk?.level ?? 'low'} points={risk?.total_points ?? student_exam.risk_score} />}
              hint={risk ? `${risk.tab_switches} tab switches · ${risk.copy_attempts + risk.paste_attempts} clipboard attempts` : 'No incidents'}
            />
          </div>
        </CardContent>
      </Card>

      {showScore && revealAnswers && answers.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-primary" />
              Answer review
            </CardTitle>
            <CardDescription>Your answers are highlighted. Essays show your instructor's score and feedback once graded.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {answers.map((answer, idx) => {
              const isOpen = expanded === answer.question_id
              const isEssay = (answer.question_type ?? 'multiple_choice') === 'essay'
              const answeredCorrectly = answer.is_correct === true
              const essayPending = isEssay && answer.points_earned === null

              return (
                <div key={answer.question_id} className="rounded-lg border">
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : answer.question_id)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left"
                  >
                    {isEssay ? (
                      essayPending ? (
                        <Clock3 className="h-5 w-5 shrink-0 text-amber-500" />
                      ) : (
                        <CheckCircle2 className="h-5 w-5 shrink-0 text-sky-500" />
                      )
                    ) : answeredCorrectly ? (
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                    ) : (
                      <XCircle className="h-5 w-5 shrink-0 text-rose-500" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium leading-snug">
                        {idx + 1}. {answer.content}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {answer.points} pt · {isEssay ? <span className="font-medium">Essay</span> : null}{' '}
                        {isEssay
                          ? essayPending
                            ? 'Awaiting grading'
                            : `Graded: ${answer.points_earned}/${answer.points}${answer.auto_graded ? ' (auto)' : ''}`
                          : answeredCorrectly ? 'Correct' : answer.choice_id ? 'Incorrect' : 'Unanswered'}
                        {!isEssay && typeof answer.points_earned === 'number' ? ` · ${answer.points_earned}/${answer.points} pts` : ''}
                      </p>
                    </div>
                    {isOpen ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
                  </button>
                  {isOpen ? (
                    <div className="space-y-2 border-t px-4 py-3">
                      {isEssay ? (
                        <>
                          <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm whitespace-pre-line">
                            {answer.answer_text || <span className="text-muted-foreground">No answer submitted.</span>}
                          </div>
                          {essayPending ? (
                            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                              Your instructor has not graded this essay yet. Your final score may change.
                            </p>
                          ) : null}
                          {answer.feedback ? (
                            <p className="rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:bg-sky-500/10 dark:text-sky-300">
                              <span className="font-medium">Instructor feedback: </span>
                              {answer.feedback}
                            </p>
                          ) : null}
                          {!essayPending && answer.auto_graded ? (
                            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                              This score was graded automatically and is provisional — your instructor may still review it and adjust your grade.
                            </p>
                          ) : null}
                        </>
                      ) : (
                      answer.choices.map((choice) => {
                        const isSelected = choice.id === answer.choice_id
                        const isCorrectChoice = choice.is_correct === true
                        return (
                          <div
                            key={choice.id}
                            className={
                              isCorrectChoice
                                ? 'rounded-md border border-emerald-400 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300'
                                : isSelected
                                  ? 'rounded-md border border-rose-400 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-500/10 dark:text-rose-300'
                                  : 'rounded-md border border-transparent px-3 py-2 text-sm'
                            }
                          >
                            <span className="flex items-center gap-2">
                              {isCorrectChoice ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : null}
                              {isSelected && !isCorrectChoice ? <XCircle className="h-4 w-4 shrink-0" /> : null}
                              {choice.content}
                              {isSelected ? <Badge variant="secondary" className="ml-auto">Your answer</Badge> : null}
                              {isCorrectChoice ? <Badge variant="success" className="ml-auto">Correct</Badge> : null}
                            </span>
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
      ) : null}

      <div className="flex justify-center">
        <Button asChild>
          <Link to="/student">Back to dashboard</Link>
        </Button>
      </div>
    </div>
  )
}

function ResultTile({
  icon: Icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: typeof Trophy
  label: string
  value: React.ReactNode
  hint?: string
  accent?: string
}) {
  return (
    <div className="rounded-xl border bg-background p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className={`mt-1.5 text-xl font-bold ${accent ?? ''}`}>{value}</div>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
