type TodoItem = {
  id: string
  text: string
  done: boolean
  createdAt: number
}

type InitProductivityOptions = {
  vibrate: () => void
}

type TimerState = {
  id: string
  durationMs: number
  running: boolean
  targetTs: number | null
  remainingMs: number
  createdAt: number
}

type CountdownState = {
  id: string
  running: boolean
  targetTs: number | null
  remainingMs: number
  inputTarget: string
  createdAt: number
}

const TODOS_KEY = 'bnkr:productivity:todos'
const TIMERS_KEY = 'bnkr:productivity:timers'
const COUNTDOWNS_KEY = 'bnkr:productivity:countdowns'

const byId = <T extends HTMLElement>(id: string): T | null => document.querySelector<T>(`#${id}`)

const formatTime = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const hh = String(hours).padStart(2, '0')
  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

const parseJson = <T>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

const saveTodos = (todos: TodoItem[]) => localStorage.setItem(TODOS_KEY, JSON.stringify(todos))
const loadTodos = (): TodoItem[] => parseJson<TodoItem[]>(localStorage.getItem(TODOS_KEY), [])

const saveTimers = (timers: TimerState[]) => localStorage.setItem(TIMERS_KEY, JSON.stringify(timers))
const loadTimers = (): TimerState[] => parseJson<TimerState[]>(localStorage.getItem(TIMERS_KEY), [])

const saveCountdowns = (countdowns: CountdownState[]) => localStorage.setItem(COUNTDOWNS_KEY, JSON.stringify(countdowns))
const loadCountdowns = (): CountdownState[] => parseJson<CountdownState[]>(localStorage.getItem(COUNTDOWNS_KEY), [])

const isIosDevice = () => /iPad|iPhone|iPod/.test(navigator.userAgent)

const platformNotificationHint = (): string => {
  const secureContextHint = window.isSecureContext ? '' : ' Use HTTPS to enable notifications.'

  if (isIosDevice()) {
    const standalone = window.matchMedia('(display-mode: standalone)').matches ||
      ('standalone' in navigator && (navigator as Navigator & { standalone?: boolean }).standalone === true)
    if (!standalone) {
      return `iOS requires Add to Home Screen for notifications.${secureContextHint}`
    }
  }

  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return `Push API is limited in this browser.${secureContextHint}`
  }

  return `Ready for notifications.${secureContextHint}`
}

const showLocalNotification = async (title: string, body: string) => {
  if (!('Notification' in window) || Notification.permission !== 'granted') return

  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.ready
      await registration.showNotification(title, {
        body,
        badge: '/web-app-manifest-192x192.png',
        icon: '/web-app-manifest-192x192.png',
        tag: `bnkr-${title}`,
      })
      return
    }
  } catch {
    // Fall through to direct notifications.
  }

  try {
    // Fallback for browsers without active SW notification support.
    new Notification(title, { body })
  } catch {
    // Ignore unsupported notification constructors.
  }
}

