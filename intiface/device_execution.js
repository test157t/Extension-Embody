/**
 * Device Execution Module
 * Handles all device command execution, pattern playback, and device control
 */

import { PlayModeLoader } from './_loader.js'

// Active pattern tracking
let activePatterns = new Map() // deviceIndex -> { pattern, interval, controls }
let playModeSequenceTimeouts = new Set()

// Dependencies (injected)
let deps = {
  NAME: 'intiface-connect',
  client: null,
  devices: [],
  getConnectedDevices: () => [],
  buttplug: null,
  deviceAssignments: {},
  globalIntensityScale: 100,
  globalInvert: false,
  updateStatus: () => {},
  updateAIStatusFromActivity: () => {},
  clearWorkerTimeout: (id) => clearTimeout(id),
  setWorkerTimeout: (cb, delay) => setTimeout(cb, delay),
  setWorkerInterval: (cb, delay) => setInterval(cb, delay),
  emitPlaybackEvent: () => {},
  getSyncStartEventLeadMs: () => 1200,
}

const devicePlaybackState = new Map() // deviceIndex -> { active, deviceName, lastType }
const linearStopTimers = new Map() // deviceIndex -> timeout id
const SYNC_ANIMATION_LEAD_MS = 0
const SYNC_START_EVENT_LEAD_MS = 1200

function getSyncStartEventLeadMs() {
  const value = Number(deps.getSyncStartEventLeadMs?.())
  if (Number.isFinite(value)) {
    return Math.max(0, Math.min(3000, Math.round(value)))
  }
  return SYNC_START_EVENT_LEAD_MS
}

function getDeviceName(device, deviceIndex) {
  return device?.displayName || device?.name || `Device ${deviceIndex}`
}

function getPatternFunctionStrict(patternName) {
  const requested = String(patternName || '').trim().toLowerCase()

  if (!requested) {
    return null
  }

  const direct = PlayModeLoader.getPattern(requested)
  if (direct) {
    return { fn: direct, resolved: requested }
  }

  return null
}

function emitPlaybackEvent(payload = {}) {
  try {
    deps.emitPlaybackEvent?.({
      timestamp: performance.now(),
      ...payload,
    })
  } catch (e) {
    // Ignore event bridge failures to avoid blocking playback.
  }
}

function clearLinearStopTimer(deviceIndex) {
  const timerId = linearStopTimers.get(deviceIndex)
  if (timerId) {
    deps.clearWorkerTimeout(timerId)
    linearStopTimers.delete(deviceIndex)
  }
}

async function waitForSyncAnimationLeadIn(cmd) {
  // Give VRM sync animation a small head start before command execution.
  if (!cmd || !cmd.char) return
  await new Promise((resolve) => deps.setWorkerTimeout(resolve, SYNC_ANIMATION_LEAD_MS))
}

async function waitForSyncStartLead(cmd) {
  if (!cmd) return
  if (cmd?._skipSyncStartLead) return
  const hasSyncContext = !!cmd.char || Number.isFinite(cmd?.traceId)
  if (!hasSyncContext) return
  const leadMs = getSyncStartEventLeadMs()
  if (leadMs <= 0) return
  await new Promise((resolve) => deps.setWorkerTimeout(resolve, leadMs))
}

function markDevicePlaybackStart(deviceIndex, device, commandType = 'unknown', meta = {}) {
  const deviceName = getDeviceName(device, deviceIndex)
  const prev = devicePlaybackState.get(deviceIndex)
  const nextState = {
    active: true,
    deviceName,
    lastType: commandType,
  }
  devicePlaybackState.set(deviceIndex, nextState)

  if (!prev?.active) {
    emitPlaybackEvent({
      state: 'start',
      deviceIndex,
      deviceName,
      commandType,
      ...meta,
    })
    return true
  }

  return false
}

function emitDevicePlaybackTick(deviceIndex, device, commandType = 'unknown', meta = {}) {
  const deviceName = getDeviceName(device, deviceIndex)
  emitPlaybackEvent({
    state: 'tick',
    deviceIndex,
    deviceName,
    commandType,
    ...meta,
  })
}

function markDevicePlaybackStop(deviceIndex, reason = 'stopped') {
  clearLinearStopTimer(deviceIndex)
  const prev = devicePlaybackState.get(deviceIndex)
  if (!prev?.active) {
    devicePlaybackState.delete(deviceIndex)
    return
  }

  devicePlaybackState.set(deviceIndex, {
    ...prev,
    active: false,
  })

  emitPlaybackEvent({
    state: 'stop',
    deviceIndex,
    deviceName: prev.deviceName,
    commandType: prev.lastType || 'unknown',
    reason,
  })
}

function getLiveDevices() {
  if (typeof deps.getConnectedDevices === 'function') {
    const connected = deps.getConnectedDevices() || []
    if (Array.isArray(connected) && connected.length > 0) {
      return connected
    }
  }
  return deps.devices || []
}

/**
 * Initialize device execution module
 */
export function initDeviceExecution(dependencies) {
  deps = { ...deps, ...dependencies }
}

/**
 * Execute a device command
 */
