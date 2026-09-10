import { useRef, useState } from 'react'
import Papa from 'papaparse'
import { toast } from 'sonner'
import { Download, FileUp, Loader2, UploadCloud } from 'lucide-react'
import { teacherApi } from '@/api/supabase-api'
import { downloadCSV, downloadText } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface CsvImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bankId: string | null
  onImported: (count: number) => void
}

/**
 * CSV template header:
 * question,choice_a,choice_b,choice_c,choice_d,correct,difficulty,category,points,explanation
 * `correct` may be a letter (A-D) or the exact text of the right choice.
 *
 * TXT files use the Aiken format — one question per block, blocks separated by
 * blank lines:
 *   What is the capital of France?
 *   A. Berlin
 *   B. Madrid
 *   *C. Paris
 *   D. Rome
 *   Explanation: Paris is the capital of France.
 * The `*` marks the correct choice. Optional per-question metadata lines:
 *   Category: <text> · Difficulty: easy|medium|hard · Points: <n>
 * Lines starting with `#` are treated as comments and ignored, so template
 * files can carry usage instructions.
 */

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
  type: string
  model_answer: string
  min_words: string
  max_words: string
}

/** Normalized question ready for insert — shared by the CSV and TXT parsers. */
interface ImportRow {
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

function normalizeDifficulty(value: string | undefined): 'easy' | 'medium' | 'hard' {
  const v = (value ?? '').trim().toLowerCase()
  return v === 'easy' || v === 'hard' ? v : 'medium'
}

function normalizeType(value: string | undefined): 'multiple_choice' | 'essay' {
  const v = (value ?? '').trim().toLowerCase()
  return v === 'essay' ? 'essay' : 'multiple_choice'
}

function csvRowToImport(row: ParsedRow): ImportRow {
  const questionType = normalizeType(row.type)
  const maxWords = Number(row.max_words) || 0
  if (questionType === 'essay') {
    return {
      content: (row.question ?? '').trim(),
      difficulty: normalizeDifficulty(row.difficulty),
      category: (row.category ?? '').trim() || null,
      points: Math.max(1, Number(row.points) || 1),
      explanation: (row.explanation ?? '').trim() || null,
      question_type: 'essay',
      model_answer: (row.model_answer ?? '').trim() || null,
      min_words: Math.max(0, Number(row.min_words) || 0),
      max_words: maxWords > 0 ? maxWords : null,
      choices: [],
    }
  }
  const choices = [row.choice_a, row.choice_b, row.choice_c, row.choice_d].map((c) => (c ?? '').trim())
  const correctUpper = (row.correct ?? '').trim().toUpperCase()
  const byLetter = ['A', 'B', 'C', 'D'].indexOf(correctUpper)
  const correctIndex = byLetter !== -1 ? byLetter : choices.indexOf((row.correct ?? '').trim())
  return {
    content: (row.question ?? '').trim(),
    difficulty: normalizeDifficulty(row.difficulty),
    category: (row.category ?? '').trim() || null,
    points: Math.max(1, Number(row.points) || 1),
    explanation: (row.explanation ?? '').trim() || null,
    question_type: 'multiple_choice',
    model_answer: null,
    min_words: 0,
    max_words: null,
    choices: choices.map((content, i) => ({ content, is_correct: i === correctIndex })),
  }
}

const AIKEN_CHOICE_RE = /^(\*?)\s*([A-Fa-f])\s*[).:-]\s*(.+)$/
const AIKEN_META_RE = /^(explanation|difficulty|category|points?|type|model answer|min words|max words)\s*[:-]\s*(.*)$/i

