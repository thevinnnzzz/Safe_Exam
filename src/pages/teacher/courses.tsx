import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { BookOpen, Loader2, Plus, Trash2, Users } from 'lucide-react'
import { teacherApi } from '@/api/supabase-api'
import { PageHeader } from '@/components/common/page-header'
import { PageLoader } from '@/components/common/page-loader'
import { EmptyState } from '@/components/common/empty-state'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function TeacherCoursesPage() {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')

  const coursesQuery = useQuery({ queryKey: ['teacher-courses'], queryFn: () => teacherApi.courses() })
  const studentsQuery = useQuery({ queryKey: ['teacher-students'], queryFn: () => teacherApi.teacherStudents() })

  const studentCountByCourse = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const s of studentsQuery.data ?? []) {
      if (s.course_id) counts[s.course_id] = (counts[s.course_id] ?? 0) + 1
    }
    return counts
  }, [studentsQuery.data])

  const createMutation = useMutation({
    mutationFn: () => teacherApi.createCourse(name, code),
    onSuccess: () => {
      toast.success('Course created')
      queryClient.invalidateQueries({ queryKey: ['teacher-courses'] })
      setCreateOpen(false)
      setName('')
      setCode('')
    },
    onError: () => toast.error('Could not create the course. The code may already exist.'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => teacherApi.deleteCourse(id),
    onSuccess: () => {
      toast.success('Course deleted')
      queryClient.invalidateQueries({ queryKey: ['teacher-courses'] })
      setDeleteId(null)
    },
    onError: () => toast.error('Could not delete the course.'),
  })

  if (coursesQuery.isLoading || studentsQuery.isLoading) return <PageLoader />

  const courses = coursesQuery.data ?? []

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Courses" description="Create the courses that you assign to students.">
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          New course
        </Button>
      </PageHeader>

      {courses.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No courses yet"
          description="Create a course, then assign students and exams to it."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              Create course
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => (
            <Card key={course.id} className="flex flex-col transition-shadow hover:shadow-md">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="truncate text-base leading-snug">{course.name}</CardTitle>
                    <p className="mt-0.5 text-xs font-medium text-muted-foreground">{course.code}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => setDeleteId(course.id)}
                    aria-label="Delete course"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="mt-auto flex items-center gap-1.5 pt-2 text-sm text-muted-foreground">
                <Users className="h-4 w-4" />
                {studentCountByCourse[course.id] ?? 0} student{(studentCountByCourse[course.id] ?? 0) === 1 ? '' : 's'}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create course</DialogTitle>
            <DialogDescription>Add a course you can assign to students and exams.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="course-name">Name</Label>
              <Input id="course-name" placeholder="e.g. Introduction to Programming" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="course-code">Code</Label>
              <Input id="course-code" placeholder="e.g. CS101" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => createMutation.mutate()} disabled={!name.trim() || !code.trim() || createMutation.isPending}>
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Delete this course?"
        description="Students keep their accounts, but their course assignment is cleared. Exams that reference the course are also cleared."
        confirmLabel="Delete course"
        destructive
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        loading={deleteMutation.isPending}
      />
    </div>
  )
}
