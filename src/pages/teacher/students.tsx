import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Papa from 'papaparse'
import { toast } from 'sonner'
import { ArrowDownUp, BadgePlus, CheckCircle2, Download, Filter, KeyRound, Loader2, Pencil, Search, Trash2, UploadCloud, UserPlus, Users, X } from 'lucide-react'
import { teacherApi } from '@/api/supabase-api'
import { downloadCSV } from '@/lib/utils'
import { PageHeader } from '@/components/common/page-header'
import { PageLoader } from '@/components/common/page-loader'
import { EmptyState } from '@/components/common/empty-state'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import type { UserProfile } from '@/lib/types'

interface NewStudentForm {
  full_name: string
  student_id: string
  password: string
  email: string
  course_id: string
  section: string
}

const emptyForm: NewStudentForm = { full_name: '', student_id: '', password: '', email: '', course_id: '', section: '' }

export function TeacherStudentsPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [singleOpen, setSingleOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [form, setForm] = useState<NewStudentForm>(emptyForm)
  const [bulkText, setBulkText] = useState('')
  const [bulkCourse, setBulkCourse] = useState('')
  const [bulkDragOver, setBulkDragOver] = useState(false)
  const [bulkFileName, setBulkFileName] = useState<string | null>(null)
  const [bulkFileError, setBulkFileError] = useState<string | null>(null)
  const [bulkParsing, setBulkParsing] = useState(false)
  const bulkFileRef = useRef<HTMLInputElement>(null)
  const [editStudent, setEditStudent] = useState<UserProfile | null>(null)
  const [editCourse, setEditCourse] = useState('')
  const [editSection, setEditSection] = useState('')
  const [accessStudent, setAccessStudent] = useState<UserProfile | null>(null)
  const [selectedExamIds, setSelectedExamIds] = useState<string[]>([])
  const [deleteStudent, setDeleteStudent] = useState<UserProfile | null>(null)
  const [courseFilter, setCourseFilter] = useState<string>('all')
  const [sectionFilter, setSectionFilter] = useState<string>('all')
  const [emailFilter, setEmailFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<string>('name_asc')

  const studentsQuery = useQuery({ queryKey: ['teacher-students'], queryFn: () => teacherApi.teacherStudents() })
  const coursesQuery = useQuery({ queryKey: ['teacher-courses'], queryFn: () => teacherApi.courses() })
  const examsQuery = useQuery({ queryKey: ['teacher-exams'], queryFn: () => teacherApi.exams() })
  const accessQuery = useQuery({
    queryKey: ['student-exam-access', accessStudent?.id],
    queryFn: () => teacherApi.studentExamAccess(accessStudent!.id),
    enabled: !!accessStudent,
  })

  const downloadTemplate = () => {
    downloadCSV('students-template.csv', [
      ['Full name', 'Student ID', 'Password', 'Email', 'Section'],
      ['Melchora Aquino', 'STU-2026-004', 'student123', 'aquino@example.com', 'BSIT-1A'],
      ['Apolinario Mabini', 'STU-2026-005', 'student123', '', 'BSIT-1A'],
    ])
  }

  const handleBulkFile = (file: File) => {
    setBulkFileError(null)
    if (!/\.(csv|txt)$/i.test(file.name)) {
      setBulkFileError('Please choose a .csv file (the downloaded template format).')
      return
    }
    setBulkParsing(true)
    Papa.parse<string[]>(file, {
      skipEmptyLines: true,
      complete: (result) => {
        try {
          let rows = (result.data ?? [])
            .map((cells) => (Array.isArray(cells) ? cells.map((c) => (c ?? '').trim()) : []))
            .filter((cells) => cells.some((c) => c !== ''))
          // Drop a header row when present (template header or pasted header).
          if (rows.length > 0 && /^(full[_ ]?name|name)$/i.test(rows[0][0] ?? '')) {
            rows = rows.slice(1)
          }
          const lines: string[] = []
          let skipped = 0
          for (const cells of rows) {
            if (cells.length < 3 || !cells[0] || !cells[1] || !cells[2]) {
              skipped += 1
              continue
            }
            // Keep the same 5-column shape the textarea parser expects.
            lines.push(cells.slice(0, 5).join(', '))
          }
          if (lines.length === 0) {
            setBulkFileError(
              skipped > 0
                ? `No usable rows found (${skipped} skipped — each row needs Full name, Student ID and Password).`
                : 'No student rows found in this file.',
            )
          } else {
            setBulkText((prev) => (prev.trim() ? `${prev.trimEnd()}\n${lines.join('\n')}` : lines.join('\n')))
            setBulkFileName(file.name)
            toast.success(`${lines.length} student${lines.length === 1 ? '' : 's'} loaded from file${skipped > 0 ? ` (${skipped} incomplete skipped)` : ''}. Review below, then Import.`)
          }
        } catch {
          setBulkFileError('Could not read this file. Make sure it is a valid CSV.')
        } finally {
          setBulkParsing(false)
          if (bulkFileRef.current) bulkFileRef.current.value = ''
        }
      },
      error: () => {
        setBulkFileError('Could not read this file. Make sure it is a valid CSV.')
        setBulkParsing(false)
        if (bulkFileRef.current) bulkFileRef.current.value = ''
      },
    })
  }

  const createMutation = useMutation({
    mutationFn: () =>
      teacherApi.createStudents([
        {
          full_name: form.full_name.trim(),
          student_id: form.student_id.trim().toUpperCase(),
          password: form.password,
          email: form.email.trim() || null,
          course_id: form.course_id || null,
          section: form.section.trim() || null,
        },
      ]),
    onSuccess: (results) => {
      const ok = results.filter((r) => r.ok).length
      const errors = results.filter((r) => !r.ok)
      if (errors.length) {
        toast.error(`Could not add ${errors.length} student${errors.length > 1 ? 's' : ''}: ${errors.map((e) => e.error).join('; ')}`)
      }
      if (ok) {
        toast.success(`${ok} student${ok > 1 ? 's' : ''} added`)
        queryClient.invalidateQueries({ queryKey: ['teacher-students'] })
        setSingleOpen(false)
        setForm(emptyForm)
      }
    },
    onError: () => toast.error('Could not add the student.'),
  })

  const bulkMutation = useMutation({
    mutationFn: () => {
      const rows = bulkText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          // Columns: Full name, Student ID, Password, Email (optional), Section (optional).
          // Older 3/4-column rows (without Section) keep working: missing
          // trailing columns are treated as empty.
          const [full_name, student_id, password, emailRaw, ...sectionRest] = line.split(',').map((s) => s.trim())
          return {
            full_name: full_name ?? '',
            student_id: (student_id ?? '').toUpperCase(),
            password: password ?? '',
            email: emailRaw || null,
            section: sectionRest.join(',').trim() || null,
            course_id: bulkCourse || null,
          }
        })
        .filter((r) => !/^(full[_ ]?name|name)$/i.test(r.full_name))
      return teacherApi.createStudents(rows)
    },
    onSuccess: (results) => {
      const ok = results.filter((r) => r.ok).length
      const errors = results.filter((r) => !r.ok)
      if (ok) toast.success(`${ok} student${ok > 1 ? 's' : ''} added`)
      if (errors.length) {
        toast.error(`Skipped ${errors.length}: ${errors.map((e) => `${e.student_id || e.full_name} (${e.error})`).join('; ')}`)
      }
      if (ok) {
        queryClient.invalidateQueries({ queryKey: ['teacher-students'] })
        setBulkOpen(false)
        setBulkText('')
        setBulkFileName(null)
        setBulkFileError(null)
      }
    },
    onError: () => toast.error('Could not import students.'),
  })

  const editMutation = useMutation({
    mutationFn: () =>
      teacherApi.updateStudent(editStudent!.id, {
        course_id: editCourse || null,
        section: editSection.trim() || null,
      }),
    onSuccess: () => {
      toast.success('Student updated')
      queryClient.invalidateQueries({ queryKey: ['teacher-students'] })
      setEditStudent(null)
    },
    onError: () => toast.error('Could not update the student.'),
  })

  const accessMutation = useMutation({
    mutationFn: () => teacherApi.setStudentExamAccess(accessStudent!.id, selectedExamIds),
    onSuccess: () => {
      toast.success('Exam access updated')
      queryClient.invalidateQueries({ queryKey: ['student-exam-access'] })
      setAccessStudent(null)
    },
    onError: () => toast.error('Could not update exam access.'),
  })

  const deleteMutation = useMutation({
    mutationFn: () => teacherApi.deleteStudent(deleteStudent!.id),
    onSuccess: () => {
      toast.success(`Deleted ${deleteStudent?.full_name}`)
      queryClient.invalidateQueries({ queryKey: ['teacher-students'] })
      setDeleteStudent(null)
    },
    onError: () => toast.error('Could not delete the student.'),
  })

  const openEdit = (s: UserProfile) => {
    setEditStudent(s)
    setEditCourse(s.course_id ?? '')
    setEditSection(s.section ?? '')
  }

  const openAccess = (s: UserProfile) => {
    setAccessStudent(s)
    setSelectedExamIds([])
  }

  useEffect(() => {
    if (accessQuery.data) setSelectedExamIds(accessQuery.data)
  }, [accessQuery.data])

  const toggleExam = (examId: string) => {
    setSelectedExamIds((prev) => (prev.includes(examId) ? prev.filter((id) => id !== examId) : [...prev, examId]))
  }

  const allStudents = studentsQuery.data ?? []

  const sections = useMemo(() => {
    const set = new Set<string>()
    for (const s of allStudents) {
      if (s.section) set.add(s.section)
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [allStudents])

  const students = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = allStudents.filter((s) => {
      if (courseFilter !== 'all' && s.course_id !== courseFilter) return false
      if (sectionFilter !== 'all' && (s.section ?? '') !== sectionFilter) return false
      if (emailFilter !== 'all') {
        const hasEmail = !!s.email
        if (emailFilter === 'has' && !hasEmail) return false
        if (emailFilter === 'none' && hasEmail) return false
      }
      if (q) {
        return (
          s.full_name.toLowerCase().includes(q) ||
          (s.student_id ?? '').toLowerCase().includes(q) ||
          (s.email ?? '').toLowerCase().includes(q) ||
          (s.course_name ?? '').toLowerCase().includes(q) ||
          (s.section ?? '').toLowerCase().includes(q)
        )
      }
      return true
    })
    return [...list].sort((a, b) => {
      switch (sortBy) {
        case 'name_desc':
          return b.full_name.localeCompare(a.full_name)
        case 'student_id_asc':
          return (a.student_id ?? '').localeCompare(b.student_id ?? '', undefined, { numeric: true })
        case 'student_id_desc':
          return (b.student_id ?? '').localeCompare(a.student_id ?? '', undefined, { numeric: true })
        case 'section_asc':
          return (a.section ?? '').localeCompare(b.section ?? '') || a.full_name.localeCompare(b.full_name)
        case 'section_desc':
          return (b.section ?? '').localeCompare(a.section ?? '') || a.full_name.localeCompare(b.full_name)
        case 'course_asc':
          return (a.course_name ?? '').localeCompare(b.course_name ?? '') || a.full_name.localeCompare(b.full_name)
        case 'course_desc':
          return (b.course_name ?? '').localeCompare(a.course_name ?? '') || a.full_name.localeCompare(b.full_name)
        default:
          return a.full_name.localeCompare(b.full_name)
      }
    })
  }, [allStudents, search, courseFilter, sectionFilter, emailFilter, sortBy])

  const hasFilters = courseFilter !== 'all' || sectionFilter !== 'all' || emailFilter !== 'all' || sortBy !== 'name_asc'

  const clearFilters = () => {
    setCourseFilter('all')
    setSectionFilter('all')
    setEmailFilter('all')
    setSortBy('name_asc')
  }

  if (studentsQuery.isLoading || coursesQuery.isLoading || examsQuery.isLoading) return <PageLoader />

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Students" description="Manage student accounts for your courses.">
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setBulkOpen(true)}>
            <BadgePlus className="h-4 w-4" />
            Bulk import
          </Button>
          <Button onClick={() => setSingleOpen(true)}>
            <UserPlus className="h-4 w-4" />
            Add student
          </Button>
        </div>
      </PageHeader>

      <Card>
        <CardContent className="p-4">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, Student ID, email, section or course…"
              className="pl-9"
            />
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-3">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={courseFilter} onValueChange={setCourseFilter}>
              <SelectTrigger className="h-8 w-auto gap-1 text-xs">
                <SelectValue placeholder="Course" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All courses</SelectItem>
                {(coursesQuery.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} ({c.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sectionFilter} onValueChange={setSectionFilter}>
              <SelectTrigger className="h-8 w-auto gap-1 text-xs">
                <SelectValue placeholder="Section" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sections</SelectItem>
                {sections.map((sec) => (
                  <SelectItem key={sec} value={sec}>
                    {sec}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={emailFilter} onValueChange={setEmailFilter}>
              <SelectTrigger className="h-8 w-auto gap-1 text-xs">
                <SelectValue placeholder="Email" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any email</SelectItem>
                <SelectItem value="has">Has email</SelectItem>
                <SelectItem value="none">No email</SelectItem>
              </SelectContent>
            </Select>
            <span className="mx-1 hidden h-4 w-px bg-border sm:block" />
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="h-8 w-auto gap-1 text-xs">
                <ArrowDownUp className="h-3.5 w-3.5 text-muted-foreground" />
                <SelectValue placeholder="Sort" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name_asc">Name A–Z</SelectItem>
                <SelectItem value="name_desc">Name Z–A</SelectItem>
                <SelectItem value="student_id_asc">Student ID ↑</SelectItem>
                <SelectItem value="student_id_desc">Student ID ↓</SelectItem>
                <SelectItem value="section_asc">Section A–Z</SelectItem>
                <SelectItem value="section_desc">Section Z–A</SelectItem>
                <SelectItem value="course_asc">Course A–Z</SelectItem>
                <SelectItem value="course_desc">Course Z–A</SelectItem>
              </SelectContent>
            </Select>
            {hasFilters ? (
              <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={clearFilters}>
                <X className="h-3.5 w-3.5" />
                Clear
              </Button>
            ) : null}
            <Badge variant="secondary" className="ml-auto">
              {students.length} shown
            </Badge>
          </div>

          {students.length === 0 ? (
            <EmptyState
              icon={Users}
              title={search ? 'No matching students' : 'No students yet'}
              description={
                search
                  ? 'Try a different search term.'
                  : 'Add students individually or import them in bulk so they can sign in and take your exams.'
              }
              action={
                search ? undefined : (
                  <Button onClick={() => setSingleOpen(true)}>
                    <UserPlus className="h-4 w-4" />
                    Add student
                  </Button>
                )
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Student ID</TableHead>
                  <TableHead>Section</TableHead>
                  <TableHead>Course</TableHead>
                  {/* <TableHead>Email</TableHead> */}
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {students.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.full_name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{s.student_id ?? '—'}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{s.section ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{s.course_name ?? '—'}</TableCell>
                    {/* <TableCell className="text-muted-foreground">{s.email ?? '—'}</TableCell> */}
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(s)} title="Edit course / section">
                          <Pencil className="h-3.5 w-3.5" />
                          <span className="sr-only">Edit</span>
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => openAccess(s)} title="Manage exam access">
                          <KeyRound className="h-3.5 w-3.5" />
                          <span className="sr-only">Manage exams</span>
                        </Button>
                        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => setDeleteStudent(s)} title="Delete student">
                          <Trash2 className="h-3.5 w-3.5" />
                          <span className="sr-only">Delete</span>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={singleOpen} onOpenChange={setSingleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add student</DialogTitle>
            <DialogDescription>Create a new student account. The student signs in with their Student ID and password.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="full_name">Full name</Label>
              <Input id="full_name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="e.g. Andres Bonifacio" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="student_id">Student ID</Label>
                <Input id="student_id" value={form.student_id} onChange={(e) => setForm({ ...form, student_id: e.target.value.toUpperCase() })} placeholder="e.g. STU-2026-004" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="min. 6 characters" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email (optional)</Label>
              <Input id="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="student@example.com" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="section">Section (optional)</Label>
                <Input id="section" value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })} placeholder="e.g. 1-A" />
              </div>
              <div className="space-y-2">
                <Label>Course (optional)</Label>
                <Select value={form.course_id || 'none'} onValueChange={(v) => setForm({ ...form, course_id: v === 'none' ? '' : v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a course" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No course</SelectItem>
                    {(coursesQuery.data ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} ({c.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSingleOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => createMutation.mutate()} disabled={!form.full_name.trim() || !form.student_id.trim() || form.password.length < 6 || createMutation.isPending}>
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Add student
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk import students</DialogTitle>
            <DialogDescription>
              One student per line, comma-separated: <code className="rounded bg-muted px-1 py-0.5 text-xs">Full name, Student ID, Password, Email (optional), Section (optional)</code>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2">
              <p className="text-xs text-muted-foreground">Prefer to fill in a file?</p>
              <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}>
                <Download className="h-3.5 w-3.5" />
                Download template
              </Button>
            </div>
            <div className="space-y-2">
              <Label htmlFor="bulk">Students</Label>
              <div
                role="button"
                tabIndex={0}
                aria-label="Upload a CSV file of students"
                onClick={() => bulkFileRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') bulkFileRef.current?.click()
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  setBulkDragOver(true)
                }}
                onDragLeave={() => setBulkDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setBulkDragOver(false)
                  const file = e.dataTransfer.files?.[0]
                  if (file) handleBulkFile(file)
                }}
                className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-4 text-center transition-colors hover:bg-muted/50 ${
                  bulkDragOver ? 'border-primary bg-primary/5' : ''
                }`}
              >
                <UploadCloud className="h-6 w-6 text-primary" />
                <p className="text-sm font-medium">
                  {bulkParsing ? 'Reading file…' : 'Click to choose a CSV file, or drag & drop it here'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Same columns as the template: Full name, Student ID, Password, Email, Section
                  {bulkFileName ? ` · Loaded: ${bulkFileName}` : ''}
                </p>
                <input
                  ref={bulkFileRef}
                  type="file"
                  accept=".csv,.txt,text/csv,text/plain"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleBulkFile(file)
                  }}
                />
              </div>
              {bulkFileError ? (
                <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{bulkFileError}</p>
              ) : null}
              <Textarea
                id="bulk"
                rows={7}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={'Melchora Aquino, STU-2026-004, student123, aquino@example.com, BSIT-1A\nApolinario Mabini, STU-2026-005, student123, , BSIT-1A'}
              />
              <p className="text-xs text-muted-foreground">File rows are added to the text above — you can review or edit them before clicking Import.</p>
            </div>
            <div className="space-y-2">
              <Label>Course (optional, applied to all)</Label>
              <Select value={bulkCourse || 'none'} onValueChange={(v) => setBulkCourse(v === 'none' ? '' : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a course" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No course</SelectItem>
                  {(coursesQuery.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} ({c.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Passwords must be at least 6 characters. Rows that fail are skipped and reported.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => bulkMutation.mutate()} disabled={!bulkText.trim() || bulkMutation.isPending}>
              {bulkMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editStudent} onOpenChange={(open) => !open && setEditStudent(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit student</DialogTitle>
            <DialogDescription>Update the course and section for {editStudent?.full_name ?? 'this student'}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit_section">Section</Label>
              <Input id="edit_section" value={editSection} onChange={(e) => setEditSection(e.target.value)} placeholder="e.g. 1-A" />
            </div>
            <div className="space-y-2">
              <Label>Course</Label>
              <Select value={editCourse || 'none'} onValueChange={(v) => setEditCourse(v === 'none' ? '' : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a course" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No course</SelectItem>
                  {(coursesQuery.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} ({c.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditStudent(null)}>
              Cancel
            </Button>
            <Button onClick={() => editMutation.mutate()} disabled={editMutation.isPending}>
              {editMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!accessStudent} onOpenChange={(open) => !open && setAccessStudent(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Manage exam access</DialogTitle>
            <DialogDescription>
              Choose which exams {accessStudent?.full_name ?? 'this student'} ({accessStudent?.student_id ?? '…'}) is allowed to take. Unchecked exams are hidden from the student.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {(examsQuery.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No exams yet. Create an exam before assigning access.</p>
            ) : (
              (examsQuery.data ?? []).map((exam) => (
                <label
                  key={exam.id}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50"
                >
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-primary"
                    checked={selectedExamIds.includes(exam.id)}
                    onChange={() => toggleExam(exam.id)}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{exam.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {exam.status}
                      {exam.course_name ? ` · ${exam.course_name}` : ''}
                    </span>
                  </span>
                </label>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAccessStudent(null)}>
              Cancel
            </Button>
            <Button onClick={() => accessMutation.mutate()} disabled={accessMutation.isPending}>
              {accessMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteStudent !== null}
        onOpenChange={(open) => !open && setDeleteStudent(null)}
        title="Delete this student?"
        description={`This permanently removes ${deleteStudent?.full_name ?? 'this student'} (${deleteStudent?.student_id ?? '…'}) along with all their attempts, answers, risk history and exam assignments. This cannot be undone.`}
        confirmLabel="Delete student"
        destructive
        onConfirm={() => deleteStudent && deleteMutation.mutate()}
        loading={deleteMutation.isPending}
      />
    </div>
  )
}
