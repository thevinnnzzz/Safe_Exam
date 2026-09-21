import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Check, ChevronDown, FileSpreadsheet, Loader2, Search } from 'lucide-react'
import { teacherApi } from '@/api/supabase-api'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

interface ExportStudentOption {
  student_user_id: string
  full_name: string
  student_id: string | null
  section: string | null
}

interface ExportColumn {
  key: string
  label: string
  group: string
  default: boolean
}

interface ExportExamAnswersModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  examId: string
  examTitle: string
  students: ExportStudentOption[]
}

const COLUMN_GROUPS: Record<string, ExportColumn[]> = {
  'Student Info': [
    { key: 'student_number', label: 'Student #', group: 'Student Info', default: true },
    { key: 'student_name', label: 'Student Name', group: 'Student Info', default: true },
    { key: 'student_email', label: 'Email', group: 'Student Info', default: false },
    { key: 'section', label: 'Section', group: 'Student Info', default: true },
  ],
  Scores: [
    { key: 'score', label: 'Score', group: 'Scores', default: true },
    { key: 'score_percent', label: 'Score %', group: 'Scores', default: true },
    { key: 'passed', label: 'Passed', group: 'Scores', default: true },
    { key: 'risk_score', label: 'Risk Score', group: 'Scores', default: true },
    { key: 'risk_level', label: 'Risk Level', group: 'Scores', default: true },
  ],
  'Question Details': [
    { key: 'question_position', label: 'Question #', group: 'Question Details', default: true },
    { key: 'question_content', label: 'Question', group: 'Question Details', default: true },
    { key: 'question_type', label: 'Type', group: 'Question Details', default: true },
    { key: 'question_category', label: 'Category', group: 'Question Details', default: false },
    { key: 'question_points', label: 'Points', group: 'Question Details', default: true },
  ],
  'Answer Details': [
    { key: 'answer_text', label: 'Student Answer', group: 'Answer Details', default: true },
    { key: 'correct_choice_content', label: 'Correct Answer', group: 'Answer Details', default: true },
    { key: 'points_earned', label: 'Points Earned', group: 'Answer Details', default: true },
    { key: 'points_possible', label: 'Points Possible', group: 'Answer Details', default: true },
    { key: 'is_correct', label: 'Correct?', group: 'Answer Details', default: true },
    { key: 'feedback', label: 'Feedback', group: 'Answer Details', default: false },
    { key: 'time_spent_seconds', label: 'Time Spent (s)', group: 'Answer Details', default: false },
  ],
}

const allColumns = Object.values(COLUMN_GROUPS).flat()