export async function executeCommand(cmd) {
  // System commands can run without connection
  if (cmd.type === 'interface_start' || cmd.type === 'interface_connect' || 
      cmd.type === 'interface_disconnect' || cmd.type === 'interface_scan') {
    // These are handled by the main script
    return
  }

  // Media commands - handled by media module
  if (cmd.type === 'media_list' || cmd.type === 'media_play' || 
      cmd.type === 'media_stop' || cmd.type === 'media_pause' || 
      cmd.type === 'media_resume' || cmd.type === 'media_intensity') {
    // These are handled by media module
    return
  }

  // Device commands require connection
  const connectedDevices = getLiveDevices()
  if (!deps.client?.connected || connectedDevices.length === 0) {
    console.warn(`${deps.NAME}: Command skipped - connected=${!!deps.client?.connected}, devices=${connectedDevices.length}, type=${cmd?.type || 'unknown'}`)
    return
  }

  // Use specified device index or default to first device
  const deviceIndex = cmd.deviceIndex !== undefined ? cmd.deviceIndex : 0
  const targetDevice = connectedDevices[deviceIndex] || connectedDevices[0]
  const resolvedDeviceIndex = connectedDevices.indexOf(targetDevice)
  const liveDeviceIndex = resolvedDeviceIndex >= 0 ? resolvedDeviceIndex : deviceIndex

  if (!targetDevice) {
    console.warn(`${deps.NAME}: No device found at index ${deviceIndex}`)
    return
  }

  try {
    const deviceName = getDeviceName(targetDevice, liveDeviceIndex)

    switch (cmd.type) {
      case 'set_intensity':
        deps.globalIntensityScale = cmd.intensity
        deps.updateStatus(`Global intensity set to ${cmd.intensity}% by AI`)
        break

      case 'vibrate':
        if (Number(cmd.intensity) > 0) {
          const didStartPlayback = markDevicePlaybackStart(liveDeviceIndex, targetDevice, 'vibrate', {
            intensity: Number(cmd.intensity),
            char: cmd?.char || null,
            traceId: Number.isFinite(cmd?.traceId) ? Number(cmd.traceId) : null,
            requestId: cmd?.requestId || null,
            messageId: Number.isInteger(cmd?.messageId) ? cmd.messageId : null,
          })
          if (didStartPlayback) {
            await waitForSyncStartLead(cmd)
          }
          await executeVibrateCommand(targetDevice, cmd.intensity, cmd.motorIndex)
          emitDevicePlaybackTick(liveDeviceIndex, targetDevice, 'vibrate', {
            intensity: Number(cmd.intensity),
            char: cmd?.char || null,
            traceId: Number.isFinite(cmd?.traceId) ? Number(cmd.traceId) : null,
            requestId: cmd?.requestId || null,
            messageId: Number.isInteger(cmd?.messageId) ? cmd.messageId : null,
          })
        } else {
          await executeVibrateCommand(targetDevice, cmd.intensity, cmd.motorIndex)
          markDevicePlaybackStop(liveDeviceIndex, 'intensity_zero')
        }
        deps.updateStatus(`${deviceName} vibrating at ${cmd.intensity}%`)
        break

      case 'oscillate':
        if (Number(cmd.intensity) > 0) {
          const didStartPlayback = markDevicePlaybackStart(liveDeviceIndex, targetDevice, 'oscillate', {
            intensity: Number(cmd.intensity),
            char: cmd?.char || null,
            traceId: Number.isFinite(cmd?.traceId) ? Number(cmd.traceId) : null,
            requestId: cmd?.requestId || null,
            messageId: Number.isInteger(cmd?.messageId) ? cmd.messageId : null,
          })
          if (didStartPlayback) {
            await waitForSyncStartLead(cmd)
          }
          await executeOscillateCommand(targetDevice, cmd.intensity)
          emitDevicePlaybackTick(liveDeviceIndex, targetDevice, 'oscillate', {
            intensity: Number(cmd.intensity),
            char: cmd?.char || null,
            traceId: Number.isFinite(cmd?.traceId) ? Number(cmd.traceId) : null,
            requestId: cmd?.requestId || null,
            messageId: Number.isInteger(cmd?.messageId) ? cmd.messageId : null,
          })
        } else {
          await executeOscillateCommand(targetDevice, cmd.intensity)
          markDevicePlaybackStop(liveDeviceIndex, 'intensity_zero')
        }
        deps.updateStatus(`${deviceName} oscillating at ${applyInversion(cmd.intensity)}%`)
        break

      case 'linear':
        if (Number(cmd.duration) > 0) {
          const didStartPlayback = markDevicePlaybackStart(liveDeviceIndex, targetDevice, 'linear', {
            startPos: Number(cmd.startPos),
            endPos: Number(cmd.endPos),
            duration: Number(cmd.duration),
            char: cmd?.char || null,
            traceId: Number.isFinite(cmd?.traceId) ? Number(cmd.traceId) : null,
            requestId: cmd?.requestId || null,
            messageId: Number.isInteger(cmd?.messageId) ? cmd.messageId : null,
          })
          if (didStartPlayback) {
            await waitForSyncStartLead(cmd)
          }
          await executeLinearCommand(targetDevice, cmd.startPos, cmd.endPos, cmd.duration)
          emitDevicePlaybackTick(liveDeviceIndex, targetDevice, 'linear', {
            startPos: Number(cmd.startPos),
            endPos: Number(cmd.endPos),
            duration: Number(cmd.duration),
            char: cmd?.char || null,
            traceId: Number.isFinite(cmd?.traceId) ? Number(cmd.traceId) : null,
            requestId: cmd?.requestId || null,
            messageId: Number.isInteger(cmd?.messageId) ? cmd.messageId : null,
          })

          clearLinearStopTimer(liveDeviceIndex)
          const linearStopId = deps.setWorkerTimeout(() => {
            markDevicePlaybackStop(liveDeviceIndex, 'linear_complete')
          }, Math.max(50, Number(cmd.duration) + 50))
          linearStopTimers.set(liveDeviceIndex, linearStopId)
        } else {
          await executeLinearCommand(targetDevice, cmd.startPos, cmd.endPos, cmd.duration)
        }
        deps.updateStatus(`${deviceName} linear stroke ${cmd.startPos}% to ${cmd.endPos}%`)
        break

      case 'stop':
        emitPlaybackEvent({
          state: 'start',
          deviceIndex: liveDeviceIndex,
          deviceName,
          commandType: 'stop',
          char: cmd?.char || null,
          traceId: Number.isFinite(cmd?.traceId) ? Number(cmd.traceId) : null,
          requestId: cmd?.requestId || null,
          messageId: Number.isInteger(cmd?.messageId) ? cmd.messageId : null,
        })
        await stopAllDeviceActions()
        break

      case 'vibrate_pattern':
        const vibrateStop = executePattern({ ...cmd, char: cmd?.char || null }, 'vibrate', deviceIndex)
        activePatterns.set(deviceIndex, {
          mode: 'pattern',
          modeName: 'vibrate_pattern',
          stop: vibrateStop
        })
        break

      case 'oscillate_pattern':
        const oscillateStop = executePattern({ ...cmd, char: cmd?.char || null }, 'oscillate', deviceIndex)
        activePatterns.set(deviceIndex, {
          mode: 'pattern',
          modeName: 'oscillate_pattern',
          stop: oscillateStop
        })
        break

      case 'preset':
        await waitForSyncAnimationLeadIn(cmd)
        await executeWaveformPattern(deviceIndex, cmd.presetName, {
          char: cmd?.char || null,
          traceId: cmd?.traceId,
          requestId: cmd?.requestId,
          messageId: cmd?.messageId,
        })
        break

      case 'waveform':
        console.debug(`${deps.NAME}: Executing waveform '${cmd.pattern}' on device index ${liveDeviceIndex}`)

        await waitForSyncAnimationLeadIn(cmd)
        await executeWaveformPattern(deviceIndex, 'custom', {
          pattern: cmd.pattern,
          min: cmd.min,
          max: cmd.max,
          duration: cmd.duration,
          cycles: cmd.cycles,
          char: cmd?.char || null,
          traceId: cmd?.traceId,
          requestId: cmd?.requestId,
          messageId: cmd?.messageId,
        })
        deps.updateStatus(`${deviceName}: ${cmd.pattern} waveform (${cmd.min}-${cmd.max}%)`)
        break

      case 'dual_waveform':
        await waitForSyncAnimationLeadIn(cmd)
        await executeDualWaveform(deviceIndex, cmd)
        break

      case 'gradient':
        await waitForSyncAnimationLeadIn(cmd)
        await executeGradientPattern(deviceIndex, { ...cmd, char: cmd?.char || null })
        deps.updateStatus(`${deviceName}: gradient ${cmd.start}% → ${cmd.end}%`)
        break

      default:
        // Check if cmd.type is a valid mode ID from PlayModeLoader
        if (PlayModeLoader.isModeEnabled(cmd.type)) {
          await waitForSyncAnimationLeadIn(cmd)
          await executeModeSequence(cmd.deviceIndex, cmd.type, cmd.modeName, cmd?.char || null, {
            traceId: cmd?.traceId,
            requestId: cmd?.requestId,
            messageId: cmd?.messageId,
          })
          deps.updateStatus(`${deviceName}: Mode - ${cmd.modeName}`)
        } else {
          console.warn(`${deps.NAME}: Unknown command type: ${cmd.type}`)
        }
        break
    }
  } catch (e) {
    console.error(`${deps.NAME}: Command execution failed:`, e)
  }
}

