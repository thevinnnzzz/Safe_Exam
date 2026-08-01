import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import type { ExamStatus, StudentExamStatus } from '@/lib/types'

const examStatusStyles: Record<ExamStatus, string> = {
  draft: 'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-400',
  published: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  archived: 'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-400',
}

const seStatusStyles: Record<StudentExamStatus, string> = {
  not_started: 'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-400',
  in_progress: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400',
  submitted: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  time_up: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
}

export function ExamStatusBadge({ status, className }: { status: ExamStatus; className?: string }) {
  return <Badge className={cn(examStatusStyles[status], 'capitalize', className)}>{status}</Badge>
}

export function StudentExamStatusBadge({ status, className }: { status: StudentExamStatus; className?: string }) {
  const label = status === 'not_started' ? 'Not started' : status === 'in_progress' ? 'In progress' : status === 'time_up' ? 'Time up' : 'Submitted'
  return <Badge className={cn(seStatusStyles[status], 'capitalize', className)}>{label}</Badge>
}
