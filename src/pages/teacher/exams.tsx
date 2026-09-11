import { Fragment, useEffect, useMemo, useState } from 'react'
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
import type { Exam, UserProfile } from '@/lib/types'
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
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatClock, formatDateTime } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const SCORES_POLL_MS = 5000

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface LiveSubmission {
  id: string
  exam_id: string
  student_user_id: string
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
  const [submittedExam, setSubmittedExam] = useState<Exam | null>(null)
  const [republishExam, setRepublishExam] = useState<Exam | null>(null)
  const [republishStart, setRepublishStart] = useState('')
  const [republishEnd, setRepublishEnd] = useState('')
  const [assignedIds, setAssignedIds] = useState<string[]>([])
  const [targetSearch, setTargetSearch] = useState('')
  const [targetCourse, setTargetCourse] = useState('')
  const [targetSection, setTargetSection] = useState('')
  const [historySection, setHistorySection] = useState('all')
  const queryClient = useQueryClient()

  const examsQuery = useQuery({ queryKey: ['teacher-exams'], queryFn: () => teacherApi.exams() })

  const sectionMapQuery = useQuery({
    queryKey: ['teacher-exam-sections'],
    queryFn: () => teacherApi.examAssignedSections(),
  })

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
        .select('id, exam_id, student_user_id, status, submitted_at, time_used_seconds, score, score_percent, passed, risk_score, student:users(full_name, student_id)')
        .in('status', ['submitted', 'time_up'])
        .order('submitted_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as LiveSubmission[]
    },
    refetchInterval: SCORES_POLL_MS,
  })

  const studentsQuery = useQuery({ queryKey: ['teacher-students'], queryFn: () => teacherApi.teacherStudents() })

  const assignedQuery = useQuery({
    queryKey: ['teacher-exam-students', republishExam?.id],
    queryFn: () => teacherApi.examStudentIds(republishExam!.id),
    enabled: republishExam !== null,
  })

  const submittedAssignedQuery = useQuery({
    queryKey: ['teacher-exam-assigned', submittedExam?.id],
    queryFn: () => teacherApi.examAssignedStudents(submittedExam!.id),
    enabled: submittedExam !== null,
  })

  const coursesQuery = useQuery({ queryKey: ['teacher-courses'], queryFn: () => teacherApi.courses() })

  const sections = useMemo(() => {
    const set = new Set<string>()
    for (const s of studentsQuery.data ?? []) if (s.section) set.add(s.section)
    return Array.from(set).sort()
  }, [studentsQuery.data])

  const filteredStudents = useMemo(() => {
    const list = studentsQuery.data ?? []
    const q = targetSearch.trim().toLowerCase()
    return list.filter((s) => {
      if (targetCourse && s.course_id !== targetCourse) return false
      if (targetSection && s.section !== targetSection) return false
      if (q) {
        const hay = `${s.full_name} ${s.student_id ?? ''} ${s.email ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [studentsQuery.data, targetSearch, targetCourse, targetSection])

  useEffect(() => {
    if (assignedQuery.data) setAssignedIds(assignedQuery.data)
  }, [assignedQuery.data])

  const toggleAssign = (id: string) => {
    setAssignedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

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

  const historyMutation = useMutation({
    mutationFn: ({ id, allow }: { id: string; allow: boolean }) => teacherApi.updateExam(id, { allow_history: allow }),
    onSuccess: (_, { allow }) => {
      queryClient.invalidateQueries({ queryKey: ['teacher-exams'] })
      toast.success(allow ? 'Exam will show in student history' : 'Exam hidden from student history')
    },
    onError: (err) => toast.error(err instanceof Error ? `Could not update history visibility: ${err.message}` : 'Could not update history visibility.'),
  })

  const republishMutation = useMutation({
    mutationFn: ({ id, startTime, endTime, studentIds }: { id: string; startTime: string | null; endTime: string | null; studentIds: string[] }) =>
      teacherApi.updateExam(id, { start_time: startTime, end_time: endTime }).then(() => teacherApi.setExamStudents(id, studentIds)),
    onSuccess: (_, { id }) => {
      setRepublishExam(null)
      queryClient.invalidateQueries({ queryKey: ['teacher-students'] })
      publishMutation.mutate({ id, publish: true })
    },
    onError: () => toast.error('Could not update the exam window.'),
  })

  const openRepublish = (exam: Exam) => {
    setRepublishStart(toLocalInput(exam.start_time))
    setRepublishEnd(toLocalInput(exam.end_time))
    setTargetSearch('')
    setTargetCourse('')
    setTargetSection('')
    setRepublishExam(exam)
  }

  const handlePublishClick = (exam: Exam) => {
    const isPastDue = exam.end_time && new Date(exam.end_time).getTime() < Date.now()
    if (isPastDue) {
      openRepublish(exam)
      return
    }
    publishMutation.mutate({ id: exam.id, publish: true })
  }

  // NOTE: all hooks must run before any early return (Rules of Hooks).
  const sectionsByExam = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const row of sectionMapQuery.data ?? []) map.set(row.exam_id, row.sections ?? [])
    return map
  }, [sectionMapQuery.data])

  const displayedExams = useMemo(() => {
    const list = examsQuery.data ?? []
    if (historySection === 'all') return list
    return list.filter((exam) => (sectionsByExam.get(exam.id) ?? []).includes(historySection))
  }, [examsQuery.data, historySection, sectionsByExam])

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

  const submittedSubmissions = submittedExam ? (byExam.get(submittedExam.id) ?? []) : []
  const submittedStudentIds = new Set(submittedSubmissions.map((s) => s.student_user_id))
  const submittedAssigned = submittedAssignedQuery.data ?? []
  const submittedList = submittedAssigned.filter((s) => submittedStudentIds.has(s.id))
  const notSubmittedList = submittedAssigned.filter((s) => !submittedStudentIds.has(s.id))

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
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Section:</span>
            <Select value={historySection} onValueChange={setHistorySection}>
              <SelectTrigger className="h-9 w-48">
                <SelectValue placeholder="All sections" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sections</SelectItem>
                {sections.map((section) => (
                  <SelectItem key={section} value={section}>
                    {section}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {historySection !== 'all' ? (
              <span className="text-xs text-muted-foreground">
                Showing {displayedExams.length} exam{displayedExams.length === 1 ? '' : 's'} assigned to section {historySection} — toggle History per exam below.
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">
                Pick a section to focus, then toggle per-exam student-history visibility.
              </span>
            )}
          </div>
          {displayedExams.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No exams for this section"
              description={`None of your exams are assigned to students in section ${historySection}.`}
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
                  <TableHead className="text-center">History</TableHead>
                  <TableHead className="w-12 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayedExams.map((exam) => {
                  const examSubmissions = byExam.get(exam.id) ?? []
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
                          {exam.start_time || exam.end_time ? (
                            <span className="flex flex-col gap-0.5">
                              {exam.start_time ? (
                                <span className="flex items-center gap-1">
                                  <CalendarClock className="h-3 w-3" /> Starts {formatDateTime(exam.start_time)}
                                </span>
                              ) : null}
                              {exam.end_time ? (
                                <span className="flex items-center gap-1">
                                  <CalendarClock className="h-3 w-3" /> Ends {formatDateTime(exam.end_time)}
                                </span>
                              ) : null}
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
                              setSubmittedExam(exam)
                            }}
                            disabled={examSubmissions.length === 0 && (exam.assigned_count ?? 0) === 0}
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            <span>{examSubmissions.length}/{exam.assigned_count ?? 0}</span>
                          </button>
                        </TableCell>
                        <TableCell>
                          <ExamStatusBadge status={exam.status} />
                        </TableCell>
                        <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                          <div className="flex flex-col items-center gap-1">
                            <Switch
                              aria-label={`Show ${exam.title} in student history`}
                              checked={exam.allow_history ?? true}
                              disabled={historyMutation.isPending}
                              onCheckedChange={(v) => historyMutation.mutate({ id: exam.id, allow: v })}
                            />
                            <span className="text-[11px] text-muted-foreground">
                              {(exam.allow_history ?? true) ? 'Shown' : 'Hidden'}
                            </span>
                          </div>
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
                                <DropdownMenuItem onClick={() => handlePublishClick(exam)}>
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
                          <TableCell colSpan={10} className="bg-muted/40 p-0">
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
                                            s.passed === null ? (
                                              <Badge variant="warning">Pending</Badge>
                                            ) : (
                                              <Badge variant={s.passed ? 'success' : 'destructive'}>{s.score_percent}%</Badge>
                                            )
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
        </>
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

      <Dialog
        open={republishExam !== null}
        onOpenChange={(open) => {
          if (!open && !republishMutation.isPending) setRepublishExam(null)
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Republish exam</DialogTitle>
            <DialogDescription>
              This exam&apos;s availability window has already ended. Set a new start and end date/time, and choose who
              should be able to take it, before republishing.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="republish-start">Start date &amp; time</Label>
                <Input id="republish-start" type="datetime-local" value={republishStart} onChange={(e) => setRepublishStart(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="republish-end">End date &amp; time</Label>
                <Input id="republish-end" type="datetime-local" value={republishEnd} onChange={(e) => setRepublishEnd(e.target.value)} />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Users className="h-4 w-4" />
                  <span>
                    <span className="font-medium text-foreground">{assignedIds.length}</span> assigned
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    disabled={filteredStudents.length === 0 || filteredStudents.every((s) => assignedIds.includes(s.id))}
                    onClick={() =>
                      setAssignedIds((prev) => Array.from(new Set([...prev, ...filteredStudents.map((s) => s.id)])))
                    }
                  >
                    Add all
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    disabled={assignedIds.length === 0}
                    onClick={() =>
                      setAssignedIds((prev) => {
                        const filtered = new Set(filteredStudents.map((s) => s.id))
                        return prev.filter((id) => !filtered.has(id))
                      })
                    }
                  >
                    Clear
                  </Button>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                <Input
                  placeholder="Search students…"
                  value={targetSearch}
                  onChange={(e) => setTargetSearch(e.target.value)}
                  className="h-9"
                />
                <Select value={targetCourse} onValueChange={(v) => setTargetCourse(v === 'all' ? '' : v)}>
                  <SelectTrigger className="h-9 w-36">
                    <SelectValue placeholder="All courses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All courses</SelectItem>
                    {(coursesQuery.data ?? []).map((course) => (
                      <SelectItem key={course.id} value={course.id}>
                        {course.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={targetSection} onValueChange={(v) => setTargetSection(v === 'all' ? '' : v)}>
                  <SelectTrigger className="h-9 w-36">
                    <SelectValue placeholder="All sections" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All sections</SelectItem>
                    {sections.map((section) => (
                      <SelectItem key={section} value={section}>
                        {section}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {studentsQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading students…</p>
              ) : filteredStudents.length === 0 ? (
                <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                  No students match your filters.
                </p>
              ) : (
                <ScrollArea className="h-48 rounded-lg border">
                  <div className="space-y-1 p-2">
                    {filteredStudents.map((student) => (
                      <StudentRow
                        key={student.id}
                        student={student}
                        checked={assignedIds.includes(student.id)}
                        onToggle={() => toggleAssign(student.id)}
                      />
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRepublishExam(null)}
              disabled={republishMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!republishExam) return
                const start = republishStart ? new Date(republishStart).toISOString() : null
                const end = republishEnd ? new Date(republishEnd).toISOString() : null
                if (start && end && new Date(start) > new Date(end)) {
                  toast.error('End must be after start.')
                  return
                }
                republishMutation.mutate({ id: republishExam.id, startTime: start, endTime: end, studentIds: assignedIds })
              }}
              disabled={republishMutation.isPending}
            >
              Save &amp; publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={submittedExam !== null} onOpenChange={(open) => !open && setSubmittedExam(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{submittedExam?.title ?? 'Exam'}</DialogTitle>
            <DialogDescription>
              {submittedList.length} of {submittedAssigned.length} assigned students have submitted.
            </DialogDescription>
          </DialogHeader>
          {submittedAssignedQuery.isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading students…</p>
          ) : submittedAssigned.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No students are assigned to this exam.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                  Submitted ({submittedList.length})
                </p>
                <ScrollArea className="h-64 rounded-lg border">
                  <div className="space-y-1 p-2">
                    {submittedList.length === 0 ? (
                      <p className="p-3 text-sm text-muted-foreground">No submissions yet.</p>
                    ) : (
                      submittedList.map((student) => (
                        <div key={student.id} className="flex items-center gap-2 rounded-md px-2 py-1.5">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-[11px] font-semibold text-emerald-600">
                            {student.full_name
                              .split(' ')
                              .map((p) => p[0])
                              .slice(0, 2)
                              .join('')}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{student.full_name}</p>
                            <p className="truncate text-xs text-muted-foreground">{student.student_id ?? '—'}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </div>
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Users className="h-4 w-4" />
                  Not submitted ({notSubmittedList.length})
                </p>
                <ScrollArea className="h-64 rounded-lg border">
                  <div className="space-y-1 p-2">
                    {notSubmittedList.length === 0 ? (
                      <p className="p-3 text-sm text-muted-foreground">Everyone has submitted.</p>
                    ) : (
                      notSubmittedList.map((student) => (
                        <div key={student.id} className="flex items-center gap-2 rounded-md px-2 py-1.5">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                            {student.full_name
                              .split(' ')
                              .map((p) => p[0])
                              .slice(0, 2)
                              .join('')}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{student.full_name}</p>
                            <p className="truncate text-xs text-muted-foreground">{student.student_id ?? '—'}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function StudentRow({
  student,
  checked,
  onToggle,
}: {
  student: UserProfile
  checked: boolean
  onToggle: () => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-md p-2 transition-colors hover:bg-muted">
      <Checkbox checked={checked} onCheckedChange={onToggle} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{student.full_name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {student.student_id ?? '—'}
          {student.course_name ? ` · ${student.course_name}` : ''}
          {student.section ? ` · ${student.section}` : ''}
        </p>
      </div>
    </label>
  )
}