/**
 * Execute vibrate command
 */
async function executeVibrateCommand(device, intensity, motorIndex = 0) {
  await sendIntensityToDevice(device, intensity, {
    motorIndex,
    preferredActuator: 'Vibrate',
    fallbackToLinear: true,
  })
}

/**
 * Execute oscillate command
 */
async function executeOscillateCommand(device, intensity) {
  await sendIntensityToDevice(device, intensity, {
    preferredActuator: 'Oscillate',
    fallbackToLinear: true,
  })
}

/**
 * Execute linear command
 */
async function executeLinearCommand(device, startPos, endPos, duration) {
  let adjustedEnd = applyInversion(endPos)
  if (typeof device?.linear === 'function') {
    await device.linear(adjustedEnd / 100, duration)
    return
  }

  // Fallback for non-linear devices: map target position to intensity.
  await sendIntensityToDevice(device, adjustedEnd, {
    preferredActuator: 'Vibrate',
    fallbackToLinear: false,
  })
}

function getScalarActuators(device) {
  const attrs = device?.messageAttributes || {}
  const scalarList = []

  if (Array.isArray(attrs?.ScalarCmd)) {
    attrs.ScalarCmd.forEach((entry, idx) => {
      scalarList.push({
        index: Number.isFinite(entry?.Index) ? Number(entry.Index) : idx,
        actuatorType: String(entry?.ActuatorType || 'Vibrate'),
      })
    })
  }

  const legacyMaps = [
    ['VibrateCmd', 'Vibrate'],
    ['OscillateCmd', 'Oscillate'],
    ['RotateCmd', 'Rotate'],
    ['ConstrictCmd', 'Constrict'],
    ['InflateCmd', 'Inflate'],
  ]

  for (const [key, actuatorType] of legacyMaps) {
    const list = attrs?.[key]
    if (!Array.isArray(list)) continue
    list.forEach((entry, idx) => {
      scalarList.push({
        index: Number.isFinite(entry?.Index) ? Number(entry.Index) : idx,
        actuatorType,
      })
    })
  }

  const deduped = []
  const seen = new Set()
  for (const entry of scalarList) {
    const key = `${entry.index}:${entry.actuatorType}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(entry)
  }
  return deduped
}

async function sendScalarIntensity(device, intensityValue, preferredActuator = 'Vibrate', motorIndex = 0) {
  if (typeof device?.scalar !== 'function') {
    return false
  }

  const actuators = getScalarActuators(device)
  if (!actuators.length) {
    return false
  }

  const preferredLower = String(preferredActuator || '').toLowerCase()
  let target = actuators.find((a) => String(a.actuatorType || '').toLowerCase() === preferredLower && a.index === motorIndex)
  if (!target) {
    target = actuators.find((a) => String(a.actuatorType || '').toLowerCase() === preferredLower)
  }
  if (!target) {
    target = actuators.find((a) => a.index === motorIndex) || actuators[0]
  }

  try {
    const scalarCmd = new deps.buttplug.ScalarSubcommand(
      Number(target.index) || 0,
      intensityValue,
      String(target.actuatorType || preferredActuator || 'Vibrate')
    )
    await device.scalar(scalarCmd)
    return true
  } catch (_e) {
    return false
  }
}

async function sendIntensityToDevice(device, intensity, options = {}) {
  const { motorIndex = 0, preferredActuator = 'Vibrate', fallbackToLinear = true } = options
  const normalized = Math.max(0, Math.min(100, Number(intensity) || 0))
  const adjusted = applyInversion(normalized)
  const intensityValue = adjusted / 100

  if (preferredActuator === 'Oscillate' && typeof device?.oscillate === 'function') {
    try {
      await device.oscillate(intensityValue)
      return true
    } catch (_e) {}
  }

  if (typeof device?.vibrate === 'function') {
    try {
      await device.vibrate(intensityValue)
      return true
    } catch (_e) {}
  }

  if (await sendScalarIntensity(device, intensityValue, preferredActuator, motorIndex)) {
    return true
  }

  if (preferredActuator !== 'Oscillate' && typeof device?.oscillate === 'function') {
    try {
      await device.oscillate(intensityValue)
      return true
    } catch (_e) {}
  }

  if (fallbackToLinear && typeof device?.linear === 'function') {
    try {
      await device.linear(intensityValue, 120)
      return true
    } catch (_e) {}
  }

  console.warn(`${deps.NAME}: Device does not support usable actuators for intensity control`)
  return false
}

/**
 * Execute dual waveform pattern
 */
async function executeDualWaveform(deviceIndex, cmd) {
  const targetDevice = getLiveDevices()[deviceIndex]
  if (!targetDevice) return

  const motorCount = getMotorCount(targetDevice)
  const steps = Math.floor(cmd.duration / 100)
  const intervals = Array(steps).fill(100)

  let patternData
  if (motorCount >= 2) {
    // Generate different patterns for each motor
    const motor1Values = generateWaveformValues(cmd.pattern1, steps, cmd.min, cmd.max)
    const motor2Values = generateWaveformValues(cmd.pattern2, steps, cmd.min, cmd.max)
    patternData = {
      pattern: { motor1: motor1Values, motor2: motor2Values },
      intervals: intervals,
      loop: cmd.cycles || 3,
      char: cmd?.char || null,
    }
    deps.updateStatus(`${targetDevice.displayName || targetDevice.name}: dual waveform (${cmd.pattern1}/${cmd.pattern2})`)
  } else {
    // Single motor - use pattern1 only
    const values = generateWaveformValues(cmd.pattern1, steps, cmd.min, cmd.max)
    patternData = {
      pattern: values,
      intervals: intervals,
      loop: cmd.cycles || 3,
      char: cmd?.char || null,
    }
    deps.updateStatus(`${targetDevice.displayName || targetDevice.name}: ${cmd.pattern1} waveform (${cmd.min}-${cmd.max}%)`)
  }
  
  await executePattern(patternData, 'vibrate', deviceIndex)
}

/**
 * Apply inversion to intensity/position values (0-100)
 */
function applyInversion(value) {
  if (deps.globalInvert) {
    return 100 - value
  }
  return value
}

/**
 * Get device motor count
 */
function getMotorCount(device) {
  if (!device || !device.vibrateAttributes) return 1
  return device.vibrateAttributes.length || 1
}

/**
 * Apply global intensity to values with optional mode scaling
 */
export function applyIntensityScale(values, modeId = null) {
  // Get base scale from global intensity (default 100%)
  let scale = deps.globalIntensityScale / 100

  // Apply mode-specific multiplier from PlayModeLoader if modeId is provided
  if (modeId && PlayModeLoader.getIntensityMultiplier) {
    const modeMultiplier = PlayModeLoader.getIntensityMultiplier(modeId)
    scale *= modeMultiplier
  }

  // Scale values around neutral point (50) to preserve dynamic range
  return values.map(v => {
    const scaled = 50 + (v - 50) * scale
    return Math.min(100, Math.max(0, Math.round(scaled)))
  })
}

/**
 * Execute a pattern on a device
 */
export function executePattern(cmd, actionType, deviceIndex) {
  const targetDevice = getLiveDevices()[deviceIndex]
  if (!targetDevice) return () => {}

  const sequenceManaged = cmd?._sequenceManaged === true

  // Clear any existing pattern for this device
  if (!sequenceManaged) {
    stopDevicePattern(deviceIndex)
  }

  let patternIndex = 0
  let loopCount = 0
  let intervalId = null
  let hasEmittedStart = false

  const pattern = cmd.pattern
  const intervals = cmd.intervals || [1000]
  const maxLoops = cmd.loop || 1

  const executeStep = async () => {
    if (!deps.client?.connected) return

    if (patternIndex >= pattern.length) {
      patternIndex = 0
      loopCount++
      if (loopCount >= maxLoops) {
        if (!sequenceManaged) {
          stopDevicePattern(deviceIndex)
        } else if (intervalId) {
          deps.clearWorkerTimeout(intervalId)
          intervalId = null
        }
        return
      }
    }

    const step = pattern[patternIndex]
    const isFirstPlaybackStep = !hasEmittedStart
    
    try {
      if (isFirstPlaybackStep && !sequenceManaged) {
        hasEmittedStart = true
        const didStartPlayback = markDevicePlaybackStart(deviceIndex, targetDevice, actionType, {
          char: cmd?.char || null,
          traceId: Number.isFinite(cmd?.traceId) ? Number(cmd.traceId) : null,
          requestId: cmd?.requestId || null,
          messageId: Number.isInteger(cmd?.messageId) ? cmd.messageId : null,
        })

        if (didStartPlayback) {
          await waitForSyncStartLead(cmd)
        }
      }

      if (actionType === 'vibrate') {
        if (Array.isArray(step)) {
          // Multi-motor pattern
          const vibrateAttrs = targetDevice.vibrateAttributes
          if (vibrateAttrs) {
            for (let i = 0; i < Math.min(vibrateAttrs.length, step.length); i++) {
              const rawIntensity = Number(step[i])
              const normalized = Math.max(0, Math.min(100, Number.isFinite(rawIntensity) ? rawIntensity : 0))
              const adjusted = applyInversion(normalized)
              const value = adjusted / 100

              let applied = false
              if (typeof targetDevice?.scalar === 'function') {
                try {
                  const scalarCmd = new deps.buttplug.ScalarSubcommand(
                    Number(vibrateAttrs[i]?.Index) || i,
                    value,
                    "Vibrate"
                  )
                  await targetDevice.scalar(scalarCmd)
                  applied = true
                } catch (_e) {}
              }

              if (!applied) {
                await sendIntensityToDevice(targetDevice, normalized, {
                  motorIndex: i,
                  preferredActuator: 'Vibrate',
                  fallbackToLinear: true,
                })
              }
            }
          } else if (typeof targetDevice?.vibrate === 'function') {
            const average = step.reduce((sum, value) => sum + Number(value || 0), 0) / Math.max(1, step.length)
            await executeVibrateCommand(targetDevice, average, 0)
          } else {
            const average = step.reduce((sum, value) => sum + Number(value || 0), 0) / Math.max(1, step.length)
            await sendIntensityToDevice(targetDevice, average, {
              preferredActuator: 'Vibrate',
              fallbackToLinear: true,
            })
          }
        } else {
          // Single intensity
          await executeVibrateCommand(targetDevice, Number(step), 0)
        }
      } else if (actionType === 'oscillate') {
        const intensity = applyInversion(step)
        await targetDevice.oscillate(intensity / 100)
      }

      const tickIntensity = Array.isArray(step)
        ? Number(step.reduce((sum, value) => sum + Number(value || 0), 0) / Math.max(1, step.length))
        : Number(step)
      emitDevicePlaybackTick(deviceIndex, targetDevice, actionType, {
        char: cmd?.char || null,
        traceId: Number.isFinite(cmd?.traceId) ? Number(cmd.traceId) : null,
        requestId: cmd?.requestId || null,
        messageId: Number.isInteger(cmd?.messageId) ? cmd.messageId : null,
        intensity: Number.isFinite(tickIntensity) ? Math.max(0, Math.min(100, Math.round(tickIntensity))) : null,
      })
    } catch (e) {
      console.error(`${deps.NAME}: Pattern step failed:`, e)
    }

    patternIndex++
    const currentInterval = intervals[patternIndex % intervals.length]
    intervalId = deps.setWorkerTimeout(executeStep, currentInterval)
  }

  // Start the pattern
  intervalId = deps.setWorkerTimeout(executeStep, intervals[0])

  // Return stop function
  return () => {
    if (intervalId) {
      deps.clearWorkerTimeout(intervalId)
    }
  }
}

/**
 * Stop a device pattern
 */
export async function stopDevicePattern(deviceIndex) {
  const active = activePatterns.get(deviceIndex)
  if (active) {
    if (active.interval) {
      deps.clearWorkerTimeout(active.interval)
    }
    if (active.stop && typeof active.stop === 'function') {
      try {
        active.stop()
      } catch (e) {
        // Ignore
      }
    }
    activePatterns.delete(deviceIndex)
    markDevicePlaybackStop(deviceIndex, 'pattern_stopped')
  }
}

/**
 * Execute waveform pattern
 */
export async function executeWaveformPattern(deviceIndex, presetName, customOptions = null) {
  const targetDevice = getLiveDevices()[deviceIndex]
  if (!targetDevice) return

  const requestedPattern = customOptions?.pattern || presetName
  const patternInfo = getPatternFunctionStrict(requestedPattern)
  if (!patternInfo) {
    console.error(`${deps.NAME}: Pattern '${requestedPattern}' not found, waveform command rejected`)
    deps.updateStatus(`Pattern not found: ${requestedPattern}`)
    return
  }
  const patternFunc = patternInfo.fn

  // Clear any existing pattern
  await stopDevicePattern(deviceIndex)

  const options = customOptions || {}
  const min = Number(options.min ?? 20)
  const max = Number(options.max ?? 80)
  const duration = Number(options.duration ?? 5000)
  const cycles = Number(options.cycles ?? 3)
  const steps = Math.floor(duration / 100)

  // Generate waveform values
  const values = []
  for (let i = 0; i < steps; i++) {
    const phase = (i / steps) * cycles
    const rawValue = patternFunc ? patternFunc(phase, 1) : Math.sin(phase * Math.PI * 2)
    const normalized = (rawValue + 1) / 2
    const pos = Math.round(min + (max - min) * normalized)
    values.push(Math.min(100, Math.max(0, pos)))
  }

  const intervals = Array(steps).fill(100)
  
  const stopFn = executePattern(
    {
      pattern: values,
      intervals,
      loop: 1,
      char: options?.char || null,
      traceId: Number.isFinite(options?.traceId) ? Number(options.traceId) : null,
      requestId: options?.requestId || null,
      messageId: Number.isInteger(options?.messageId) ? options.messageId : null,
    },
    'vibrate',
    deviceIndex
  )

  activePatterns.set(deviceIndex, {
    mode: 'waveform',
    modeName: patternInfo.resolved || presetName,
    stop: stopFn
  })
}

/**
 * Execute gradient pattern
 */
export async function executeGradientPattern(deviceIndex, options) {
  const targetDevice = getLiveDevices()[deviceIndex]
  if (!targetDevice) return

  const { start, end, duration, hold = 0, release = 0, char = null } = options

  // Clear any existing pattern
  await stopDevicePattern(deviceIndex)

  const steps = Math.floor(duration / 100)
  const values = []
  
  // Build gradient
  for (let i = 0; i < steps; i++) {
    const progress = i / steps
    const value = Math.round(start + (end - start) * progress)
    values.push(Math.min(100, Math.max(0, value)))
  }

  const intervals = Array(steps).fill(100)
  
  const stopFn = executePattern(
    { pattern: values, intervals, loop: 1, char },
    'vibrate',
    deviceIndex
  )

  activePatterns.set(deviceIndex, {
    mode: 'gradient',
    stop: stopFn
  })

  // Handle hold and release if specified
  if (hold > 0) {
    deps.setWorkerTimeout(() => {
      if (release > 0) {
        const releaseSteps = Math.floor(release / 100)
        const releaseValues = []
        for (let i = 0; i < releaseSteps; i++) {
          const progress = i / releaseSteps
          const value = Math.round(end * (1 - progress))
          releaseValues.push(value)
        }
        executePattern(
          { pattern: releaseValues, intervals: Array(releaseSteps).fill(100), loop: 1, char },
          'vibrate',
          deviceIndex
        )
      }
    }, duration + hold)
  }
}

/**
 * Execute tease and denial mode sequence
 */
export async function executeTeaseAndDenialMode(deviceIndex, modeName, syncChar = null, meta = {}) {
  return executeModeSequence(deviceIndex, null, modeName, syncChar, meta)
}

export async function executeModeSequence(deviceIndex, modeId, modeName, syncChar = null, meta = {}) {
  const targetDevice = getLiveDevices()[deviceIndex]
  if (!targetDevice) return

  const resolveSequence = () => {
    if (modeId) {
      return PlayModeLoader.getSequence(modeId, modeName)
    }

    const enabledModes = PlayModeLoader.getEnabledModes ? PlayModeLoader.getEnabledModes() : []
    for (const enabledModeId of enabledModes) {
      const found = PlayModeLoader.getSequence(enabledModeId, modeName)
      if (found) return found
    }
    return null
  }

  const sequence = resolveSequence()

  const defaultDynamicProfile = {
    minJitter: 4,
    maxJitter: 6,
    durationJitterPct: 0.2,
    pauseJitterPct: 0.25,
    cyclesRange: [1, 4],
  }

  const modeMetadata = modeId ? PlayModeLoader.getMode(modeId) : null
  const dynamicProfile = {
    ...defaultDynamicProfile,
    ...(modeMetadata?.dynamics || {}),
    ...(sequence?.dynamics || {}),
  }

  if (!sequence) {
    console.warn(`${deps.NAME}: Mode sequence '${modeName}' not found`)
    return
  }

  // Clear any existing pattern
  await stopDevicePattern(deviceIndex)

  // Execute sequence steps
  const steps = sequence.steps || []
  let currentStep = 0
  let timeoutId = null
  let sessionStarted = false
  let sessionLeadApplied = false

  const eventMeta = {
    char: syncChar || null,
    traceId: Number.isFinite(meta?.traceId) ? Number(meta.traceId) : null,
    requestId: meta?.requestId || null,
    messageId: Number.isInteger(meta?.messageId) ? meta.messageId : null,
  }

  const resolveNumberInRange = (value, fallback = 0) => {
    if (Array.isArray(value) && value.length >= 2) {
      const lo = Number(value[0])
      const hi = Number(value[1])
      if (Number.isFinite(lo) && Number.isFinite(hi)) {
        const minVal = Math.min(lo, hi)
        const maxVal = Math.max(lo, hi)
        return minVal + Math.random() * (maxVal - minVal)
      }
    }

    if (typeof value === 'object' && value !== null) {
      const lo = Number(value.min)
      const hi = Number(value.max)
      if (Number.isFinite(lo) && Number.isFinite(hi)) {
        const minVal = Math.min(lo, hi)
        const maxVal = Math.max(lo, hi)
        return minVal + Math.random() * (maxVal - minVal)
      }
    }

    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }

  const resolveStepMinMax = (step) => {
    const rawMin = resolveNumberInRange(step.minRange ?? step.min, 10)
    const rawMax = resolveNumberInRange(step.maxRange ?? step.max, 80)

    const minJitter = Number(step.minJitter ?? dynamicProfile.minJitter)
    const maxJitter = Number(step.maxJitter ?? dynamicProfile.maxJitter)

    const minWithJitter = rawMin + ((Math.random() * 2 - 1) * minJitter)
    const maxWithJitter = rawMax + ((Math.random() * 2 - 1) * maxJitter)

    let resolvedMin = Math.max(0, Math.min(95, Math.round(minWithJitter)))
    let resolvedMax = Math.max(5, Math.min(100, Math.round(maxWithJitter)))

    if (resolvedMax <= resolvedMin) {
      resolvedMax = Math.min(100, resolvedMin + 8)
    }

    return { min: resolvedMin, max: resolvedMax }
  }

  const resolveStepDuration = (step) => {
    const baseDuration = resolveNumberInRange(step.durationRange ?? step.duration, 5000)
    const jitterPercent = Number(step.durationJitterPct ?? dynamicProfile.durationJitterPct)
    const jitterScale = 1 + ((Math.random() * 2 - 1) * jitterPercent)
    return Math.max(800, Math.round(baseDuration * jitterScale))
  }

  const resolveStepPause = (step) => {
    const basePause = resolveNumberInRange(step.pauseRange ?? step.pause, 0)
    const jitterPercent = Number(step.pauseJitterPct ?? dynamicProfile.pauseJitterPct)
    const jitterScale = 1 + ((Math.random() * 2 - 1) * jitterPercent)
    return Math.max(0, Math.round(basePause * jitterScale))
  }

  const resolveStepCycles = (step, stepDuration) => {
    if (step.cycles !== undefined) {
      return Math.max(1, Math.round(resolveNumberInRange(step.cycles, 1)))
    }

    if (step.cyclesRange !== undefined) {
      return Math.max(1, Math.round(resolveNumberInRange(step.cyclesRange, 1)))
    }

    const [profileLow, profileHigh] = dynamicProfile.cyclesRange || [1, 4]
    return Math.round(resolveNumberInRange([profileLow, profileHigh], 2))
  }

  const executeStep = async () => {
    if (currentStep >= steps.length) {
      if (sequence.repeat) {
        currentStep = 0
      } else {
        if (sessionStarted) {
          markDevicePlaybackStop(deviceIndex, 'sequence_complete')
        }
        return
      }
    }

    if (!sessionStarted) {
      sessionStarted = true
      // Use vibrate command type so VRM tick validation aligns.
      const didStartPlayback = markDevicePlaybackStart(deviceIndex, targetDevice, 'vibrate', eventMeta)
      sessionLeadApplied = !didStartPlayback
    }

    if (!sessionLeadApplied) {
      sessionLeadApplied = true
      await waitForSyncStartLead(eventMeta)
    }

    const step = steps[currentStep]
    const patternInfo = getPatternFunctionStrict(step.pattern)
    if (!patternInfo) {
      console.error(`${deps.NAME}: Sequence '${modeName}' references missing pattern '${step.pattern}', stopping sequence`)
      deps.updateStatus(`Sequence failed: ${modeName} (missing pattern '${step.pattern}')`)
      markDevicePlaybackStop(deviceIndex, 'sequence_invalid_pattern')
      return
    }
    const patternFunc = patternInfo.fn
    const stepDuration = resolveStepDuration(step)
    const stepPause = resolveStepPause(step)

    const stepCycles = resolveStepCycles(step, stepDuration)
    const { min: stepMin, max: stepMax } = resolveStepMinMax(step)
    const stepSteps = Math.floor(stepDuration / 100)
    const values = []

    for (let i = 0; i < stepSteps; i++) {
      const phase = (i / stepSteps) * stepCycles
      const rawValue = patternFunc(phase, 1)
      const normalizedRaw = rawValue >= 0 && rawValue <= 1 ? rawValue : (rawValue + 1) / 2
      const normalized = Math.min(1, Math.max(0, normalizedRaw))
      const pos = Math.round(stepMin + (stepMax - stepMin) * normalized)
      values.push(Math.min(100, Math.max(0, pos)))
    }

    const intervals = Array(stepSteps).fill(100)

    executePattern(
      {
        pattern: values,
        intervals,
        loop: 1,
        char: syncChar,
        _sequenceManaged: true,
        traceId: eventMeta.traceId,
        requestId: eventMeta.requestId,
        messageId: eventMeta.messageId,
      },
      'vibrate',
      deviceIndex
    )

    currentStep++
    const nextDelay = stepDuration + stepPause
    timeoutId = deps.setWorkerTimeout(executeStep, nextDelay)
    playModeSequenceTimeouts.add(timeoutId)
  }

  executeStep()

  // Store cleanup function
  activePatterns.set(deviceIndex, {
    mode: 'sequence',
    modeName: modeName,
    stop: () => {
      if (timeoutId) {
        deps.clearWorkerTimeout(timeoutId)
        playModeSequenceTimeouts.delete(timeoutId)
      }
      if (sessionStarted) {
        markDevicePlaybackStop(deviceIndex, 'sequence_stopped')
      }
    }
  })
}

/**
 * Generate waveform values for a pattern
 */
export function generateWaveformValues(patternName, steps, min, max) {
  const patternFunc = PlayModeLoader.getPattern(patternName)
  if (!patternFunc) {
    throw new Error(`${deps.NAME}: Pattern '${patternName}' not found`)
  }

  const values = []
  const range = max - min

  for (let i = 0; i < steps; i++) {
    const phase = i / steps
    const normalized = patternFunc(phase, 1)
    const value = min + (normalized * range)
    values.push(Math.max(0, Math.min(100, Math.round(value))))
  }

  return values
}

/**
 * Stop all device actions immediately
 */
export async function stopAllDeviceActions(options = {}) {
  const { silent = false } = options
  try {
    deps.updateAIStatusFromActivity?.()

    // Clear all active patterns first, even if no devices are currently visible.
    for (const [deviceIndex] of activePatterns.entries()) {
      await stopDevicePattern(deviceIndex)
    }
    activePatterns.clear()

    // Clear all pending sequence timers.
    playModeSequenceTimeouts.forEach(id => deps.clearWorkerTimeout(id))
    playModeSequenceTimeouts.clear()

    const connectedDevices = getLiveDevices()
    if (connectedDevices.length === 0) {
      if (!silent) {
        deps.updateStatus('Stopped all local actions (no connected devices found)')
      }
      return 'Stopped local actions (no connected devices)'
    }

    // Stop all devices
    const stopPromises = connectedDevices.map(async (dev) => {
      try {
        if (typeof dev?.vibrate === 'function') {
          await dev.vibrate(0)
        }
        if (typeof dev?.oscillate === 'function') {
          await dev.oscillate(0)
        }
        if (typeof dev?.linear === 'function') {
          await dev.linear(0, 120)
        }

        if (typeof dev?.scalar === 'function') {
          const actuators = getScalarActuators(dev)
          for (const actuator of actuators) {
            try {
              const scalarCmd = new deps.buttplug.ScalarSubcommand(
                Number(actuator.index) || 0,
                0,
                String(actuator.actuatorType || 'Vibrate')
              )
              await dev.scalar(scalarCmd)
            } catch (_e) {}
          }
        }

        const deviceIndex = connectedDevices.indexOf(dev)
        if (deviceIndex >= 0) {
          markDevicePlaybackStop(deviceIndex, 'stop_all')
        }
        return dev.name
      } catch (e) {
        return null
      }
    })

    const results = (await Promise.all(stopPromises)).filter(name => name !== null)
    if (!silent) {
      deps.updateStatus(`Stopped ${results.length} device(s)`)
    }
    
    return `Stopped ${results.length} device(s): ${results.join(', ')}`
  } catch (e) {
    console.error(`${deps.NAME}: Failed to stop device actions:`, e)
    return "Stop failed"
  }
}

/**
 * Get active pattern info
 */
export function getActivePatterns() {
  return activePatterns
}

// Export dependencies for other modules
export function getDeps() {
  return deps
}

// Default export
export default {
  initDeviceExecution,
  executeCommand,
  executePattern,
  executeWaveformPattern,
  executeGradientPattern,
  executeTeaseAndDenialMode,
  generateWaveformValues,
  stopAllDeviceActions,
  stopDevicePattern,
  applyIntensityScale,
  getActivePatterns
}
