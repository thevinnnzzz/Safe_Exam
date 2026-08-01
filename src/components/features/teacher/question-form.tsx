import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { teacherApi } from '@/api/supabase-api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const questionSchema = z.object({
  content: z.string().min(5, 'Question must be at least 5 characters.'),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  category: z.string().optional(),
  points: z.coerce.number().min(1).max(100),
  explanation: z.string().optional(),
  choices: z.array(z.string().min(1, 'Every choice needs text.')).length(4),
  correctIndex: z.coerce.number().int().min(0).max(3),
})

type QuestionFormValues = z.infer<typeof questionSchema>

export interface QuestionFormData {
  id?: string
  content: string
  difficulty: 'easy' | 'medium' | 'hard'
  category: string | null
  points: number
  explanation: string | null
  choices: { content: string; is_correct: boolean }[]
}

interface QuestionFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bankId: string | null
  initial?: QuestionFormData | null
  onSaved: () => void
}

export function QuestionFormDialog({ open, onOpenChange, bankId, initial, onSaved }: QuestionFormDialogProps) {
  const editing = Boolean(initial?.id)

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<QuestionFormValues>({
    resolver: zodResolver(questionSchema),
    defaultValues: {
      content: '',
      difficulty: 'medium',
      category: '',
      points: 1,
      explanation: '',
      choices: ['', '', '', ''],
      correctIndex: 0,
    },
  })

  useEffect(() => {
    if (open) {
      reset({
        content: initial?.content ?? '',
        difficulty: initial?.difficulty ?? 'medium',
        category: initial?.category ?? '',
        points: initial?.points ?? 1,
        explanation: initial?.explanation ?? '',
        choices: initial ? initial.choices.map((c) => c.content) : ['', '', '', ''],
        correctIndex: initial ? initial.choices.findIndex((c) => c.is_correct) : 0,
      })
    }
  }, [open, initial, reset])

  const choices = watch('choices')
  const correctIndex = watch('correctIndex')

  const onSubmit = async (values: QuestionFormValues) => {
    try {
      const choiceObjects = values.choices.map((content, i) => ({
        content,
        is_correct: i === values.correctIndex,
      }))
      if (editing && initial?.id) {
        await teacherApi.updateQuestion(initial.id, {
          content: values.content,
          difficulty: values.difficulty,
          category: values.category || null,
          points: values.points,
          explanation: values.explanation || null,
        })
        await teacherApi.replaceChoices(initial.id, choiceObjects)
        toast.success('Question updated')
      } else {
        await teacherApi.createQuestion(bankId, {
          content: values.content,
          difficulty: values.difficulty,
          category: values.category || null,
          points: values.points,
          explanation: values.explanation || null,
          choices: choiceObjects,
        })
        toast.success('Question created')
      }
      onOpenChange(false)
      onSaved()
    } catch {
      toast.error('Could not save the question.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit question' : 'Add question'}</DialogTitle>
          <DialogDescription>Multiple choice questions must have exactly four choices.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="q-content">Question</Label>
            <Textarea id="q-content" rows={3} placeholder="Enter the question text…" {...register('content')} />
            {errors.content ? <p className="text-xs text-destructive">{errors.content.message}</p> : null}
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="space-y-2">
              <Label>Difficulty</Label>
              <Select value={watch('difficulty')} onValueChange={(v) => setValue('difficulty', v as 'easy' | 'medium' | 'hard')}>
                <SelectTrigger>
                  <SelectValue placeholder="Difficulty" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="easy">Easy</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="hard">Hard</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="q-category">Category</Label>
              <Input id="q-category" placeholder="e.g. Algorithms" {...register('category')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="q-points">Points</Label>
              <Input id="q-points" type="number" min={1} max={100} {...register('points')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="q-correct">Correct</Label>
              <Select value={String(correctIndex)} onValueChange={(v) => setValue('correctIndex', Number(v))}>
                <SelectTrigger>
                  <SelectValue placeholder="Correct" />
                </SelectTrigger>
                <SelectContent>
                  {choices.map((_, i) => (
                    <SelectItem key={i} value={String(i)}>
                      Choice {String.fromCharCode(65 + i)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Choices</Label>
            <div className="grid gap-2">
              {choices.map((_, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-semibold">
                    {String.fromCharCode(65 + i)}
                  </span>
                  <Input
                    placeholder={`Choice ${String.fromCharCode(65 + i)}`}
                    {...register(`choices.${i}` as const)}
                    className={correctIndex === i ? 'border-emerald-500' : ''}
                  />
                  <button
                    type="button"
                    onClick={() => setValue('correctIndex', i)}
                    className={`shrink-0 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      correctIndex === i
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
                        : 'text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {correctIndex === i ? 'Correct' : 'Mark correct'}
                  </button>
                </div>
              ))}
            </div>
            {errors.choices ? <p className="text-xs text-destructive">{errors.choices.message}</p> : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="q-explanation">Explanation (optional)</Label>
            <Textarea id="q-explanation" rows={2} placeholder="Shown to students after review…" {...register('explanation')} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {editing ? 'Save changes' : 'Create question'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
