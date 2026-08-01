import type { ActivityEventType, RiskLevel } from '@/lib/types'

/** Risk points assigned per activity event type. */
export const EVENT_POINTS: Record<ActivityEventType, number> = {
  tab_switch: 10,
  window_blur: 5,
  fullscreen_exit: 15,
  copy_attempt: 20,
  paste_attempt: 20,
  cut_attempt: 15,
  right_click: 5,
  selection_attempt: 5,
  devtools: 25,
  refresh_attempt: 15,
  navigate_attempt: 10,
  find_attempt: 10,
  print_attempt: 15,
  save_attempt: 15,
  zoom_attempt: 5,
  new_tab: 10,
  idle: 10,
  started: 0,
  submitted: 0,
  time_up: 0,
  warning: 5,
}

export const EVENT_LABELS: Record<ActivityEventType, string> = {
  tab_switch: 'Tab switch',
  window_blur: 'Window blur',
  fullscreen_exit: 'Fullscreen exit',
  copy_attempt: 'Copy attempt',
  paste_attempt: 'Paste attempt',
  cut_attempt: 'Cut attempt',
  right_click: 'Right-click',
  selection_attempt: 'Text selection',
  devtools: 'DevTools shortcut',
  refresh_attempt: 'Refresh attempt',
  navigate_attempt: 'Back/forward nav',
  find_attempt: 'Find on page',
  print_attempt: 'Print shortcut',
  save_attempt: 'Save page',
  zoom_attempt: 'Zoom shortcut',
  new_tab: 'New tab/window',
  idle: 'Idle (3 min)',
  started: 'Started',
  submitted: 'Submitted',
  time_up: 'Time expired',
  warning: 'Warning',
}

export function riskLevel(points: number): RiskLevel {
  if (points >= 80) return 'high'
  if (points >= 40) return 'medium'
  return 'low'
}

export const RISK_THRESHOLDS = { medium: 40, high: 80 } as const

export interface RiskBreakdown {
  total: number
  level: RiskLevel
  counts: Record<Exclude<ActivityEventType, 'started' | 'submitted' | 'time_up'>, number>
  idleSeconds: number
}

export function computeRisk(events: { event_type: ActivityEventType; risk_points: number; meta?: unknown }[]): RiskBreakdown {
  const counts: RiskBreakdown['counts'] = {
    tab_switch: 0,
    window_blur: 0,
    fullscreen_exit: 0,
    copy_attempt: 0,
    paste_attempt: 0,
    cut_attempt: 0,
    right_click: 0,
    selection_attempt: 0,
    devtools: 0,
    refresh_attempt: 0,
    navigate_attempt: 0,
    find_attempt: 0,
    print_attempt: 0,
    save_attempt: 0,
    zoom_attempt: 0,
    new_tab: 0,
    idle: 0,
    warning: 0,
  }

  let total = 0
  let idleSeconds = 0

  for (const event of events) {
    if (event.event_type in counts) {
      counts[event.event_type as keyof RiskBreakdown['counts']] += 1
    }
    total += event.risk_points
    if (event.event_type === 'idle' && event.meta) {
      const secs = Number((event.meta as { seconds?: number }).seconds ?? 0)
      idleSeconds += secs
    }
  }

  return { total, level: riskLevel(total), counts, idleSeconds }
}
