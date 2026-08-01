import { cn } from '@/lib/utils'
import type { PublicChoice } from '@/lib/types'

interface AnswerOptionProps {
  choice: PublicChoice
  selected: boolean
  onSelect: (choiceId: string) => void
}

export function AnswerOption({ choice, selected, onSelect }: AnswerOptionProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(choice.id)}
      className={cn(
        'group flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-all',
        selected
          ? 'border-primary bg-primary/5 shadow-sm ring-1 ring-primary'
          : 'border-border bg-background hover:border-primary/50 hover:bg-accent',
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors',
          selected ? 'border-primary bg-primary' : 'border-muted-foreground/50 group-hover:border-primary/60',
        )}
      >
        {selected ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
      </span>
      <span className="min-w-0">{choice.content}</span>
    </button>
  )
}
