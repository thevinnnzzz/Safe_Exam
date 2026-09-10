import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ClipboardX,
  Flag,
  Loader2,
  Save,
  ShieldAlert,
  Timer,
} from 'lucide-react'
import { studentApi } from '@/api/supabase-api'
import { useProctoring, IDLE_TIMEOUT_MS } from '@/hooks/use-proctoring'
import { useAuth } from '@/hooks/use-auth'
import { SESSION_TAKEN_MESSAGE, isSessionTakenError } from '@/lib/auth'
import type { ExamQuestionPublic, StudentExam } from '@/lib/types'
import { countWords } from '@/lib/types'
import { EVENT_LABELS } from '@/lib/risk'
import { formatClock } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { RiskBadge } from '@/components/common/risk-badge'
import { QuestionPalette } from '@/components/features/student/question-palette'
import { AnswerOption } from '@/components/features/student/answer-option'

type Phase = 'loading' | 'instructions' | 'starting' | 'taking' | 'locked' | 'submitting'
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

const violationEvents = new Set(['fullscreen_exit', 'copy_attempt', 'paste_attempt', 'cut_attempt', 'devtools'])

export function StudentExamPage() {
  const { examId } = useParams<{ examId: string }>()
  const navigate = useNavigate()
  const { logout } = useAuth()

  // If another device claims this account mid-exam, sign out here immediately.
  const handleTakeover = useCallback(() => {
    logout()
    toast.error(SESSION_TAKEN_MESSAGE, { duration: 6000 })
    navigate('/login', { replace: true })
  }, [logout, navigate])

  const examQuery = useQuery({
    queryKey: ['student-exam', examId],
    queryFn: () => studentApi.exam(examId!),
    enabled: !!examId,
    retry: 1,
  })
  const exam = examQuery.data

  const [phase, setPhase] = useState<Phase>('loading')
  const [se, setSe] = useState<StudentExam | null>(null)
  const [questions, setQuestions] = useState<ExamQuestionPublic[]>([])
  const [answers, setAnswers] = useState<Record<string, string | null>>({})
  const [flagged, setFlagged] = useState<string[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [remainingSeconds, setRemainingSeconds] = useState(0)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [confirmSubmit, setConfirmSubmit] = useState(false)

  const answersRef = useRef(answers)
  const currentIndexRef = useRef(0)
  const startMsRef = useRef(0)
  const questionTimesRef = useRef<Record<string, number>>({})
  const questionEnterRef = useRef(Date.now())
  const submittedRef = useRef(false)
  const saveChainRef = useRef<Promise<void>>(Promise.resolve())
  const progressTimerRef = useRef<number | null>(null)
  const essayTimerRef = useRef<number | null>(null)
  const autoResumedRef = useRef(false)

  const proctor = useProctoring(se?.id ?? null, {
    enabled: phase === 'taking' || phase === 'locked',
    onViolation: (eventType) => {
      if (violationEvents.has(eventType)) {
        toast.warning(`${EVENT_LABELS[eventType as keyof typeof EVENT_LABELS] ?? eventType} detected`, {
          description: 'This incident was recorded and added to your risk score.',
        })
      }
    },
  })

  // Whether this browser can run the exam in fullscreen. iPhones and other
  // browsers without the Fullscreen API cannot — starting is blocked there.
  const fullscreenSupported = proctor.fullscreenSupported

  const seRef = useRef(se)
  seRef.current = se
  const proctorRef = useRef(proctor)
  proctorRef.current = proctor

  // Reset proctoring when a new session loads.
  useEffect(() => {
    answersRef.current = answers
  }, [answers])

  // Prepare the session once the exam is known.
  useEffect(() => {
    if (!exam) return
    setPhase('instructions')
  }, [exam])

  const scheduleProgressSave = useCallback(
    (immediate = false, online = true) => {
      if (!se) return
      const run = () =>
        studentApi.updateProgress(se.id, {
          answers: answersRef.current,
          current_question_index: currentIndexRef.current,
          time_used_seconds: Math.floor((Date.now() - startMsRef.current) / 1000),
          is_online: online,
        })
      if (immediate) {
        void run().catch(() => {})
        return
      }
      if (progressTimerRef.current) window.clearTimeout(progressTimerRef.current)
      progressTimerRef.current = window.setTimeout(() => void run().catch(() => {}), 2000)
    },
    [se],
  )

  const enqueueAnswerSave = useCallback(
    (qid: string, choiceId: string | null, timeSpent: number, answerText?: string | null) => {
      if (!se) return
      setSaveStatus('saving')
      saveChainRef.current = saveChainRef.current
        .then(() => studentApi.saveAnswer(se.id, qid, choiceId, timeSpent, answerText ?? null))
        .then(() => setSaveStatus('saved'))
        .catch(() => setSaveStatus('error'))
    },
    [se],
  )

  const restoreSession = useCallback(
    async (attempt: StudentExam) => {
      const qs = await studentApi.fetchExamQuestions(attempt.id)
      if (qs.length === 0) throw new Error('This exam has no questions yet.')
      const saved = await studentApi.myAnswers(attempt.id)

      const restored: Record<string, string | null> = {}
      const times: Record<string, number> = {}
      for (const row of saved) {
        restored[row.question_id] = row.answer_text ?? row.choice_id
        times[row.question_id] = row.time_spent_seconds
      }

      let storedFlagged: string[] = []
      try {
        storedFlagged = JSON.parse(localStorage.getItem(`safe_exam.flagged.${attempt.id}`) ?? '[]')
      } catch {
        storedFlagged = []
      }

      startMsRef.current = new Date(attempt.started_at ?? new Date()).getTime()
      questionEnterRef.current = Date.now()
      currentIndexRef.current = attempt.current_question_index ?? 0
      answersRef.current = restored
      questionTimesRef.current = times

      setSe(attempt)
      setQuestions(qs)
      setAnswers(restored)
      setFlagged(storedFlagged)
      setCurrentIndex(attempt.current_question_index ?? 0)

      proctor.requestFullscreen()
      setPhase('taking')
    },
    [proctor],
  )

  // Auto-resume an in-progress attempt so a reload (e.g. a fullscreen exit on
  // mobile) drops the student straight back into the exam instead of bouncing
  // them to the instructions screen for a second "Begin exam" click.
  // Skipped on browsers without fullscreen support: starting is blocked there,
  // so resuming silently would bypass the device gate.
  useEffect(() => {
    if (!exam) return
    if (!fullscreenSupported) return
    if (exam.status !== 'published') return
    if (exam.start_time && new Date(exam.start_time).getTime() > Date.now()) return
    if (exam.end_time && new Date(exam.end_time).getTime() < Date.now()) return
    if (autoResumedRef.current) return
    let cancelled = false
    const resume = async () => {
      try {
        const attempt = await studentApi.currentAttempt(exam.id)
        if (cancelled || !attempt || attempt.status !== 'in_progress') return
        autoResumedRef.current = true
        await restoreSession(attempt)
        if (!cancelled) toast.info('Resumed your exam in progress.', { duration: 3000 })
      } catch {
        // No in-progress attempt (or an error) — stay on the instructions screen.
      }
    }
    void resume()
    return () => {
      cancelled = true
    }
  }, [exam, fullscreenSupported, restoreSession])

  const beginExam = async () => {
    if (!exam) return
    // Defense in depth: the Begin button is hidden on unsupported browsers,
    // but never start the attempt even if this is reached some other way.
    if (!fullscreenSupported) {
      toast.error('This device or browser does not support fullscreen exams.')
      return
    }
    setPhase('starting')
    try {
      const attempt = await studentApi.startExam(exam.id)
      if (attempt.status === 'submitted' || attempt.status === 'time_up') {
        navigate(`/student/result/${attempt.id}`, { replace: true })
        return
      }
      await restoreSession(attempt)
      toast.success('Exam started. Your answers are saved automatically.', { duration: 3500 })
    } catch (err) {
      if (isSessionTakenError(err)) {
        handleTakeover()
        return
      }
      setPhase('instructions')
      toast.error(err instanceof Error ? err.message : 'Could not start the exam.')
    }
  }

  const doSubmit = useCallback(async () => {
    if (!se || !exam || submittedRef.current) return
    submittedRef.current = true
    if (essayTimerRef.current) {
      window.clearTimeout(essayTimerRef.current)
      essayTimerRef.current = null
    }
    setPhase('submitting')
    try {
      await saveChainRef.current
      const elapsed = Math.min(
        Math.floor((Date.now() - startMsRef.current) / 1000),
        exam.duration_minutes * 60,
      )
      const result = await studentApi.submitExam(se.id, answersRef.current, elapsed)
      await proctor.flush()
      await studentApi.updateProgress(se.id, { answers: answersRef.current, is_online: false }).catch(() => {})
      navigate(`/student/result/${result.id}`, { replace: true })
    } catch (err) {
      if (isSessionTakenError(err)) {
        handleTakeover()
        return
      }
      submittedRef.current = false
      setPhase('taking')
      toast.error('Submission failed. Please try again.')
    }
  }, [se, exam, proctor, navigate, handleTakeover])

  const handleTimeUp = useCallback(() => {
    if (submittedRef.current || !exam) return
    if (exam.auto_submit) {
      void doSubmit()
    } else {
      setPhase('locked')
      toast.warning('Time is up. Please submit your exam.')
    }
  }, [exam, doSubmit])

  // Countdown timer.
  useEffect(() => {
    if (phase !== 'taking' && phase !== 'locked') return
    if (!exam || !se) return

    const endMs = startMsRef.current + exam.duration_minutes * 60 * 1000
    const tick = () => {
      const rem = Math.max(0, Math.ceil((endMs - Date.now()) / 1000))
      setRemainingSeconds(rem)
      if (rem <= 0) {
        window.clearInterval(interval)
        handleTimeUp()
      }
    }
    tick()
    const interval = window.setInterval(tick, 1000)
    return () => window.clearInterval(interval)
  }, [phase, exam, se, handleTimeUp])

  // Periodic progress + heartbeat.
  useEffect(() => {
    if (phase !== 'taking') return
    const heartbeat = window.setInterval(() => scheduleProgressSave(true), 15000)
    return () => window.clearInterval(heartbeat)
  }, [phase, scheduleProgressSave])

  // Flush on hide/unload so nothing is lost during refresh or navigation.
  useEffect(() => {
    if (phase !== 'taking' && phase !== 'locked') return
    const onHide = () => {
      if (document.hidden) {
        scheduleProgressSave(true, false)
        void proctor.flush()
      }
    }
    const onUnload = () => onHide()
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onUnload)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onUnload)
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [phase, scheduleProgressSave, proctor])

  // Mark offline on unmount.
  useEffect(() => {
    return () => {
      const current = seRef.current
      if (current && !submittedRef.current) {
        void studentApi.updateProgress(current.id, { is_online: false }).catch(() => {})
        void proctorRef.current.flush()
      }
    }
  }, [])

  const currentQuestion = questions[currentIndex]
  const isEssay = (qid: string) => questions.find((q) => q.question_id === qid)?.question_type === 'essay'
  const answeredIds = new Set(
    Object.entries(answers).filter(([k, v]) => (v ?? '').trim().length > 0 && (isEssay(k) || (v ?? '').length > 0)).map(([k]) => k),
  )
  const answeredCount = answeredIds.size
  const progressPercent = questions.length ? (answeredCount / questions.length) * 100 : 0
  const flaggedSet = new Set(flagged)

  const goTo = (index: number) => {
    if (!currentQuestion) return
    // flush any pending essay autosave for the question being left
    if (essayTimerRef.current) {
      window.clearTimeout(essayTimerRef.current)
      essayTimerRef.current = null
      const fromQid = currentQuestion.question_id
      const pendingText = answersRef.current[fromQid]
      if ((currentQuestion.question_type ?? 'multiple_choice') === 'essay') {
        const deltaFlush = Math.floor((Date.now() - questionEnterRef.current) / 1000)
        questionTimesRef.current[fromQid] = (questionTimesRef.current[fromQid] ?? 0) + Math.max(0, deltaFlush)
        questionEnterRef.current = Date.now()
        enqueueAnswerSave(fromQid, null, questionTimesRef.current[fromQid], pendingText ?? null)
      }
    }
    const fromQid = currentQuestion.question_id
    const delta = Math.floor((Date.now() - questionEnterRef.current) / 1000)
    questionTimesRef.current[fromQid] = (questionTimesRef.current[fromQid] ?? 0) + Math.max(0, delta)
    questionEnterRef.current = Date.now()
    currentIndexRef.current = index
    setCurrentIndex(index)
    scheduleProgressSave()
  }

  const handleSelect = (choiceId: string) => {
    if (!currentQuestion) return
    const qid = currentQuestion.question_id
    const delta = Math.floor((Date.now() - questionEnterRef.current) / 1000)
    questionTimesRef.current[qid] = (questionTimesRef.current[qid] ?? 0) + Math.max(0, delta)
    questionEnterRef.current = Date.now()

    const next = { ...answersRef.current, [qid]: choiceId }
    answersRef.current = next
    setAnswers(next)
    enqueueAnswerSave(qid, choiceId, questionTimesRef.current[qid])
    scheduleProgressSave()
  }

  const handleEssayChange = (text: string) => {
    if (!currentQuestion) return
    const qid = currentQuestion.question_id
    const next = { ...answersRef.current, [qid]: text }
    answersRef.current = next
    setAnswers(next)
    // debounce server saves while typing; progress snapshot stays debounced too
    if (essayTimerRef.current) window.clearTimeout(essayTimerRef.current)
    essayTimerRef.current = window.setTimeout(() => {
      const delta = Math.floor((Date.now() - questionEnterRef.current) / 1000)
      questionTimesRef.current[qid] = (questionTimesRef.current[qid] ?? 0) + Math.max(0, delta)
      questionEnterRef.current = Date.now()
      enqueueAnswerSave(qid, null, questionTimesRef.current[qid], text)
    }, 1200)
    scheduleProgressSave()
  }

  const toggleFlag = () => {
    if (!se || !currentQuestion) return
    const qid = currentQuestion.question_id
    setFlagged((prev) => {
      const next = prev.includes(qid) ? prev.filter((x) => x !== qid) : [...prev, qid]
      localStorage.setItem(`safe_exam.flagged.${se.id}`, JSON.stringify(next))
      return next
    })
  }

  if (examQuery.isLoading) {
    return <ExamPageLoading />
  }

  if (examQuery.isError || !exam) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <ShieldAlert className="h-10 w-10 text-destructive" />
            <p className="font-semibold">Exam unavailable</p>
            <p className="text-sm text-muted-foreground">
              This exam does not exist, is not published, or is outside its scheduled availability window.
            </p>
            <Button onClick={() => navigate('/student')}>Back to dashboard</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (phase === 'instructions' || phase === 'starting') {
    return (
      <div className="mx-auto max-w-2xl animate-fade-in">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-xl">{exam.title}</CardTitle>
                <CardDescription className="mt-1">
                  {exam.course_name ? `${exam.course_name} · ` : ''}
                  {exam.description ?? 'No description provided.'}
                </CardDescription>
              </div>
              <Badge variant="info">{exam.duration_minutes} min</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <InstructionTile icon={Timer} label="Duration" value={`${exam.duration_minutes} min`} />
              <InstructionTile icon={CalendarClock} label="Available" value="Scheduled" />
              <InstructionTile icon={CheckCircle2} label="Passing score" value={`${exam.passing_score}%`} />
              <InstructionTile icon={ClipboardX} label="Format" value="MCQ + Essay" />
            </div>

            {exam.instructions ? (
              <div className="rounded-lg bg-muted/60 p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Instructions</p>
                <p className="whitespace-pre-line text-sm">{exam.instructions}</p>
              </div>
            ) : null}

            <div className="flex items-start gap-2 rounded-lg border border-amber-300/50 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">Anti-cheating monitoring is active</p>
                <p className="mt-0.5 text-xs opacity-90">
                  The exam runs in fullscreen. Tab switches, copy/paste attempts, and leaving fullscreen are logged and
                  contribute to a risk score. {`Idle for ${IDLE_TIMEOUT_MS / 60000} minutes also counts.`}
                </p>
              </div>
            </div>

            {!fullscreenSupported ? (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
                <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                <div>
                  <p className="font-semibold">This device cannot start the exam</p>
                  <p className="mt-1 text-muted-foreground">
                    This browser does not support fullscreen mode (e.g. iPhones and some in-app browsers), which this
                    exam requires to prevent tab switching. Please sign in on an Android device with Chrome, or on a
                    desktop browser, and start the exam there.
                  </p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => navigate('/student')}>
                    <ArrowLeft className="h-4 w-4" />
                    Back to dashboard
                  </Button>
                </div>
              </div>
            ) : (
              <Button size="lg" className="w-full" onClick={beginExam} disabled={phase === 'starting'}>
                {phase === 'starting' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {phase === 'starting' ? 'Starting exam…' : 'Begin exam'}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!currentQuestion) {
    return <ExamPageLoading />
  }

  const timerTone =
    remainingSeconds <= Math.floor(exam.duration_minutes * 6)
      ? 'text-rose-600 dark:text-rose-400 animate-pulse'
      : remainingSeconds <= Math.floor(exam.duration_minutes * 60 * 0.25)
        ? 'text-amber-600 dark:text-amber-400'
        : ''

  return (
    <div className="mx-auto max-w-6xl animate-fade-in">
      {fullscreenSupported && !proctor.isFullscreen && phase === 'taking' ? (
        <div className="mb-4 flex flex-col gap-3 rounded-xl border border-amber-300/60 bg-amber-50 p-4 text-sm text-amber-800 sm:flex-row sm:items-center sm:justify-between dark:bg-amber-500/10 dark:text-amber-300">
          <p className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              <span className="font-medium">You left fullscreen.</span> This was logged — tap the button to return.
            </span>
          </p>
          <Button size="sm" onClick={() => proctor.requestFullscreen()}>
            Re-enter fullscreen
          </Button>
        </div>
      ) : null}
      <div className="mb-4 flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="truncate font-semibold">{exam.title}</p>
          <p className="text-xs text-muted-foreground">
            Question {currentIndex + 1} of {questions.length}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className={cn('flex items-center gap-2 rounded-lg border px-3 py-1.5', timerTone)}>
            <Timer className="h-4 w-4" />
            <span className="font-mono text-lg font-bold tabular-nums">{formatClock(remainingSeconds)}</span>
          </div>
          <RiskBadge level={proctor.level} points={proctor.risk} />
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Save className={cn('h-3.5 w-3.5', saveStatus === 'saved' && 'text-emerald-500')} />
            {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : saveStatus === 'error' ? 'Retrying…' : 'Ready'}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardContent className="p-5">
              <div className="mb-4 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant={(currentQuestion.question_type ?? 'multiple_choice') === 'essay' ? 'info' : 'secondary'}>
                    {(currentQuestion.question_type ?? 'multiple_choice') === 'essay' ? 'Essay' : 'Multiple choice'}
                  </Badge>
                  <Badge variant={currentQuestion.difficulty === 'easy' ? 'success' : currentQuestion.difficulty === 'hard' ? 'destructive' : 'warning'}>
                    {currentQuestion.difficulty}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{currentQuestion.points} pt{currentQuestion.points !== 1 ? 's' : ''}</span>
                  {currentQuestion.category ? <Badge variant="secondary">{currentQuestion.category}</Badge> : null}
                </div>
              </div>

              <p className="text-lg font-medium leading-relaxed">{currentQuestion.content}</p>

              {(currentQuestion.question_type ?? 'multiple_choice') === 'essay' ? (
                <EssayAnswer
                  value={answers[currentQuestion.question_id] ?? ''}
                  minWords={currentQuestion.min_words ?? 0}
                  maxWords={currentQuestion.max_words ?? null}
                  onChange={handleEssayChange}
                />
              ) : (
              <div className="mt-5 space-y-2.5">
                {currentQuestion.choices.map((choice) => (
                  <AnswerOption
                    key={choice.id}
                    choice={choice}
                    selected={answers[currentQuestion.question_id] === choice.id}
                    onSelect={handleSelect}
                  />
                ))}
              </div>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="outline" onClick={() => goTo(Math.max(0, currentIndex - 1))} disabled={currentIndex === 0 || phase === 'submitting'}>
              <ArrowLeft className="h-4 w-4" />
              Previous
            </Button>
            <Button variant="outline" onClick={toggleFlag} className={flaggedSet.has(currentQuestion.question_id) ? 'border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300' : ''}>
              <Flag className="h-4 w-4" />
              {flaggedSet.has(currentQuestion.question_id) ? 'Unflag' : 'Flag for review'}
            </Button>
            <Button variant="outline" onClick={() => goTo(Math.min(questions.length - 1, currentIndex + 1))} disabled={currentIndex === questions.length - 1 || phase === 'submitting'}>
              Next
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <aside className="space-y-4">
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Progress</span>
                  <span>
                    {answeredCount}/{questions.length} answered
                  </span>
                </div>
                <Progress value={progressPercent} />
              </div>

              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded border border-sky-400 bg-sky-100 dark:bg-sky-500/20" /> Answered
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded border border-amber-400 ring-1 ring-amber-400" /> Flagged
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded border bg-primary" /> Current
                </span>
              </div>

              <QuestionPalette
                count={questions.length}
                currentIndex={currentIndex}
                answered={answeredIds}
                flagged={flaggedSet}
                questionIds={questions.map((q) => q.question_id)}
                onSelect={goTo}
              />

              <Button className="w-full" onClick={() => setConfirmSubmit(true)} disabled={phase === 'submitting'}>
                {phase === 'submitting' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Submit exam
              </Button>
            </CardContent>
          </Card>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmSubmit}
        onOpenChange={setConfirmSubmit}
        title="Submit exam?"
        description={`You have answered ${answeredCount} of ${questions.length} questions. After submitting you can no longer change your answers.`}
        confirmLabel="Submit now"
        onConfirm={() => {
          setConfirmSubmit(false)
          void doSubmit()
        }}
        loading={phase === 'submitting'}
      />
    </div>
  )
}

function EssayAnswer({ value, minWords, maxWords, onChange }: { value: string; minWords: number; maxWords: number | null; onChange: (text: string) => void }) {
  const words = countWords(value)
  const underMin = minWords > 0 && words < minWords
  const overMax = maxWords != null && maxWords > 0 && words > maxWords
  return (
    <div className="mt-5 space-y-2">
      <Textarea
        rows={10}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Write your answer here…"
        className="min-h-[220px] leading-relaxed"
      />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className={underMin || overMax ? 'font-medium text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}>
          {words} word{words === 1 ? '' : 's'}
          {minWords > 0 ? ` · minimum ${minWords}` : ''}
          {maxWords != null && maxWords > 0 ? ` · maximum ${maxWords}` : ''}
        </span>
        <span className="text-muted-foreground">Saved automatically as you type</span>
      </div>
      {underMin ? (
        <p className="text-xs text-amber-600 dark:text-amber-400">You need {minWords - words} more word{minWords - words === 1 ? '' : 's'} to reach the minimum.</p>
      ) : null}
      {overMax ? (
        <p className="text-xs text-rose-600 dark:text-rose-400">Over the maximum by {words - (maxWords ?? 0)} words. Consider shortening your answer.</p>
      ) : null}
    </div>
  )
}

function InstructionTile({ icon: Icon, label, value }: { icon: typeof Timer; label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background p-3 text-center">
      <Icon className="mx-auto mb-1.5 h-4 w-4 text-primary" />
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  )
}

function ExamPageLoading() {
  return (
    <div className="mx-auto flex max-w-2xl items-center justify-center py-24">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  )
}
