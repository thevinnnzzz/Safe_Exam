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
  FileQuestion,
  Filter,
  Gauge,
  Radio,
  Search,
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { BarChart, ChartCard, DoughnutChart, palette } from '@/components/features/teacher/charts'
import { formatDateTime } from '@/lib/utils'
import type { ActivityLog } from '@/lib/types'

type DatePreset = 'all' | 'today' | '7d' | '30d' | 'custom'

function parseTimeMinutes(value: string): number | null {
  if (!value) return null
  const [h, m] = value.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  if (h < 0 || h > 23 || m < 0 || m > 59) return null
  return h * 60 + m
}

function inTimeWindow(dateIso: string, timeFrom: string, timeTo: string): boolean {
  if (!timeFrom && !timeTo) return true
  const from = parseTimeMinutes(timeFrom)
  const to = parseTimeMinutes(timeTo)
  if (from === null && to === null) return true
  const d = new Date(dateIso)
  if (Number.isNaN(d.getTime())) return false
  const mins = d.getHours() * 60 + d.getMinutes()
  if (from !== null && to !== null) {
    if (from <= to) return mins >= from && mins <= to
    // overnight wrap, e.g. 22:00–06:00
    return mins >= from || mins <= to
  }
  if (from !== null) return mins >= from
  return mins <= (to as number)
}

function resolveDateBounds(
  preset: DatePreset,
  fromRaw: string,
  toRaw: string,
): { from: Date | null; to: Date | null; error: string | null } {
  const now = new Date()
  if (preset === 'all') return { from: null, to: null, error: null }
  if (preset === 'today') {
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    return { from: start, to: now, error: null }
  }
  if (preset === '7d') {
    return { from: new Date(now.getTime() - 7 * 24 * 3600_000), to: now, error: null }
  }
  if (preset === '30d') {
    return { from: new Date(now.getTime() - 30 * 24 * 3600_000), to: now, error: null }
  }
  // custom
  let from: Date | null = null
  let to: Date | null = null
  if (fromRaw) {
    const d = new Date(fromRaw)
    if (Number.isNaN(d.getTime())) return { from: null, to: null, error: 'Invalid start date.' }
    from = d
  }
  if (toRaw) {
    const d = new Date(toRaw)
    if (Number.isNaN(d.getTime())) return { from: null, to: null, error: 'Invalid end date.' }
    to = d
  }
  if (from && to && from.getTime() > to.getTime()) {
    return { from, to, error: 'Start must be before end.' }
  }
  if (!from && !to) return { from: null, to: null, error: null }
  return { from, to, error: null }
}

function inDateRange(iso: string | null, from: Date | null, to: Date | null): boolean {
  if (!from && !to) return true
  if (!iso) return false
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return false
  if (from && t < from.getTime()) return false
  if (to && t > to.getTime()) return false
  return true
}

