import type { LucideIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface StatCardProps {
  title: string
  value: string | number
  icon: LucideIcon
  hint?: string
  iconClassName?: string
  loading?: boolean
}

export function StatCard({ title, value, icon: Icon, hint, iconClassName, loading }: StatCardProps) {
  return (
    <Card className="overflow-hidden transition-shadow hover:shadow-md">
      <CardContent className="flex items-center gap-4 p-5">
        <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary', iconClassName)}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{title}</p>
          <div className="flex items-baseline gap-2">
            {loading ? (
              <div className="h-7 w-16 animate-pulse rounded bg-muted" />
            ) : (
              <p className="text-2xl font-bold tracking-tight">{value}</p>
            )}
            {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
