import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, Download, FileBarChart, FileUp, Loader2, RotateCcw, Search, ShieldAlert, TimerOff, FileSpreadsheet, X } from 'lucide-react'
import { toast } from 'sonner'
import { teacherApi } from '@/api/supabase-api'
import { riskLevel } from '@/lib/risk'
import { cn, downloadCSV, formatClock, formatDateTime } from '@/lib/utils'
import { PageHeader } from '@/components/common/page-header'
import { PageLoader } from '@/components/common/page-loader'
import { EmptyState } from '@/components/common/empty-state'
import { RiskBadge } from '@/components/common/risk-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { RiskScore, StudentExam } from '@/lib/types'
import { ExportExamAnswersModal } from '@/components/features/teacher/export-exam-answers'
import { ImportGradesModal } from '@/components/features/teacher/import-grades-modal'

type SortKey = 'student' | 'attempt' | 'score' | 'percent' | 'time' | 'risk' | 'incidents' | 'status'

const STATUS_ORDER: Record<string, number> = { submitted: 0, time_up: 1, in_progress: 2, not_started: 3 }

const SORTABLE_COLUMNS: { key: SortKey; label: string; className?: string; defaultDir: 'asc' | 'desc' }[] = [
  { key: 'student', label: 'Student', defaultDir: 'asc' },
  { key: 'attempt', label: 'Attempt', className: 'text-center', defaultDir: 'asc' },
  { key: 'score', label: 'Score', defaultDir: 'desc' },
  { key: 'percent', label: 'Percentage', defaultDir: 'desc' },
  { key: 'time', label: 'Time used', defaultDir: 'asc' },
  { key: 'risk', label: 'Risk', defaultDir: 'desc' },
  { key: 'incidents', label: 'Incidents', defaultDir: 'desc' },
  { key: 'status', label: 'Status', defaultDir: 'asc' },
]