function parseAiken(text: string): { rows: ImportRow[]; errors: string[] } {
  // Strip UTF-8 BOM and normalize Windows/mac line endings.
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const blocks = normalized
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean)

  const rows: ImportRow[] = []
  const errors: string[] = []
  let questionNumber = 0

  blocks.forEach((block) => {
    // Skip comment lines (used for instructions inside template files).
    const lines = block
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
    if (lines.length === 0) return

    questionNumber += 1
    const label = `Question ${questionNumber}`

    const questionLines: string[] = []
    const choices: { content: string; is_correct: boolean }[] = []
    let explanation: string | null = null
    let difficulty: string | undefined
    let category: string | null = null
    let points: number | undefined
    let qtype: 'multiple_choice' | 'essay' = 'multiple_choice'
    let modelAnswer: string | null = null
    let minWords = 0
    let maxWords: number | null = null
    let expectedLetterIndex = 0
    let sawChoice = false
    let correctCount = 0

    for (const line of lines) {
      const choiceMatch = line.match(AIKEN_CHOICE_RE)
      if (choiceMatch && qtype !== 'essay') {
        const letterIndex = choiceMatch[2].toUpperCase().charCodeAt(0) - 65
        if (letterIndex !== expectedLetterIndex) {
          errors.push(`${label}: choices must be labeled in order (A, B, C, …).`)
          return
        }
        const isCorrect = choiceMatch[1] === '*'
        if (isCorrect) correctCount += 1
        choices.push({ content: choiceMatch[3].trim(), is_correct: isCorrect })
        expectedLetterIndex += 1
        sawChoice = true
        continue
      }

      const metaMatch = line.match(AIKEN_META_RE)
      if (metaMatch) {
        const key = metaMatch[1].toLowerCase()
        const value = metaMatch[2].trim()
        if (key === 'explanation') explanation = value || null
        else if (key === 'difficulty') difficulty = value
        else if (key === 'category') category = value || null
        else if (key === 'type') qtype = normalizeType(value)
        else if (key === 'model answer') modelAnswer = value || null
        else if (key === 'min words') minWords = Math.max(0, Number(value) || 0)
        else if (key === 'max words') maxWords = Number(value) > 0 ? Number(value) : null
        else points = Math.max(1, Number(value) || 1)
        continue
      }

      if (!sawChoice) {
        questionLines.push(line)
      } else {
        errors.push(`${label}: unrecognized line "${line.slice(0, 40)}${line.length > 40 ? '…' : ''}".`)
        return
      }
    }

    const content = questionLines.join(' ').trim()
    if (!content) {
      errors.push(`${label}: missing question text.`)
      return
    }
    if (qtype === 'essay') {
      rows.push({
        content,
        difficulty: normalizeDifficulty(difficulty),
        category,
        points: points ?? 1,
        explanation,
        question_type: 'essay',
        model_answer: modelAnswer,
        min_words: minWords,
        max_words: maxWords,
        choices: [],
      })
      return
    }
    if (choices.length < 2) {
      errors.push(`${label}: needs at least two answer choices.`)
      return
    }
    if (correctCount === 0) {
      errors.push(`${label}: mark the correct choice with * (e.g. "*C. Paris").`)
      return
    }
    if (correctCount > 1) {
      errors.push(`${label}: only one choice may be marked correct.`)
      return
    }

    rows.push({
      content,
      difficulty: normalizeDifficulty(difficulty),
      category,
      points: points ?? 1,
      explanation,
      question_type: 'multiple_choice',
      model_answer: null,
      min_words: 0,
      max_words: null,
      choices,
    })
  })

  return { rows, errors }
}

