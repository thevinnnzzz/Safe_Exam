import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  Clock3,
  Radio,
  ShieldAlert,
  Users,
  WifiOff,
} from 'lucide-react'
import { getSupabase } from '@/lib/supabase'
import { teacherApi } from '@/api/supabase-api'
import { riskLevel, EVENT_LABELS } from '@/lib/risk'
import { cn, formatClock, formatDateTime } from '@/lib/utils'
import { PageHeader } from '@/components/common/page-header'
import { PageLoader } from '@/components/common/page-loader'
import { StatCard } from '@/components/common/stat-card'
import { RiskBadge } from '@/components/common/risk-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { ActivityLog } from '@/lib/types'

const POLL_MS = 5000
const ONLINE_WINDOW_MS = 45000

type SortKey = 'student' | 'status' | 'question' | 'progress' | 'time' | 'risk'

const SORTABLE_COLUMNS: { key: SortKey; label: string; className?: string; defaultDir: 'asc' | 'desc' }[] = [
  { key: 'student', label: 'Student', defaultDir: 'asc' },
  { key: 'status', label: 'Status', defaultDir: 'asc' },
  { key: 'question', label: 'Current question', defaultDir: 'asc' },
  { key: 'progress', label: 'Progress', className: 'text-center', defaultDir: 'desc' },
  { key: 'time', label: 'Time remaining', defaultDir: 'asc' },
  { key: 'risk', label: 'Risk', defaultDir: 'desc' },
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

export function TeacherMonitorPage() {
  const { examId } = useParams<{ examId: string }>()

  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  // Ticking clock so the "time remaining" column updates every second,
  // independent of the 5s polling refetch.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  const examQuery = useQuery({
    queryKey: ['teacher-exam', examId],
    queryFn: () => teacherApi.exam(examId!),
    enabled: !!examId,
  })

  const recordsQuery = useQuery({
    queryKey: ['teacher-monitor-records', examId],
    queryFn: () => teacherApi.examStudentRecords(examId!),
    enabled: !!examId,
    refetchInterval: POLL_MS,
  })

  const assignedQuery = useQuery({
    queryKey: ['teacher-monitor-assigned', examId],
    queryFn: () => teacherApi.examAssignedStudents(examId!),
    enabled: !!examId,
    staleTime: 60_000,
  })

  const activityQuery = useQuery({
    queryKey: ['teacher-monitor-activity', examId],
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('activity_logs')
        .select('id, exam_id, event_type, risk_points, created_at, student:users(full_name, student_id)')
        .eq('exam_id', examId!)
        .order('created_at', { ascending: false })
        .limit(30)
      if (error) throw error
      return (data ?? []) as unknown as (ActivityLog & { student: { full_name: string; student_id: string } | null })[]
    },
    enabled: !!examId,
    refetchInterval: POLL_MS,
  })

  const records = recordsQuery.data ?? []
  const activity = activityQuery.data ?? []

  const questionIds = useMemo(() => {
    const ids = new Set<string>()
    for (const r of records) {
      const order = (r.question_order as string[] | null) ?? []
      if (r.question_order) for (const id of order) ids.add(id)
    }
    return [...ids]
  }, [records])

  const questionsQuery = useQuery({
    queryKey: ['teacher-monitor-questions', examId],
    queryFn: () => teacherApi.questionBatch(questionIds),
    enabled: questionIds.length > 0,
  })
  const questionMap = useMemo(
    () => new Map((questionsQuery.data ?? []).map((q) => [q.id, q.content])),
    [questionsQuery.data],
  )

  const latestByStudent = useMemo(() => {
    const map = new Map<string, (typeof records)[number]>()
    for (const r of records) {
      const existing = map.get(r.student_user_id)
      if (!existing || (r.started_at ?? '').localeCompare(existing.started_at ?? '') >= 0) {
        map.set(r.student_user_id, r)
      }
    }
    return [...map.values()]
  }, [records])

  if (examQuery.isLoading) return <PageLoader />
  if (examQuery.isError || !examQuery.data) {
    return (
      <div className="py-16 text-center">
        <p className="font-semibold">Exam not found</p>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/teacher/exams">Back to exams</Link>
        </Button>
      </div>
    )
  }

  const exam = examQuery.data
  const durationSec = exam.duration_minutes * 60

  const isRecentlyActive = (r: { is_online: boolean; last_active_at: string | null }) =>
    r.is_online && !!r.last_active_at && now - new Date(r.last_active_at).getTime() < ONLINE_WINDOW_MS

  const online = latestByStudent.filter((r) => r.status === 'in_progress' && isRecentlyActive(r))
  const inProgress = latestByStudent.filter((r) => r.status === 'in_progress')
  const finished = latestByStudent.filter((r) => r.status === 'submitted' || r.status === 'time_up')
  const suspicious = latestByStudent.filter((r) => r.risk_score >= 40)

  // Live row metrics used for ordering. "Time remaining" and "progress" need
  // per-row values, so they are computed once and reused for both sorting and
  // rendering below.
  const rowMetrics = new Map(
    latestByStudent.map((record) => {
      const order = (record.question_order as string[] | null) ?? []
      const currentQid = order[record.current_question_index]
      const currentText = questionMap.get(currentQid) ?? '—'
      const answered = record.answers ? Object.values(record.answers as Record<string, unknown>).filter(Boolean).length : 0
      const remaining = record.status === 'in_progress' && record.started_at
        ? Math.max(0, durationSec - Math.floor((now - new Date(record.started_at).getTime()) / 1000))
        : 0
      const isOnline = record.status === 'in_progress' && isRecentlyActive(record)
      const isFinished = record.status === 'submitted' || record.status === 'time_up'
      const statusOrder = isFinished ? 1 : record.status === 'in_progress' ? (isOnline ? 0 : 2) : 3
      return [
        record.id,
        { statusOrder, currentText, currentIndex: record.current_question_index ?? 0, answered, total: order.length, remaining, isOnline, isFinished },
      ] as const
    }),
  )

  const sortValue = (record: (typeof latestByStudent)[number], key: SortKey): number | string => {
    const m = rowMetrics.get(record.id)!
    switch (key) {
      case 'student':
        return record.student?.full_name ?? ''
      case 'status':
        return m.statusOrder
      case 'question':
        return m.currentIndex
      case 'progress':
        return m.total > 0 ? m.answered / m.total : 0
      case 'time':
        return m.remaining
      case 'risk':
        return record.risk_score
    }
  }

  const tiebreak = (a: (typeof latestByStudent)[number], b: (typeof latestByStudent)[number]) =>
    (b.started_at ?? '').localeCompare(a.started_at ?? '') || (a.student?.full_name ?? '').localeCompare(b.student?.full_name ?? '')

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(SORTABLE_COLUMNS.find((c) => c.key === key)?.defaultDir ?? 'asc')
    }
  }

  const sortedStudents = [...latestByStudent].sort((a, b) => {
    if (!sortKey) return tiebreak(a, b)
    const sign = sortDir === 'asc' ? 1 : -1
    const av = sortValue(a, sortKey)
    const bv = sortValue(b, sortKey)
    const aEmpty = typeof av === 'number' ? av < 0 : av === ''
    const bEmpty = typeof bv === 'number' ? bv < 0 : bv === ''
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

  const assigned = assignedQuery.data ?? []
  const attendedIds = new Set(records.map((r) => r.student_user_id))
  const attended = assigned.filter((s) => attendedIds.has(s.id))
  const notAttended = assigned.filter((s) => !attendedIds.has(s.id))

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title={exam.title} description="Live monitoring — refreshes every 5 seconds.">
        <Button variant="ghost" asChild>
          <Link to="/teacher/exams">
            <ArrowLeft className="h-4 w-4" />
            Exams
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link to={`/teacher/exams/${exam.id}/results`}>Results</Link>
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Online now" value={online.length} icon={Radio} hint="actively taking" iconClassName="bg-emerald-500/10 text-emerald-600" />
        <StatCard title="In progress" value={inProgress.length} icon={Users} hint="started" iconClassName="bg-sky-500/10 text-sky-600" />
        <StatCard title="Finished" value={finished.length} icon={CheckCircle2} hint="submitted" iconClassName="bg-violet-500/10 text-violet-600" />
        <StatCard title="Suspicious" value={suspicious.length} icon={ShieldAlert} hint="risk ≥ 40" iconClassName="bg-rose-500/10 text-rose-600" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Attendance</CardTitle>
          <CardDescription>
            {attended.length} of {assigned.length} assigned students have started this exam.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Progress value={assigned.length === 0 ? 0 : Math.round((attended.length / assigned.length) * 100)} />
          {notAttended.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              All assigned students have started the exam.
            </p>
          ) : (
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Still not attending ({notAttended.length})
              </p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {notAttended.map((student) => (
                  <div key={student.id} className="flex items-center gap-2 rounded-lg border p-2">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                      {student.full_name
                        .split(' ')
                        .map((p) => p[0])
                        .slice(0, 2)
                        .join('')}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{student.full_name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {student.student_id ?? '—'}
                        {student.section ? ` · ${student.section}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid items-stretch gap-6 lg:grid-cols-[1fr_420px]">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-semibold">Students</CardTitle>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              Live
            </span>
          </CardHeader>
          <CardContent className="p-0">
            {latestByStudent.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">No students have started this exam yet.</p>
            ) : (
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedStudents.map((record) => {
                    const m = rowMetrics.get(record.id)!
                    const isSuspicious = record.risk_score >= 40

                    return (
                      <TableRow key={record.id} className={isSuspicious ? 'bg-rose-50/60 dark:bg-rose-500/5' : ''}>
                        <TableCell>
                          <Link to={`/teacher/exams/${exam.id}/results/${record.id}`} className="font-medium hover:underline">
                            {record.student?.full_name ?? 'Student'}
                          </Link>
                          <p className="text-xs text-muted-foreground">{record.student?.student_id}</p>
                        </TableCell>
                        <TableCell>
                          {m.isFinished ? (
                            <Badge variant="secondary">Finished</Badge>
                          ) : m.isOnline ? (
                            <Badge variant="success">Online</Badge>
                          ) : record.status === 'in_progress' ? (
                            <Badge variant="warning">
                              <WifiOff className="h-3 w-3" /> Offline
                            </Badge>
                          ) : (
                            <Badge variant="outline">Not started</Badge>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[200px]">
                          <p className="truncate text-sm" title={m.currentText}>
                            {record.status === 'in_progress' ? `Q${m.currentIndex + 1}: ${m.currentText}` : '—'}
                          </p>
                        </TableCell>
                        <TableCell className="text-center text-sm">
                          {record.status === 'in_progress' ? `${m.answered}/${m.total}` : '—'}
                        </TableCell>
                        <TableCell>
                          {record.status === 'in_progress' ? (
                            <span className={`font-mono text-sm tabular-nums ${m.remaining < 60 ? 'text-rose-600 dark:text-rose-400' : ''}`}>
                              {formatClock(m.remaining)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {isSuspicious ? (
                            <RiskBadge level={riskLevel(record.risk_score)} points={record.risk_score} />
                          ) : (
                            <span className="text-sm text-muted-foreground">{record.risk_score}</span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="flex min-h-0 flex-col">
          <CardHeader className="shrink-0 pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Activity className="h-4 w-4 text-primary" />
              Live events feed
            </CardTitle>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-y-auto">
            {activity.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No events yet.</p>
            ) : (
              <div className="space-y-0">
                {activity.map((log) => (
                  <div key={log.id} className="flex items-start gap-2 border-b py-2.5 last:border-0">
                    <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted">
                      {log.risk_points > 0 ? <ShieldAlert className="h-3.5 w-3.5 text-rose-500" /> : <Clock3 className="h-3.5 w-3.5 text-muted-foreground" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-xs">
                        <span className="font-medium">{log.student?.full_name ?? 'Student'}</span>
                        <span className="text-muted-foreground"> · {EVENT_LABELS[log.event_type as keyof typeof EVENT_LABELS] ?? log.event_type}</span>
                      </p>
                      <p className="text-[11px] text-muted-foreground">{formatDateTime(log.created_at)}</p>
                    </div>
                    {log.risk_points > 0 ? <span className="shrink-0 text-xs font-semibold text-rose-500">+{log.risk_points}</span> : null}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
