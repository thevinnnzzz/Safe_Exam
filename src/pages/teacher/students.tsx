import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { BadgePlus, CheckCircle2, Download, Loader2, Search, UserPlus, Users } from 'lucide-react'
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

interface NewStudentForm {
  full_name: string
  student_id: string
  password: string
  email: string
  course_id: string
}

const emptyForm: NewStudentForm = { full_name: '', student_id: '', password: '', email: '', course_id: '' }

export function TeacherStudentsPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [singleOpen, setSingleOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [form, setForm] = useState<NewStudentForm>(emptyForm)
  const [bulkText, setBulkText] = useState('')
  const [bulkCourse, setBulkCourse] = useState('')

  const studentsQuery = useQuery({ queryKey: ['teacher-students'], queryFn: () => teacherApi.teacherStudents() })
  const coursesQuery = useQuery({ queryKey: ['teacher-courses'], queryFn: () => teacherApi.courses() })

  const downloadTemplate = () => {
    downloadCSV('students-template.csv', [
      ['Full name', 'Student ID', 'Password', 'Email'],
      ['Melchora Aquino', 'STU-2026-004', 'student123', 'aquino@example.com'],
      ['Apolinario Mabini', 'STU-2026-005', 'student123', ''],
    ])
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
          const [full_name, student_id, password, ...rest] = line.split(',').map((s) => s.trim())
          return { full_name: full_name ?? '', student_id: (student_id ?? '').toUpperCase(), password: password ?? '', email: rest.join(',') || null, course_id: bulkCourse || null }
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
      }
    },
    onError: () => toast.error('Could not import students.'),
  })

  const students = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = studentsQuery.data ?? []
    if (!q) return list
    return list.filter(
      (s) =>
        s.full_name.toLowerCase().includes(q) ||
        (s.student_id ?? '').toLowerCase().includes(q) ||
        (s.email ?? '').toLowerCase().includes(q) ||
        (s.course_name ?? '').toLowerCase().includes(q),
    )
  }, [studentsQuery.data, search])

  if (studentsQuery.isLoading || coursesQuery.isLoading) return <PageLoader />

  return (
    <div className="mx-auto max-w-5xl space-y-6">
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
              placeholder="Search by name, Student ID, email or course…"
              className="pl-9"
            />
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
                  <TableHead>Email</TableHead>
                  <TableHead>Course</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {students.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.full_name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{s.student_id ?? '—'}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{s.email ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{s.course_name ?? '—'}</TableCell>
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
              One student per line, comma-separated: <code className="rounded bg-muted px-1 py-0.5 text-xs">Full name, Student ID, Password, Email (optional)</code>
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
              <Textarea
                id="bulk"
                rows={7}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={'Melchora Aquino, STU-2026-004, student123, aquino@example.com\nApolinario Mabini, STU-2026-005, student123'}
              />
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
    </div>
  )
}