function SortableHead({
  column,
  active,
  direction,
  onSort,
}: {
  column: (typeof SORTABLE_COLUMNS)[number]
  active: boolean
  direction: 'asc' | 'desc'
  onSort: (key: SortKey) => void
}) {
  return (
    <TableHead className={column.className}>
      <button
        type="button"
        onClick={() => onSort(column.key)}
        className={cn(
          'inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium uppercase tracking-wide transition-colors hover:text-foreground',
          active ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {column.label}
        {active ? (
          direction === 'asc' ? (
            <ArrowUp className="h-3.5 w-3.5" />
          ) : (
            <ArrowDown className="h-3.5 w-3.5" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-50" />
        )}
      </button>
    </TableHead>
  )
}

export function TeacherResultsPage() {
  const { examId } = useParams<{ examId: string }>()
  const queryClient = useQueryClient()

  const examQuery = useQuery({ queryKey: ['teacher-exam', examId], queryFn: () => teacherApi.exam(examId!), enabled: !!examId })
  const recordsQuery = useQuery({
    queryKey: ['teacher-results-records', examId],
    queryFn: () => teacherApi.examStudentRecords(examId!),
    enabled: !!examId,
  })
  const riskQuery = useQuery({
    queryKey: ['teacher-results-risk', examId],
    queryFn: () => teacherApi.examRiskScores(examId!),
    enabled: !!examId,
  })
  const assignedQuery = useQuery({
    queryKey: ['teacher-exam-assigned', examId],
    queryFn: () => teacherApi.examAssignedStudents(examId!),
    enabled: !!examId,
  })

  const retakeMutation = useMutation({
    mutationFn: ({ studentUserId, studentName }: { studentUserId: string; studentName: string }) =>
      teacherApi.grantRetake(examId!, studentUserId).then((result) => ({ ...result, studentName })),
    onSuccess: ({ retakes_allowed, studentName }) => {
      toast.success(`Retake allowed for ${studentName} (${retakes_allowed} extra attempt${retakes_allowed === 1 ? '' : 's'} granted).`)
      queryClient.invalidateQueries({ queryKey: ['teacher-results-records', examId] })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not allow a retake.'),
  })

  const [exportModalOpen, setExportModalOpen] = useState(false)
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const exportResults = async () => {
    try {
      const rows = (await teacherApi.exportResults(examId!)) as {
        student_id: string | null
        full_name: string
        status: string
        started_at: string | null
        submitted_at: string | null
        time_used_seconds: number
        score: number | null
        score_percent: number | null
        passed: boolean | null
        risk_score: number
        risk_level: string
      }[]
      downloadCSV(`exam-results-${examId}.csv`, [
        ['Student ID', 'Name', 'Status', 'Started', 'Submitted', 'Time used (s)', 'Score', 'Score %', 'Passed', 'Risk score', 'Risk level'],
        ...rows.map((r) => [r.student_id, r.full_name, r.status, r.started_at, r.submitted_at, r.time_used_seconds, r.score, r.score_percent, r.passed, r.risk_score, r.risk_level]),
      ])
      toast.success('Results exported to CSV')
    } catch {
      toast.error('Could not export results.')
    }
  }

  if (examQuery.isLoading || recordsQuery.isLoading) return <PageLoader />

  const exam = examQuery.data
  if (!exam) {
    return (
      <div className="py-16 text-center">
        <p className="font-semibold">Exam not found</p>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/teacher/exams">Back to exams</Link>
        </Button>
      </div>
    )
  }

  const records = recordsQuery.data ?? []
  const riskMap = new Map<string, RiskScore>((riskQuery.data ?? []).map((r) => [r.student_exam_id, r]))
  const sectionMap = new Map((assignedQuery.data ?? []).map((s) => [s.id, s.section]))

  const getIncidents = (record: StudentExam): number => {
    const risk = riskMap.get(record.id)
    if (!risk) return 0
    return (
      risk.tab_switches +
      risk.fullscreen_exits +
      risk.copy_attempts +
      risk.paste_attempts +
      risk.cut_attempts +
      risk.devtools_attempts +
      risk.refresh_attempts +
      risk.navigate_attempts +
      risk.find_attempts +
      risk.print_attempts +
      risk.save_attempts +
      risk.zoom_attempts +
      risk.new_tab_attempts +
      risk.idle_events
    )
  }

  const sortValue = (record: StudentExam, key: SortKey): string | number | null => {
    switch (key) {
      case 'student':
        return record.student?.full_name ?? ''
      case 'attempt':
        return record.attempt_number ?? 1
      case 'score':
        return record.score
      case 'percent':
        return record.score_percent
      case 'time':
        return record.time_used_seconds
      case 'risk':
        return record.risk_score
      case 'incidents':
        return getIncidents(record)
      case 'status':
        return STATUS_ORDER[record.status] ?? 999
    }
  }

  const tiebreak = (a: StudentExam, b: StudentExam): number => {
    const byDate = (b.submitted_at ?? '').localeCompare(a.submitted_at ?? '')
    if (byDate !== 0) return byDate
    return (a.student?.full_name ?? '').localeCompare(b.student?.full_name ?? '')
  }

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(SORTABLE_COLUMNS.find((c) => c.key === key)?.defaultDir ?? 'asc')
    }
  }

  const resetFilters = () => {
    setSearch('')
    setStatusFilter('all')
    setSortKey(null)
    setSortDir('desc')
  }

  const filtersActive = search.trim() !== '' || statusFilter !== 'all' || sortKey !== null

  const q = search.trim().toLowerCase()
  const filteredRecords = records.filter((record) => {
    if (statusFilter === 'needs_grading' && record.grading_status !== 'pending') return false
    if (statusFilter !== 'all' && statusFilter !== 'needs_grading' && record.status !== statusFilter) return false
    if (!q) return true
    const section = sectionMap.get(record.student_user_id) ?? ''
    return [record.student?.full_name ?? '', record.student?.student_id ?? '', section].some((value) =>
      value.toLowerCase().includes(q),
    )
  })

  const sorted = [...filteredRecords].sort((a, b) => {
    if (!sortKey) return (b.submitted_at ?? '').localeCompare(a.submitted_at ?? '')
    const sign = sortDir === 'asc' ? 1 : -1
    const av = sortValue(a, sortKey)
    const bv = sortValue(b, sortKey)
    const aEmpty = av == null || av === ''
    const bEmpty = bv == null || bv === ''
    if (aEmpty && bEmpty) return tiebreak(a, b)
    if (aEmpty) return 1
    if (bEmpty) return -1
    let cmp = 0
    if (typeof av === 'number' && typeof bv === 'number') {
      cmp = av < bv ? -1 : av > bv ? 1 : 0
    } else {
      cmp = String(av).localeCompare(String(bv))
    }
    if (cmp !== 0) return cmp * sign
    return tiebreak(a, b)
  })

  const exportStudents = Array.from(
    new Map(
      records
        .filter((r) => r.status === 'submitted' || r.status === 'time_up')
        .sort((a, b) => (b.attempt_number ?? 1) - (a.attempt_number ?? 1))
        .map((r) => [r.student_user_id, r] as const),
    ).values(),
  ).map((r) => ({
    student_user_id: r.student_user_id,
    full_name: r.student?.full_name ?? 'Student',
    student_id: r.student?.student_id ?? null,
    section: sectionMap.get(r.student_user_id) ?? null,
  }))

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title={exam.title} description="Results, analytics and export.">
        <Button variant="ghost" asChild>
          <Link to="/teacher/exams">
            <ArrowLeft className="h-4 w-4" />
            Exams
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link to={`/teacher/exams/${exam.id}/monitor`}>Live monitor</Link>
        </Button>
        <Button onClick={() => setExportModalOpen(true)}>
          <FileSpreadsheet className="h-4 w-4" />
          Export Answers
        </Button>
        <Button variant="outline" onClick={() => setImportModalOpen(true)}>
          <FileUp className="h-4 w-4" />
          Import Grades
        </Button>
        <Button onClick={exportResults}>
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </PageHeader>

      {records.length === 0 ? (
        <EmptyState icon={FileBarChart} title="No submissions yet" description="Once students submit, their results will appear here." />
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1 sm:max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search name, student ID, or section..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
              {search ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="submitted">Submitted</SelectItem>
                <SelectItem value="time_up">Time up</SelectItem>
                <SelectItem value="in_progress">In progress</SelectItem>
                <SelectItem value="not_started">Not started</SelectItem>
                <SelectItem value="needs_grading">Needs grading</SelectItem>
              </SelectContent>
            </Select>
            {filtersActive ? (
              <Button variant="ghost" size="sm" onClick={resetFilters}>
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </Button>
            ) : null}
            <span className="ml-auto text-sm text-muted-foreground">
              {filtersActive ? (
                <>Showing {sorted.length} of {records.length}</>
              ) : (
                <> {records.length} submission{records.length === 1 ? '' : 's'}</>
              )}
            </span>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    {SORTABLE_COLUMNS.map((column) => (
                      <SortableHead
                        key={column.key}
                        column={column}
                        active={sortKey === column.key}
                        direction={sortDir}
                        onSort={handleSort}
                      />
                    ))}
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                        No results match your current search or filters.
                      </TableCell>
                    </TableRow>
                  ) : (
                    sorted.map((record) => {
                      const incidents = getIncidents(record)
                      const finished = record.status === 'submitted' || record.status === 'time_up'
                      return (
                        <TableRow key={record.id}>
                          <TableCell>
                            <span className="font-medium">{record.student?.full_name ?? 'Student'}</span>
                            <p className="text-xs text-muted-foreground">{record.student?.student_id}</p>
                          </TableCell>
                          <TableCell className="text-center text-sm text-muted-foreground">
                            {record.attempt_number ?? 1}
                          </TableCell>
                          <TableCell>
                            {record.score !== null ? (
                              <span className="font-semibold">{record.score}</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {record.score_percent !== null ? (
                              record.passed === null ? (
                                <Badge variant="warning">Pending</Badge>
                              ) : (
                                <Badge variant={record.passed ? 'success' : 'destructive'}>{record.score_percent}%</Badge>
                              )
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-sm">{finished ? formatClock(record.time_used_seconds) : '—'}</TableCell>
                          <TableCell>
                            {record.risk_score > 0 ? <RiskBadge level={riskLevel(record.risk_score)} points={record.risk_score} /> : <span className="text-sm text-muted-foreground">0</span>}
                          </TableCell>
                          <TableCell>{incidents > 0 ? <span className="font-medium text-rose-600 dark:text-rose-400">{incidents}</span> : '0'}</TableCell>
                          <TableCell>
                            {record.status === 'submitted' ? (
                              <Badge variant="success">Submitted</Badge>
                            ) : record.status === 'time_up' ? (
                              <Badge variant="warning">
                                <TimerOff className="h-3 w-3" /> Time up
                              </Badge>
                            ) : record.status === 'in_progress' ? (
                              <Badge variant="info">In progress</Badge>
                            ) : (
                              <Badge variant="outline">Not started</Badge>
                            )}
                            {record.grading_status === 'pending' ? (
                              <Badge variant="warning" className="ml-1">Needs grading</Badge>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {finished ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  title="Allow this student one more attempt"
                                  disabled={retakeMutation.isPending}
                                  onClick={() =>
                                    retakeMutation.mutate({
                                      studentUserId: record.student_user_id,
                                      studentName: record.student?.full_name ?? 'Student',
                                    })
                                  }
                                >
                                  {retakeMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                                  Allow retake
                                </Button>
                              ) : null}
                              <Button asChild variant="ghost" size="sm">
                                <Link to={`/teacher/exams/${exam.id}/results/${record.id}`}>Review</Link>
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {records.some((r) => r.risk_score > 0) ? (
        <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
          <ShieldAlert className="h-5 w-5 shrink-0" />
          <p>
            <span className="font-medium">Heads up:</span> {records.filter((r) => r.risk_score >= 80).length} high-risk and {records.filter((r) => r.risk_score >= 40 && r.risk_score < 80).length} medium-risk
            attempts were flagged. Risk scores are advisory — review the activity logs before taking action.
          </p>
        </div>
      ) : null}

      {records.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Submitted: {records.filter((r) => r.submitted_at).map((r) => formatDateTime(r.submitted_at)).join(', ') || '—'}
        </p>
      ) : null}

      <ExportExamAnswersModal
        open={exportModalOpen}
        onOpenChange={setExportModalOpen}
        examId={examId!}
        examTitle={exam.title}
        students={exportStudents}
      />
      <ImportGradesModal
        open={importModalOpen}
        onOpenChange={(next) => {
          if (!next) {
            queryClient.invalidateQueries({ queryKey: ['teacher-results-records', examId] })
            queryClient.invalidateQueries({ queryKey: ['teacher-result-detail'] })
          }
          setImportModalOpen(next)
        }}
        examId={examId!}
        examTitle={exam.title}
      />
    </div>
  )
}