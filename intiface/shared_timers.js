const NAME = "intiface-connect"
let timerState = {
  worker: null,
  timers: new Map(),
  timerId: 0,
  isRunning: false,
  tickIntervalMs: 25,
  requireWorkerTimeout: false,
}

export function initTimerWorker({ workerFile = "background-worker.js", tickIntervalMs = 25, requireWorkerTimeout = false } = {}) {
  timerState.tickIntervalMs = tickIntervalMs
  timerState.requireWorkerTimeout = requireWorkerTimeout

  try {
    const workerUrl = new URL(workerFile, import.meta.url).href
    timerState.worker = new Worker(workerUrl)

    timerState.worker.onmessage = (e) => {
      const { type, timestamp } = e.data
      if (type === "tick") {
        const now = timestamp || Date.now()
        executeReadyTimers(now)
      }
    }

    timerState.worker.onerror = (err) => {
      console.error(`${NAME}: Timer worker error:`, err)
      timerState.worker = null
      timerState.isRunning = false
    }

    console.log(`${NAME}: Timer worker initialized successfully`)
  } catch (e) {
    console.error(`${NAME}: Failed to initialize timer worker:`, e)
    timerState.worker = null
  }
}

function executeReadyTimers(now) {
  const timersToExecute = []

  for (const [id, timer] of timerState.timers) {
    if (!timer.callback) continue
    const timeSinceLast = timer.lastExecuted ? now - timer.lastExecuted : now - timer.createdAt
    if (timeSinceLast >= timer.interval) {
      timersToExecute.push(id)
    }
  }

  for (const id of timersToExecute) {
    const timer = timerState.timers.get(id)
    if (timer?.callback) {
      try {
        timer.callback()
        if (!timer.isOneShot) {
          timer.lastExecuted = now
        } else {
          timerState.timers.delete(id)
        }
      } catch (err) {
        console.error(`${NAME}: Timer callback error:`, err)
        timerState.timers.delete(id)
      }
    }
  }
}

function getWorkerTickInterval(delay) {
  return Number.isFinite(timerState.tickIntervalMs) ? timerState.tickIntervalMs : delay
}

export function setWorkerTimeout(callback, delay) {
  if (timerState.worker && delay >= 50) {
    const id = ++timerState.timerId
    const now = Date.now()
    timerState.timers.set(id, {
      callback,
      interval: delay,
      createdAt: now,
      lastExecuted: null,
      isOneShot: true,
    })

    if (!timerState.isRunning) {
      timerState.worker.postMessage({ command: "start", data: { interval: getWorkerTickInterval(delay) } })
      timerState.isRunning = true
    }

    return id
  }

  if (timerState.requireWorkerTimeout) {
    throw new Error("Timer worker is required for scheduled execution")
  }

  return setTimeout(callback, delay)
}

export function setWorkerInterval(callback, delay) {
  if (timerState.worker && delay >= 50) {
    const id = ++timerState.timerId
    const now = Date.now()
    timerState.timers.set(id, {
      callback,
      interval: delay,
      createdAt: now,
      lastExecuted: null,
      isOneShot: false,
    })

    if (!timerState.isRunning) {
      timerState.worker.postMessage({ command: "start", data: { interval: getWorkerTickInterval(delay) } })
      timerState.isRunning = true
    }

    return id
  }
  return setInterval(callback, delay)
}

export function clearWorkerTimeout(id) {
  if (typeof id === "number" && timerState.timers.has(id)) {
    timerState.timers.delete(id)

    if (timerState.worker && timerState.timers.size === 0 && timerState.isRunning) {
      timerState.worker.postMessage({ command: "stop" })
      timerState.isRunning = false
    }
  } else if (typeof id === "number" && id !== 0) {
    clearInterval(id)
  } else if (typeof id === "object" && id !== null) {
    clearTimeout(id)
  }
}

export const clearWorkerInterval = clearWorkerTimeout

export function restartWorkerTimer(minIntervalMs = 0) {
  if (!timerState.worker || !timerState.isRunning || timerState.timers.size === 0) {
    return false
  }

  timerState.worker.postMessage({ command: "stop" })
  timerState.isRunning = false

  const shortestInterval = Math.min(...Array.from(timerState.timers.values()).map(timer => timer.interval))
  const nextInterval = Math.max(shortestInterval, minIntervalMs)
  timerState.worker.postMessage({ command: "start", data: { interval: nextInterval } })
  timerState.isRunning = true
  return true
}
