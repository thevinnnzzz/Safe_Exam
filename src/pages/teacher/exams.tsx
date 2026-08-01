import { Fragment, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Edit3,
  MoreHorizontal,
  Plus,
  Send,
  TimerOff,
  Trash2,
  Users,
} from 'lucide-react'
import { getSupabase } from '@/lib/supabase'
import { teacherApi } from '@/api/supabase-api'
import { PageHeader } from '@/components/common/page-header'
import { PageLoader } from '@/components/common/page-loader'
import { EmptyState } from '@/components/common/empty-state'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { ExamStatusBadge } from '@/components/common/status-badge'
import { RiskBadge } from '@/components/common/risk-badge'
import { riskLevel } from '@/lib/risk'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatClock, formatDateTime } from '@/lib/utils'

const SCORES_POLL_MS = 5000

interface LiveSubmission {
  id: string
  exam_id: string
  status: string
  submitted_at: string | null
  time_used_seconds: number
  score: number | null
  score_percent: number | null
  passed: boolean | null
  risk_score: number
  student: { full_name: string; student_id: string } | { full_name: string; student_id: string }[] | null
}

export function TeacherExamsPage() {
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const examsQuery = useQuery({ queryKey: ['teacher-exams'], queryFn: () => teacherApi.exams() })

  const countsQuery = useQuery({
    queryKey: ['teacher-exam-question-counts'],
    queryFn: async () => {
      const { data, error } = await getSupabase().from('exam_questions').select('exam_id')
      if (error) throw error
      const counts: Record<string, number> = {}
      for (const row of data ?? []) counts[row.exam_id] = (counts[row.exam_id] ?? 0) + 1
      return counts
    },
  })

  const scoresQuery = useQuery({
    queryKey: ['teacher-live-scores'],
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('student_exams')
        .select('id, exam_id, status, submitted_at, time_used_seconds, score, score_percent, passed, risk_score, student:users(full_name, student_id)')
        .in('status', ['submitted', 'time_up'])
        .order('submitted_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as LiveSubmission[]
    },
    refetchInterval: SCORES_POLL_MS,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => teacherApi.deleteExam(id),
    onSuccess: () => {
      toast.success('Exam deleted')
      queryClient.invalidateQueries({ queryKey: ['teacher-exams'] })
      setDeleteId(null)
    },
    onError: () => toast.error('Could not delete the exam.'),
  })

  const publishMutation = useMutation({
    mutationFn: ({ id, publish }: { id: string; publish: boolean }) => teacherApi.publishExam(id, publish),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teacher-exams'] })
      toast.success('Exam status updated')
    },
    onError: () => toast.error('Could not update the exam.'),
  })

  if (examsQuery.isLoading) return <PageLoader />

  const exams = examsQuery.data ?? []
  const counts = countsQuery.data ?? {}
  const submissions = scoresQuery.data ?? []

  const byExam = new Map<string, LiveSubmission[]>()
  for (const s of submissions) {
    const list = byExam.get(s.exam_id) ?? []
    list.push(s)
    byExam.set(s.exam_id, list)
  }

  const studentOf = (s: LiveSubmission) =>
    Array.isArray(s.student) ? (s.student[0] ?? null) : s.student

  const toggleExpand = (examId: string) => {
    setExpanded((prev) => (prev === examId ? null : examId))
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Exams" description="Create, publish and manage your exams.">
        <Button asChild>
          <Link to="/teacher/exams/new">
            <Plus className="h-4 w-4" />
            New exam
          </Link>
        </Button>
      </PageHeader>

      {exams.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No exams yet"
          description="Create your first exam to start publishing quizzes for your students."
          action={
            <Button asChild>
              <Link to="/teacher/exams/new">
                <Plus className="h-4 w-4" />
                Create exam
              </Link>
            </Button>
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Exam</TableHead>
                  <TableHead>Course</TableHead>
                  <TableHead className="text-center">Questions</TableHead>
                  <TableHead>Availability</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead className="text-center">Submitted</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {exams.map((exam) => {
                  const examSubmissions = byExam.get(exam.id) ?? []
                  const scored = examSubmissions.filter((s) => s.score_percent !== null)
                  const avg = scored.length ? Math.round(scored.reduce((a, b) => a + (b.score_percent ?? 0), 0) / scored.length) : null
                  const isExpanded = expanded === exam.id
                  return (
                    <Fragment key={exam.id}>
                      <TableRow key={exam.id} className="cursor-pointer" onClick={() => toggleExpand(exam.id)}>
                        <TableCell>
                          {examSubmissions.length > 0 ? (
                            isExpanded ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            )
                          ) : (
                            <span className="block w-4" />
                          )}
                        </TableCell>
                        <TableCell>
                          <Link to={`/teacher/exams/${exam.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                            {exam.title}
                          </Link>
                          <p className="text-xs text-muted-foreground">{exam.description ?? 'No description'}</p>
                        </TableCell>
                        <TableCell>{exam.course_name ?? '—'}</TableCell>
                        <TableCell className="text-center">{counts[exam.id] ?? 0}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {exam.start_time ? (
                            <span className="flex items-center gap-1">
                              <CalendarClock className="h-3 w-3" /> {formatDateTime(exam.start_time)}
                            </span>
                          ) : (
                            'No window'
                          )}
                        </TableCell>
                        <TableCell>{exam.duration_minutes} min</TableCell>
                        <TableCell className="text-center">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleExpand(exam.id)
                            }}
                            disabled={examSubmissions.length === 0}
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            {examSubmissions.length}
                            {avg !== null ? (
                              <Badge variant="secondary">{avg}%</Badge>
                            ) : null}
                          </button>
                        </TableCell>
                        <TableCell>
                          <ExamStatusBadge status={exam.status} />
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" aria-label="Exam actions">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              <DropdownMenuItem asChild>
                                <Link to={`/teacher/exams/${exam.id}`}>
                                  <Edit3 className="h-4 w-4" /> Edit exam
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem asChild>
                                <Link to={`/teacher/exams/${exam.id}/monitor`}>
                                  <Users className="h-4 w-4" /> Live monitor
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem asChild>
                                <Link to={`/teacher/exams/${exam.id}/results`}>
                                  <BarChart3 className="h-4 w-4" /> Results
                                </Link>
                              </DropdownMenuItem>
                              {exam.status === 'published' ? (
                                <DropdownMenuItem onClick={() => publishMutation.mutate({ id: exam.id, publish: false })}>
                                  <Send className="h-4 w-4" /> Unpublish
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem onClick={() => publishMutation.mutate({ id: exam.id, publish: true })}>
                                  <Send className="h-4 w-4" /> Publish
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteId(exam.id)}>
                                <Trash2 className="h-4 w-4" /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>

                      {isExpanded && examSubmissions.length > 0 ? (
                        <TableRow key={`${exam.id}-scores`}>
                          <TableCell colSpan={9} className="bg-muted/40 p-0">
                            <div className="p-4">
                              <div className="mb-3 flex items-center justify-between">
                                <p className="text-sm font-medium">Live scores</p>
                                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                                  Refreshes every {SCORES_POLL_MS / 1000}s
                                </span>
                              </div>
                              <div className="overflow-hidden rounded-lg border">
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>Student</TableHead>
                                      <TableHead className="text-center">Score</TableHead>
                                      <TableHead className="text-center">Percentage</TableHead>
                                      <TableHead>Time used</TableHead>
                                      <TableHead>Risk</TableHead>
                                      <TableHead>Status</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {examSubmissions.map((s) => {
                                      const student = studentOf(s)
                                      return (
                                      <TableRow key={s.id}>
                                        <TableCell>
                                          <span className="font-medium">{student?.full_name ?? 'Student'}</span>
                                          <p className="text-xs text-muted-foreground">{student?.student_id}</p>
                                        </TableCell>
                                        <TableCell className="text-center font-semibold">{s.score ?? '—'}</TableCell>
                                        <TableCell className="text-center">
                                          {s.score_percent !== null ? (
                                            <Badge variant={s.passed ? 'success' : 'destructive'}>{s.score_percent}%</Badge>
                                          ) : (
                                            <span className="text-muted-foreground">—</span>
                                          )}
                                        </TableCell>
                                        <TableCell className="font-mono text-sm">
                                          {s.status === 'time_up' ? (
                                            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                                              <TimerOff className="h-3.5 w-3.5" /> {formatClock(s.time_used_seconds)}
                                            </span>
                                          ) : (
                                            formatClock(s.time_used_seconds)
                                          )}
                                        </TableCell>
                                        <TableCell>
                                          {s.risk_score > 0 ? <RiskBadge level={riskLevel(s.risk_score)} points={s.risk_score} /> : <span className="text-sm text-muted-foreground">0</span>}
                                        </TableCell>
                                        <TableCell>
                                          {s.status === 'submitted' ? (
                                            <Badge variant="success">Submitted</Badge>
                                          ) : (
                                            <Badge variant="warning">Time up</Badge>
                                          )}
                                        </TableCell>
                                      </TableRow>
                                    )})}
                                  </TableBody>
                                </Table>
                              </div>
                              <div className="mt-3">
                                <Button asChild variant="outline" size="sm">
                                  <Link to={`/teacher/exams/${exam.id}/results`}>
                                    <BarChart3 className="h-4 w-4" /> View full results
                                  </Link>
                                </Button>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Delete this exam?"
        description="This permanently removes the exam and all associated student records and answers."
        confirmLabel="Delete exam"
        destructive
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        loading={deleteMutation.isPending}
      />
    </div>
  )
}
