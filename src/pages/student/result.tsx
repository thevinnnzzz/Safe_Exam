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
  choice_id: string | null
  is_correct: boolean | null
  points_earned: number | null
  time_spent_seconds: number
  choices: { id: string; content: string; is_correct: boolean | null; position: number }[]
}

interface ResultPayload {
  student_exam: {
    id: string
    status: string
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

  if (resultQuery.isLoading) return <PageLoader />
  if (resultQuery.isError || !resultQuery.data) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
        <ShieldAlert className="h-10 w-10 text-destructive" />
        <p className="font-semibold">Result not available</p>
        <Button onClick={() => navigate('/student')}>Back to dashboard</Button>
      </div>
    )
  }

  const { exam, student_exam, answers, risk } = resultQuery.data
  const showScore = exam.show_score_after
  const revealAnswers = exam.allow_review

  return (
    <div className="mx-auto max-w-4xl animate-fade-in space-y-6">
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-r from-primary to-sky-500 px-6 py-8 text-primary-foreground">
          <p className="text-sm opacity-90">{exam.title}</p>
          <h1 className="mt-1 text-2xl font-bold">
            {showScore ? 'Exam submitted — here is your result' : 'Exam submitted successfully'}
          </h1>
          <p className="mt-1 text-sm opacity-90">
            Submitted {student_exam.submitted_at ? new Date(student_exam.submitted_at).toLocaleString() : '—'}
          </p>
        </div>
        <CardContent className="p-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <ResultTile
              icon={Trophy}
              label="Score"
              value={showScore ? `${student_exam.score_percent ?? 0}%` : '—'}
              hint={showScore ? `${student_exam.score ?? 0} points` : 'Hidden by instructor'}
            />
            <ResultTile
              icon={CheckCircle2}
              label="Result"
              value={showScore ? (student_exam.passed ? 'Passed' : 'Failed') : '—'}
              hint={showScore ? `Passing: ${exam.passing_score}%` : undefined}
              accent={student_exam.passed ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}
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
            <CardDescription>Your answers are highlighted. Green shows the correct answer.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {answers.map((answer, idx) => {
              const isOpen = expanded === answer.question_id
              const answeredCorrectly = answer.is_correct === true

              return (
                <div key={answer.question_id} className="rounded-lg border">
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : answer.question_id)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left"
                  >
                    {answeredCorrectly ? (
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                    ) : (
                      <XCircle className="h-5 w-5 shrink-0 text-rose-500" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium leading-snug">
                        {idx + 1}. {answer.content}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {answer.points} pt · {answeredCorrectly ? 'Correct' : answer.choice_id ? 'Incorrect' : 'Unanswered'}
                        {typeof answer.points_earned === 'number' ? ` · ${answer.points_earned}/${answer.points} pts` : ''}
                      </p>
                    </div>
                    {isOpen ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
                  </button>
                  {isOpen ? (
                    <div className="space-y-2 border-t px-4 py-3">
                      {answer.choices.map((choice) => {
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
                      })}
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
