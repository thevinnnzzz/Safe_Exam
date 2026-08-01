import { cn } from '@/lib/utils'

interface QuestionPaletteProps {
  count: number
  currentIndex: number
  answered: Set<string>
  flagged: Set<string>
  questionIds: string[]
  onSelect: (index: number) => void
}

export function QuestionPalette({ count, currentIndex, answered, flagged, questionIds, onSelect }: QuestionPaletteProps) {
  return (
    <div className="grid grid-cols-6 gap-2 sm:grid-cols-8 lg:grid-cols-5">
      {Array.from({ length: count }).map((_, i) => {
        const isAnswered = answered.has(questionIds[i])
        const isFlagged = flagged.has(questionIds[i])
        const isCurrent = i === currentIndex
        return (
          <button
            key={i}
            type="button"
            onClick={() => onSelect(i)}
            aria-label={`Go to question ${i + 1}`}
            className={cn(
              'relative flex h-9 items-center justify-center rounded-md border text-sm font-medium transition-all',
              isCurrent
                ? 'border-primary bg-primary text-primary-foreground shadow'
                : isAnswered
                  ? 'border-sky-500/50 bg-sky-100 text-sky-700 hover:bg-sky-200 dark:bg-sky-500/15 dark:text-sky-400'
                  : 'border-border bg-background text-muted-foreground hover:bg-accent',
              isFlagged && !isCurrent && 'ring-2 ring-amber-400',
            )}
          >
            {i + 1}
            {isFlagged ? <span className={cn('absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-400')} /> : null}
          </button>
        )
      })}
    </div>
  )
}
