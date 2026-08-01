import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EVENT_POINTS, riskLevel } from '@/lib/risk'
import type { RiskLevel } from '@/lib/types'
import { studentApi } from '@/api/supabase-api'

export const IDLE_TIMEOUT_MS = 3 * 60 * 1000

export interface RiskCounts {
  tab_switches: number
  fullscreen_exits: number
  copy_attempts: number
  paste_attempts: number
  cut_attempts: number
  devtools_attempts: number
  refresh_attempts: number
  navigate_attempts: number
  find_attempts: number
  print_attempts: number
  save_attempts: number
  zoom_attempts: number
  new_tab_attempts: number
  idle_events: number
  idle_seconds: number
}

interface PendingEvent {
  event_type: string
  meta: Record<string, unknown>
}

interface UseProctoringOptions {
  enabled: boolean
  onViolation?: (eventType: string) => void
}

const initialCounts: RiskCounts = {
  tab_switches: 0,
  fullscreen_exits: 0,
  copy_attempts: 0,
  paste_attempts: 0,
  cut_attempts: 0,
  devtools_attempts: 0,
  refresh_attempts: 0,
  navigate_attempts: 0,
  find_attempts: 0,
  print_attempts: 0,
  save_attempts: 0,
  zoom_attempts: 0,
  new_tab_attempts: 0,
  idle_events: 0,
  idle_seconds: 0,
}

