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

const questionSchema = z
  .object({
    question_type: z.enum(['multiple_choice', 'essay']),
    content: z.string().min(5, 'Question must be at least 5 characters.'),
    difficulty: z.enum(['easy', 'medium', 'hard']),
    category: z.string().optional(),
    points: z.coerce.number().min(1).max(100),
    explanation: z.string().optional(),
    choices: z.array(z.string()).length(4),
    correctIndex: z.coerce.number().int().min(0).max(3),
    model_answer: z.string().optional(),
    min_words: z.coerce.number().min(0).max(10000).optional(),
    max_words: z.coerce.number().min(0).max(10000).optional(),
  })
  .superRefine((values, ctx) => {
    if (values.question_type === 'multiple_choice') {
      values.choices.forEach((c, i) => {
        if (!c.trim()) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Every choice needs text.', path: ['choices', i] })
        }
      })
    }
    const min = values.min_words ?? 0
    const max = values.max_words ?? 0
    if (max > 0 && min > 0 && max < min) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Max words must be >= min words.', path: ['max_words'] })
    }
  })

type QuestionFormValues = z.infer<typeof questionSchema>

export interface QuestionFormData {
  id?: string
  content: string
  difficulty: 'easy' | 'medium' | 'hard'
  category: string | null
  points: number
  explanation: string | null
  question_type: 'multiple_choice' | 'essay'
  model_answer: string | null
  min_words: number
  max_words: number | null
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
      question_type: 'multiple_choice',
      content: '',
      difficulty: 'medium',
      category: '',
      points: 1,
      explanation: '',
      choices: ['', '', '', ''],
      correctIndex: 0,
      model_answer: '',
      min_words: 0,
      max_words: 0,
    },
  })

  useEffect(() => {
    if (open) {
      reset({
        question_type: initial?.question_type ?? 'multiple_choice',
        content: initial?.content ?? '',
        difficulty: initial?.difficulty ?? 'medium',
        category: initial?.category ?? '',
        points: initial?.points ?? 1,
        explanation: initial?.explanation ?? '',
        choices: initial && initial.choices.length === 4 ? initial.choices.map((c) => c.content) : ['', '', '', ''],
        correctIndex: initial ? Math.max(0, initial.choices.findIndex((c) => c.is_correct)) : 0,
        model_answer: initial?.model_answer ?? '',
        min_words: initial?.min_words ?? 0,
        max_words: initial?.max_words ?? 0,
      })
    }
  }, [open, initial, reset])

  const choices = watch('choices')
  const correctIndex = watch('correctIndex')
  const questionType = watch('question_type')

  const onSubmit = async (values: QuestionFormValues) => {
    try {
      const base = {
        content: values.content,
        difficulty: values.difficulty,
        category: values.category || null,
        points: values.points,
        explanation: values.explanation || null,
        question_type: values.question_type,
        model_answer: values.question_type === 'essay' ? values.model_answer || null : null,
        min_words: values.question_type === 'essay' ? (values.min_words ?? 0) : 0,
        max_words: values.question_type === 'essay' && (values.max_words ?? 0) > 0 ? (values.max_words as number) : null,
      }
      if (editing && initial?.id) {
        await teacherApi.updateQuestion(initial.id, base)
        if (values.question_type === 'multiple_choice') {
          const choiceObjects = values.choices.map((content, i) => ({
            content,
            is_correct: i === values.correctIndex,
          }))
          await teacherApi.replaceChoices(initial.id, choiceObjects)
        }
        toast.success('Question updated')
      } else {
        const choiceObjects =
          values.question_type === 'multiple_choice'
            ? values.choices.map((content, i) => ({ content, is_correct: i === values.correctIndex }))
            : []
        await teacherApi.createQuestion(bankId, { ...base, choices: choiceObjects })
        toast.success(values.question_type === 'essay' ? 'Essay question created' : 'Question created')
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
          <DialogDescription>
            {questionType === 'essay'
              ? 'Essay questions are answered with free text and graded manually by you.'
              : 'Multiple choice questions must have exactly four choices.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label>Question type</Label>
            <Select value={questionType} onValueChange={(v) => setValue('question_type', v as 'multiple_choice' | 'essay')}>
              <SelectTrigger>
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="multiple_choice">Multiple choice (auto-graded)</SelectItem>
                <SelectItem value="essay">Essay (manually graded)</SelectItem>
              </SelectContent>
            </Select>
          </div>

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
            {questionType === 'multiple_choice' ? (
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
            ) : (
              <div className="space-y-2">
                <Label htmlFor="q-min">Min words</Label>
                <Input id="q-min" type="number" min={0} max={10000} {...register('min_words')} />
              </div>
            )}
          </div>

          {questionType === 'multiple_choice' ? (
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
          ) : (
            <div className="space-y-4 rounded-lg border bg-muted/30 p-3">
              <div className="space-y-2">
                <Label htmlFor="q-max">Max words (0 = no limit)</Label>
                <Input id="q-max" type="number" min={0} max={10000} {...register('max_words')} />
                {errors.max_words ? <p className="text-xs text-destructive">{errors.max_words.message}</p> : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="q-model">Model answer (teachers only)</Label>
                <Textarea id="q-model" rows={3} placeholder="Reference answer to guide manual grading…" {...register('model_answer')} />
                <p className="text-xs text-muted-foreground">Never shown to students. Visible to you when grading.</p>
              </div>
            </div>
          )}

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