export function TeacherDashboardPage() {
  const [examFilter, setExamFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [riskFilter, setRiskFilter] = useState<string>('all')
  const [eventFilter, setEventFilter] = useState<string>('all')
  const [activitySort, setActivitySort] = useState<'newest' | 'oldest' | 'risk'>('newest')
  const [datePreset, setDatePreset] = useState<DatePreset>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [timeFrom, setTimeFrom] = useState('')
  const [timeTo, setTimeTo] = useState('')
  const [activeDifficulty, setActiveDifficulty] = useState<'easy' | 'medium' | 'hard' | null>(null)
  const [difficultySearch, setDifficultySearch] = useState('')

  const examsQuery = useQuery({ queryKey: ['teacher-exams'], queryFn: () => teacherApi.exams() })

  const recordsQuery = useQuery({
    queryKey: ['teacher-all-records'],
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('student_exams')
        .select('id, exam_id, status, is_online, risk_score, score_percent, submitted_at, time_used_seconds, last_active_at, exam:exams(id, title)')
        .order('last_active_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as { id: string; exam_id: string; status: string; is_online: boolean; risk_score: number; score_percent: number | null; submitted_at: string | null; time_used_seconds: number; last_active_at: string | null; exam: { id: string; title: string } | null }[]
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

  const difficultyDetailQuery = useQuery({
    queryKey: ['teacher-difficulty-detail'],
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('questions')
        .select('id, content, difficulty, category, points, question_bank_id, created_at, question_bank:question_bank(id, name)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as {
        id: string
        content: string
        difficulty: string
        category: string | null
        points: number
        question_bank_id: string | null
        created_at: string
        question_bank: { id: string; name: string } | null
      }[]
    },
    enabled: activeDifficulty !== null,
  })

  const examQuestionsQuery = useQuery({
    queryKey: ['teacher-exam-questions-map'],
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('exam_questions')
        .select('question_id, exam_id, exam:exams(id, title, status)')
      if (error) throw error
      return (data ?? []) as unknown as { question_id: string; exam_id: string; exam: { id: string; title: string; status: string } | null }[]
    },
    enabled: activeDifficulty !== null,
  })

  const activityQuery = useQuery({
    queryKey: ['teacher-activity-feed'],
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('activity_logs')
        .select('id, exam_id, event_type, risk_points, created_at, exam:exams(id, title), student:users(full_name, student_id)')
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) throw error
      return (data ?? []) as unknown as (ActivityLog & { exam: { id: string; title: string } | null; student: { full_name: string; student_id: string } | null })[]
    },
  })

  const exams = examsQuery.data ?? []
  const allRecords = recordsQuery.data ?? []
  const difficulties = difficultyQuery.data ?? []
  const allActivity = activityQuery.data ?? []

  const dateBounds = useMemo(() => resolveDateBounds(datePreset, dateFrom, dateTo), [datePreset, dateFrom, dateTo])
  const hasTimeFilter = timeFrom !== '' || timeTo !== ''

  const filteredRecords = useMemo(() => {
    const { from, to, error } = dateBounds
    const useDate = !error
    return allRecords.filter((r) => {
      if (examFilter !== 'all' && r.exam_id !== examFilter) return false
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (riskFilter !== 'all' && riskLevel(r.risk_score) !== riskFilter) return false
      if (useDate && (from || to)) {
        const ts = r.submitted_at ?? r.last_active_at
        if (!inDateRange(ts, from, to)) return false
        if (hasTimeFilter && ts && !inTimeWindow(ts, timeFrom, timeTo)) return false
        if (hasTimeFilter && !ts) return false
      } else if (hasTimeFilter) {
        const ts = r.submitted_at ?? r.last_active_at
        if (!ts || !inTimeWindow(ts, timeFrom, timeTo)) return false
      }
      return true
    })
  }, [allRecords, examFilter, statusFilter, riskFilter, dateBounds, timeFrom, timeTo, hasTimeFilter])

  const filteredActivity = useMemo(() => {
    const { from, to, error } = dateBounds
    const useDate = !error
    const list = allActivity.filter((log) => {
      if (examFilter !== 'all' && log.exam_id !== examFilter) return false
      if (eventFilter !== 'all' && log.event_type !== eventFilter) return false
      if (useDate && (from || to) && !inDateRange(log.created_at, from, to)) return false
      if (hasTimeFilter && !inTimeWindow(log.created_at, timeFrom, timeTo)) return false
      return true
    })
    return [...list].sort((a, b) => {
      if (activitySort === 'oldest') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      if (activitySort === 'risk') return (b.risk_points ?? 0) - (a.risk_points ?? 0)
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
  }, [allActivity, examFilter, eventFilter, activitySort, dateBounds, timeFrom, timeTo, hasTimeFilter])

  const records = filteredRecords
  const activity = filteredActivity
  const hasFilters =
    examFilter !== 'all' ||
    statusFilter !== 'all' ||
    riskFilter !== 'all' ||
    eventFilter !== 'all' ||
    datePreset !== 'all' ||
    dateFrom !== '' ||
    dateTo !== '' ||
    hasTimeFilter

  const clearFilters = () => {
    setExamFilter('all')
    setStatusFilter('all')
    setRiskFilter('all')
    setEventFilter('all')
    setActivitySort('newest')
    setDatePreset('all')
    setDateFrom('')
    setDateTo('')
    setTimeFrom('')
    setTimeTo('')
  }

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

  // Submission timeline — respects active date window, falls back to last 24h in 2h buckets
  const buckets = useMemo(() => {
    const arr = Array.from({ length: 12 }, () => ({ label: '', count: 0 }))
    const nowMs = Date.now()
    const { from, to, error } = dateBounds
    const hasWindow = !error && (from !== null || to !== null || datePreset !== 'all')
    let windowStart: number
    let windowEnd: number
    if (!hasWindow) {
      windowStart = nowMs - 24 * 3600_000
      windowEnd = nowMs
    } else {
      windowStart = from ? from.getTime() : nowMs - 24 * 3600_000
      windowEnd = to ? to.getTime() : nowMs
      if (windowEnd <= windowStart) windowEnd = windowStart + 24 * 3600_000
    }
    const span = windowEnd - windowStart
    const bucketMs = span / 12
    for (let i = 0; i < 12; i++) {
      const bucketStart = windowStart + i * bucketMs
      // Short window: show HH:MM, long window: show Mon DD
      const isShort = span <= 2 * 24 * 3600_000
      arr[i].label = isShort
        ? new Date(bucketStart).toLocaleTimeString([], { hour: '2-digit' })
        : new Date(bucketStart).toLocaleDateString([], { month: 'short', day: 'numeric' })
    }
    for (const r of submitted) {
      if (!r.submitted_at) continue
      const ts = new Date(r.submitted_at).getTime()
      if (Number.isNaN(ts) || ts < windowStart || ts > windowEnd) continue
      if (hasTimeFilter && !inTimeWindow(r.submitted_at, timeFrom, timeTo)) continue
      const idx = Math.min(11, Math.max(0, Math.floor((ts - windowStart) / bucketMs)))
      arr[idx].count += 1
    }
    return arr
  }, [submitted, dateBounds, datePreset, timeFrom, timeTo, hasTimeFilter])

  const submissionChartDescription = useMemo(() => {
    const { from, to, error } = dateBounds
    if (error || (!from && !to && datePreset === 'all' && !hasTimeFilter)) return 'How many students submitted over time.'
    const fmt = (d: Date) => d.toLocaleDateString([], { month: 'short', day: 'numeric' })
    if (datePreset === 'today') return 'Today — submissions by hour.'
    if (datePreset === '7d') return 'Last 7 days — submissions per day.'
    if (datePreset === '30d') return 'Last 30 days — submissions per day.'
    if (from && to) return `${fmt(from)} → ${fmt(to)}`
    if (from) return `Since ${fmt(from)}`
    if (to) return `Until ${fmt(to)}`
    return 'Filtered window'
  }, [dateBounds, datePreset, hasTimeFilter])

  const questionUsageMap = useMemo(() => {
    const map = new Map<string, { id: string; title: string }[]>()
    for (const row of examQuestionsQuery.data ?? []) {
      const list = map.get(row.question_id) ?? []
      if (row.exam) list.push({ id: row.exam.id, title: row.exam.title })
      map.set(row.question_id, list)
    }
    return map
  }, [examQuestionsQuery.data])

  const filteredDifficultyQuestions = useMemo(() => {
    if (!activeDifficulty) return []
    const q = difficultyDetailQuery.data ?? []
    const needle = difficultySearch.trim().toLowerCase()
    return q.filter((item) => {
      if (item.difficulty !== activeDifficulty) return false
      if (!needle) return true
      return `${item.content} ${item.category ?? ''} ${item.question_bank?.name ?? ''}`.toLowerCase().includes(needle)
    })
  }, [activeDifficulty, difficultyDetailQuery.data, difficultySearch])

  if (examsQuery.isLoading || recordsQuery.isLoading) return <PageLoader />

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

          <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium">Date &amp; time</p>
              <div className="flex flex-wrap items-center gap-1">
                {(['all', 'today', '7d', '30d', 'custom'] as const).map((preset) => (
                  <Button
                    key={preset}
                    type="button"
                    size="sm"
                    variant={datePreset === preset ? 'secondary' : 'ghost'}
                    className="h-7 px-2.5 text-xs"
                    onClick={() => setDatePreset(preset)}
                  >
                    {preset === 'all' ? 'All time' : preset === 'today' ? 'Today' : preset === '7d' ? '7 days' : preset === '30d' ? '30 days' : 'Custom'}
                  </Button>
                ))}
              </div>
            </div>

            {datePreset === 'custom' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="dash-date-from" className="text-xs">From</Label>
                  <Input id="dash-date-from" type="datetime-local" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dash-date-to" className="text-xs">To</Label>
                  <Input id="dash-date-to" type="datetime-local" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9" />
                </div>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="dash-time-from" className="text-xs">Time from (optional)</Label>
                <Input id="dash-time-from" type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dash-time-to" className="text-xs">Time to (optional)</Label>
                <Input id="dash-time-to" type="time" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} className="h-9" />
              </div>
            </div>

            {dateBounds.error ? (
              <p className="text-xs text-destructive">{dateBounds.error}</p>
            ) : datePreset !== 'all' || hasTimeFilter ? (
              <p className="text-xs text-muted-foreground">
                Showing {records.length} record{records.length === 1 ? '' : 's'} · {activity.length} event{activity.length === 1 ? '' : 's'} in window
                {hasTimeFilter ? ` · ${timeFrom || '00:00'}–${timeTo || '23:59'}` : ''}
              </p>
            ) : null}
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
        <ChartCard title="Submissions" description={submissionChartDescription}>
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

        <ChartCard title="Question difficulty" description="Click a bar to see the questions. Your question bank by difficulty.">
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
            onBarClick={(idx) => {
              const map: ('easy' | 'medium' | 'hard')[] = ['easy', 'medium', 'hard']
              setActiveDifficulty(map[idx] ?? null)
              setDifficultySearch('')
            }}
          />
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(['easy', 'medium', 'hard'] as const).map((level) => (
              <Button
                key={level}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2.5 text-xs capitalize"
                onClick={() => {
                  setActiveDifficulty(level)
                  setDifficultySearch('')
                }}
              >
                View {level} ({difficultyCounts[level]})
              </Button>
            ))}
          </div>
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

      <Dialog
        open={!!activeDifficulty}
        onOpenChange={(open) => {
          if (!open) {
            setActiveDifficulty(null)
            setDifficultySearch('')
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="capitalize">
              {activeDifficulty ? `${activeDifficulty} questions` : 'Questions'} ({filteredDifficultyQuestions.length})
            </DialogTitle>
            <DialogDescription>All questions at this difficulty across your banks. Click a chip to open the bank or exam.</DialogDescription>
          </DialogHeader>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search question, category, or bank..."
              value={difficultySearch}
              onChange={(e) => setDifficultySearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {difficultyDetailQuery.isLoading || examQuestionsQuery.isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
          ) : filteredDifficultyQuestions.length === 0 ? (
            <div className="py-8 text-center">
              <FileQuestion className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">{difficultySearch ? `No match for "${difficultySearch}"` : `No ${activeDifficulty} questions yet.`}</p>
              <p className="text-xs text-muted-foreground">Try a different search or create questions in your banks.</p>
            </div>
          ) : (
            <ScrollArea className="h-[min(60vh,32rem)] pr-3">
              <div className="space-y-3">
                {filteredDifficultyQuestions.map((q) => {
                  const exams = questionUsageMap.get(q.id) ?? []
                  return (
                    <div key={q.id} className="rounded-lg border p-3">
                      <p className="line-clamp-3 text-sm font-medium leading-snug" title={q.content}>
                        {q.content}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Badge variant={q.difficulty === 'easy' ? 'success' : q.difficulty === 'hard' ? 'destructive' : 'warning'} className="capitalize">
                          {q.difficulty}
                        </Badge>
                        {q.category ? <Badge variant="secondary">{q.category}</Badge> : null}
                        <Badge variant="outline">{q.points} pts</Badge>
                        <span className="text-xs text-muted-foreground">{formatDateTime(q.created_at)}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="font-medium text-muted-foreground">Bank:</span>
                        {q.question_bank ? (
                          <Link to={`/teacher/banks/${q.question_bank.id}`}>
                            <Badge variant="secondary" className="hover:bg-secondary/80 cursor-pointer">
                              {q.question_bank.name}
                            </Badge>
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="font-medium text-muted-foreground">Used in:</span>
                        {exams.length === 0 ? (
                          <span className="text-muted-foreground">Not yet added to any exam</span>
                        ) : (
                          exams.map((ex) => (
                            <Link key={ex.id} to={`/teacher/exams/${ex.id}`}>
                              <Badge variant="outline" className="hover:bg-muted cursor-pointer">
                                {ex.title}
                              </Badge>
                            </Link>
                          ))
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
