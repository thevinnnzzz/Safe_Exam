import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Database, FileQuestion, FolderPlus, Trash2 } from 'lucide-react'
import { teacherApi } from '@/api/supabase-api'
import { PageHeader } from '@/components/common/page-header'
import { PageLoader } from '@/components/common/page-loader'
import { EmptyState } from '@/components/common/empty-state'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Loader2 } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'

export function TeacherBanksPage() {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const banksQuery = useQuery({ queryKey: ['teacher-banks'], queryFn: () => teacherApi.banks() })

  const createMutation = useMutation({
    mutationFn: () => teacherApi.createBank(name.trim(), description.trim() || null),
    onSuccess: () => {
      toast.success('Question bank created')
      queryClient.invalidateQueries({ queryKey: ['teacher-banks'] })
      setCreateOpen(false)
      setName('')
      setDescription('')
    },
    onError: () => toast.error('Could not create the bank.'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => teacherApi.deleteBank(id),
    onSuccess: () => {
      toast.success('Question bank deleted')
      queryClient.invalidateQueries({ queryKey: ['teacher-banks'] })
      setDeleteId(null)
    },
    onError: () => toast.error('Could not delete the bank.'),
  })

  if (banksQuery.isLoading) return <PageLoader />

  const banks = banksQuery.data ?? []

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Question banks" description="Reusable collections of multiple choice questions.">
        <Button onClick={() => setCreateOpen(true)}>
          <FolderPlus className="h-4 w-4" />
          New bank
        </Button>
      </PageHeader>

      {banks.length === 0 ? (
        <EmptyState
          icon={Database}
          title="No question banks"
          description="Create a bank to organize questions you can reuse across exams, and import them from CSV."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <FolderPlus className="h-4 w-4" />
              Create bank
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {banks.map((bank) => (
            <Card key={bank.id} className="flex flex-col transition-shadow hover:shadow-md">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base leading-snug">{bank.name}</CardTitle>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setDeleteId(bank.id)} aria-label="Delete bank">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <CardDescription className="line-clamp-2">{bank.description ?? 'No description'}</CardDescription>
              </CardHeader>
              <CardContent className="mt-auto flex items-center justify-between pt-2">
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <FileQuestion className="h-4 w-4" />
                  {bank.question_count} questions
                </span>
                <span className="text-xs text-muted-foreground">{formatDateTime(bank.created_at)}</span>
              </CardContent>
              <CardContent className="pt-0">
                <Button asChild variant="outline" className="w-full">
                  <Link to={`/teacher/banks/${bank.id}`}>Manage questions</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create question bank</DialogTitle>
            <DialogDescription>Give your bank a name to organize questions.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="bank-name">Name</Label>
              <Input id="bank-name" placeholder="e.g. CS101 Fundamentals Bank" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bank-desc">Description (optional)</Label>
              <Textarea id="bank-desc" rows={2} placeholder="What is this bank for?" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => createMutation.mutate()} disabled={!name.trim() || createMutation.isPending}>
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Delete this question bank?"
        description="Questions in the bank will be deleted. Exams that reference them keep a snapshot only for grading."
        confirmLabel="Delete bank"
        destructive
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        loading={deleteMutation.isPending}
      />
    </div>
  )
}