export function CsvImportDialog({ open, onOpenChange, bankId, onImported }: CsvImportDialogProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [rows, setRows] = useState<ImportRow[]>([])
  const [errors, setErrors] = useState<string[]>([])

  const downloadCsvTemplate = () => {
    downloadCSV('questions-template.csv', [
      ['question', 'type', 'choice_a', 'choice_b', 'choice_c', 'choice_d', 'correct', 'difficulty', 'category', 'points', 'explanation', 'model_answer', 'min_words', 'max_words'],
      ['What is the capital of France?', 'multiple_choice', 'Berlin', 'Madrid', 'Paris', 'Rome', 'C', 'easy', 'Geography', '1', 'Paris is the capital of France.', '', '', ''],
      ['2 + 2 = ?', 'multiple_choice', '3', '4', '5', '6', 'B', 'easy', 'Math', '1', 'Two plus two equals four.', '', '', ''],
      ['Explain the causes of World War I.', 'essay', '', '', '', '', '', 'medium', 'History', '10', '', 'Militarism, alliances, imperialism, nationalism.', '100', '500'],
    ])
  }

  const downloadTxtTemplate = () => {
    downloadText(
      'questions-template.txt',
      [
        '# ==================================================================',
        '# SAFE EXAM — QUESTION IMPORT TEMPLATE (TXT / Aiken format)',
        '# ==================================================================',
        '# HOW TO USE',
        '#   1. Each question is a block of lines; separate questions with a',
        '#      blank line.',
        '#   2. The first line of each block is the question text.',
        '#   3. Below it, list the answer choices on their own lines, labeled',
        '#      A. B. C. D. (up to F is allowed).',
        '#   4. Put * in front of the letter of the CORRECT choice.',
        '#      Exactly one choice per question must be marked.',
        '#   5. Optional lines (anywhere inside the block):',
        '#        Explanation: <text shown to students after submission>',
        '#        Category:    <free text>',
        '#        Difficulty:  easy | medium | hard   (default: medium)',
        '#        Points:      <number>                (default: 1)',
        '#   6. Lines starting with # are comments and are ignored on import.',
        '#      You can keep or delete this header — it will not be imported.',
        '#',
        '# Prefer a spreadsheet? Import a .csv instead with columns:',
        '#   question,choice_a,choice_b,choice_c,choice_d,correct,difficulty,category,points,explanation',
        '# ==================================================================',
        '',
        'What is the capital of France?',
        'A. Berlin',
        'B. Madrid',
        '*C. Paris',
        'D. Rome',
        'Explanation: Paris is the capital of France.',
        '',
        'What is 2 + 2?',
        'A. 3',
        'B. 4',
        'C. 5',
        '*D. 6',
        'Category: Math',
        'Difficulty: easy',
        'Points: 1',
        '',
        'Which planet is known as the Red Planet?',
        'A. Venus',
        '*B. Mars',
        'C. Jupiter',
        'D. Saturn',
        'Explanation: Mars appears red because of iron oxide (rust) on its surface.',
        'Category: Science',
        'Difficulty: easy',
        '',
        'Who wrote the novel "Noli Me Tangere"?',
        'A. Andres Bonifacio',
        'B. Emilio Jacinto',
        '*C. Jose Rizal',
        'D. Apolinario Mabini',
        'Explanation: Jose Rizal published Noli Me Tangere in 1887.',
        'Category: History',
        'Difficulty: medium',
        'Points: 2',
        '',
        'What is the largest ocean on Earth?',
        '*A. Pacific Ocean',
        'B. Atlantic Ocean',
        'C. Indian Ocean',
        'D. Arctic Ocean',
        'Category: Geography',
        'Difficulty: hard',
        'Points: 3',
      ].join('\n'),
    )
  }

  const handleFile = (file: File) => {
    setParsing(true)
    setErrors([])

    if (/\.txt$/i.test(file.name)) {
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const result = parseAiken(String(reader.result ?? ''))
          setRows(result.rows)
          setErrors(result.errors)
        } catch {
          setErrors(['Could not read the TXT file.'])
        }
        setParsing(false)
      }
      reader.onerror = () => {
        setErrors(['Could not read the TXT file.'])
        setParsing(false)
      }
      reader.readAsText(file)
      return
    }

    Papa.parse<ParsedRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const parsed = (result.data as unknown as Record<string, unknown>[]).filter((r) => {
          const q = String(r.question ?? '').trim()
          return q.length > 0
        }) as unknown as ParsedRow[]
        setRows(parsed.map(csvRowToImport))
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
      if (row.question_type === 'essay') return
      if (row.choices.some((c) => !c.content)) validationErrors.push(`Question ${i + 1}: every choice must have text.`)
      if (!row.choices.some((c) => c.is_correct)) validationErrors.push(`Question ${i + 1}: no correct answer is marked.`)
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
        await teacherApi.createQuestion(bankId, {
          content: row.content,
          difficulty: row.difficulty,
          category: row.category,
          points: row.points,
          explanation: row.explanation,
          choices: row.choices,
          question_type: row.question_type,
          model_answer: row.model_answer,
          min_words: row.min_words,
          max_words: row.max_words,
        })
        ok += 1
      }
      toast.success(`Imported ${ok} question${ok === 1 ? '' : 's'}.`)
      onImported(ok)
      onOpenChange(false)
      setRows([])
      if (fileRef.current) fileRef.current.value = ''
    } catch {
      toast.error(`Import failed after ${ok} questions. Check the file format.`)
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-4 overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import questions</DialogTitle>
          <DialogDescription>
            CSV (<code className="rounded bg-muted px-1 text-xs">question,type,choice_a,…</code>, type = multiple_choice|essay) or TXT in Aiken format (
            <code className="rounded bg-muted px-1 text-xs">* marks the correct choice</code>, blank line between questions; essays use <code className="rounded bg-muted px-1 text-xs">Type: essay</code>).
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          <div
            className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed p-5 text-center hover:bg-muted/50"
            onClick={() => fileRef.current?.click()}
          >
            <UploadCloud className="h-7 w-7 text-primary" />
            <p className="text-sm font-medium">Click to choose a CSV or TXT file</p>
            <p className="text-xs text-muted-foreground">CSV: one question per row · TXT: Aiken blocks separated by blank lines</p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv,.txt,text/plain"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleFile(file)
              }}
            />
          </div>

          <div className="flex items-center justify-center gap-6">
            <button type="button" onClick={downloadCsvTemplate} className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
              <Download className="h-3.5 w-3.5" />
              Download CSV template
            </button>
            <button type="button" onClick={downloadTxtTemplate} className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
              <Download className="h-3.5 w-3.5" />
              Download TXT template
            </button>
          </div>

          {parsing ? (
            <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Parsing file…
            </p>
          ) : rows.length > 0 ? (
            <p className="text-center text-sm">
              <span className="font-medium">{rows.length}</span> question{rows.length === 1 ? '' : 's'} ready to import.
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
          <Button onClick={() => void importRows()} disabled={rows.length === 0 || importing}>
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
            Import {rows.length > 0 ? `${rows.length} question${rows.length === 1 ? '' : 's'}` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