export function ExportExamAnswersModal({
  open,
  onOpenChange,
  examId,
  examTitle,
  students,
}: ExportExamAnswersModalProps) {
  const [selectedStudents, setSelectedStudents] = useState<string[]>([])
  const [selectedColumns, setSelectedColumns] = useState<string[]>([])
  const [questionType, setQuestionType] = useState<'all' | 'essay' | 'multiple_choice'>('all')
  const [format, setFormat] = useState<'csv' | 'txt'>('csv')
  const [isExporting, setIsExporting] = useState(false)
  const [search, setSearch] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([])

  useEffect(() => {
    if (open) {
      setSelectedStudents(students.map((s) => s.student_user_id))
      setSelectedColumns(allColumns.filter((c) => c.default).map((c) => c.key))
      setQuestionType('all')
      setFormat('csv')
      setSearch('')
      setCollapsedGroups([])
      setIsExporting(false)
    }
  }, [open, students])

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return students
    return students.filter(
      (s) =>
        s.full_name.toLowerCase().includes(q) ||
        (s.student_id ?? '').toLowerCase().includes(q) ||
        (s.section ?? '').toLowerCase().includes(q),
    )
  }, [students, search])

  const allFilteredSelected = filteredStudents.length > 0 && filteredStudents.every((s) => selectedStudents.includes(s.student_user_id))

  const handleSelectAllStudents = () => {
    setSelectedStudents((prev) => {
      const filtered = new Set(filteredStudents.map((s) => s.student_user_id))
      if (filteredStudents.every((s) => prev.includes(s.student_user_id))) {
        return prev.filter((id) => !filtered.has(id))
      }
      return [...new Set([...prev, ...filteredStudents.map((s) => s.student_user_id)])]
    })
  }

  const toggleStudent = (id: string) => {
    setSelectedStudents((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const toggleColumn = (key: string) => {
    setSelectedColumns((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
  }

  const toggleColumnGroup = (group: string) => {
    const keys = COLUMN_GROUPS[group].map((c) => c.key)
    const allInGroup = keys.every((k) => selectedColumns.includes(k))
    setSelectedColumns((prev) => {
      const withoutGroup = prev.filter((k) => !keys.includes(k))
      return allInGroup ? withoutGroup : [...new Set([...withoutGroup, ...keys])]
    })
  }

  const handleExport = async () => {
    if (selectedStudents.length === 0) {
      toast.error('Select at least one student to export.')
      return
    }
    if (selectedColumns.length === 0) {
      toast.error('Select at least one column to export.')
      return
    }
    setIsExporting(true)
    try {
      await teacherApi.exportExamAnswers(examId, {
        studentUserIds: selectedStudents,
        columns: selectedColumns,
        format,
        questionType,
      })
      const typeLabel = questionType === 'essay' ? 'essay' : questionType === 'multiple_choice' ? 'MCQ' : 'all'
      toast.success(`Exported ${selectedStudents.length} student${selectedStudents.length === 1 ? '' : 's'} (${typeLabel}) to ${format.toUpperCase()}.`)
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed.')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader className="pr-8">
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            Export Exam Answers
          </DialogTitle>
          <DialogDescription>
            Export answers for <span className="font-medium text-foreground">{examTitle}</span>. Only the latest{' '}
            submitted attempt per student is exported. Choose students, columns, and format.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <Label className="font-medium">Students</Label>
              <Button type="button" variant="ghost" size="sm" onClick={handleSelectAllStudents}>
                {allFilteredSelected ? 'Clear all' : 'Select all'}
              </Button>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by name, ID, or section..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <ScrollArea className="h-[min(48vh,26rem)]">
              <div className="space-y-1 pr-3">
                {filteredStudents.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    {search ? 'No students match your search.' : 'No students with submissions yet.'}
                  </p>
                ) : (
                  filteredStudents.map((student) => (
                    <label
                      key={student.student_user_id}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
                        selectedStudents.includes(student.student_user_id)
                          ? 'border-primary bg-primary/5'
                          : 'border-transparent hover:bg-muted/50',
                      )}
                    >
                      <Checkbox
                        checked={selectedStudents.includes(student.student_user_id)}
                        onCheckedChange={() => toggleStudent(student.student_user_id)}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{student.full_name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {student.student_id ? `#${student.student_id}` : 'No student ID'}
                          {student.section ? ` · ${student.section}` : ''}
                        </p>
                      </div>
                    </label>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <Label className="font-medium">Columns</Label>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedColumns(allColumns.map((c) => c.key))}
                >
                  Select all
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedColumns([])}>
                  Clear
                </Button>
              </div>
            </div>
            <ScrollArea className="h-[min(48vh,26rem)]">
              <div className="space-y-2 pr-3">
                {Object.entries(COLUMN_GROUPS).map(([group, columns]) => {
                  const collapsed = collapsedGroups.includes(group)
                  const keys = columns.map((c) => c.key)
                  const allInGroup = keys.every((k) => selectedColumns.includes(k))
                  const someInGroup = keys.some((k) => selectedColumns.includes(k))
                  return (
                    <div key={group} className="rounded-lg border">
                      <div className="flex items-center gap-2 p-2">
                        <Checkbox
                          checked={allInGroup}
                          onCheckedChange={() => toggleColumnGroup(group)}
                        />
                        <button
                          type="button"
                          className="flex flex-1 items-center justify-between text-sm font-medium"
                          onClick={() =>
                            setCollapsedGroups((prev) => (prev.includes(group) ? prev.filter((g) => g !== group) : [...prev, group]))
                          }
                        >
                          <span className={cn(someInGroup && !allInGroup && 'text-primary')}>{group}</span>
                          <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', collapsed && 'rotate-180')} />
                        </button>
                      </div>
                      {!collapsed && (
                        <div className="grid grid-cols-1 gap-1 border-t p-2 pl-6 sm:grid-cols-2">
                          {columns.map((column) => (
                            <label
                              key={column.key}
                              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted/50"
                            >
                              <Checkbox
                                checked={selectedColumns.includes(column.key)}
                                onCheckedChange={() => toggleColumn(column.key)}
                              />
                              {column.label}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-3">
          <span className="text-sm font-medium">Question type</span>
          <div className="flex items-center gap-1 rounded-md border bg-background p-1">
            <Button
              type="button"
              size="sm"
              variant={questionType === 'all' ? 'secondary' : 'ghost'}
              className="h-7 px-3 text-xs"
              onClick={() => setQuestionType('all')}
            >
              Both
            </Button>
            <Button
              type="button"
              size="sm"
              variant={questionType === 'essay' ? 'secondary' : 'ghost'}
              className="h-7 px-3 text-xs"
              onClick={() => setQuestionType('essay')}
            >
              Essay only
            </Button>
            <Button
              type="button"
              size="sm"
              variant={questionType === 'multiple_choice' ? 'secondary' : 'ghost'}
              className="h-7 px-3 text-xs"
              onClick={() => setQuestionType('multiple_choice')}
            >
              MCQ only
            </Button>
          </div>
          <span className="text-xs text-muted-foreground">
            {questionType === 'essay'
              ? 'Only essay rows — ideal for the Import Grades CSV.'
              : questionType === 'multiple_choice'
                ? 'Only MCQ rows.'
                : 'All rows (essay + MCQ).'}
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
          <div className="flex items-center gap-2 text-sm">
            <Badge variant="secondary">{selectedStudents.length} student{selectedStudents.length === 1 ? '' : 's'}</Badge>
            <Badge variant="secondary">{selectedColumns.length} columns</Badge>
            <div className="flex items-center gap-1 rounded-md border">
              <Button
                type="button"
                size="sm"
                variant={format === 'csv' ? 'secondary' : 'ghost'}
                className="gap-1"
                onClick={() => setFormat('csv')}
              >
                CSV
              </Button>
              <Button
                type="button"
                size="sm"
                variant={format === 'txt' ? 'secondary' : 'ghost'}
                className="gap-1"
                onClick={() => setFormat('txt')}
              >
                TXT
              </Button>
            </div>
          </div>
          {isExporting ? (
            <Button disabled className="gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Exporting...
            </Button>
          ) : (
            <Button onClick={handleExport} className="gap-2">
              <Check className="h-4 w-4" />
              Export {format.toUpperCase()}
            </Button>
          )}
        </div>

        <DialogFooter>
          <p className="w-full text-center text-xs text-muted-foreground">
            One row per student-question pair. Student info repeats on every row.
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}