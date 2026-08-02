import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ArrowDown,
  ArrowUp,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Loader2,
  Plus,
  Save,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { teacherApi } from '@/api/supabase-api'
import { PageHeader } from '@/components/common/page-header'
import { PageLoader } from '@/components/common/page-loader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { ExamStatusBadge } from '@/components/common/status-badge'
import type { Exam, UserProfile } from '@/lib/types'

const examSchema = z.object({
  title: z.string().min(3, 'Title is required.'),
  description: z.string().optional(),
  instructions: z.string().optional(),
  course_id: z.string().optional(),
  start_time: z.string().optional(),
  end_time: z.string().optional(),
  duration_minutes: z.coerce.number().min(1).max(600),
  passing_score: z.coerce.number().min(0).max(100),
})

type ExamFormValues = z.infer<typeof examSchema>

interface SelectedQuestion {
  question_id: string
  content: string
  difficulty: string
  category: string | null
  points: number
}

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalInput(value: string | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

export function ExamEditorPage() {
  const { examId } = useParams<{ examId: string }>()
  const editing = Boolean(examId)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [selected, setSelected] = useState<SelectedQuestion[]>([])
  const [toggles, setToggles] = useState({
    randomize_questions: false,
    randomize_choices: false,
    show_score_after: true,
    allow_review: true,
    auto_submit: true,
  })
  const [addDialog, setAddDialog] = useState(false)
  const [assignedIds, setAssignedIds] = useState<string[]>([])
  const [targetSearch, setTargetSearch] = useState('')
  const [targetCourse, setTargetCourse] = useState('')
  const [targetSection, setTargetSection] = useState('')

  const coursesQuery = useQuery({ queryKey: ['teacher-courses'], queryFn: () => teacherApi.courses() })

  const studentsQuery = useQuery({ queryKey: ['teacher-students'], queryFn: () => teacherApi.teacherStudents() })

  const assignedQuery = useQuery({
    queryKey: ['teacher-exam-students', examId],
    queryFn: () => teacherApi.examStudentIds(examId!),
    enabled: editing,
  })

  const sections = useMemo(() => {
    const set = new Set<string>()
    for (const s of studentsQuery.data ?? []) if (s.section) set.add(s.section)
    return Array.from(set).sort()
  }, [studentsQuery.data])

  const filteredStudents = useMemo(() => {
    const list = studentsQuery.data ?? []
    const q = targetSearch.trim().toLowerCase()
    return list.filter((s) => {
      if (targetCourse && s.course_id !== targetCourse) return false
      if (targetSection && s.section !== targetSection) return false
      if (q) {
        const hay = `${s.full_name} ${s.student_id ?? ''} ${s.email ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [studentsQuery.data, targetSearch, targetCourse, targetSection])

  const toggleAssign = (id: string) => {
    setAssignedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const existingQuery = useQuery({
    queryKey: ['teacher-exam-detail', examId],
    queryFn: async () => {
      const detail = await teacherApi.examDetail(examId!)
      return detail as {
        exam: Exam
        questions: (SelectedQuestion & {
          id: string
          position: number
          choices: { id: string; content: string; is_correct: boolean }[]
        })[]
      }
    },
    enabled: editing,
  })

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<ExamFormValues>({ resolver: zodResolver(examSchema) })

  useEffect(() => {
    if (existingQuery.data) {
      const exam = existingQuery.data.exam
      reset({
        title: exam.title,
        description: exam.description ?? '',
        instructions: exam.instructions ?? '',
        course_id: exam.course_id ?? '',
        start_time: toLocalInput(exam.start_time),
        end_time: toLocalInput(exam.end_time),
        duration_minutes: exam.duration_minutes,
        passing_score: Number(exam.passing_score),
      })
      setToggles({
        randomize_questions: exam.randomize_questions,
        randomize_choices: exam.randomize_choices,
        show_score_after: exam.show_score_after,
        allow_review: exam.allow_review,
        auto_submit: exam.auto_submit,
      })
      setSelected(
        existingQuery.data.questions
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((q) => ({
            question_id: q.id,
            content: q.content,
            difficulty: q.difficulty,
            category: q.category,
            points: q.points,
          })),
      )
    }
  }, [existingQuery.data, reset])

  useEffect(() => {
    if (assignedQuery.data) setAssignedIds(assignedQuery.data)
  }, [assignedQuery.data])

  const createMutation = useMutation({
    mutationFn: async ({ values, questionIds, studentIds }: { values: ExamFormValues; questionIds: string[]; studentIds: string[] }) => {
      const payload: Partial<Exam> = {
        title: values.title,
        description: values.description || null,
        instructions: values.instructions || null,
        course_id: values.course_id || null,
        start_time: fromLocalInput(values.start_time),
        end_time: fromLocalInput(values.end_time),
        duration_minutes: values.duration_minutes,
        passing_score: values.passing_score,
        ...toggles,
      }
      if (editing && examId) {
        await teacherApi.updateExam(examId, payload)
        await teacherApi.setExamQuestions(examId, questionIds, 1)
        await teacherApi.setExamStudents(examId, studentIds)
        return examId
      }
      const created = await teacherApi.createExam(payload)
      await teacherApi.setExamQuestions(created.id, questionIds, 1)
      await teacherApi.setExamStudents(created.id, studentIds)
      return created.id
    },
    onSuccess: (id) => {
      toast.success(editing ? 'Exam updated' : 'Exam created')
      queryClient.invalidateQueries({ queryKey: ['teacher-exams'] })
      queryClient.invalidateQueries({ queryKey: ['teacher-students'] })
      navigate(`/teacher/exams/${id}`)
    },
    onError: () => toast.error('Could not save the exam.'),
  })

  const onSubmit = (values: ExamFormValues) => {
    if (selected.length === 0) {
      toast.error('Add at least one question to the exam.')
      return
    }
    createMutation.mutate({ values, questionIds: selected.map((q) => q.question_id), studentIds: assignedIds })
  }

  const toggleQuestion = (question: SelectedQuestion) => {
    setSelected((prev) =>
      prev.some((q) => q.question_id === question.question_id)
        ? prev.filter((q) => q.question_id !== question.question_id)
        : [...prev, question],
    )
  }

  const move = (index: number, dir: -1 | 1) => {
    setSelected((prev) => {
      const next = [...prev]
      const target = index + dir
      if (target < 0 || target >= next.length) return prev
      const temp = next[index]
      next[index] = next[target]
      next[target] = temp
      return next
    })
  }

  const isLoading = editing && existingQuery.isLoading

  if (isLoading) return <PageLoader />

  const courseId = watch('course_id')

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title={editing ? 'Edit exam' : 'New exam'} description="Configure settings and add questions from your banks.">
        <Button variant="ghost" asChild>
          <Link to="/teacher/exams">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
        </Button>
        {existingQuery.data ? <ExamStatusBadge status={existingQuery.data.exam.status} /> : null}
      </PageHeader>

      <form onSubmit={handleSubmit(onSubmit)} className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
              <CardDescription>Basic information students see before starting.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input id="title" placeholder="e.g. CS101 Midterm" {...register('title')} />
                {errors.title ? <p className="text-xs text-destructive">{errors.title.message}</p> : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea id="description" rows={2} placeholder="Short summary of the exam…" {...register('description')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="instructions">Instructions</Label>
                <Textarea id="instructions" rows={3} placeholder="Rules and guidance shown before the exam starts…" {...register('instructions')} />
              </div>
              <div className="space-y-2">
                <Label>Course (optional)</Label>
                <Select value={courseId ?? ''} onValueChange={(v) => setValue('course_id', v === 'none' ? '' : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a course" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No course</SelectItem>
                    {(coursesQuery.data ?? []).map((course) => (
                      <SelectItem key={course.id} value={course.id}>
                        {course.name} ({course.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Scheduling</CardTitle>
              <CardDescription>When the exam is available and how long it lasts.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="start_time">Start time</Label>
                <Input id="start_time" type="datetime-local" {...register('start_time')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end_time">End time</Label>
                <Input id="end_time" type="datetime-local" {...register('end_time')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="duration">Duration (minutes)</Label>
                <Input id="duration" type="number" min={1} max={600} {...register('duration_minutes')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="passing">Passing score (%)</Label>
                <Input id="passing" type="number" min={0} max={100} {...register('passing_score')} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Target students</CardTitle>
              <CardDescription>Choose who can see and take this exam. Students not listed here won&apos;t see it.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Users className="h-4 w-4" />
                  <span>
                    <span className="font-medium text-foreground">{assignedIds.length}</span> assigned
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    disabled={filteredStudents.length === 0 || filteredStudents.every((s) => assignedIds.includes(s.id))}
                    onClick={() =>
                      setAssignedIds((prev) => Array.from(new Set([...prev, ...filteredStudents.map((s) => s.id)])))
                    }
                  >
                    Add all
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    disabled={assignedIds.length === 0}
                    onClick={() =>
                      setAssignedIds((prev) => {
                        const filtered = new Set(filteredStudents.map((s) => s.id))
                        return prev.filter((id) => !filtered.has(id))
                      })
                    }
                  >
                    Clear
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                  <Input
                    placeholder="Search students…"
                    value={targetSearch}
                    onChange={(e) => setTargetSearch(e.target.value)}
                    className="h-9"
                  />
                  <Select value={targetCourse} onValueChange={(v) => setTargetCourse(v === 'all' ? '' : v)}>
                    <SelectTrigger className="h-9 w-40">
                      <SelectValue placeholder="All courses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All courses</SelectItem>
                      {(coursesQuery.data ?? []).map((course) => (
                        <SelectItem key={course.id} value={course.id}>
                          {course.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={targetSection} onValueChange={(v) => setTargetSection(v === 'all' ? '' : v)}>
                    <SelectTrigger className="h-9 w-40">
                      <SelectValue placeholder="All sections" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All sections</SelectItem>
                      {sections.map((section) => (
                        <SelectItem key={section} value={section}>
                          {section}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {studentsQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading students…</p>
              ) : filteredStudents.length === 0 ? (
                <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                  No students match your filters.
                </p>
              ) : (
                <ScrollArea className="h-64 rounded-lg border">
                  <div className="space-y-1 p-2">
                    {filteredStudents.map((student) => (
                      <StudentRow
                        key={student.id}
                        student={student}
                        checked={assignedIds.includes(student.id)}
                        onToggle={() => toggleAssign(student.id)}
                      />
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Behaviour</CardTitle>
              <CardDescription>Randomization and post-exam visibility.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ToggleRow
                label="Randomize questions"
                description="Shuffle the question order for every student."
                checked={toggles.randomize_questions}
                onChange={(v) => setToggles((t) => ({ ...t, randomize_questions: v }))}
              />
              <Separator />
              <ToggleRow
                label="Randomize choices"
                description="Shuffle the order of answer choices."
                checked={toggles.randomize_choices}
                onChange={(v) => setToggles((t) => ({ ...t, randomize_choices: v }))}
              />
              <Separator />
              <ToggleRow
                label="Show score after submission"
                description="Students can see their score and result immediately."
                checked={toggles.show_score_after}
                onChange={(v) => setToggles((t) => ({ ...t, show_score_after: v }))}
              />
              <Separator />
              <ToggleRow
                label="Allow review"
                description="Let students review their answers afterwards."
                checked={toggles.allow_review}
                onChange={(v) => setToggles((t) => ({ ...t, allow_review: v }))}
              />
              <Separator />
              <ToggleRow
                label="Auto submit on timer end"
                description="Automatically submit when the timer reaches zero."
                checked={toggles.auto_submit}
                onChange={(v) => setToggles((t) => ({ ...t, auto_submit: v }))}
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6 lg:sticky lg:top-20">
          <Card className="flex flex-col overflow-hidden lg:max-h-[calc(100vh-12rem)]">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Exam questions</CardTitle>
                <CardDescription>{selected.length} selected</CardDescription>
              </div>
              <Button size="sm" onClick={() => setAddDialog(true)} type="button">
                <Plus className="h-4 w-4" />
                Add
              </Button>
            </CardHeader>
            <CardContent className="space-y-2 overflow-y-auto">
              {selected.length === 0 ? (
                <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No questions yet. Click <span className="font-medium">Add</span> to pick from your question banks.
                </p>
              ) : (
                selected.map((q, i) => (
                  <div key={q.question_id} className="group rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                          {i + 1}
                        </span>
                        <p className="text-sm leading-snug">{q.content}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        <Button variant="ghost" size="icon" className="h-7 w-7" type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" type="button" onClick={() => move(i, 1)} disabled={i === selected.length - 1} aria-label="Move down">
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          type="button"
                          onClick={() => toggleQuestion(q)}
                          aria-label="Remove question"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5 pl-7">
                      <Badge variant={q.difficulty === 'easy' ? 'success' : q.difficulty === 'hard' ? 'destructive' : 'warning'}>{q.difficulty}</Badge>
                      {q.category ? <Badge variant="secondary">{q.category}</Badge> : null}
                      <span className="text-xs text-muted-foreground">{q.points} pts</span>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Button size="lg" className="w-full" type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {editing ? 'Save changes' : 'Create exam'}
          </Button>
        </div>
      </form>

      <AddQuestionsDialog open={addDialog} onOpenChange={setAddDialog} selected={selected} onToggle={toggleQuestion} />
    </div>
  )
}

function StudentRow({
  student,
  checked,
  onToggle,
}: {
  student: UserProfile
  checked: boolean
  onToggle: () => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-md p-2 transition-colors hover:bg-muted">
      <Checkbox checked={checked} onCheckedChange={onToggle} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{student.full_name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {student.student_id ?? '—'}
          {student.course_name ? ` · ${student.course_name}` : ''}
          {student.section ? ` · ${student.section}` : ''}
        </p>
      </div>
    </label>
  )
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

function AddQuestionsDialog({
  open,
  onOpenChange,
  selected,
  onToggle,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  selected: SelectedQuestion[]
  onToggle: (question: SelectedQuestion) => void
}) {
  const [expandedBank, setExpandedBank] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const banksQuery = useQuery({ queryKey: ['teacher-banks'], queryFn: () => teacherApi.banks() })
  const bankQuestionsQuery = useQuery({
    queryKey: ['teacher-bank-questions', expandedBank],
    queryFn: () => teacherApi.bankQuestions(expandedBank!) as Promise<SelectedQuestion[]>,
    enabled: !!expandedBank,
  })

  const banks = banksQuery.data ?? []
  const bankQuestions = bankQuestionsQuery.data ?? []

  const selectedIds = useMemo(() => new Set(selected.map((q) => q.question_id)), [selected])
  const selectedCount = selected.length

  const filteredQuestions = bankQuestions.filter((q) => q.content.toLowerCase().includes(search.toLowerCase()))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add questions</DialogTitle>
          <DialogDescription>{selectedCount} currently in the exam. Pick questions from your banks.</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search questions…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        <div className="space-y-3">
          {banks.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No question banks yet.{' '}
              <Link to="/teacher/banks" className="text-primary underline" onClick={() => onOpenChange(false)}>
                Create one
              </Link>{' '}
              first.
            </p>
          ) : (
            banks.map((bank) => (
              <div key={bank.id} className="rounded-lg border">
                <button
                  type="button"
                  onClick={() => setExpandedBank(expandedBank === bank.id ? null : bank.id)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left"
                >
                  <span className="flex items-center gap-2 font-medium">
                    <BookOpen className="h-4 w-4 text-primary" />
                    {bank.name}
                  </span>
                  <Badge variant="secondary">{bank.question_count} questions</Badge>
                </button>
                {expandedBank === bank.id ? (
                  <div className="space-y-2 border-t p-3">
                    {bankQuestionsQuery.isLoading ? (
                      <p className="py-4 text-center text-sm text-muted-foreground">Loading…</p>
                    ) : bankQuestionsQuery.isError ? (
                      <p className="py-4 text-center text-sm text-destructive">Could not load questions.</p>
                    ) : filteredQuestions.length === 0 ? (
                      <p className="py-4 text-center text-sm text-muted-foreground">No matching questions.</p>
                    ) : (
                      filteredQuestions.map((q) => {
                        const isSelected = selectedIds.has(q.question_id)
                        return (
                          <button
                            key={q.question_id}
                            type="button"
                            onClick={() => onToggle(q)}
                            className={`flex w-full items-start gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                              isSelected ? 'border-primary bg-primary/5' : 'hover:bg-muted'
                            }`}
                          >
                            {isSelected ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> : <Plus className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                            <span className="min-w-0 flex-1">{q.content}</span>
                            <Badge variant="secondary">{q.points} pts</Badge>
                          </button>
                        )
                      })
                    )}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4" />
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