export function useProctoring(studentExamId: string | null, { enabled, onViolation }: UseProctoringOptions) {
  const queueRef = useRef<PendingEvent[]>([])
  const flushingRef = useRef(false)
  const lastActivityRef = useRef(Date.now())
  const countsRef = useRef<RiskCounts>({ ...initialCounts })
  const fullscreenRef = useRef(false)
  const onViolationRef = useRef(onViolation)
  onViolationRef.current = onViolation

  const [risk, setRisk] = useState(0)
  const [counts, setCounts] = useState<RiskCounts>({ ...initialCounts })
  const [lastEvent, setLastEvent] = useState<string | null>(null)

  const queueKey = `safe_exam.pending_events.${studentExamId}`

  // Restore any queued events from a previous session (e.g. hard refresh).
  useEffect(() => {
    if (!studentExamId || !enabled) return
    try {
      const raw = localStorage.getItem(queueKey)
      if (raw) {
        const parsed = JSON.parse(raw) as PendingEvent[]
        if (Array.isArray(parsed)) queueRef.current = parsed
      }
    } catch {
      queueRef.current = []
    }
  }, [queueKey, enabled, studentExamId])

  const persistQueue = useCallback(() => {
    try {
      localStorage.setItem(queueKey, JSON.stringify(queueRef.current))
    } catch {
      /* storage unavailable */
    }
  }, [queueKey])

  const flush = useCallback(async () => {
    if (!studentExamId || flushingRef.current || queueRef.current.length === 0) return
    flushingRef.current = true
    const batch = queueRef.current.splice(0)
    persistQueue()

    for (const event of batch) {
      try {
        await studentApi.logEvent(studentExamId, event.event_type, event.meta)
      } catch {
        queueRef.current.unshift(event)
        break
      }
    }
    persistQueue()
    flushingRef.current = false
    if (queueRef.current.length > 0) {
      window.setTimeout(() => void flush(), 3000)
    }
  }, [studentExamId, persistQueue])

  const record = useCallback(
    (eventType: string, meta: Record<string, unknown> = {}) => {
      if (!enabled || !studentExamId) return

      const points = EVENT_POINTS[eventType as keyof typeof EVENT_POINTS] ?? 0
      if (eventType in countsRef.current) {
        countsRef.current = { ...countsRef.current, [eventType]: countsRef.current[eventType as keyof RiskCounts] + 1 }
        if (eventType === 'idle') {
          countsRef.current.idle_seconds += Math.max(0, Number(meta.seconds ?? 0))
        }
      }

      setCounts({ ...countsRef.current })
      setRisk((prev) => prev + points)
      setLastEvent(eventType)

      queueRef.current.push({ event_type: eventType, meta })
      persistQueue()
      void flush()

      if (onViolationRef.current) onViolationRef.current(eventType)
    },
    [enabled, studentExamId, flush, persistQueue],
  )

  // Idle detection — bumps on any interaction, fires after 3 minutes of none.
  useEffect(() => {
    if (!enabled) return

    const bump = () => {
      lastActivityRef.current = Date.now()
    }
    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'wheel']
    for (const event of events) window.addEventListener(event, bump)

    const idleTimer = window.setInterval(() => {
      const idleFor = Date.now() - lastActivityRef.current
      if (idleFor >= IDLE_TIMEOUT_MS) {
        record('idle', { seconds: Math.floor(idleFor / 1000) })
        lastActivityRef.current = Date.now()
      }
    }, 30000)

    return () => {
      for (const event of events) window.removeEventListener(event, bump)
      window.clearInterval(idleTimer)
    }
  }, [enabled, record])

  // Blocking + detection of copy/paste/cut/selection/right-click/devtools.
  useEffect(() => {
    if (!enabled) return

    const block = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
    }

    const onCopy = (e: ClipboardEvent) => {
      block(e)
      record('copy_attempt')
    }
    const onPaste = (e: ClipboardEvent) => {
      block(e)
      record('paste_attempt')
    }
    const onCut = (e: ClipboardEvent) => {
      block(e)
      record('cut_attempt')
    }
    const onContextMenu = (e: MouseEvent) => {
      block(e)
      record('right_click')
    }
    const onSelectStart = (e: Event) => {
      block(e)
      record('selection_attempt')
    }
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      const target = e.target as HTMLElement | null
      const inField = !!target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

      const isDevtoolsShortcut =
        key === 'f12' ||
        (e.ctrlKey && e.shiftKey && ['i', 'j', 'c'].includes(key)) ||
        (e.ctrlKey && ['u'].includes(key))
      const isCopy = e.ctrlKey && !e.shiftKey && !e.altKey && key === 'c'
      const isPaste = e.ctrlKey && !e.shiftKey && !e.altKey && key === 'v'
      const isCut = e.ctrlKey && !e.shiftKey && !e.altKey && key === 'x'
      const isSelectAll = e.ctrlKey && !e.shiftKey && !e.altKey && key === 'a'
      const isRefresh = key === 'f5' || (e.ctrlKey && !e.altKey && key === 'r')
      const isBackForward = (e.altKey && (key === 'arrowleft' || key === 'arrowright')) || (!inField && key === 'backspace')
      const isFind = e.ctrlKey && !e.shiftKey && !e.altKey && key === 'f'
      const isPrint = e.ctrlKey && !e.shiftKey && !e.altKey && key === 'p'
      const isSave = e.ctrlKey && !e.shiftKey && !e.altKey && key === 's'
      const isZoom = e.ctrlKey && ['=', '+', '-', '0'].includes(key)
      const isNewTab = e.ctrlKey && ['t', 'n', 'w'].includes(key)

      if (isDevtoolsShortcut) {
        e.preventDefault()
        record('devtools')
      } else if (isCopy) {
        e.preventDefault()
        record('copy_attempt')
      } else if (isPaste) {
        e.preventDefault()
        record('paste_attempt')
      } else if (isCut) {
        e.preventDefault()
        record('cut_attempt')
      } else if (isSelectAll) {
        e.preventDefault()
        record('selection_attempt')
      } else if (isRefresh) {
        e.preventDefault()
        record('refresh_attempt', { keys: e.ctrlKey ? 'Ctrl+R' : 'F5' })
      } else if (isBackForward) {
        e.preventDefault()
        record('navigate_attempt', { keys: e.altKey ? (key === 'arrowleft' ? 'Alt+Left' : 'Alt+Right') : 'Backspace' })
      } else if (isFind) {
        e.preventDefault()
        record('find_attempt', { keys: 'Ctrl+F' })
      } else if (isPrint) {
        e.preventDefault()
        record('print_attempt', { keys: 'Ctrl+P' })
      } else if (isSave) {
        e.preventDefault()
        record('save_attempt', { keys: 'Ctrl+S' })
      } else if (isZoom) {
        e.preventDefault()
        record('zoom_attempt', { keys: `Ctrl+${key === '=' || key === '+' ? '+' : key}` })
      } else if (isNewTab) {
        e.preventDefault()
        record('new_tab', { keys: `Ctrl+${key === 'w' ? 'W' : key.toUpperCase()}` })
      }
    }

    document.addEventListener('copy', onCopy, true)
    document.addEventListener('paste', onPaste, true)
    document.addEventListener('cut', onCut, true)
    document.addEventListener('contextmenu', onContextMenu, true)
    document.addEventListener('selectstart', onSelectStart, true)
    document.addEventListener('keydown', onKeyDown, true)

    return () => {
      document.removeEventListener('copy', onCopy, true)
      document.removeEventListener('paste', onPaste, true)
      document.removeEventListener('cut', onCut, true)
      document.removeEventListener('contextmenu', onContextMenu, true)
      document.removeEventListener('selectstart', onSelectStart, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [enabled, record])

  // Tab switching.
  useEffect(() => {
    if (!enabled) return
    const onVisibility = () => {
      if (document.hidden) record('tab_switch', { at: new Date().toISOString() })
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [enabled, record])

  // Window blur.
  useEffect(() => {
    if (!enabled) return
    const onBlur = () => record('window_blur')
    const onFocus = () => {
      lastActivityRef.current = Date.now()
    }
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
    }
  }, [enabled, record])

  // Fullscreen exit.
  useEffect(() => {
    if (!enabled) return
    fullscreenRef.current = Boolean(document.fullscreenElement)
    const onFullscreenChange = () => {
      const isFullscreen = Boolean(document.fullscreenElement)
      if (fullscreenRef.current && !isFullscreen) {
        record('fullscreen_exit', { at: new Date().toISOString() })
      }
      fullscreenRef.current = isFullscreen
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [enabled, record])

  const requestFullscreen = useCallback(() => {
    if (document.fullscreenElement) return
    document.documentElement.requestFullscreen?.().catch(() => {
      record('warning', { message: 'Fullscreen request blocked' })
    })
  }, [record])

  const flushAndExit = useCallback(() => {
    void flush()
  }, [flush])

  return useMemo(
    () => ({
      risk,
      counts,
      level: riskLevel(risk) as RiskLevel,
      lastEvent,
      record,
      flush: flushAndExit,
      requestFullscreen,
    }),
    [risk, counts, lastEvent, record, flushAndExit, requestFullscreen],
  )
}
