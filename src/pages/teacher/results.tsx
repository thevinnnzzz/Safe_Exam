import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, Download, FileBarChart, FileUp, Loader2, RotateCcw, Search, ShieldAlert, TimerOff, FileSpreadsheet, X } from 'lucide-react'
import { toast } from 'sonner'
import { getSupabase, getToken } from '@/lib/supabase'
import { teacherApi } from '@/api/supabase-api'
import { EVENT_LABELS, riskLevel } from '@/lib/risk'
import { cn, downloadCSV, formatClock, formatDateTime } from '@/lib/utils'
import { PageHeader } from '@/components/common/page-header'
import { PageLoader } from '@/components/common/page-loader'
import { EmptyState } from '@/components/common/empty-state'
import { RiskBadge } from '@/components/common/risk-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { ActivityLog, RiskScore, StudentExam } from '@/lib/types'
import { ExportExamAnswersModal } from '@/components/features/teacher/export-exam-answers'
import { ImportGradesModal } from '@/components/features/teacher/import-grades-modal'

/** Long safety-net poll while the Risk dialog is open (socket is the primary feed). */
const RISK_FALLBACK_POLL_MS = 60_000

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

  const [riskRecord, setRiskRecord] = useState<StudentExam | null>(null)
  const [riskLive, setRiskLive] = useState(false)
  const riskAttemptId = riskRecord?.id ?? null

  // Lazy per-attempt incident feed for the Risk dialog. The realtime channel
  // below is the primary feed; this query does the initial load plus a slow
  // 60s fallback poll while the dialog is open (covers socket drops / expiry).
  const riskActivityQuery = useQuery({
    queryKey: ['teacher-results-risk-activity', riskAttemptId],
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('activity_logs')
        .select('id, event_type, risk_points, created_at, meta')
        .eq('student_exam_id', riskAttemptId!)
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) throw error
      return (data ?? []) as ActivityLog[]
    },
    enabled: !!riskAttemptId,
    refetchInterval: riskAttemptId ? RISK_FALLBACK_POLL_MS : false,
  })

  // Scalable live feed: one channel per open dialog, two server-filtered
  // bindings (this attempt's INSERTs + risk UPDATEs). Payloads are applied
  // straight into the query cache — zero refetches per event, zero traffic
  // when idle. Channel is removed on dialog close (no idle sockets).
  useEffect(() => {
    if (!riskAttemptId) {
      setRiskLive(false)
      return
    }
    const token = getToken()
    if (!token) return
    const client = getSupabase()
    client.realtime.setAuth(token)

    const channel = client
      .channel(`teacher-risk-${riskAttemptId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'activity_logs',
          filter: `student_exam_id=eq.${riskAttemptId}`,
        },
        (payload) => {
          const row = payload.new as unknown as ActivityLog
          queryClient.setQueryData<ActivityLog[]>(
            ['teacher-results-risk-activity', riskAttemptId],
            (old) => {
              const prev = old ?? []
              if (prev.some((r) => r.id === row.id)) return prev
              return [row, ...prev].slice(0, 200)
            },
          )
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'risk_scores',
          filter: `student_exam_id=eq.${riskAttemptId}`,
        },
        (payload) => {
          const row = payload.new as unknown as RiskScore
          queryClient.setQueryData<RiskScore[]>(
            ['teacher-results-risk', examId],
            (old) => (old ?? []).map((r) => (r.student_exam_id === riskAttemptId ? { ...r, ...row } : r)),
          )
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setRiskLive(true)
          // Catch-up fetch in case anything landed between open and subscribe.
          queryClient.invalidateQueries({ queryKey: ['teacher-results-risk-activity', riskAttemptId] })
          queryClient.invalidateQueries({ queryKey: ['teacher-results-risk', examId] })
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setRiskLive(false)
        }
      })

    return () => {
      setRiskLive(false)
      void client.removeChannel(channel)
    }
  }, [riskAttemptId, examId, queryClient])

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

  // Trigger breakdown for the Risk dialog, derived from the live incident feed:
  // per event_type → { count, points }. Falls back to the risk_scores row when
  // the log feed is still loading/empty but totals exist.
  const riskTriggerGroups = useMemo(() => {
    const logs = (riskActivityQuery.data ?? []).filter((l) => (l.risk_points ?? 0) > 0)
    const groups = new Map<string, { count: number; points: number }>()
    for (const log of logs) {
      const entry = groups.get(log.event_type) ?? { count: 0, points: 0 }
      entry.count += 1
      entry.points += log.risk_points ?? 0
      groups.set(log.event_type, entry)
    }
    return [...groups.entries()]
      .map(([eventType, { count, points }]) => ({ eventType, count, points }))
      .sort((a, b) => b.points - a.points)
  }, [riskActivityQuery.data])

  const riskDialogIncidents = useMemo(
    () => (riskActivityQuery.data ?? []).filter((l) => (l.risk_points ?? 0) > 0),
    [riskActivityQuery.data],
  )

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
                            <button
                              type="button"
                              onClick={() => setRiskRecord(record)}
                              aria-label={`View risk details for ${record.student?.full_name ?? 'Student'}`}
                              title="View what triggered this risk score"
                              className="cursor-pointer rounded transition-opacity hover:opacity-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {record.risk_score > 0 ? <RiskBadge level={riskLevel(record.risk_score)} points={record.risk_score} /> : <span className="text-sm text-muted-foreground">0</span>}
                            </button>
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
      <RiskDetailDialog
        record={riskRecord}
        risk={riskRecord ? riskMap.get(riskRecord.id) : undefined}
        triggerGroups={riskTriggerGroups}
        incidents={riskDialogIncidents}
        loading={riskActivityQuery.isLoading}
        updating={riskActivityQuery.isFetching}
        live={riskLive}
        examId={examId!}
        onClose={() => setRiskRecord(null)}
      />
    </div>
  )
}

const RISK_COUNT_LABELS: { key: keyof RiskScore; label: string }[] = [
  { key: 'tab_switches', label: 'Tab switches' },
  { key: 'fullscreen_exits', label: 'Fullscreen exits' },
  { key: 'copy_attempts', label: 'Copy attempts' },
  { key: 'paste_attempts', label: 'Paste attempts' },
  { key: 'cut_attempts', label: 'Cut attempts' },
  { key: 'devtools_attempts', label: 'DevTools shortcuts' },
  { key: 'refresh_attempts', label: 'Refresh attempts' },
  { key: 'navigate_attempts', label: 'Back/forward nav' },
  { key: 'find_attempts', label: 'Find on page' },
  { key: 'print_attempts', label: 'Print shortcuts' },
  { key: 'save_attempts', label: 'Save page' },
  { key: 'zoom_attempts', label: 'Zoom shortcuts' },
  { key: 'new_tab_attempts', label: 'New tab/window' },
  { key: 'idle_events', label: 'Idle events' },
]

function RiskDetailDialog({
  record,
  risk,
  triggerGroups,
  incidents,
  loading,
  updating,
  live,
  examId,
  onClose,
}: {
  record: StudentExam | null
  risk: RiskScore | undefined
  triggerGroups: { eventType: string; count: number; points: number }[]
  incidents: ActivityLog[]
  loading: boolean
  updating: boolean
  live: boolean
  examId: string
  onClose: () => void
}) {
  const fallbackCounts = risk
    ? RISK_COUNT_LABELS.map(({ key, label }) => ({ label, value: Number(risk[key] ?? 0) })).filter(
        (c) => c.value > 0,
      )
    : []
  const idleMins = risk ? Math.round((risk.idle_seconds ?? 0) / 60) : 0

  return (
    <Dialog open={!!record} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="pr-8">
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-primary" />
            Risk details — {record?.student?.full_name ?? 'Student'}
            <span className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
              <span className={cn('h-1.5 w-1.5 rounded-full', live ? 'animate-pulse bg-emerald-500' : 'bg-muted-foreground/50')} />
              {live ? 'Live' : 'Connecting…'}
              {updating && live ? ' · Updating…' : ''}
            </span>
          </DialogTitle>
          <DialogDescription>
            {record?.student?.student_id ?? ''} · Attempt {record?.attempt_number ?? 1} · {record?.status ?? ''}
            {risk ? (
              <>
                {' · '}
                <RiskBadge level={riskLevel(record?.risk_score ?? 0)} points={record?.risk_score ?? 0} />
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading incidents…</p>
        ) : triggerGroups.length === 0 && fallbackCounts.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No cheating-related incidents recorded for this attempt.
          </p>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Where the risk came from
              </p>
              {triggerGroups.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {triggerGroups.map((g) => (
                    <div key={g.eventType} className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {EVENT_LABELS[g.eventType as keyof typeof EVENT_LABELS] ?? g.eventType}
                        </p>
                        <p className="text-xs text-muted-foreground">×{g.count}</p>
                      </div>
                      <span className="shrink-0 text-sm font-bold text-rose-600 dark:text-rose-400">+{g.points}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {fallbackCounts.map((c) => (
                    <div key={c.label} className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
                      <p className="text-sm font-medium">{c.label}</p>
                      <span className="text-sm font-bold text-rose-600 dark:text-rose-400">×{c.value}</span>
                    </div>
                  ))}
                  {idleMins > 0 ? (
                    <div className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
                      <p className="text-sm font-medium">Idle time</p>
                      <span className="text-sm font-bold">{idleMins} min</span>
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Specific incidents ({incidents.length})
              </p>
              {incidents.length === 0 ? (
                <p className="text-sm text-muted-foreground">Incident feed is still loading — totals above are current.</p>
              ) : (
                <ScrollArea className="h-[min(40vh,22rem)] rounded-lg border">
                  <div className="divide-y">
                    {incidents.map((log) => (
                      <div key={log.id} className="flex items-start gap-2 px-3 py-2">
                        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted">
                          <ShieldAlert className="h-3.5 w-3.5 text-rose-500" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium">
                            {EVENT_LABELS[log.event_type as keyof typeof EVENT_LABELS] ?? log.event_type}
                          </p>
                          <p className="text-[11px] text-muted-foreground">{formatDateTime(log.created_at)}</p>
                        </div>
                        <span className="shrink-0 text-xs font-semibold text-rose-500">+{log.risk_points}</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              Risk scores are advisory — review the activity logs before taking action.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          {record ? (
            <Button asChild onClick={onClose}>
              <Link to={`/teacher/exams/${examId}/results/${record.id}`}>Open full review</Link>
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}