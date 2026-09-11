import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { BookOpen, CalendarClock, ClipboardList, Clock3, History, PlayCircle, Trophy } from 'lucide-react'
import { studentApi } from '@/api/supabase-api'
import { isHistoryVisible } from '@/lib/types'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PageLoader } from '@/components/common/page-loader'
import { EmptyState } from '@/components/common/empty-state'
import { PageHeader } from '@/components/common/page-header'
import { formatDateTime } from '@/lib/utils'
import type { StudentExam } from '@/lib/types'

export function StudentDashboardPage() {
  const availableQuery = useQuery({
    queryKey: ['student-available-exams'],
    queryFn: () => studentApi.availableExams(),
    // Lightweight polling so teacher publishes/assignments appear without a
    // manual refresh. Pauses automatically when the tab is hidden.
    refetchInterval: 30_000,
  })
  const attemptsQuery = useQuery({
    queryKey: ['student-attempts'],
    queryFn: () => studentApi.myExamAttempts(),
    refetchInterval: 30_000,
  })

  if (availableQuery.isLoading || attemptsQuery.isLoading) return <PageLoader />

  const exams = availableQuery.data ?? []
  const attempts = attemptsQuery.data ?? []

  const attemptByExam = new Map<string, StudentExam>()
  for (const attempt of attempts) {
    if (!attemptByExam.has(attempt.exam_id)) attemptByExam.set(attempt.exam_id, attempt)
  }

  const latestAttempts = [...attempts]
    .filter(isHistoryVisible)
    .sort((a, b) => (b.submitted_at ?? b.started_at ?? '').localeCompare(a.submitted_at ?? a.started_at ?? ''))
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader title={`Welcome back!`} description="Your available exams and recent attempts." />

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <BookOpen className="h-5 w-5 text-primary" />
          Available exams
        </h2>
        {exams.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No exams available"
            description="Your instructor hasn't published any exams for you right now."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {exams.map((exam) => {
              const attempt = attemptByExam.get(exam.id)
              const submitted = attempt?.status === 'submitted' || attempt?.status === 'time_up'
              const inProgress = attempt?.status === 'in_progress'
              const attemptNumber = attempt?.attempt_number ?? 1
              // Mirrors the fn_start_exam retake gate: first attempt is free,
              // further ones need granted retakes.
              const attemptsUsed = attempts.filter((a) => a.exam_id === exam.id).length
              const canRetake = !submitted || attemptsUsed < 1 + (exam.retakes_allowed ?? 0)
              return (
                <Card key={exam.id} className="flex flex-col transition-shadow hover:shadow-md">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base leading-snug">{exam.title}</CardTitle>
                      {inProgress ? (
                        <Badge variant="info">In progress</Badge>
                      ) : submitted ? (
                        attempt.passed === null ? (
                          <Badge variant="warning">Pending review</Badge>
                        ) : (
                          <Badge variant={attempt.passed ? 'success' : 'destructive'}>
                            {attempt.passed ? 'Passed' : 'Failed'}
                          </Badge>
                        )
                      ) : null}
                    </div>
                    <CardDescription className="line-clamp-2">{exam.description ?? 'No description.'}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col gap-2 text-sm text-muted-foreground">
                    {exam.course_name ? (
                      <span className="flex items-center gap-2">
                        <BookOpen className="h-3.5 w-3.5" /> {exam.course_name}
                      </span>
                    ) : null}
                    <span className="flex items-center gap-2">
                      <Clock3 className="h-3.5 w-3.5" /> {exam.duration_minutes} minutes · {exam.passing_score}% to pass
                    </span>
                    <span className="flex items-center gap-2">
                      <CalendarClock className="h-3.5 w-3.5" />
                      {exam.start_time ? `Opens ${formatDateTime(exam.start_time)}` : 'No scheduled window'}
                    </span>
                    {submitted ? (
                      <span className="flex items-center gap-2 font-medium text-emerald-600 dark:text-emerald-400">
                        <Trophy className="h-3.5 w-3.5" />
                        Attempt {attemptNumber} score: {attempt.score_percent ?? 0}% ({attempt.score ?? 0} pts)
                      </span>
                    ) : null}
                    {submitted && !canRetake ? (
                      <span className="text-xs">No retakes remaining — ask your instructor to allow another attempt.</span>
                    ) : null}
                  </CardContent>
                  <CardFooter className="pt-2">
                    {inProgress ? (
                      <Button asChild className="w-full">
                        <Link to={`/student/exam/${exam.id}`}>
                          <PlayCircle className="h-4 w-4" />
                          Resume exam
                        </Link>
                      </Button>
                    ) : submitted && !canRetake ? (
                      <div className="flex w-full gap-2">
                        <Button asChild variant="outline" className="flex-1">
                          <Link to={`/student/result/${attempt.id}`}>View result</Link>
                        </Button>
                      </div>
                    ) : (
                      <div className="flex w-full gap-2">
                        <Button asChild className="flex-1">
                          <Link to={`/student/exam/${exam.id}`}>
                            <PlayCircle className="h-4 w-4" />
                            {submitted ? `Retake (attempt ${attemptNumber + 1})` : 'Take exam'}
                          </Link>
                        </Button>
                        {submitted ? (
                          <Button asChild variant="outline">
                            <Link to={`/student/result/${attempt.id}`}>View result</Link>
                          </Button>
                        ) : null}
                      </div>
                    )}
                  </CardFooter>
                </Card>
              )
            })}
          </div>
        )}
      </section>

      {latestAttempts.length > 0 ? (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
            <History className="h-5 w-5 text-primary" />
            Recent attempts
            <Button asChild variant="ghost" size="sm" className="ml-auto">
              <Link to="/student/history">View full history</Link>
            </Button>
          </h2>
          <Card>
            <CardContent className="divide-y p-0">
              {latestAttempts.slice(0, 5).map((attempt) => (
                <div key={attempt.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{attempt.exam?.title ?? 'Exam'}</p>
                    <p className="text-xs text-muted-foreground">
                      {attempt.submitted_at ? `Submitted ${formatDateTime(attempt.submitted_at)}` : 'Not submitted yet'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {attempt.status === 'submitted' ? (
                      <Badge variant="secondary">{attempt.score_percent ?? 0}%</Badge>
                    ) : (
                      <Badge variant="info">{attempt.status}</Badge>
                    )}
                    <Button asChild variant="ghost" size="sm">
                      <Link to={`/student/exam/${attempt.exam_id}`}>Open</Link>
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      ) : null}
    </div>
  )
}
