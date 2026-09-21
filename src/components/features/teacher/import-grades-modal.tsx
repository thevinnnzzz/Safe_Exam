import { useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import { toast } from 'sonner'
import { AlertTriangle, Download, FileUp, Loader2, UploadCloud } from 'lucide-react'
import { teacherApi } from '@/api/supabase-api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { downloadCSV } from '@/lib/utils'

interface ImportGradesModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  examId: string
  examTitle: string
}

const REQUIRED_HEADERS = ['Student #', 'Student Name', 'Question #', 'Question', 'Feedback', 'Points Earned'] as const

type RequiredHeader = (typeof REQUIRED_HEADERS)[number]

/** Header aliases accepted on import (export uses exactly the labels above, but be forgiving). */
const HEADER_ALIASES: Record<string, RequiredHeader> = {
  'student #': 'Student #',
  'student number': 'Student #',
  'student_number': 'Student #',
  'student id': 'Student #',
  'student_id': 'Student #',
  'student name': 'Student Name',
  'student_name': 'Student Name',
  'full name': 'Student Name',
  name: 'Student Name',
  'question #': 'Question #',
  'question number': 'Question #',
  'question_position': 'Question #',
  question: 'Question',
  feedback: 'Feedback',
  'points earned': 'Points Earned',
  points_earned: 'Points Earned',
  'points possible': 'Points Earned',
  points: 'Points Earned',
}

interface ParsedRow {
  student_number: string
  question_position: number
  points_earned_raw: string
  points_earned: number
  feedback: string | null
  rowIndex: number
  invalidReason: string | null
}

interface ImportError {
  student_number: string
  question_position: string
  reason: string
}

function normalizeHeader(raw: string): string {
  return raw.trim().replace(/^\uFEFF/, '')
}

function resolveHeader(raw: string): RequiredHeader | null {
  const key = raw.trim().toLowerCase()
  if (HEADER_ALIASES[key]) return HEADER_ALIASES[key]
  const exact = REQUIRED_HEADERS.find((h) => h.toLowerCase() === key)
  return exact ?? null
}

