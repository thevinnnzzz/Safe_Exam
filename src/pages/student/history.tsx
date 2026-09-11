import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { CheckCircle2, Clock3, EyeOff, History, ListChecks, Search, TimerOff, XCircle } from 'lucide-react'
import { studentApi } from '@/api/supabase-api'
import { isHistoryVisible } from '@/lib/types'
import { formatClock, formatDateTime } from '@/lib/utils'
import { PageHeader } from '@/components/common/page-header'
import { PageLoader } from '@/components/common/page-loader'
import { EmptyState } from '@/components/common/empty-state'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export function StudentHistoryPage() {
  const [search, setSearch] = useState('')

  const attemptsQuery = useQuery({
    queryKey: ['student-history'],
    queryFn: () => studentApi.myExamAttempts(),
    // Same lightweight polling as the dashboard (pauses when tab is hidden).
    refetchInterval: 30_000,
  })

  if (attemptsQuery.isLoading) return <PageLoader />

  if (attemptsQuery.isError) {
    return (
      <div className="mx-auto max-w-6xl animate-fade-in space-y-6">
        <PageHeader title="Exam history" description="Browse every exam you have taken and review your answers." />
        <EmptyState
          icon={History}
          title="Could not load history"
          description={attemptsQuery.error instanceof Error ? attemptsQuery.error.message : 'Please try again in a moment.'}
          action={
            <Button onClick={() => attemptsQuery.refetch()}>Retry</Button>
          }
        />
      </div>
    )
  }

  const all = attemptsQuery.data ?? []
  const q = search.trim().toLowerCase()
  const byRecency = (a: (typeof all)[number], b: (typeof all)[number]) =>
    (b.submitted_at ?? b.started_at ?? '').localeCompare(a.submitted_at ?? a.started_at ?? '')
  const attempts = all
    .filter(isHistoryVisible)
    .filter((a) => (a.exam?.title ?? 'Exam').toLowerCase().includes(q))
    .sort(byRecency)
  // Attempts whose exam history the instructor hid: shown as marked
  // placeholders (title only — no score, no review link).
  const hidden = all
    .filter((a) => !isHistoryVisible(a))
    .filter((a) => (a.exam?.title ?? 'Exam').toLowerCase().includes(q))
    .sort(byRecency)

  return (
    <div className="mx-auto max-w-6xl animate-fade-in space-y-6">
      <PageHeader title="Exam history" description="Browse every exam you have taken and review your answers." />

      <Card>
        <CardContent className="p-4">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by exam title…"
              className="pl-9"
            />
          </div>

          {attempts.length === 0 && hidden.length === 0 ? (
            <EmptyState
              icon={all.length === 0 ? History : ListChecks}
              title={all.length === 0 ? 'No exam history yet' : 'No matching exams'}
              description={
                all.length === 0
                  ? 'Once you take an exam, it will appear here for review.'
                  : 'Try a different search term.'
              }
              action={
                <Button asChild variant="outline">
                  <Link to="/student">Back to dashboard</Link>
                </Button>
              }
            />
          ) : (
            <>
              {attempts.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Exam</TableHead>
                      <TableHead className="text-center">Attempt</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Score</TableHead>
                      <TableHead>Time used</TableHead>
                      <TableHead>Submitted</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {attempts.map((attempt) => {
                  const finished = attempt.status === 'submitted' || attempt.status === 'time_up'
                  const inProgress = attempt.status === 'in_progress'
                  const showScore = attempt.exam?.show_score_after !== false
                  return (
                    <TableRow key={attempt.id}>
                      <TableCell>
                        <span className="font-medium">{attempt.exam?.title ?? 'Exam'}</span>
                      </TableCell>
                      <TableCell className="text-center text-sm text-muted-foreground">
                        {attempt.attempt_number ?? 1}
                      </TableCell>
                      <TableCell>
                        {inProgress ? (
                          <Badge variant="info">In progress</Badge>
                        ) : attempt.status === 'time_up' ? (
                          <Badge variant="warning">
                            <TimerOff className="h-3 w-3" /> Time up
                          </Badge>
                        ) : attempt.passed === null ? (
                          <Badge variant="warning">
                            <Clock3 className="h-3 w-3" /> Pending review
                          </Badge>
                        ) : attempt.passed ? (
                          <Badge variant="success">
                            <CheckCircle2 className="h-3 w-3" /> Passed
                          </Badge>
                        ) : (
                          <Badge variant="destructive">
                            <XCircle className="h-3 w-3" /> Failed
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {showScore && attempt.score_percent !== null ? (
                          <span className="font-semibold">{attempt.score_percent}%</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {finished ? formatClock(attempt.time_used_seconds) : '—'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {attempt.submitted_at ? formatDateTime(attempt.submitted_at) : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        {inProgress ? (
                          <Button asChild variant="ghost" size="sm">
                            <Link to={`/student/exam/${attempt.exam_id}`}>Resume</Link>
                          </Button>
                        ) : finished ? (
                          <Button asChild variant="ghost" size="sm">
                            <Link to={`/student/result/${attempt.id}`}>Review</Link>
                          </Button>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
                  </TableBody>
                </Table>
              ) : null}
              {hidden.length > 0 ? (
                <div className={attempts.length > 0 ? 'mt-6' : ''}>
                  <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                    <EyeOff className="h-4 w-4" />
                    Hidden by instructor ({hidden.length})
                  </p>
                  <div className="space-y-2">
                    {hidden.map((attempt) => (
                      <div
                        key={attempt.id}
                        className="flex items-center gap-3 rounded-lg border border-dashed bg-muted/40 px-4 py-3 opacity-80"
                      >
                        <EyeOff className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{attempt.exam?.title ?? 'Exam'}</p>
                          <p className="text-xs text-muted-foreground">
                            Attempt {attempt.attempt_number ?? 1}
                            {attempt.submitted_at ? ` · Submitted ${formatDateTime(attempt.submitted_at)}` : ''}
                          </p>
                        </div>
                        <Badge variant="secondary">Hidden</Badge>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    These exams are hidden by your instructor and cannot be reviewed right now.
                  </p>
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