export const initProductivityFeature = ({ vibrate }: InitProductivityOptions): void => {
  const todoInput = byId<HTMLInputElement>('todo-input')
  const todoAddBtn = byId<HTMLButtonElement>('todo-add-btn')
  const todoList = byId<HTMLElement>('todo-list')
  const todoEmpty = byId<HTMLElement>('todo-empty')
  const homeTodoPreview = byId<HTMLElement>('home-todo-preview')
  const homeRunningTimersPreview = byId<HTMLElement>('home-running-timers-preview')
  const homeRunningCountdownsPreview = byId<HTMLElement>('home-running-countdowns-preview')

  const timerInput = byId<HTMLInputElement>('timer-minutes')
  const timerAddBtn = byId<HTMLButtonElement>('timer-add-btn')
  const timerList = byId<HTMLElement>('timer-list')
  const timerEmpty = byId<HTMLElement>('timer-empty')

  const countdownInput = byId<HTMLInputElement>('countdown-target')
  const countdownAddBtn = byId<HTMLButtonElement>('countdown-add-btn')
  const countdownList = byId<HTMLElement>('countdown-list')
  const countdownEmpty = byId<HTMLElement>('countdown-empty')

  const notifStatus = byId<HTMLElement>('notif-status')
  const notifHint = byId<HTMLElement>('notif-hint')
  const notifEnable = byId<HTMLButtonElement>('notif-enable-btn')
  const notifTest = byId<HTMLButtonElement>('notif-test-btn')

  if (
    !todoInput || !todoAddBtn || !todoList || !todoEmpty ||
    !timerInput || !timerAddBtn || !timerList || !timerEmpty ||
    !countdownInput || !countdownAddBtn || !countdownList || !countdownEmpty ||
    !notifStatus || !notifHint || !notifEnable || !notifTest
  ) {
    return
  }

  let todos = loadTodos()
  let timers = loadTimers()
  let countdowns = loadCountdowns()
  let reminderPermissionPrompted = false

  const ensureReminderNotificationPermission = async () => {
    if (reminderPermissionPrompted) return
    if (!('Notification' in window)) return
    if (Notification.permission !== 'default') return
    reminderPermissionPrompted = true

    try {
      await Notification.requestPermission()
      updateNotificationUi()
    } catch {
      // Ignore request failures and continue without reminders.
    }
  }

  const notifyCountdownOrTimerDone = async (kind: 'Timer' | 'Countdown', id: string) => {
    const title = `${kind} complete`
    const body = `${kind} ${id.slice(0, 6).toUpperCase()} has finished.`
    await showLocalNotification(title, body)
  }

  const renderHomeList = (target: HTMLElement | null, rows: Array<{ label: string; time?: string }>, emptyLabel: string) => {
    if (!target) return
    if (rows.length === 0) {
      target.innerHTML = `<p class="home-preview-empty">${emptyLabel}</p>`
      return
    }

    target.innerHTML = `
      <ul class="home-mini-list">
        ${rows.map((row) => `
          <li class="home-mini-item">
            <span class="home-mini-text">${row.label}</span>
            ${row.time ? `<span class="home-mini-time">${row.time}</span>` : ''}
          </li>
        `).join('')}
      </ul>
    `
  }

  const renderTodos = () => {
    if (todos.length === 0) {
      todoEmpty.hidden = false
      todoList.innerHTML = ''
      renderHomeList(homeTodoPreview, [], 'No pending todos.')
      return
    }

    todoEmpty.hidden = true
    todoList.innerHTML = todos
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((todo) => `
        <li class="todo-item${todo.done ? ' is-done' : ''}" data-todo-id="${todo.id}">
          <button type="button" class="todo-toggle" data-todo-toggle="${todo.id}" aria-label="Toggle todo">
            <span class="material-symbols-rounded" aria-hidden="true">${todo.done ? 'check_circle' : 'radio_button_unchecked'}</span>
          </button>
          <span class="todo-text">${todo.text.replace(/[&<>\"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c))}</span>
          <button type="button" class="todo-remove" data-todo-remove="${todo.id}" aria-label="Delete todo">
            <span class="material-symbols-rounded" aria-hidden="true">delete</span>
          </button>
        </li>
      `)
      .join('')

    const pendingTodos = todos
      .filter((todo) => !todo.done)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 4)
      .map((todo) => ({ label: todo.text }))
    renderHomeList(homeTodoPreview, pendingTodos, 'No pending todos.')
  }

  const timerNow = (timer: TimerState) => {
    if (!timer.running || timer.targetTs === null) return timer.remainingMs
    return Math.max(0, timer.targetTs - Date.now())
  }

  const countdownNow = (countdown: CountdownState) => {
    if (!countdown.running || countdown.targetTs === null) return countdown.remainingMs
    return Math.max(0, countdown.targetTs - Date.now())
  }

  const renderTimers = () => {
    if (timers.length === 0) {
      timerEmpty.hidden = false
      timerList.innerHTML = ''
    } else {
      timerEmpty.hidden = true
      timerList.innerHTML = timers
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((timer) => {
          const remaining = timerNow(timer)
          const stateLabel = timer.running ? 'Running' : remaining > 0 ? 'Paused' : 'Done'
          return `
            <li class="timer-item" data-timer-id="${timer.id}">
              <div class="timer-item-top">
                <span class="timer-item-label">${stateLabel} • ${Math.round(timer.durationMs / 60000 * 10) / 10}m</span>
                <span class="timer-item-time">${formatTime(remaining)}</span>
              </div>
              <div class="timer-item-actions">
                <button type="button" class="action-btn action-btn--ghost" data-timer-action="start" data-timer-id="${timer.id}">Start</button>
                <button type="button" class="action-btn action-btn--ghost" data-timer-action="pause" data-timer-id="${timer.id}">Pause</button>
                <button type="button" class="action-btn action-btn--ghost" data-timer-action="reset" data-timer-id="${timer.id}">Reset</button>
                <button type="button" class="action-btn action-btn--ghost" data-timer-action="delete" data-timer-id="${timer.id}">Delete</button>
              </div>
            </li>
          `
        }).join('')
    }

    const runningRows = timers
      .filter((timer) => timer.running)
      .sort((a, b) => timerNow(a) - timerNow(b))
      .slice(0, 4)
      .map((timer) => ({ label: `Timer ${Math.round(timer.durationMs / 60000 * 10) / 10}m`, time: formatTime(timerNow(timer)) }))
    renderHomeList(homeRunningTimersPreview, runningRows, 'No running timers.')
  }

  const renderCountdowns = () => {
    if (countdowns.length === 0) {
      countdownEmpty.hidden = false
      countdownList.innerHTML = ''
      renderHomeList(homeRunningCountdownsPreview, [], 'No running countdowns.')
      return
    }

    countdownEmpty.hidden = true
    countdownList.innerHTML = countdowns
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((countdown) => {
        const remaining = countdownNow(countdown)
        const stateLabel = countdown.running ? 'Running' : remaining > 0 ? 'Paused' : 'Done'
        return `
          <li class="countdown-item" data-countdown-id="${countdown.id}">
            <div class="countdown-item-top">
              <span class="countdown-item-label">${stateLabel} • ${countdown.inputTarget || 'Target set'}</span>
              <span class="countdown-item-time">${formatTime(remaining)}</span>
            </div>
            <div class="countdown-item-actions">
              <button type="button" class="action-btn action-btn--ghost" data-countdown-action="start" data-countdown-id="${countdown.id}">Start</button>
              <button type="button" class="action-btn action-btn--ghost" data-countdown-action="pause" data-countdown-id="${countdown.id}">Pause</button>
              <button type="button" class="action-btn action-btn--ghost" data-countdown-action="reset" data-countdown-id="${countdown.id}">Reset</button>
              <button type="button" class="action-btn action-btn--ghost" data-countdown-action="delete" data-countdown-id="${countdown.id}">Delete</button>
            </div>
          </li>
        `
      }).join('')

    const runningRows = countdowns
      .filter((countdown) => countdown.running)
      .sort((a, b) => countdownNow(a) - countdownNow(b))
      .slice(0, 4)
      .map((countdown) => ({ label: countdown.inputTarget ? `To ${countdown.inputTarget}` : 'Countdown', time: formatTime(countdownNow(countdown)) }))
    renderHomeList(homeRunningCountdownsPreview, runningRows, 'No running countdowns.')
  }

  const updateNotificationUi = () => {
    if (!('Notification' in window)) {
      notifStatus.textContent = 'Notifications are not supported on this browser.'
      notifEnable.disabled = true
      notifTest.disabled = true
      notifHint.textContent = platformNotificationHint()
      return
    }

    const permission = Notification.permission
    notifStatus.textContent = permission === 'granted'
      ? 'Notifications enabled.'
      : permission === 'denied'
        ? 'Notifications blocked. Enable in browser settings.'
        : 'Notifications not enabled yet.'

    notifEnable.disabled = permission === 'granted'
    notifEnable.textContent = permission === 'granted' ? 'Notifications Enabled' : 'Enable Notifications'
    notifTest.disabled = permission !== 'granted'
    notifHint.textContent = platformNotificationHint()
  }

  const requestNotificationPermission = async () => {
    if (!('Notification' in window)) {
      updateNotificationUi()
      return
    }

    const result = await Notification.requestPermission()
    if (result === 'granted') {
      await showLocalNotification('BNKR notifications enabled', 'You will get alerts for countdown and timer milestones.')
    }

    updateNotificationUi()
  }

  const addTodo = () => {
    const text = todoInput.value.trim()
    if (!text) return

    todos.push({
      id: crypto.randomUUID(),
      text,
      done: false,
      createdAt: Date.now(),
    })

    saveTodos(todos)
    todoInput.value = ''
    renderTodos()
    vibrate()
  }

  const addTimer = () => {
    const enteredMinutes = Number.parseFloat(timerInput.value)
    const startMs = Math.max(0, Math.floor(enteredMinutes * 60_000))

    if (startMs <= 0) return

    timers.push({
      id: crypto.randomUUID(),
      durationMs: startMs,
      running: true,
      targetTs: Date.now() + startMs,
      remainingMs: startMs,
      createdAt: Date.now(),
    })
    timerInput.value = ''
    saveTimers(timers)
    renderTimers()
    vibrate()
    void ensureReminderNotificationPermission()
  }

  const setTimerAction = (id: string, action: 'start' | 'pause' | 'reset' | 'delete') => {
    const timer = timers.find((item) => item.id === id)
    if (!timer) return

    if (action === 'delete') {
      timers = timers.filter((item) => item.id !== id)
    } else if (action === 'start') {
      if (!timer.running && timer.remainingMs > 0) {
        timer.running = true
        timer.targetTs = Date.now() + timer.remainingMs
      }
    } else if (action === 'pause') {
      if (timer.running && timer.targetTs !== null) {
        timer.remainingMs = Math.max(0, timer.targetTs - Date.now())
        timer.running = false
        timer.targetTs = null
      }
    } else if (action === 'reset') {
      timer.running = false
      timer.targetTs = null
      timer.remainingMs = timer.durationMs
    }

    saveTimers(timers)
    renderTimers()
    vibrate()
    if (action === 'start') void ensureReminderNotificationPermission()
  }

  const addCountdown = () => {
    const targetRaw = countdownInput.value
    const targetTs = targetRaw ? new Date(targetRaw).getTime() : NaN
    if (!Number.isFinite(targetTs)) return
    const startMs = Math.max(0, targetTs - Date.now())
    if (startMs <= 0) return

    countdowns.push({
      id: crypto.randomUUID(),
      running: true,
      targetTs,
      remainingMs: startMs,
      inputTarget: targetRaw,
      createdAt: Date.now(),
    })
    countdownInput.value = ''
    saveCountdowns(countdowns)
    renderCountdowns()
    vibrate()
    void ensureReminderNotificationPermission()
  }

  const setCountdownAction = (id: string, action: 'start' | 'pause' | 'reset' | 'delete') => {
    const countdown = countdowns.find((item) => item.id === id)
    if (!countdown) return

    if (action === 'delete') {
      countdowns = countdowns.filter((item) => item.id !== id)
    } else if (action === 'start') {
      if (!countdown.running && countdown.remainingMs > 0) {
        countdown.running = true
        countdown.targetTs = Date.now() + countdown.remainingMs
      }
    } else if (action === 'pause') {
      if (countdown.running && countdown.targetTs !== null) {
        countdown.remainingMs = Math.max(0, countdown.targetTs - Date.now())
        countdown.running = false
        countdown.targetTs = null
      }
    } else if (action === 'reset') {
      countdown.running = false
      countdown.targetTs = null
      countdown.remainingMs = 0
    }

    saveCountdowns(countdowns)
    renderCountdowns()
    vibrate()
    if (action === 'start') void ensureReminderNotificationPermission()
  }

  todoAddBtn.addEventListener('click', addTodo)
  todoInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    addTodo()
  })

  todoList.addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    const toggleBtn = target.closest<HTMLButtonElement>('[data-todo-toggle]')
    const removeBtn = target.closest<HTMLButtonElement>('[data-todo-remove]')

    if (toggleBtn) {
      const id = toggleBtn.dataset.todoToggle
      if (!id) return
      todos = todos.map((todo) => (todo.id === id ? { ...todo, done: !todo.done } : todo))
      saveTodos(todos)
      renderTodos()
      vibrate()
      return
    }

    if (removeBtn) {
      const id = removeBtn.dataset.todoRemove
      if (!id) return
      todos = todos.filter((todo) => todo.id !== id)
      saveTodos(todos)
      renderTodos()
      vibrate()
    }
  })

  timerAddBtn.addEventListener('click', addTimer)
  timerInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    addTimer()
  })

  timerList.addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    const actionBtn = target.closest<HTMLButtonElement>('[data-timer-action]')
    if (!actionBtn) return
    const id = actionBtn.dataset.timerId
    const action = actionBtn.dataset.timerAction as 'start' | 'pause' | 'reset' | 'delete' | undefined
    if (!id || !action) return
    setTimerAction(id, action)
  })

  countdownAddBtn.addEventListener('click', addCountdown)
  countdownInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    addCountdown()
  })

  countdownList.addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    const actionBtn = target.closest<HTMLButtonElement>('[data-countdown-action]')
    if (!actionBtn) return
    const id = actionBtn.dataset.countdownId
    const action = actionBtn.dataset.countdownAction as 'start' | 'pause' | 'reset' | 'delete' | undefined
    if (!id || !action) return
    setCountdownAction(id, action)
  })

  notifEnable.addEventListener('click', () => {
    void requestNotificationPermission()
  })

  notifTest.addEventListener('click', () => {
    void showLocalNotification('BNKR test notification', 'Notifications are working on this device.')
  })

  renderTodos()
  renderTimers()
  renderCountdowns()
  updateNotificationUi()

  window.setInterval(() => {
    let timersChanged = false
    timers = timers.map((timer) => {
      if (!timer.running || timer.targetTs === null) return timer
      const remaining = Math.max(0, timer.targetTs - Date.now())
      if (remaining > 0) {
        if (remaining !== timer.remainingMs) {
          timersChanged = true
          return { ...timer, remainingMs: remaining }
        }
        return timer
      }

      timersChanged = true
      vibrate()
      void notifyCountdownOrTimerDone('Timer', timer.id)
      return { ...timer, running: false, targetTs: null, remainingMs: 0 }
    })

    if (timersChanged) {
      saveTimers(timers)
    }
    renderTimers()

    let countdownsChanged = false
    countdowns = countdowns.map((countdown) => {
      if (!countdown.running || countdown.targetTs === null) return countdown
      const remaining = Math.max(0, countdown.targetTs - Date.now())
      if (remaining > 0) {
        if (remaining !== countdown.remainingMs) {
          countdownsChanged = true
          return { ...countdown, remainingMs: remaining }
        }
        return countdown
      }

      countdownsChanged = true
      vibrate()
      void notifyCountdownOrTimerDone('Countdown', countdown.id)
      return { ...countdown, running: false, targetTs: null, remainingMs: 0 }
    })

    if (countdownsChanged) {
      saveCountdowns(countdowns)
    }
    renderCountdowns()
  }, 250)
}
