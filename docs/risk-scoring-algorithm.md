# Risk scoring algorithm & proctoring metrics

The proctoring engine is a **weighted point-based risk scoring algorithm**. Each detected incident adds a fixed number of points; the running total maps to a risk level. Points are enforced server-side so students cannot under-report.

## Algorithm summary

```
for each detected incident (tab switch, copy, devtools, …):
    event_type   = classify(incident)          # client
    points       = EVENT_POINTS[event_type]    # server-side lookup
    total        = risk_scores.total_points + points
    level        = riskLevel(total)
    risk_scores  ← update row                  # per-type counter + total + level
    student_exams.risk_score ← total           # mirrored in same transaction
```

The **client only reports the event type**; the server independently looks up the point value in `fn_log_event` (`CASE p_event_type ...`). A malicious client cannot choose a lower point value.

## Event metrics table

`EVENT_POINTS` (`src/lib/risk.ts`) mirrors the server `CASE` in `fn_log_event`:

| Event type | Points | Detection basis (client) |
|---|---|---|
| `devtools` | **25** | `keydown`: F12, Ctrl+Shift+I/J/C, Ctrl+U |
| `copy_attempt` | **20** | `copy` event + `keydown` Ctrl+C |
| `paste_attempt` | **20** | `paste` event + `keydown` Ctrl+V |
| `fullscreen_exit` | **15** | `fullscreenchange` leaving fullscreen |
| `cut_attempt` | **15** | `cut` event + `keydown` Ctrl+X |
| `refresh_attempt` | **15** | `keydown`: F5, Ctrl+R |
| `print_attempt` | **15** | `keydown`: Ctrl+P |
| `save_attempt` | **15** | `keydown`: Ctrl+S |
| `tab_switch` | **10** | `visibilitychange` → hidden |
| `navigate_attempt` | **10** | `keydown`: Alt+← / Alt+→ / Backspace (outside inputs) |
| `find_attempt` | **10** | `keydown`: Ctrl+F |
| `new_tab` | **10** | `keydown`: Ctrl+T / Ctrl+N / Ctrl+W |
| `idle` | **10** | no activity for `IDLE_TIMEOUT_MS` (3 min) |
| `window_blur` | **5** | `blur` on window |
| `right_click` | **5** | `contextmenu` |
| `selection_attempt` | **5** | `selectstart` + `keydown` Ctrl+A |
| `zoom_attempt` | **5** | `keydown`: Ctrl+Plus / Ctrl+Minus / Ctrl+0 |
| `warning` | **5** | fullscreen request blocked, etc. |
| `started` / `submitted` / `time_up` | **0** | lifecycle events, informational only |

> Keyboard detection: `use-proctoring.ts` normalizes `e.key`, checks modifiers (`ctrlKey`, `shiftKey`, `altKey`), and ignores Backspace/typing inside `INPUT`/`TEXTAREA`/`SELECT`/contenteditable to avoid false positives. Blocked actions call `preventDefault()`.

## Risk level thresholds

```
riskLevel(points):
    points >= 80  → 'high'
    points >= 40  → 'medium'
    else          → 'low'
```

(`RISK_THRESHOLDS = { medium: 40, high: 80 }`)

### Worked example

| Incident sequence | Points | Running total | Level |
|---|---|---|---|
| (start) | — | 0 | low |
| tab switch | 10 | 10 | low |
| fullscreen exit | 15 | 25 | low |
| copy attempt | 20 | 45 | **medium** |
| tab switch | 10 | 55 | medium |
| devtools (F12) | 25 | 80 | **high** |

## Client accumulation (`use-proctoring.ts`)

- `record(eventType, meta)`:
  1. increments the per-type counter in `countsRef`
  2. `setRisk(prev => prev + points)` for the live UI badge
  3. pushes `{ event_type, meta }` to an in-memory queue
  4. persists the queue to `localStorage` (`safe_exam.pending_events.<studentExamId>`)
  5. triggers `flush()` and calls the optional `onViolation` callback (student toast)

- **Reliable delivery:** events are batched and flushed to `fn_log_event`. If a flush fails, events are re-queued and retried after 3s. The localStorage queue survives a hard refresh, so a refresh/tab-switch incident itself is not lost.

- **Idle detection:** `mousemove/keydown/mousedown/touchstart/wheel` bump `lastActivityRef`; a 30s interval fires `idle` after 3 minutes of no activity, recording the seconds via `meta.seconds`.

## Server storage (`fn_log_event` → `risk_scores`)

On each event the server:

1. Inserts an append-only row into `activity_logs` with the server-assigned `risk_points`.
2. UPSERTs `risk_scores` (unique on `student_exam_id`):
   - `total_points += points`
   - `level = fn_risk_level(total_points)`
   - increments the matching per-type counter (`tab_switches`, `copy_attempts`, `devtools_attempts`, `refresh_attempts`, `navigate_attempts`, `find_attempts`, `print_attempts`, `save_attempts`, `zoom_attempts`, `new_tab_attempts`, `idle_events`, …)
   - `idle_seconds += meta.seconds` (idle only)
3. Mirrors `total_points` onto `student_exams.risk_score` and refreshes `last_active_at`.

## Derived metrics

### Live "online" status (monitor)

```
online = status == 'in_progress'
         AND is_online == true
         AND (now - last_active_at) <= ONLINE_WINDOW_MS   # 45 000 ms
```

`ONLINE_WINDOW_MS` constant in `src/pages/teacher/monitor.tsx`; the teacher dashboard uses the same 45s window.

### Incidents count (results page)

```
incidents = tab_switches + fullscreen_exits + copy_attempts + paste_attempts
          + cut_attempts + devtools_attempts + refresh_attempts + navigate_attempts
          + find_attempts + print_attempts + save_attempts + zoom_attempts
          + new_tab_attempts + idle_events
```

### Risk breakdown (`computeRisk`)

Given a list of logged events, recomputes `{ total, level, counts, idleSeconds }` for dashboards and detail views.

## Design notes

- **Advisory only** — risk scores never auto-fail a student; they inform the teacher.
- **Weighting is static & hand-tuned** — no ML. Heuristic severity: DevTools/copy/paste are high-weight; blur/right-click/zoom are low-weight.
- **Idempotent counters** — every logged event is counted exactly once; re-pushing the same event by a client is possible but each event still costs points server-side, so flooding only raises the student's own score.
