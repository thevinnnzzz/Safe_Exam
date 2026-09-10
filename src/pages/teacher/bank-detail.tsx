import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, FileQuestion, FileUp, Pencil, Plus, Trash2 } from 'lucide-react'
import { getSupabase } from '@/lib/supabase'
import { teacherApi } from '@/api/supabase-api'
import { PageHeader } from '@/components/common/page-header'
import { PageLoader } from '@/components/common/page-loader'
import { EmptyState } from '@/components/common/empty-state'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { QuestionFormDialog, type QuestionFormData } from '@/components/features/teacher/question-form'
import { CsvImportDialog } from '@/components/features/teacher/csv-import'
import { formatDateTime } from '@/lib/utils'

interface BankQuestion {
  id: string
  content: string
  difficulty: string
  category: string | null
  points: number
  explanation: string | null
  created_at: string
  question_type?: 'multiple_choice' | 'essay'
  model_answer?: string | null
  min_words?: number
  max_words?: number | null
  choices: { id: string; content: string; is_correct: boolean; position: number }[]
}

export function BankDetailPage() {
  const { bankId } = useParams<{ bankId: string }>()
  const queryClient = useQueryClient()

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<QuestionFormData | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const bankQuery = useQuery({
    queryKey: ['teacher-bank', bankId],
    queryFn: async () => {
      const { data, error } = await getSupabase().from('question_bank').select('*').eq('id', bankId!).maybeSingle()
      if (error) throw error
      if (!data) throw new Error('Bank not found')
      return data
    },
    enabled: !!bankId,
  })

  const questionsQuery = useQuery({
    queryKey: ['teacher-bank-questions', bankId],
    queryFn: () => teacherApi.bankQuestions(bankId!) as Promise<BankQuestion[]>,
    enabled: !!bankId,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => teacherApi.deleteQuestion(id),
    onSuccess: () => {
      toast.success('Question deleted')
      queryClient.invalidateQueries({ queryKey: ['teacher-bank-questions', bankId] })
      setDeleteId(null)
    },
    onError: () => toast.error('Could not delete the question.'),
  })

  if (bankQuery.isLoading || questionsQuery.isLoading) return <PageLoader />
  if (bankQuery.isError || !bankQuery.data) {
    return (
      <div className="py-16 text-center">
        <p className="font-semibold">Question bank not found</p>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/teacher/banks">Back to banks</Link>
        </Button>
      </div>
    )
  }

  const bank = bankQuery.data
  const questions = questionsQuery.data ?? []

  const openCreate = () => {
    setEditing(null)
    setFormOpen(true)
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title={bank.name} description={bank.description ?? 'No description.'}>
        <Button variant="ghost" asChild>
          <Link to="/teacher/banks">
            <ArrowLeft className="h-4 w-4" />
            Banks
          </Link>
        </Button>
        <Button variant="outline" onClick={() => setImportOpen(true)}>
          <FileUp className="h-4 w-4" />
          Import Questions
        </Button>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Add question
        </Button>
      </PageHeader>

      {questions.length === 0 ? (
        <EmptyState
          icon={FileQuestion}
          title="No questions in this bank"
          description="Add questions manually or import them from a CSV file."
          action={
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <FileUp className="h-4 w-4" />
                Import Questions
              </Button>
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4" />
                Add question
              </Button>
            </div>
          }
        />
      ) : (
        <div className="space-y-3">
          {questions.map((question) => {
            const correct = question.choices.find((c) => c.is_correct)
            const isEssay = (question.question_type ?? 'multiple_choice') === 'essay'
            return (
              <Card key={question.id}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge variant={isEssay ? 'info' : 'secondary'}>{isEssay ? 'Essay' : 'MCQ'}</Badge>
                        <Badge variant={question.difficulty === 'easy' ? 'success' : question.difficulty === 'hard' ? 'destructive' : 'warning'}>{question.difficulty}</Badge>
                        {question.category ? <Badge variant="secondary">{question.category}</Badge> : null}
                        <Badge variant="outline">{question.points} pts</Badge>
                        {isEssay && (question.min_words || question.max_words) ? (
                          <Badge variant="outline">
                            {question.min_words ? `${question.min_words}+` : ''}{question.min_words && question.max_words ? ' / ' : ''}{question.max_words ? `max ${question.max_words}` : ''} words
                          </Badge>
                        ) : null}
                        <span className="text-xs text-muted-foreground">{formatDateTime(question.created_at)}</span>
                      </div>
                      <p className="font-medium leading-snug">{question.content}</p>
                      {isEssay ? (
                        <div className="mt-3 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                          <p className="text-xs font-semibold uppercase tracking-wide">Essay — manually graded</p>
                          {question.model_answer ? (
                            <p className="mt-1.5 text-sm text-foreground">
                              <span className="font-medium">Model answer:</span> {question.model_answer}
                            </p>
                          ) : (
                            <p className="mt-1 text-xs">No model answer set.</p>
                          )}
                        </div>
                      ) : (
                      <div className="mt-3 grid gap-1 sm:grid-cols-2">
                        {question.choices.map((choice) => (
                          <div
                            key={choice.id}
                            className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm ${
                              choice.is_correct ? 'border-emerald-400 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-muted/40'
                            }`}
                          >
                            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold">
                              {String.fromCharCode(65 + choice.position)}
                            </span>
                            {choice.content}
                          </div>
                        ))}
                      </div>
                      )}
                      {question.explanation ? (
                        <p className="mt-2 text-xs text-muted-foreground">
                          <span className="font-medium">Explanation:</span> {question.explanation}
                        </p>
                      ) : null}
                      {!isEssay ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        <span className="font-medium">Correct answer:</span>{' '}
                        <span className="text-emerald-600 dark:text-emerald-400">{correct?.content ?? '—'}</span>
                      </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Edit question"
                        onClick={() => {
                          setEditing({
                            id: question.id,
                            content: question.content,
                            difficulty: question.difficulty as 'easy' | 'medium' | 'hard',
                            category: question.category,
                            points: question.points,
                            explanation: question.explanation,
                            question_type: (question.question_type ?? 'multiple_choice') as 'multiple_choice' | 'essay',
                            model_answer: question.model_answer ?? null,
                            min_words: question.min_words ?? 0,
                            max_words: question.max_words ?? null,
                            choices: question.choices.map((c) => ({ content: c.content, is_correct: c.is_correct })),
                          })
                          setFormOpen(true)
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="text-destructive" aria-label="Delete question" onClick={() => setDeleteId(question.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <QuestionFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        bankId={bankId ?? null}
        initial={editing}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ['teacher-bank-questions', bankId] })}
      />

      <CsvImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        bankId={bankId ?? null}
        onImported={() => queryClient.invalidateQueries({ queryKey: ['teacher-bank-questions', bankId] })}
      />

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Delete this question?"
        description="This removes the question and its choices permanently."
        confirmLabel="Delete"
        destructive
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        loading={deleteMutation.isPending}
      />
    </div>
  )
}
