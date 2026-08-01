import { useRef, useState } from 'react'
import Papa from 'papaparse'
import { toast } from 'sonner'
import { Download, FileUp, Loader2, UploadCloud } from 'lucide-react'
import { teacherApi } from '@/api/supabase-api'
import { downloadCSV } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface CsvImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bankId: string | null
  onImported: (count: number) => void
}

interface ParsedRow {
  question: string
  choice_a: string
  choice_b: string
  choice_c: string
  choice_d: string
  correct: string
  difficulty: string
  category: string
  points: string
  explanation: string
}

/**
 * Expected CSV header:
 * question,choice_a,choice_b,choice_c,choice_d,correct,difficulty,category,points,explanation
 * `correct` may be a letter (A-D) or the exact text of the right choice.
 */
export function CsvImportDialog({ open, onOpenChange, bankId, onImported }: CsvImportDialogProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [errors, setErrors] = useState<string[]>([])

  const downloadTemplate = () => {
    downloadCSV('questions-template.csv', [
      ['question', 'choice_a', 'choice_b', 'choice_c', 'choice_d', 'correct', 'difficulty', 'category', 'points', 'explanation'],
      ['What is the capital of France?', 'Berlin', 'Madrid', 'Paris', 'Rome', 'C', 'easy', 'Geography', '1', 'Paris is the capital of France.'],
      ['2 + 2 = ?', '3', '4', '5', '6', 'B', 'easy', 'Math', '1', 'Two plus two equals four.'],
    ])
  }

  const handleFile = (file: File) => {    setParsing(true)
    setErrors([])
    Papa.parse<ParsedRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const parsed = (result.data as unknown as Record<string, unknown>[]).filter((r) => {
          const q = String(r.question ?? '').trim()
          return q.length > 0
        }) as unknown as ParsedRow[]
        setRows(parsed)
        setParsing(false)
      },
      error: () => {
        setErrors(['Could not read the CSV file.'])
        setParsing(false)
      },
    })
  }

  const validate = (): boolean => {
    const validationErrors: string[] = []
    if (rows.length === 0) {
      validationErrors.push('The file contains no questions.')
    }
    rows.forEach((row, i) => {
      const choices = [row.choice_a, row.choice_b, row.choice_c, row.choice_d].map((c) => (c ?? '').trim())
      if (choices.some((c) => !c)) validationErrors.push(`Row ${i + 2}: every choice must have text.`)
      const correct = (row.correct ?? '').trim().toUpperCase()
      const byLetter = ['A', 'B', 'C', 'D'].indexOf(correct)
      const byText = choices.indexOf((row.correct ?? '').trim())
      if (byLetter === -1 && byText === -1) {
        validationErrors.push(`Row ${i + 2}: "correct" must be A, B, C or D (or match a choice).`)
      }
    })
    setErrors(validationErrors)
    return validationErrors.length === 0
  }

  const importRows = async () => {
    if (!validate()) return
    setImporting(true)
    let ok = 0
    try {
      for (const row of rows) {
        const choices = [row.choice_a, row.choice_b, row.choice_c, row.choice_d].map((c) => (c ?? '').trim())
        const correctUpper = (row.correct ?? '').trim().toUpperCase()
        const byLetter = ['A', 'B', 'C', 'D'].indexOf(correctUpper)
        const correctIndex = byLetter !== -1 ? byLetter : choices.indexOf((row.correct ?? '').trim())
        const difficulty = ['easy', 'medium', 'hard'].includes((row.difficulty ?? '').trim().toLowerCase())
          ? (row.difficulty.trim().toLowerCase() as 'easy' | 'medium' | 'hard')
          : 'medium'
        await teacherApi.createQuestion(bankId, {
          content: (row.question ?? '').trim(),
          difficulty,
          category: (row.category ?? '').trim() || null,
          points: Math.max(1, Number(row.points) || 1),
          explanation: (row.explanation ?? '').trim() || null,
          choices: choices.map((content, i) => ({ content, is_correct: i === correctIndex })),
        })
        ok += 1
      }
      toast.success(`Imported ${ok} question${ok === 1 ? '' : 's'}.`)
      onImported(ok)
      onOpenChange(false)
      setRows([])
      if (fileRef.current) fileRef.current.value = ''
    } catch {
      toast.error(`Import failed after ${ok} questions. Check the CSV format.`)
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-4 overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import questions from CSV</DialogTitle>
          <DialogDescription>
            Header: <code className="rounded bg-muted px-1 text-xs">question,choice_a,…,correct,difficulty,points,…</code>
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          <div
            className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed p-5 text-center hover:bg-muted/50"
            onClick={() => fileRef.current?.click()}
          >
            <UploadCloud className="h-7 w-7 text-primary" />
            <p className="text-sm font-medium">Click to choose a CSV file</p>
            <p className="text-xs text-muted-foreground">One question per row, four choices each.</p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleFile(file)
              }}
            />
          </div>

          <button
            type="button"
            onClick={downloadTemplate}
            className="mx-auto flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          >
            <Download className="h-3.5 w-3.5" />
            Download template CSV
          </button>

          {parsing ? (
            <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Parsing file…
            </p>
          ) : rows.length > 0 ? (
            <p className="text-center text-sm">
              <span className="font-medium">{rows.length}</span> questions ready to import.
            </p>
          ) : null}

          {errors.length > 0 ? (
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              {errors.map((err, i) => (
                <p key={i}>{err}</p>
              ))}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={importRows} disabled={rows.length === 0 || importing}>
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
            Import {rows.length > 0 ? `${rows.length} questions` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