export function ImportGradesModal({ open, onOpenChange, examId, examTitle }: ImportGradesModalProps) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [missingHeaders, setMissingHeaders] = useState<string[]>([])
  const [serverSummary, setServerSummary] = useState<{ applied: number; skipped: number; errors: ImportError[] } | null>(null)
  const [importing, setImporting] = useState(false)

  const resetState = () => {
    setFileName(null)
    setParsedRows([])
    setParseError(null)
    setMissingHeaders([])
    setServerSummary(null)
    setImporting(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) resetState()
    onOpenChange(next)
  }

  const downloadTemplate = () => {
    // One student × 5 essay rows so the row-per-question layout is obvious.
    // Teachers duplicate the Student #/Name block per student and adjust Q # 1..5.
    downloadCSV(`${examTitle.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-import-template.csv`, [
      [...REQUIRED_HEADERS] as string[],
      ['20240001', 'Juan Dela Cruz', '1', 'Explain the main causes of climate change in 150–250 words.', 'Clear thesis, good structure — add one cited source.', '8'],
      ['20240001', 'Juan Dela Cruz', '2', 'Compare renewable vs non-renewable energy with two real-world examples.', 'Strong comparison, second example could be more specific.', '7'],
      ['20240001', 'Juan Dela Cruz', '3', 'Discuss the ethical implications of AI in education.', 'Thoughtful argument, address counterpoints more directly.', '9'],
      ['20240001', 'Juan Dela Cruz', '4', 'Propose a data-privacy policy for a school that uses cloud tools.', 'Practical and well-organized, tighten the retention section.', '6'],
      ['20240001', 'Juan Dela Cruz', '5', 'Analyze the role of social media in modern political campaigns.', 'Insightful analysis with relevant examples.', '9'],
    ])
  }

  const handleFile = (file: File | null) => {
    if (!file) return
    setFileName(file.name)
    setParseError(null)
    setMissingHeaders([])
    setServerSummary(null)

    Papa.parse<string[]>(file, {
      header: false,
      skipEmptyLines: true,
      complete: (result) => {
        const rows = result.data as string[][]
        if (rows.length === 0) {
          setParseError('The file is empty.')
          setParsedRows([])
          return
        }

        const rawHeaders = rows[0].map(normalizeHeader)
        const headerMap = new Map<string, number>()
        for (let i = 0; i < rawHeaders.length; i++) {
          const resolved = resolveHeader(rawHeaders[i])
          if (resolved && !headerMap.has(resolved)) headerMap.set(resolved, i)
        }

        const missing = REQUIRED_HEADERS.filter((h) => !headerMap.has(h))
        if (missing.length > 0) {
          setMissingHeaders(missing)
          setParsedRows([])
          return
        }

        const out: ParsedRow[] = []
        for (let r = 1; r < rows.length; r++) {
          const row = rows[r]
          const studentNumber = (row[headerMap.get('Student #')!] ?? '').trim()
          const qRaw = (row[headerMap.get('Question #')!] ?? '').trim()
          const feedbackRaw = (row[headerMap.get('Feedback')!] ?? '').trim()
          const pointsRaw = (row[headerMap.get('Points Earned')!] ?? '').trim()

          // Rule: feedback-only rows (blank points) are skipped entirely — never sent to the server.
          if (pointsRaw === '') {
            continue
          }

          const pos = Number(qRaw)
          const pts = Number(pointsRaw)
          let invalidReason: string | null = null
          if (!studentNumber) invalidReason = 'Missing Student #'
          else if (!Number.isFinite(pos) || !Number.isInteger(pos) || pos < 1) invalidReason = 'Invalid Question #'
          else if (!Number.isFinite(pts) || pointsRaw === '') invalidReason = 'Points Earned must be a number'

          out.push({
            student_number: studentNumber,
            question_position: Number.isFinite(pos) ? Math.trunc(pos) : NaN,
            points_earned_raw: pointsRaw,
            points_earned: pts,
            feedback: feedbackRaw || null,
            rowIndex: r + 1,
            invalidReason,
          })
        }

        setParsedRows(out)
        if (out.length === 0 && missingHeaders.length === 0) {
          setParseError('No gradable rows found — every row has blank Points Earned and was skipped (feedback-only rows are intentionally not imported). Fill in Points Earned for the rows you want to grade.')
        }
      },
      error: (err) => setParseError(err.message || 'Could not parse the CSV.'),
    })
  }

  const invalidCount = useMemo(() => parsedRows.filter((r) => r.invalidReason !== null).length, [parsedRows])
  const validRows = useMemo(() => parsedRows.filter((r) => r.invalidReason === null), [parsedRows])

  const handleImport = async () => {
    if (invalidCount > 0) {
      toast.error('Fix the highlighted rows before importing (e.g. missing Student # or non-numeric Points Earned).')
      return
    }
    if (validRows.length === 0) {
      toast.error('Nothing to import — no rows with Points Earned were found.')
      return
    }
    setImporting(true)
    try {
      const payload = validRows.map((r) => ({
        student_number: r.student_number,
        question_position: r.question_position,
        points_earned: r.points_earned,
        feedback: r.feedback,
      }))
      const result = await teacherApi.importAnswerGrades(examId, payload)
      setServerSummary(result)
      const { applied, skipped, errors } = result
      if (applied > 0) {
        toast.success(`Imported ${applied} grade${applied === 1 ? '' : 's'}${skipped > 0 ? ` · ${skipped} row${skipped === 1 ? '' : 's'} skipped (feedback-only / MCQ)` : ''}${errors.length > 0 ? ` · ${errors.length} row${errors.length === 1 ? '' : 's'} with errors` : ''}`)
      } else if (errors.length > 0) {
        toast.error(`No grades applied — ${errors.length} row${errors.length === 1 ? '' : 's'} had errors. See the details below.`)
      } else {
        toast.info('Nothing was applied — all rows were skipped (feedback-only / MCQ).')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed.')
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader className="pr-8">
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="h-5 w-5 text-primary" />
            Import Grades
          </DialogTitle>
          <DialogDescription>
            Bulk grade essay answers for <span className="font-medium text-foreground">{examTitle}</span>. Import a CSV with the columns{' '}
            <span className="font-mono text-xs">Student # · Student Name · Question # · Question · Feedback · Points Earned</span>. Tip: use{' '}
            <span className="font-medium">Export Answers</span> first — it already produces exactly this layout.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 rounded-lg border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
          <p className="font-medium text-foreground">How it works</p>
          <ul className="list-disc space-y-0.5 pl-4">
            <li>
              One row = one student × one question. For 5 essays you will have 5 rows per student (
              <span className="font-mono">Question # 1…5</span> with the same <span className="font-mono">Student #</span>). Each row is matched by{' '}
              <span className="font-medium text-foreground">Student #</span> + <span className="font-medium text-foreground">Question #</span> against that student's latest submitted/time_up attempt — the same attempt shown in the export.
            </li>
            <li>
              Only <span className="font-medium text-foreground">essay</span> answers are graded; MCQ rows are skipped (reported below).
            </li>
            <li>
              <span className="font-medium text-foreground">Feedback-only rows</span> (blank Points Earned) are skipped entirely — feedback is only saved together with a score.
            </li>
            <li>Fill only the last two columns (<span className="font-mono">Feedback</span> and <span className="font-mono">Points Earned</span>); leave the first four exactly as exported. Scores must be 0 … max points and overwrite any auto-graded value (manual grade wins).</li>
          </ul>
          <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}>
            <Download className="h-3.5 w-3.5" />
            Download template (1 student × 5 essays)
          </Button>
        </div>

        <div className="space-y-2">
          <Label htmlFor="import-file">CSV file</Label>
          <div className="flex items-center gap-2">
            <Input
              ref={fileRef as never}
              id="import-file"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            />
            <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
              <UploadCloud className="h-4 w-4" />
              Choose file
            </Button>
          </div>
          {fileName ? <p className="text-xs text-muted-foreground">Selected: {fileName}</p> : null}
        </div>

        {missingHeaders.length > 0 ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div>
              <p className="font-medium text-destructive">Missing required columns</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Expected headers: <span className="font-mono">{REQUIRED_HEADERS.join(' · ')}</span>
              </p>
              <p className="mt-1 text-xs">Missing: {missingHeaders.join(', ')}</p>
            </div>
          </div>
        ) : null}

        {parseError ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="text-destructive">{parseError}</p>
          </div>
        ) : null}

        {parsedRows.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {validRows.length} gradable row{validRows.length === 1 ? '' : 's'}
              {invalidCount > 0 ? ` · ${invalidCount} row${invalidCount === 1 ? '' : 's'} need fixing` : ''}
              {' · '}feedback-only rows were omitted from this preview (they are skipped on import).
            </p>
            <ScrollArea className="h-[min(42vh,22rem)] rounded-lg border">
              <div className="min-w-[560px]">
                <div className="sticky top-0 grid grid-cols-[3.5rem_7rem_5rem_7rem_1fr] gap-2 border-b bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">
                  <span>Row</span>
                  <span>Student #</span>
                  <span>Q #</span>
                  <span>Points</span>
                  <span>Feedback / note</span>
                </div>
                <div className="divide-y">
                  {parsedRows.map((row) => (
                    <div
                      key={`${row.student_number}-${row.question_position}-${row.rowIndex}`}
                      className={`grid grid-cols-[3.5rem_7rem_5rem_7rem_1fr] gap-2 px-3 py-2 text-sm ${row.invalidReason ? 'bg-destructive/5' : ''}`}
                    >
                      <span className="text-xs text-muted-foreground">{row.rowIndex}</span>
                      <span className="truncate font-mono text-xs">{row.student_number || '—'}</span>
                      <span className="text-xs">{Number.isFinite(row.question_position) ? row.question_position : '—'}</span>
                      <span className={`text-xs ${row.invalidReason ? 'text-destructive' : ''}`}>{row.points_earned_raw}</span>
                      <span className={`truncate text-xs ${row.invalidReason ? 'text-destructive' : 'text-muted-foreground'}`}>{row.invalidReason ?? row.feedback ?? ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            </ScrollArea>
          </div>
        ) : null}

        {serverSummary ? (
          <div className="space-y-2 rounded-lg border p-3 text-sm">
            <p className="font-medium">
              Result: {serverSummary.applied} applied · {serverSummary.skipped} skipped · {serverSummary.errors.length} error
              {serverSummary.errors.length === 1 ? '' : 's'}
            </p>
            {serverSummary.errors.length > 0 ? (
              <ScrollArea className="max-h-40">
                <ul className="space-y-1 text-xs">
                  {serverSummary.errors.map((e, i) => (
                    <li key={`${e.student_number}-${e.question_position}-${i}`} className="flex gap-2">
                      <span className="font-mono shrink-0">
                        {e.student_number} / Q{e.question_position}
                      </span>
                      <span className="text-muted-foreground">{e.reason}</span>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            ) : null}
            {serverSummary.applied > 0 ? <p className="text-xs text-muted-foreground">Scores on this page will refresh shortly.</p> : null}
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            {serverSummary?.applied ? 'Close' : 'Cancel'}
          </Button>
          <Button type="button" onClick={handleImport} disabled={importing || parsedRows.length === 0 || invalidCount > 0}>
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
            {importing ? 'Importing…' : 'Import grades'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
