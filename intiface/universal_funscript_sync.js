/**
 * Universal Funscript Sync Module
 * Handles funscript playback for ANY source (timeline, media, etc.)
 * Each source gets its own worker to prevent crosstalk
 */

import {
  getConnectedDevices,
  getDeviceChannel,
  getDevicesOnChannel,
  isClientConnected,
  getButtplug
} from './connected_devices.js'

// Active sync workers
let syncWorkers = new Map() // workerId -> { channelFunscripts, channelLastIndex, isPlaying, intervalId, getCurrentTime, dynamicIntervalMs }
let workerIdCounter = 0

// Polling rate
let pollingRate = 30 // Hz

function nowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

/**
 * Initialize sync system
 */
export function initSync(pollingRateHz = 30) {
  pollingRate = pollingRateHz
}

/**
 * Start a new sync worker
 * @param {Object} channelFunscripts - Map of channel -> funscript
 * @param {Function} getCurrentTime - Function returning current time in ms
 * @returns {string} workerId
 */
export function startSync(channelFunscripts, getCurrentTime) {
  const workerId = `sync_${++workerIdCounter}`
  
  // Initialize per-channel action indices
  const channelLastIndex = {}
  Object.keys(channelFunscripts).forEach(channel => {
    if (channelFunscripts[channel]?.actions?.length > 0) {
      channelLastIndex[channel] = 0
    }
  })
  
  const worker = {
    id: workerId,
    channelFunscripts,
    channelLastIndex,
    isPlaying: true,
    getCurrentTime,
    intervalId: null,
    dynamicIntervalMs: Math.round(1000 / pollingRate)
  }
  
  syncWorkers.set(workerId, worker)
  
  // Start the sync loop for this worker
  runSyncWorker(workerId)
  
  return workerId
}

/**
 * Pause a sync worker
 * @param {string} workerId 
 */
export function pauseSync(workerId) {
  const worker = syncWorkers.get(workerId)
  if (!worker) return false
  
  worker.isPlaying = false
  if (worker.intervalId) {
    clearTimeout(worker.intervalId)
    worker.intervalId = null
  }
  
  return true
}

/**
 * Resume a sync worker
 * @param {string} workerId 
 */
export function resumeSync(workerId) {
  const worker = syncWorkers.get(workerId)
  if (!worker || worker.isPlaying) return false
  
  worker.isPlaying = true
  runSyncWorker(workerId)
  
  return true
}

/**
 * Stop and remove a sync worker
 * @param {string} workerId 
 */
export function stopSync(workerId) {
  const worker = syncWorkers.get(workerId)
  if (!worker) return false
  
  worker.isPlaying = false
  if (worker.intervalId) {
    clearTimeout(worker.intervalId)
    worker.intervalId = null
  }
  
  syncWorkers.delete(workerId)
  return true
}

/**
 * Stop all sync workers
 */
export function stopAllSync() {
  syncWorkers.forEach((worker, id) => {
    stopSync(id)
  })
}

/**
 * Get sync worker status
 * @param {string} workerId 
 * @returns {Object|null}
 */
export function getSyncStatus(workerId) {
  const worker = syncWorkers.get(workerId)
  if (!worker) return null
  
  return {
    id: worker.id,
    isPlaying: worker.isPlaying,
    channels: Object.keys(worker.channelFunscripts),
    currentPosition: worker.getCurrentTime()
  }
}

/**
 * Seek to a time position in a sync worker
 * @param {string} workerId 
 * @param {number} timeMs 
 */
export function seekSync(workerId, timeMs) {
  const worker = syncWorkers.get(workerId)
  if (!worker) return false
  
  // Recalculate action indices for all channels
  Object.keys(worker.channelFunscripts).forEach(channel => {
    const funscript = worker.channelFunscripts[channel]
    if (!funscript?.actions?.length) return
    
    let newIndex = 0
    for (let i = 0; i < funscript.actions.length; i++) {
      if (funscript.actions[i].at <= timeMs) {
        newIndex = i + 1
      } else {
        break
      }
    }
    worker.channelLastIndex[channel] = newIndex
  })
  
  return true
}

/**
 * Get all active worker IDs
 */
export function getActiveWorkers() {
  return Array.from(syncWorkers.keys())
}

/**
 * Run the sync loop for a specific worker
 */
async function runSyncWorker(workerId) {
  const worker = syncWorkers.get(workerId)
  if (!worker || !worker.isPlaying) return
  
  if (!isClientConnected()) {
    stopSync(workerId)
    return
  }
  
  const tickStartedAt = nowMs()
  const currentTime = worker.getCurrentTime()
  const dispatches = []
  
  // Process actions from each channel
  Object.keys(worker.channelFunscripts).forEach(channel => {
    const funscript = worker.channelFunscripts[channel]
    if (!funscript?.actions?.length) return
    
    const actions = funscript.actions
    const lastIndex = worker.channelLastIndex[channel] || 0

    let newestDueIndex = -1
    for (let i = lastIndex; i < actions.length; i++) {
      if (actions[i].at <= currentTime) {
        newestDueIndex = i
      } else {
        break
      }
    }

    if (newestDueIndex >= lastIndex) {
      const newestAction = actions[newestDueIndex]
      worker.channelLastIndex[channel] = newestDueIndex + 1
      dispatches.push(
        executeFunscriptAction(newestAction, channel).catch(() => false)
      )
    }
  })

  if (dispatches.length > 0) {
    await Promise.allSettled(dispatches)
  }
  
  // Schedule next iteration
  if (worker.isPlaying) {
    const baseInterval = Math.round(1000 / pollingRate)
    const tickElapsed = nowMs() - tickStartedAt

    if (!Number.isFinite(worker.dynamicIntervalMs)) {
      worker.dynamicIntervalMs = baseInterval
    }

    if (tickElapsed > baseInterval * 1.2) {
      worker.dynamicIntervalMs = Math.min(100, Math.round(worker.dynamicIntervalMs * 1.25))
    } else {
      worker.dynamicIntervalMs = Math.max(baseInterval, Math.round(worker.dynamicIntervalMs * 0.9))
    }

    const interval = Math.max(baseInterval, worker.dynamicIntervalMs)
    const waitMs = Math.max(1, Math.round(interval - tickElapsed))
    worker.intervalId = setTimeout(() => {
      runSyncWorker(workerId).catch(() => {
        stopSync(workerId)
      })
    }, waitMs)
  }
}

