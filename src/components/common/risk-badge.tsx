import { cn } from '@/lib/utils'
import type { RiskLevel } from '@/lib/types'
import { Badge } from '@/components/ui/badge'

const riskStyles: Record<RiskLevel, string> = {
  low: 'border-transparent bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  medium: 'border-transparent bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  high: 'border-transparent bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400',
}

export function RiskBadge({ level, points }: { level: RiskLevel; points?: number }) {
  return (
    <Badge variant="outline" className={cn(riskStyles[level], 'uppercase tracking-wide')}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {level} risk{typeof points === 'number' ? ` · ${points}` : ''}
    </Badge>
  )
}
