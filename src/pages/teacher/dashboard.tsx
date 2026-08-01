import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Activity,
  ArrowDownUp,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock3,
  Filter,
  Gauge,
  Radio,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  Trophy,
  Users,
  X,
} from 'lucide-react'
import { getSupabase } from '@/lib/supabase'
import { teacherApi } from '@/api/supabase-api'
import { riskLevel, EVENT_LABELS } from '@/lib/risk'
import { PageHeader } from '@/components/common/page-header'
import { PageLoader } from '@/components/common/page-loader'
import { StatCard } from '@/components/common/stat-card'
import { RiskBadge } from '@/components/common/risk-badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { BarChart, ChartCard, DoughnutChart, palette } from '@/components/features/teacher/charts'
import { formatDateTime } from '@/lib/utils'
import type { ActivityLog } from '@/lib/types'

export function TeacherDashboardPage() {
  const [examFilter, setExamFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [riskFilter, setRiskFilter] = useState<string>('all')
  const [eventFilter, setEventFilter] = useState<string>('all')
  const [activitySort, setActivitySort] = useState<'newest' | 'oldest' | 'risk'>('newest')

  const examsQuery = useQuery({ queryKey: ['teacher-exams'], queryFn: () => teacherApi.exams() })

  const recordsQuery = useQuery({
    queryKey: ['teacher-all-records'],
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('student_exams')
        .select('*, exam:exams(id, title)')
        .order('last_active_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as { id: string; exam_id: string; status: string; is_online: boolean; risk_score: number; score_percent: number | null; submitted_at: string | null; time_used_seconds: number; last_active_at: string | null; exam: { id: string; title: string } | null }[]
    },
  })

  const difficultyQuery = useQuery({
    queryKey: ['teacher-difficulty'],
    queryFn: async () => {
      const { data, error } = await getSupabase().from('questions').select('difficulty')
      if (error) throw error
      return data ?? []
    },
  })

  const activityQuery = useQuery({
    queryKey: ['teacher-activity-feed'],
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('activity_logs')
        .select('*, exam:exams(id, title), student:users(full_name, student_id)')
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) throw error
      return (data ?? []) as (ActivityLog & { exam: { id: string; title: string } | null; student: { full_name: string; student_id: string } | null })[]
    },
  })

  const exams = examsQuery.data ?? []
  const allRecords = recordsQuery.data ?? []
  const difficulties = difficultyQuery.data ?? []
  const allActivity = activityQuery.data ?? []

  const filteredRecords = useMemo(() => {
    return allRecords.filter((r) => {
      if (examFilter !== 'all' && r.exam_id !== examFilter) return false
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (riskFilter !== 'all' && riskLevel(r.risk_score) !== riskFilter) return false
      return true
    })
  }, [allRecords, examFilter, statusFilter, riskFilter])

  const filteredActivity = useMemo(() => {
    const list = allActivity.filter((log) => {
      if (examFilter !== 'all' && log.exam_id !== examFilter) return false
      if (eventFilter !== 'all' && log.event_type !== eventFilter) return false
      return true
    })
    return [...list].sort((a, b) => {
      if (activitySort === 'oldest') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      if (activitySort === 'risk') return (b.risk_points ?? 0) - (a.risk_points ?? 0)
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
  }, [allActivity, examFilter, eventFilter, activitySort])

  const records = filteredRecords
  const activity = filteredActivity
  const hasFilters = examFilter !== 'all' || statusFilter !== 'all' || riskFilter !== 'all' || eventFilter !== 'all'

  const clearFilters = () => {
    setExamFilter('all')
    setStatusFilter('all')
    setRiskFilter('all')
    setEventFilter('all')
    setActivitySort('newest')
  }

  if (examsQuery.isLoading || recordsQuery.isLoading) return <PageLoader />

  const submitted = records.filter((r) => r.status === 'submitted' || r.status === 'time_up')
  const online = records.filter(
    (r) => r.status === 'in_progress' && r.is_online && r.last_active_at && Date.now() - new Date(r.last_active_at).getTime() < 45000,
  )
  const scored = submitted.filter((r) => r.score_percent !== null)

  const avgScore = scored.length ? scored.reduce((a, b) => a + (b.score_percent ?? 0), 0) / scored.length : 0
  const highest = scored.length ? Math.max(...scored.map((r) => r.score_percent ?? 0)) : 0
  const lowest = scored.length ? Math.min(...scored.map((r) => r.score_percent ?? 0)) : 0
  const avgRisk = records.length ? records.reduce((a, b) => a + b.risk_score, 0) / records.length : 0

  const riskBuckets = { low: 0, medium: 0, high: 0 }
  for (const r of records) riskBuckets[riskLevel(r.risk_score)] += 1

  // Submission timeline (last 24h in 2h buckets)
  const buckets = Array.from({ length: 12 }, () => ({ label: '', count: 0 }))
  const now = Date.now()
  for (let i = 11; i >= 0; i--) {
    const start = now - (i + 1) * 2 * 3600_000
    const label = new Date(start).toLocaleTimeString([], { hour: '2-digit' })
    buckets[11 - i].label = label
  }
  for (const r of submitted) {
    if (!r.submitted_at) continue
    const ts = new Date(r.submitted_at).getTime()
    const hoursAgo = (now - ts) / 3600_000
    if (hoursAgo >= 0 && hoursAgo < 24) {
      const idx = Math.min(11, Math.floor(hoursAgo / 2))
      buckets[11 - idx].count += 1
    }
  }

  // Average time used per exam
  const examTimeMap = new Map<string, { title: string; total: number; n: number }>()
  for (const r of submitted) {
    const key = r.exam_id
    const entry = examTimeMap.get(key) ?? { title: r.exam?.title ?? 'Exam', total: 0, n: 0 }
    entry.total += r.time_used_seconds
    entry.n += 1
    examTimeMap.set(key, entry)
  }
  const examTimeData = [...examTimeMap.values()].slice(0, 8)

  const difficultyCounts = {
    easy: difficulties.filter((d) => d.difficulty === 'easy').length,
    medium: difficulties.filter((d) => d.difficulty === 'medium').length,
    hard: difficulties.filter((d) => d.difficulty === 'hard').length,
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        title="Teacher dashboard"
        description="Live overview across all of your exams."
      >
        <Link
          to="/teacher/exams"
          className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
        >
          <BookOpen className="h-4 w-4" />
          Manage exams
        </Link>
      </PageHeader>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Filter className="h-4 w-4 text-primary" />
              Advanced filters
            </p>
            {hasFilters ? (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="h-7 px-2 text-xs">
                <X className="h-3.5 w-3.5" />
                Clear all
              </Button>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Exam</label>
              <Select value={examFilter} onValueChange={setExamFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All exams" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All exams</SelectItem>
                  {exams.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="in_progress">In progress</SelectItem>
                  <SelectItem value="submitted">Submitted</SelectItem>
                  <SelectItem value="time_up">Time up</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Risk level</label>
              <Select value={riskFilter} onValueChange={setRiskFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All risk levels" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All risk levels</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Activity event</label>
              <Select value={eventFilter} onValueChange={setEventFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All events" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All events</SelectItem>
                  {Object.entries(EVENT_LABELS).map(([type, label]) => (
                    <SelectItem key={type} value={type}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Students online" value={online.length} icon={Radio} hint="taking an exam now" iconClassName="bg-emerald-500/10 text-emerald-600" />
        <StatCard title="Students finished" value={submitted.length} icon={CheckCircle2} hint="submitted" iconClassName="bg-sky-500/10 text-sky-600" />
        <StatCard title="Students remaining" value={records.length - submitted.length} icon={Users} hint="not yet submitted" />
        <StatCard title="Average risk score" value={avgRisk.toFixed(1)} icon={ShieldAlert} hint="across attempts" iconClassName="bg-rose-500/10 text-rose-600" />
        <StatCard title="Average score" value={`${avgScore.toFixed(1)}%`} icon={Gauge} hint="submitted exams" iconClassName="bg-violet-500/10 text-violet-600" />
        <StatCard title="Highest score" value={`${highest}%`} icon={TrendingUp} hint="best result" iconClassName="bg-emerald-500/10 text-emerald-600" />
        <StatCard title="Lowest score" value={`${lowest}%`} icon={TrendingDown} hint="worst result" iconClassName="bg-rose-500/10 text-rose-600" />
        <StatCard title="Total attempts" value={records.length} icon={Activity} hint={`${exams.length} exams`} iconClassName="bg-primary/10 text-primary" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Submissions — last 24 hours" description="How many students submitted over time.">
          <BarChart
            data={{
              labels: buckets.map((b) => b.label),
              datasets: [
                {
                  data: buckets.map((b) => b.count),
                  backgroundColor: palette.blue,
                  borderRadius: 4,
                },
              ],
            }}
          />
        </ChartCard>

        <ChartCard title="Risk score distribution" description="Low / medium / high across all attempts.">
          <DoughnutChart
            data={{
              labels: ['Low', 'Medium', 'High'],
              datasets: [
                {
                  data: [riskBuckets.low, riskBuckets.medium, riskBuckets.high],
                  backgroundColor: [palette.emerald, palette.amber, palette.rose],
                  borderWidth: 0,
                },
              ],
            }}
          />
        </ChartCard>

        <ChartCard title="Question difficulty" description="Your question bank by difficulty.">
          <BarChart
            data={{
              labels: ['Easy', 'Medium', 'Hard'],
              datasets: [
                {
                  data: [difficultyCounts.easy, difficultyCounts.medium, difficultyCounts.hard],
                  backgroundColor: [palette.emerald, palette.amber, palette.rose],
                  borderRadius: 4,
                },
              ],
            }}
          />
        </ChartCard>

        <ChartCard title="Average time used per exam" description="Seconds per submitted exam (top 8).">
          <BarChart
            data={{
              labels: examTimeData.map((d) => d.title.slice(0, 18)),
              datasets: [
                {
                  data: examTimeData.map((d) => Math.round(d.total / d.n / 60)),
                  backgroundColor: palette.sky,
                  borderRadius: 4,
                },
              ],
            }}
          />
        </ChartCard>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Activity className="h-4 w-4 text-primary" />
            Recent activity
          </CardTitle>
          <div className="flex items-center gap-2">
            {hasFilters ? (
              <Badge variant="secondary" className="text-xs">
                {activity.length} shown
              </Badge>
            ) : null}
            <Select value={activitySort} onValueChange={(v) => setActivitySort(v as 'newest' | 'oldest' | 'risk')}>
              <SelectTrigger className="h-8 w-[160px] text-xs">
                <ArrowDownUp className="h-3.5 w-3.5" />
                <SelectValue placeholder="Sort" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest first</SelectItem>
                <SelectItem value="oldest">Oldest first</SelectItem>
                <SelectItem value="risk">Highest risk</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {activity.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No activity yet.</p>
          ) : (
            <div className="divide-y">
              {activity.map((log) => (
                <div key={log.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      <span className="font-medium">{log.student?.full_name ?? 'Student'}</span>
                      <span className="text-muted-foreground"> · {EVENT_LABELS[log.event_type as keyof typeof EVENT_LABELS] ?? log.event_type}</span>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {log.exam?.title ?? 'Exam'} · {formatDateTime(log.created_at)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {log.risk_points > 0 ? (
                      <RiskBadge level={riskLevel(log.risk_points)} points={log.risk_points} />
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock3 className="h-3.5 w-3.5" />
                        {formatDateTime(log.created_at)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between rounded-xl border bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Trophy className="h-5 w-5" />
          </div>
          <div>
            <p className="font-medium">Monitor an exam live</p>
            <p className="text-sm text-muted-foreground">Watch student progress, risk scores and incidents in real time.</p>
          </div>
        </div>
        <Link to="/teacher/exams" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
          Pick an exam <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  )
}