function getScalarActuators(device) {
  const attrs = device?.messageAttributes || {}
  const sources = [
    attrs?.ScalarCmd,
    attrs?.VibrateCmd,
    attrs?.OscillateCmd,
    attrs?.RotateCmd,
    attrs?.ConstrictCmd,
    attrs?.InflateCmd,
  ]

  const entries = []
  for (const list of sources) {
    if (!Array.isArray(list)) continue
    for (let i = 0; i < list.length; i++) {
      const item = list[i] || {}
      const actuatorType = String(item?.ActuatorType || 'Vibrate')
      const index = Number.isFinite(item?.Index) ? Number(item.Index) : i
      entries.push({ index, actuatorType })
    }
  }

  const deduped = []
  const seen = new Set()
  for (const entry of entries) {
    const key = `${entry.index}:${entry.actuatorType}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(entry)
  }
  return deduped
}

async function applyActionToDevice(device, action, buttplug) {
  const normalizeActionPosToUnit = (value) => {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return 0

    // Support common position encodings: 0..100, 0..1, and legacy -1..1.
    if (numeric >= 0 && numeric <= 1) {
      return numeric
    }
    if (numeric >= -1 && numeric <= 1) {
      return (numeric + 1) / 2
    }
    if (numeric >= 0 && numeric <= 100) {
      return numeric / 100
    }
    return Math.max(0, Math.min(1, numeric))
  }

  const positions = Array.isArray(action.pos) ? action.pos : [action.pos]
  const firstPos = normalizeActionPosToUnit(positions[0])
  const hasLinearCapability =
    (Array.isArray(device?.linearAttributes) && device.linearAttributes.length > 0) ||
    Array.isArray(device?.messageAttributes?.LinearCmd) ||
    typeof device?.linear === 'function'

  // Funscript position data maps best to linear movement on stroker-class devices.
  if (hasLinearCapability && typeof device?.linear === 'function') {
    try {
      await device.linear(firstPos, 120)
      return true
    } catch (_e) {}
  }

  if (Array.isArray(device?.vibrateAttributes) && device.vibrateAttributes.length > 0 && typeof device.scalar === 'function') {
    const cmds = []
    for (let motorIndex = 0; motorIndex < Math.min(device.vibrateAttributes.length, positions.length); motorIndex++) {
      const attr = device.vibrateAttributes[motorIndex]
      if (!attr) continue
      const adjustedPos = normalizeActionPosToUnit(positions[motorIndex])
      cmds.push(device.scalar(new buttplug.ScalarSubcommand(attr.Index, adjustedPos, 'Vibrate')))
    }
    if (cmds.length > 0) {
      await Promise.all(cmds)
      return true
    }
  }

  if (typeof device?.vibrate === 'function') {
    try {
      await device.vibrate(firstPos)
      return true
    } catch (_e) {}
  }

  if (typeof device?.scalar === 'function') {
    const actuators = getScalarActuators(device)
    if (actuators.length > 0) {
      const cmds = []
      for (let i = 0; i < Math.min(actuators.length, positions.length); i++) {
        const target = actuators[i]
        const adjustedPos = normalizeActionPosToUnit(positions[i])
        cmds.push(device.scalar(new buttplug.ScalarSubcommand(target.index, adjustedPos, String(target.actuatorType || 'Vibrate'))))
      }
      if (cmds.length === 0) {
        const fallback = actuators[0]
        cmds.push(device.scalar(new buttplug.ScalarSubcommand(fallback.index, firstPos, String(fallback.actuatorType || 'Vibrate'))))
      }
      await Promise.all(cmds)
      return true
    }
  }

  if (typeof device?.oscillate === 'function') {
    try {
      await device.oscillate(firstPos)
      return true
    } catch (_e) {}
  }

  if (typeof device?.linear === 'function') {
    try {
      await device.linear(firstPos, 120)
      return true
    } catch (_e) {}
  }

  return false
}

/**
 * Execute a funscript action to devices on a specific channel
 * @param {Object} action - Funscript action { at, pos }
 * @param {string} channel - Channel letter (A, B, C, D)
 */
async function executeFunscriptAction(action, channel) {
  const devices = getDevicesOnChannel(channel)
  const buttplug = getButtplug()
  
  if (devices.length === 0 || !buttplug) return
  
  const promises = []

  for (const device of devices) {
    promises.push(
      applyActionToDevice(device, action, buttplug).catch((e) => {
        console.error('[UniversalSync]: Error executing action:', e)
        return false
      })
    )
  }

  if (promises.length > 0) {
    await Promise.all(promises)
  }
}

/**
 * Update polling rate
 * @param {number} rateHz 
 */
export function setPollingRate(rateHz) {
  pollingRate = Math.max(10, Math.min(120, rateHz))
}

/**
 * Get current polling rate
 */
export function getPollingRate() {
  return pollingRate
}

// Default export
export default {
  initSync,
  startSync,
  pauseSync,
  resumeSync,
  stopSync,
  stopAllSync,
  seekSync,
  getSyncStatus,
  getActiveWorkers,
  setPollingRate,
  getPollingRate
}
