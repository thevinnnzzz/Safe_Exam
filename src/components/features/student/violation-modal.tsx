import { ShieldAlert } from 'lucide-react'
import ElectricBorder from '@/components/ui/electric-border'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { RiskBadge } from '@/components/common/risk-badge'
import { EVENT_LABELS } from '@/lib/risk'
import type { RiskLevel } from '@/lib/types'

export interface ViolationInfo {
  eventType: string
  points: number
}

const LEVEL_COLORS: Record<RiskLevel, string> = {
  low: '#7df9ff',
  medium: '#fbbf24',
  high: '#fb7185',
}

interface ViolationModalProps {
  violation: ViolationInfo | null
  level: RiskLevel
  totalPoints: number
  open: boolean
  onAcknowledge: () => void
}

/**
 * Blocking warning shown when proctoring detects a violation. The card is
 * wrapped in an animated electric border whose color follows the live risk
 * level. The exam timer keeps running underneath; the student must acknowledge
 * to continue. If another violation fires while open, the parent swaps the
 * content instead of stacking modals.
 */
export function ViolationModal({ violation, level, totalPoints, open, onAcknowledge }: ViolationModalProps) {
  const label = (violation && (EVENT_LABELS[violation.eventType as keyof typeof EVENT_LABELS] as string | undefined)) ?? violation?.eventType ?? 'Violation'

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onAcknowledge()}>
      <DialogContent className="border-0 bg-transparent p-0 shadow-none sm:max-w-md [&>button]:hidden">
        <ElectricBorder color={LEVEL_COLORS[level]} speed={1.4} chaos={0.16} thickness={2} style={{ borderRadius: 16 }}>
          <div className="rounded-2xl border bg-card p-6 text-center shadow-2xl">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <ShieldAlert className="h-6 w-6 text-destructive" />
            </div>
            <DialogHeader className="items-center">
              <DialogTitle className="text-lg">Integrity warning: {label}</DialogTitle>
              <DialogDescription>
                This incident was recorded
                {violation && violation.points > 0 ? (
                  <>
                    {' '}(<span className="font-semibold text-foreground">+{violation.points} risk points</span>)
                  </>
                ) : null}{' '}
                and added to your risk score.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 flex justify-center">
              <RiskBadge level={level} points={totalPoints} />
            </div>
            <Button className="mt-5 w-full" size="lg" autoFocus onClick={onAcknowledge}>
              I understand — continue exam
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">Your exam timer keeps running.</p>
          </div>
        </ElectricBorder>
      </DialogContent>
    </Dialog>
  )
}
