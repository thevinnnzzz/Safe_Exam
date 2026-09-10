import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Download, FileBarChart, ShieldAlert, TimerOff } from 'lucide-react'
import { toast } from 'sonner'
import { teacherApi } from '@/api/supabase-api'
import { riskLevel } from '@/lib/risk'
import { downloadCSV, formatClock, formatDateTime } from '@/lib/utils'
import { PageHeader } from '@/components/common/page-header'
import { PageLoader } from '@/components/common/page-loader'
import { EmptyState } from '@/components/common/empty-state'
import { RiskBadge } from '@/components/common/risk-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { RiskScore } from '@/lib/types'

export function TeacherResultsPage() {
  const { examId } = useParams<{ examId: string }>()

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

  const sorted = [...records].sort((a, b) => (b.submitted_at ?? '').localeCompare(a.submitted_at ?? ''))

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
        <Button onClick={exportResults}>
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </PageHeader>

      {sorted.length === 0 ? (
        <EmptyState icon={FileBarChart} title="No submissions yet" description="Once students submit, their results will appear here." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead className="text-center">Attempt</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Percentage</TableHead>
                  <TableHead>Time used</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead>Incidents</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((record) => {
                  const risk = riskMap.get(record.id)
                  const incidents = risk
                    ? risk.tab_switches + risk.fullscreen_exits + risk.copy_attempts + risk.paste_attempts + risk.cut_attempts + risk.devtools_attempts + risk.refresh_attempts + risk.navigate_attempts + risk.find_attempts + risk.print_attempts + risk.save_attempts + risk.zoom_attempts + risk.new_tab_attempts + risk.idle_events
                    : 0
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
                          <Badge variant={record.passed ? 'success' : 'destructive'}>{record.score_percent}%</Badge>
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
                        <Button asChild variant="ghost" size="sm">
                          <Link to={`/teacher/exams/${exam.id}/results/${record.id}`}>Review</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
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
    </div>
  )
}
