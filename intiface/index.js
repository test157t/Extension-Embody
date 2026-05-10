/**
 * Extension-Intiface Main Module
 * 
 * This is the wiring file that connects all modules together.
 * For specific functionality, see:
 * - connected_devices.js - Device connection and management
 * - device_execution.js - Command execution and pattern playback
 * - command_parser.js - AI command parsing
 * - media_playback.js - Media player UI
 * - universal_funscript_sync.js - Funscript playback
 * - timeline_sequencer.js - Timeline sequencer
 * - _loader.js - Pattern library
 */

import { renderExtensionTemplateAsync, getContext } from "../../../../extensions.js"
import { eventSource, event_types, setExtensionPrompt, getExtensionPromptByName, extension_prompt_types, extension_prompt_roles, getRequestHeaders, generateRaw, updateMessageBlock, saveChatDebounced, sendSystemMessage, system_message_types, chat as globalChat } from "../../../../../script.js"

// Module imports
import { PlayModeLoader } from "./_loader.js"
import { initConnectedDevices, getConnectedDevices, setConnectedDevices, getDeviceChannel, setDeviceChannel, getDevicesOnChannel, getActiveChannels, getDeviceMotorCount, getDeviceDisplayName, getDeviceType, stopAllDevices, isClientConnected, getButtplug, onDeviceChange, connect as connectDevices, disconnect as disconnectDevices, rescan as rescanDevices } from "./connected_devices.js"
import { initTimelineModule, selectPatternForTimeline, addTimelineBlock, removeTimelineBlock, clearTimeline, getTimelineDuration, getContentDuration, formatTimelineTime, formatDurationShort, getChannelMotorCount, getPatternDefaults, getPatternDuration, renderTimeline, convertTimelineToFunscripts, playTimeline, pauseTimeline, resumeTimeline, stopTimeline, scrubTimeline, updateMotorLanes, attachLaneClickHandlers, setupTimelineEventHandlers, getTimelineBlocks, getTimelineCurrentPosition, isTimelinePlaying } from "./timeline_sequencer.js"
import { initMediaModule, initMediaPlayer, loadMediaPlayerAppearance, saveMediaPlayerAppearance, applyMediaPlayerAppearance, startInternalProxy, stopInternalProxy, refreshMenuMediaList, loadFunscript, processFunscript, startFunscriptSync, stopFunscriptSync, stopMediaPlayback, updateMediaPlayerStatus, createChatSidebarPanel, setupChatPanelEventHandlers, showChatMediaPanel, hideChatMediaPanel, loadChatMediaFile, setupChatVideoEventListeners, updateChatFunscriptUI, mediaPlayer } from "./media_playback.js"
import { initSync, startSync, pauseSync, resumeSync, stopSync, stopAllSync, setPollingRate, getPollingRate } from "./universal_funscript_sync.js"
import { initDeviceExecution, executeCommand, executePattern, executeWaveformPattern, executeGradientPattern, executeTeaseAndDenialMode, generateWaveformValues, stopAllDeviceActions, stopDevicePattern, applyIntensityScale, getActivePatterns } from "./device_execution.js"
import { parseDeviceCommands, setParserName } from "./command_parser.js"
import { initModeBuilder } from "./mode_builder.js"
import { initDynamicCommands } from "./dynamic_commands.js"
import { loadWorldInfo, saveWorldInfo, createNewWorldInfo, updateWorldInfoList, onWorldInfoChange } from "../../../../world-info.js"

const console = { ...globalThis.console }

const NAME = "intiface-connect"

if (typeof globalThis !== 'undefined') {
  globalThis.__intifacePromptManagedByIndex = true
}
if (typeof window !== 'undefined') {
  window.__intifacePromptManagedByIndex = true
}
const extensionName = "Extension-Embody/intiface"

// Global state (kept for compatibility)
let client
let buttplug
let devices = []
let device = null
let deviceAssignments = {}

// Command processing state
let messageCommands = []
let executedCommands = new Set()
let streamingText = ''
let lastRawStreamText = ''
let seenCommands = new Set()
let commandQueueInterval = null
let isExecutingCommands = false
let isStartingIntiface = false
let playModeSequenceTimeouts = new Set()
let pendingMediaListFromStream = false
let aiStopLatchActive = false
let systemCommandState = new Map()
let pendingSpokenSyncCommands = []
let pendingSpokenSyncKeys = new Set()
let spokenSyncQueuedKeysEver = new Set()
let spokenSyncCommandOrdinal = 0
let spokenSyncSeenCommandSignaturesByRequest = new Map()
let spokenSyncLastChunkStartKey = ''
let spokenSyncLastExecutionAt = 0
let lastKnownChatIdentity = ''
let activeTtsRequestId = null
let activeTtsMessageId = null
let spokenSyncTraceCounter = 0
let CHUNK_SYNC_DEBUG = false
const CHUNK_SYNC_FALLBACK_CHUNK_DELAY = 1
const CHUNK_SYNC_SUBTITLE_EARLY_LEAD_CHUNKS = 0
const CHUNK_SYNC_RECENT_EXECUTION_WINDOW_MS = 1800
const CHUNK_SYNC_OFFSET_EARLY_LEAD_MIN = 0
const CHUNK_SYNC_OFFSET_EARLY_LEAD_MAX = 0
const CHUNK_SYNC_OFFSET_EXTRA_CHUNK_LEAD = 0.33
let TARGET_PARSE_DEBUG = false
const TARGET_SENTINEL_ANY_CHANNEL = -1
const TARGET_SENTINEL_CHANNEL_A = -101
const TARGET_SENTINEL_CHANNEL_B = -102
const TARGET_SENTINEL_CHANNEL_C = -103
const TARGET_SENTINEL_CHANNEL_D = -104

// Settings
let globalIntensityScale = 100
let globalInvert = false
let devicePollingRate = 30
let aiCommandsEnabled = true
let aiTtsSyncEnabled = false
let aiTtsSyncOffsetMs = 0
let aiTtsSyncStartTimeoutMs = 1200
let aiSyncStartLeadMs = 1200
let aiTtsInterruptPolicy = 'grace'
let intifaceDebugLoggingEnabled = false

// TTS sync state
let ttsSyncWaitingForStart = false
let ttsSyncActive = false
let ttsSyncLastReleaseSource = 'none'
let ttsSyncStartTimeoutId = null
let ttsSyncOffsetTimeoutId = null
let ttsInterruptGraceTimeoutId = null

// Timer worker for background vibration
let timerWorker = null
let workerTimers = new Map()
let workerTimerId = 0
let isWorkerTimerRunning = false
const WORKER_TICK_INTERVAL_MS = 25
const INTIFACE_DEVICE_LOREBOOK_NAME = 'intiface_device_profiles'
const INTIFACE_DEVICE_LOREBOOK_TEMPLATE_PATH = '/scripts/extensions/third-party/Extension-Embody/intiface/lorebooks/intiface_device_profiles.json'

// AI status check interval
let aiStatusCheckInterval = null
let connectionStateMonitorInterval = null
let lastObservedConnectionState = null
let pendingModelRuntimeNotice = ''
let pendingModelRuntimeNoticeAt = 0
let lastCallModeDisconnectReplyAt = 0
const CALL_MODE_DISCONNECT_REPLY_COOLDOWN_MS = 8000
let lastUiDisconnectIntentAt = 0
let autoReconnectInFlight = false
const UI_DISCONNECT_INTENT_WINDOW_MS = 2500
const AUTO_RECONNECT_MAX_ATTEMPTS = 3
let lastDisconnectReason = 'none'

// Pattern tracking
let activePatterns = new Map()

// Mode settings (managed by PlayModeLoader)
const modeSettings = new Proxy({}, {
  get(target, prop) {
    const camelCaseToFolder = {
      'denialDomina': 'denial',
      'milkMaid': 'milking',
      'petTraining': 'training',
      'sissySurrender': 'sissy',
      'prejacPrincess': 'prejac',
      'roboticRuination': 'robotic',
      'evilEdgingMistress': 'evil',
      'frustrationFairy': 'frustration',
      'hypnoHelper': 'hypno',
      'chastityCaretaker': 'chastity'
    }
    const modeId = camelCaseToFolder[prop] || prop
    if (PlayModeLoader?.isModeEnabled) {
      return PlayModeLoader.isModeEnabled(modeId)
    }
    return target[prop]
  },
  set(target, prop, value) {
    const camelCaseToFolder = {
      'denialDomina': 'denial',
      'milkMaid': 'milking',
      'petTraining': 'training',
      'sissySurrender': 'sissy',
      'prejacPrincess': 'prejac',
      'roboticRuination': 'robotic',
      'evilEdgingMistress': 'evil',
      'frustrationFairy': 'frustration',
      'hypnoHelper': 'hypno',
      'chastityCaretaker': 'chastity'
    }
    const modeId = camelCaseToFolder[prop] || prop
    if (PlayModeLoader?.setModeEnabled) {
      PlayModeLoader.setModeEnabled(modeId, value)
    }
    target[prop] = value
    return true
  }
})

const modeIntensityMultipliers = new Proxy({}, {
  get(target, prop) {
    const camelCaseToFolder = {
      'denialDomina': 'denial',
      'milkMaid': 'milking',
      'petTraining': 'training',
      'sissySurrender': 'sissy',
      'prejacPrincess': 'prejac',
      'roboticRuination': 'robotic',
      'evilEdgingMistress': 'evil',
      'frustrationFairy': 'frustration',
      'hypnoHelper': 'hypno',
      'chastityCaretaker': 'chastity'
    }
    const modeId = camelCaseToFolder[prop] || prop
    if (PlayModeLoader?.getIntensityMultiplier) {
      return PlayModeLoader.getIntensityMultiplier(modeId)
    }
    return target[prop]
  },
  set(target, prop, value) {
    const camelCaseToFolder = {
      'denialDomina': 'denial',
      'milkMaid': 'milking',
      'petTraining': 'training',
      'sissySurrender': 'sissy',
      'prejacPrincess': 'prejac',
      'roboticRuination': 'robotic',
      'evilEdgingMistress': 'evil',
      'frustrationFairy': 'frustration',
      'hypnoHelper': 'hypno',
      'chastityCaretaker': 'chastity'
    }
    const modeId = camelCaseToFolder[prop] || prop
    if (PlayModeLoader?.setIntensityMultiplier) {
      PlayModeLoader.setIntensityMultiplier(modeId, value)
    }
    target[prop] = value
    return true
  }
})

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

function updateStatus(status, isError = false) {
  const statusPanel = $("#intiface-status-panel")
  statusPanel.text(`Status: ${status}`)
  if (isError) {
    statusPanel.removeClass("connected").addClass("disconnected")
  }
}

function updateButtonStates(isConnected) {
  const connectButton = $("#intiface-connect-action-button")
  if (isConnected) {
    connectButton
      .html('<i class="fa-solid fa-power-off"></i> Disconnect')
      .removeClass("connect-button")
      .addClass("disconnect-button")
  } else {
    connectButton
      .html('<i class="fa-solid fa-power-off"></i> Connect')
      .removeClass("disconnect-button")
      .addClass("connect-button")
  }
  $("#intiface-rescan-button").toggle(isConnected)
  $("#intiface-start-timer-button").toggle(isConnected)
  $("#intiface-connect-button .drawer-icon").toggleClass("flashing-icon", isConnected)
}

function getPollingInterval() {
  return Math.round(1000 / devicePollingRate)
}

function getErrorMessage(error, fallback = 'unknown error') {
  if (error instanceof Error && typeof error.message === 'string' && error.message.trim()) {
    return error.message.trim()
  }
  if (typeof error === 'string' && error.trim()) {
    return error.trim()
  }
  if (error && typeof error === 'object') {
    const msg = String(error?.message || error?.reason || error?.error || '').trim()
    if (msg) return msg
  }
  return fallback
}

function applyInversion(value) {
  if (globalInvert) {
    return 100 - value
  }
  return value
}

function loadGlobalInvert() {
  try {
    const saved = localStorage.getItem('intiface-global-invert')
    if (saved !== null) {
      globalInvert = saved === 'true'
    }
  } catch (e) {
    console.error(`${NAME}: Failed to load global invert:`, e)
    globalInvert = false
  }
}

function saveGlobalInvert(value) {
  try {
    globalInvert = value
    localStorage.setItem('intiface-global-invert', value.toString())
  } catch (e) {
    console.error(`${NAME}: Failed to save global invert:`, e)
  }
}

function loadDevicePollingRate() {
  try {
    const saved = localStorage.getItem('intiface-polling-rate')
    if (saved) {
      devicePollingRate = parseInt(saved, 10) || 30
      if (devicePollingRate < 10) devicePollingRate = 10
      if (devicePollingRate > 120) devicePollingRate = 120
    }
  } catch (e) {
    console.error(`${NAME}: Failed to load polling rate:`, e)
    devicePollingRate = 30
  }
}

function saveDevicePollingRate(rate) {
  try {
    devicePollingRate = rate
    localStorage.setItem('intiface-polling-rate', rate.toString())
  } catch (e) {
    console.error(`${NAME}: Failed to save polling rate:`, e)
  }
}

function updateExePathStatus(pathValue) {
  const statusEl = $("#intiface-exe-status")
  const trimmed = String(pathValue || '').trim()

  if (!trimmed) {
    statusEl.css('color', '#888').text('Not configured')
    return
  }

  statusEl.css('color', '#4CAF50').text('Configured')
}

function saveExePath(pathValue) {
  const trimmed = String(pathValue || '').trim()
  localStorage.setItem('intiface-exe-path', trimmed)
  updateExePathStatus(trimmed)
  lastPromptHash = ''
  updatePrompt()
}

function loadExePath() {
  const saved = localStorage.getItem('intiface-exe-path') || ''
  $("#intiface-exe-path").val(saved)
  updateExePathStatus(saved)
}

async function browseExePath() {
  const button = $("#intiface-exe-browse")
  const originalHtml = button.html()
  button.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i>')

  try {
    const response = await fetch('/api/plugins/intiface-launcher/browse-exe', {
      method: 'GET',
      headers: getRequestHeaders(),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const data = await response.json()
    if (data?.success && data.path) {
      $("#intiface-exe-path").val(data.path)
      saveExePath(data.path)
      updateStatus('Selected Intiface executable path')
    } else if (data?.cancelled) {
      updateStatus('Executable browse cancelled')
    } else {
      updateStatus(data?.error || 'Failed to browse for executable', true)
    }
  } catch (e) {
    console.error(`${NAME}: Failed to browse executable path:`, e)
    updateStatus('Browse unavailable - enter path manually', true)
  } finally {
    button.prop('disabled', false).html(originalHtml)
  }
}

function loadAICommandsEnabled() {
  try {
    const saved = localStorage.getItem('intiface-ai-commands-enabled')
    aiCommandsEnabled = saved !== null ? saved === 'true' : true
  } catch (e) {
    console.error(`${NAME}: Failed to load AI command toggle:`, e)
    aiCommandsEnabled = true
  }
}

function saveAICommandsEnabled(enabled) {
  try {
    aiCommandsEnabled = enabled
    localStorage.setItem('intiface-ai-commands-enabled', enabled.toString())
  } catch (e) {
    console.error(`${NAME}: Failed to save AI command toggle:`, e)
  }
}

function loadAITtsSyncSettings() {
  try {
    const savedEnabled = localStorage.getItem('intiface-ai-tts-sync-enabled')
    aiTtsSyncEnabled = savedEnabled !== null ? savedEnabled === 'true' : false

    const savedOffsetRaw = localStorage.getItem('intiface-ai-tts-sync-offset-ms')
    const savedOffset = Number.parseInt(savedOffsetRaw ?? '0', 10)
    aiTtsSyncOffsetMs = Number.isFinite(savedOffset) ? Math.max(-1500, Math.min(1500, savedOffset)) : 0

    const savedTimeout = Number.parseInt(localStorage.getItem('intiface-ai-tts-sync-timeout-ms') || '1200', 10)
    aiTtsSyncStartTimeoutMs = Number.isFinite(savedTimeout) ? Math.max(300, Math.min(5000, savedTimeout)) : 1200

    const savedLead = Number.parseInt(localStorage.getItem('intiface-ai-sync-start-lead-ms') || '1200', 10)
    aiSyncStartLeadMs = Number.isFinite(savedLead) ? Math.max(0, Math.min(3000, savedLead)) : 1200

    const savedPolicy = String(localStorage.getItem('intiface-ai-tts-interrupt-policy') || 'grace').trim().toLowerCase()
    aiTtsInterruptPolicy = ['flush', 'grace', 'preserve'].includes(savedPolicy) ? savedPolicy : 'grace'
  } catch (e) {
    console.error(`${NAME}: Failed to load AI TTS sync settings:`, e)
    aiTtsSyncEnabled = false
    aiTtsSyncOffsetMs = 0
    aiTtsSyncStartTimeoutMs = 1200
    aiSyncStartLeadMs = 1200
    aiTtsInterruptPolicy = 'grace'
  }
}

function loadDebugLoggingSetting() {
  try {
    const saved = localStorage.getItem('intiface-debug-logging-enabled')
    intifaceDebugLoggingEnabled = saved !== null ? saved === 'true' : false
  } catch (e) {
    console.error(`${NAME}: Failed to load debug logging setting:`, e)
    intifaceDebugLoggingEnabled = false
  }

  CHUNK_SYNC_DEBUG = intifaceDebugLoggingEnabled
  TARGET_PARSE_DEBUG = intifaceDebugLoggingEnabled
}

function saveDebugLoggingSetting(enabled) {
  try {
    intifaceDebugLoggingEnabled = enabled
    CHUNK_SYNC_DEBUG = enabled
    TARGET_PARSE_DEBUG = enabled
    localStorage.setItem('intiface-debug-logging-enabled', enabled.toString())
  } catch (e) {
    console.error(`${NAME}: Failed to save debug logging setting:`, e)
  }
}

function saveAITtsSyncEnabled(enabled) {
  try {
    aiTtsSyncEnabled = enabled
    localStorage.setItem('intiface-ai-tts-sync-enabled', enabled.toString())
  } catch (e) {
    console.error(`${NAME}: Failed to save AI TTS sync enabled:`, e)
  }
}

function saveAITtsSyncOffsetMs(value) {
  try {
    aiTtsSyncOffsetMs = Math.max(-1500, Math.min(1500, Number.parseInt(value, 10) || 0))
    localStorage.setItem('intiface-ai-tts-sync-offset-ms', aiTtsSyncOffsetMs.toString())
  } catch (e) {
    console.error(`${NAME}: Failed to save AI TTS sync offset:`, e)
  }
}

function saveAITtsSyncTimeoutMs(value) {
  try {
    aiTtsSyncStartTimeoutMs = Math.max(300, Math.min(5000, Number.parseInt(value, 10) || 1200))
    localStorage.setItem('intiface-ai-tts-sync-timeout-ms', aiTtsSyncStartTimeoutMs.toString())
  } catch (e) {
    console.error(`${NAME}: Failed to save AI TTS sync timeout:`, e)
  }
}

function saveAISyncStartLeadMs(value) {
  try {
    aiSyncStartLeadMs = Math.max(0, Math.min(3000, Number.parseInt(value, 10) || 0))
    localStorage.setItem('intiface-ai-sync-start-lead-ms', aiSyncStartLeadMs.toString())
  } catch (e) {
    console.error(`${NAME}: Failed to save AI sync start lead:`, e)
  }
}

function saveAITtsInterruptPolicy(value) {
  try {
    const normalized = String(value || '').trim().toLowerCase()
    aiTtsInterruptPolicy = ['flush', 'grace', 'preserve'].includes(normalized) ? normalized : 'grace'
    localStorage.setItem('intiface-ai-tts-interrupt-policy', aiTtsInterruptPolicy)
  } catch (e) {
    console.error(`${NAME}: Failed to save AI TTS interrupt policy:`, e)
  }
}

function updateAITtsSyncControls() {
  const disabled = !aiTtsSyncEnabled
  $("#intiface-ai-tts-sync-offset").prop('disabled', disabled)
  $("#intiface-ai-tts-sync-timeout").prop('disabled', disabled)
  $("#intiface-ai-sync-start-lead").prop('disabled', disabled)
  $("#intiface-ai-tts-interrupt-policy").prop('disabled', disabled)
}

function clearTtsSyncTimers() {
  if (ttsSyncStartTimeoutId) {
    clearWorkerTimeout(ttsSyncStartTimeoutId)
    ttsSyncStartTimeoutId = null
  }
  if (ttsSyncOffsetTimeoutId) {
    clearWorkerTimeout(ttsSyncOffsetTimeoutId)
    ttsSyncOffsetTimeoutId = null
  }
}

function resetTtsSyncState() {
  clearTtsSyncTimers()
  ttsSyncWaitingForStart = false
  ttsSyncActive = false
  ttsSyncLastReleaseSource = 'none'
}

function clearSpokenSyncQueueState() {
  pendingSpokenSyncCommands = []
  pendingSpokenSyncKeys.clear()
  spokenSyncQueuedKeysEver.clear()
  spokenSyncCommandOrdinal = 0
  spokenSyncLastExecutionAt = 0
  spokenSyncSeenCommandSignaturesByRequest.clear()
  spokenSyncLastChunkStartKey = ''
  activeTtsMessageId = null
}

function clearTtsInterruptGraceTimer() {
  if (!ttsInterruptGraceTimeoutId) return
  clearWorkerTimeout(ttsInterruptGraceTimeoutId)
  ttsInterruptGraceTimeoutId = null
}

function shouldGateDeviceCommandExecution() {
  return aiCommandsEnabled && aiTtsSyncEnabled && ttsSyncWaitingForStart
}

function armTtsSyncGate() {
  if (!aiCommandsEnabled || !aiTtsSyncEnabled) return
  if (ttsSyncWaitingForStart || ttsSyncActive) return

  ttsSyncWaitingForStart = true
  ttsSyncLastReleaseSource = 'waiting'

  if (ttsSyncStartTimeoutId) {
    clearWorkerTimeout(ttsSyncStartTimeoutId)
  }

  ttsSyncStartTimeoutId = setWorkerTimeout(() => {
    ttsSyncStartTimeoutId = null
    if (!ttsSyncWaitingForStart) return
    releaseTtsSyncGate('fallback')
  }, aiTtsSyncStartTimeoutMs)

  updateAIStatusFromActivity()
}

function releaseTtsSyncGate(source = 'tts') {
  const applyRelease = () => {
    clearTtsSyncTimers()
    ttsSyncWaitingForStart = false
    ttsSyncActive = true
    ttsSyncLastReleaseSource = source
    updateAIStatusFromActivity()
    processCommandQueue()
  }

  if (source === 'tts' && aiTtsSyncOffsetMs > 0) {
    if (ttsSyncOffsetTimeoutId) {
      clearWorkerTimeout(ttsSyncOffsetTimeoutId)
    }
    ttsSyncOffsetTimeoutId = setWorkerTimeout(() => {
      ttsSyncOffsetTimeoutId = null
      applyRelease()
    }, aiTtsSyncOffsetMs)
    return
  }

  applyRelease()
}

// Timer worker functions
function initTimerWorker() {
  try {
    const workerUrl = new URL('background-worker.js', import.meta.url).href
    timerWorker = new Worker(workerUrl)

    timerWorker.onmessage = (e) => {
      const { type, timestamp } = e.data
      if (type === 'tick') {
        const now = timestamp || Date.now()
        const timersToExecute = []

        for (const [id, timer] of workerTimers) {
          if (!timer.callback) continue
          const timeSinceLast = timer.lastExecuted ? now - timer.lastExecuted : now - timer.createdAt
          if (timeSinceLast >= timer.interval) {
            timersToExecute.push(id)
          }
        }

        for (const id of timersToExecute) {
          const timer = workerTimers.get(id)
          if (timer?.callback) {
            try {
              timer.callback()
              if (!timer.isOneShot) {
                timer.lastExecuted = now
              } else {
                workerTimers.delete(id)
              }
            } catch (err) {
              console.error(`${NAME}: Timer callback error:`, err)
              workerTimers.delete(id)
            }
          }
        }
      }
    }

    timerWorker.onerror = (err) => {
      console.error(`${NAME}: Timer worker error:`, err)
      timerWorker = null
      isWorkerTimerRunning = false
    }

    console.log(`${NAME}: Timer worker initialized successfully`)
  } catch (e) {
    console.error(`${NAME}: Failed to initialize timer worker:`, e)
    timerWorker = null
  }
}

function setWorkerTimeout(callback, delay) {
  if (timerWorker && delay >= 50) {
    const id = ++workerTimerId
    const now = Date.now()
    workerTimers.set(id, { callback, interval: delay, createdAt: now, lastExecuted: null, isOneShot: true })

    if (!isWorkerTimerRunning) {
      timerWorker.postMessage({ command: 'start', data: { interval: WORKER_TICK_INTERVAL_MS } })
      isWorkerTimerRunning = true
    }

    return id
  } else {
    return setTimeout(callback, delay)
  }
}

function setWorkerInterval(callback, delay) {
  if (timerWorker && delay >= 50) {
    const id = ++workerTimerId
    const now = Date.now()
    workerTimers.set(id, { callback, interval: delay, createdAt: now, lastExecuted: null, isOneShot: false })

    if (!isWorkerTimerRunning) {
      timerWorker.postMessage({ command: 'start', data: { interval: WORKER_TICK_INTERVAL_MS } })
      isWorkerTimerRunning = true
    }

    return id
  } else {
    return setInterval(callback, delay)
  }
}

function clearWorkerTimeout(id) {
  if (typeof id === 'number' && workerTimers.has(id)) {
    workerTimers.delete(id)

    if (timerWorker && workerTimers.size === 0 && isWorkerTimerRunning) {
      timerWorker.postMessage({ command: 'stop' })
      isWorkerTimerRunning = false
    }
  } else if (typeof id === 'number' && id !== 0) {
    clearInterval(id)
  } else if (typeof id === 'object' && id !== null) {
    clearTimeout(id)
  }
}

function getDeviceShorthand(dev) {
  const devName = (dev.displayName || dev.name || '').toLowerCase()
  return devName.split(' ')[0]
}

function getDeviceDefaultIntensity(dev) {
  return 100
}

// ==========================================
// AI COMMAND HANDLING
// ==========================================

function updateAIStatusFromActivity() {
  const statusEl = $("#intiface-ai-status")
  const textEl = $("#intiface-ai-status-text")

  if (!aiCommandsEnabled) {
    statusEl.css("background", "rgba(120,120,120,0.15)")
    textEl.css("color", "#aaa").text("AI control is disabled")
    return
  }

  const hasActivePatterns = activePatterns.size > 0
  const isProcessing = isExecutingCommands || messageCommands.length > 0

  if (shouldGateDeviceCommandExecution()) {
    statusEl.css("background", "rgba(255, 193, 7, 0.18)")
    textEl.css("color", "#e5b93c").text("Waiting for VoiceForge TTS playback...")
    return
  }

  if (hasActivePatterns || isProcessing) {
    statusEl.css("background", "rgba(76, 175, 80, 0.15)")
    const sourceSuffix = ttsSyncLastReleaseSource === 'fallback' ? ' (timeout fallback)' : ''
    textEl.css("color", "#4CAF50").text(`AI is controlling your device...${sourceSuffix}`)
  } else {
    statusEl.css("background", "rgba(0,0,0,0.05)")
    textEl.css("color", "#888").text("AI is ready to control your device via chat commands")
  }
}

function startAIStatusMonitoring() {
  if (aiStatusCheckInterval) return
  aiStatusCheckInterval = setInterval(updateAIStatusFromActivity, 500)
}

function stopAIStatusMonitoring() {
  if (aiStatusCheckInterval) {
    clearInterval(aiStatusCheckInterval)
    aiStatusCheckInterval = null
  }
}

function clearPendingModelRuntimeNotice() {
  if (!pendingModelRuntimeNotice) return
  pendingModelRuntimeNotice = ''
  pendingModelRuntimeNoticeAt = 0
  updatePrompt()
}

function setPendingModelRuntimeNotice(message) {
  const normalized = String(message || '').trim()
  if (!normalized) return
  pendingModelRuntimeNotice = normalized
  pendingModelRuntimeNoticeAt = Date.now()
  updatePrompt()
}

function isVoiceforgeCallModeActive() {
  try {
    const button = document.getElementById('voiceforge_call_button')
    return !!button?.classList?.contains('active')
  } catch (_e) {
    return false
  }
}

function classifyDisconnectReason() {
  const now = Date.now()
  if ((now - lastUiDisconnectIntentAt) <= UI_DISCONNECT_INTENT_WINDOW_MS) {
    lastUiDisconnectIntentAt = 0
    return 'ui_manual'
  }
  return 'unexpected'
}

async function attemptAutomaticReconnect() {
  if (autoReconnectInFlight) return false
  autoReconnectInFlight = true

  try {
    for (let attempt = 1; attempt <= AUTO_RECONNECT_MAX_ATTEMPTS; attempt++) {
      if (client?.connected || isClientConnected()) {
        return true
      }

      try {
        await connectDevices(true)
      } catch (_e) {
        // Keep retrying with short backoff.
      }

      if (client?.connected || isClientConnected()) {
        return true
      }

      await waitMs(800 * attempt)
    }
  } finally {
    autoReconnectInFlight = false
  }

  return !!(client?.connected || isClientConnected())
}

async function maybeTriggerCallModeDisconnectReply(reason = 'unexpected') {
  if (!isVoiceforgeCallModeActive()) return

  const now = Date.now()
  if ((now - lastCallModeDisconnectReplyAt) < CALL_MODE_DISCONNECT_REPLY_COOLDOWN_MS) {
    return
  }
  lastCallModeDisconnectReplyAt = now

  const context = getContext?.()
  if (!context || typeof context.generate !== 'function') {
    return
  }

  try {
    if (reason === 'ui_manual') {
      sendSystemMessage(
        system_message_types.GENERIC,
        '[System status update: The user manually disconnected Intiface from the UI. Give a short, mildly annoyed acknowledgment, and do not auto-reconnect unless asked.]',
        { isSmallSys: true, source: 'intiface_runtime' }
      )
    } else {
      sendSystemMessage(
        system_message_types.GENERIC,
        '[System status update: Intiface disconnected unexpectedly (likely server-side). Briefly acknowledge this and say you are attempting automatic reconnect now.]',
        { isSmallSys: true, source: 'intiface_runtime' }
      )
    }
    await context.generate()
  } catch (e) {
    console.warn(`${NAME}: Failed to auto-generate call-mode disconnect acknowledgement`, e)
  }
}

function getConnectionStateKey() {
  const connected = !!(client?.connected || isClientConnected())
  const deviceCount = Array.isArray(getConnectedDevices()) ? getConnectedDevices().length : 0
  return `${connected ? 1 : 0}:${deviceCount}`
}

function startConnectionStateMonitoring() {
  if (connectionStateMonitorInterval) return

  lastObservedConnectionState = getConnectionStateKey()
  connectionStateMonitorInterval = setInterval(() => {
    const nextState = getConnectionStateKey()
    if (nextState === lastObservedConnectionState) {
      return
    }

    const [wasConnected] = String(lastObservedConnectionState || '0:0').split(':')
    const [isConnected] = String(nextState).split(':')
    lastObservedConnectionState = nextState

    updatePrompt()
    updateButtonStates(isConnected === '1')

    if (isConnected === '1') {
      clearPendingModelRuntimeNotice()
    }

    if (wasConnected !== isConnected) {
      updateStatus(isConnected === '1' ? 'Connected' : 'Disconnected')
      if (wasConnected === '1' && isConnected === '0') {
        const disconnectReason = classifyDisconnectReason()
        lastDisconnectReason = disconnectReason
        if (disconnectReason === 'ui_manual') {
          setPendingModelRuntimeNotice('User manually disconnected Intiface from the UI. Acknowledge this in your next reply with mild annoyance, and wait for user instruction before reconnecting.')
          void maybeTriggerCallModeDisconnectReply('ui_manual')
        } else {
          setPendingModelRuntimeNotice('Intiface disconnected unexpectedly. Explain you are attempting automatic reconnect, then proceed if successful.')
          void maybeTriggerCallModeDisconnectReply('unexpected')
          void (async () => {
            const restored = await attemptAutomaticReconnect()
            if (restored) {
              setPendingModelRuntimeNotice('Intiface connection was restored automatically after an unexpected disconnect. Briefly confirm recovery.')
            } else {
              setPendingModelRuntimeNotice('Automatic reconnect failed after retries. Ask the user to verify Intiface server status and approve another reconnect attempt.')
            }
          })()
        }
      } else if (wasConnected === '0' && isConnected === '1') {
        lastDisconnectReason = 'none'
      }
    }
  }, 1000)
}

async function loadIntifaceDeviceLorebookTemplate() {
  try {
    const response = await fetch(INTIFACE_DEVICE_LOREBOOK_TEMPLATE_PATH, {
      method: 'GET',
      cache: 'no-cache',
    })

    if (!response.ok) {
      return null
    }

    const data = await response.json()
    if (!data || typeof data !== 'object' || !data.entries || typeof data.entries !== 'object') {
      return null
    }

    return data
  } catch (_e) {
    return null
  }
}

async function ensureIntifaceDeviceLorebookSelected() {
  try {
    await updateWorldInfoList()
    const option = $('#world_info').children('option').filter(function () {
      return String($(this).text() || '').trim().toLowerCase() === INTIFACE_DEVICE_LOREBOOK_NAME.toLowerCase()
    })

    if (!option.length) {
      return
    }

    if (!option.prop('selected')) {
      option.prop('selected', true)
      onWorldInfoChange('__notSlashCommand__')
    }
  } catch (e) {
    console.warn(`${NAME}: Failed selecting Intiface device lorebook`, e)
  }
}

async function ensureIntifaceDeviceLorebook() {
  if (!aiCommandsEnabled) return

  try {
    const template = await loadIntifaceDeviceLorebookTemplate()
    if (!template) {
      return
    }

    const desiredVersion = Number(template?.extensions?.intifaceVersion || 1)
    let existing = await loadWorldInfo(INTIFACE_DEVICE_LOREBOOK_NAME)

    if (!existing) {
      await createNewWorldInfo(INTIFACE_DEVICE_LOREBOOK_NAME, { interactive: false })
      existing = await loadWorldInfo(INTIFACE_DEVICE_LOREBOOK_NAME)
    }

    if (!existing) {
      return
    }

    const isManaged = existing?.extensions?.intifaceManaged === true
    const currentVersion = Number(existing?.extensions?.intifaceVersion || 0)
    const entryCount = existing?.entries ? Object.keys(existing.entries).length : 0
    const shouldWrite = (isManaged && (currentVersion < desiredVersion || entryCount === 0)) || (!isManaged && entryCount === 0)

    if (shouldWrite) {
      const merged = {
        ...existing,
        ...template,
        name: INTIFACE_DEVICE_LOREBOOK_NAME,
        entries: template.entries,
        extensions: {
          ...(existing?.extensions || {}),
          ...(template?.extensions || {}),
          intifaceManaged: true,
          intifaceVersion: desiredVersion,
        },
      }
      await saveWorldInfo(INTIFACE_DEVICE_LOREBOOK_NAME, merged, true)
    }

    await ensureIntifaceDeviceLorebookSelected()
  } catch (e) {
    console.warn(`${NAME}: Failed ensuring Intiface device lorebook`, e)
  }
}

async function processCommandQueue() {
  if (!aiCommandsEnabled) {
    messageCommands = []
    resetTtsSyncState()
    return
  }

  if (isExecutingCommands || messageCommands.length === 0) return

  if (shouldGateDeviceCommandExecution()) {
    const stopCommands = messageCommands.filter((cmd) => isStopCommandType(cmd?.type))
    if (stopCommands.length === 0) {
      updateAIStatusFromActivity()
      return
    }
    messageCommands = stopCommands
  }

  const playerPanel = $("#intiface-chat-media-panel")
  const isMediaPlaying = playerPanel.length > 0 && playerPanel.is(":visible") && mediaPlayer.isPlaying

  if (isMediaPlaying) {
    const stopCommands = messageCommands.filter((cmd) => isStopCommandType(cmd?.type))
    if (stopCommands.length === 0) {
      if (messageCommands.length > 0) {
        messageCommands = []
        resetTtsSyncState()
      }
      return
    }
    messageCommands = stopCommands
  }

  isExecutingCommands = true
  startAIStatusMonitoring()

  while (messageCommands.length > 0) {
    const cmd = messageCommands.shift()
    if (!cmd) continue

    if (isStopCommandType(cmd.type)) {
      await executeStopCommand(cmd)
      continue
    }

    if (aiStopLatchActive) {
      continue
    }

    if (isSystemCommandType(cmd.type)) {
      continue
    }

    const currentPlayerPanel = $("#intiface-chat-media-panel")
    if (currentPlayerPanel.length > 0 && currentPlayerPanel.is(":visible") && mediaPlayer.isPlaying) {
      const remainingStopCommands = messageCommands.filter((queuedCmd) => isStopCommandType(queuedCmd?.type))
      if (remainingStopCommands.length === 0) {
        messageCommands = []
        resetTtsSyncState()
        break
      }
      messageCommands = remainingStopCommands
      continue
    }

    if (!client.connected) {
      continue
    }

    const expandedCommands = expandCommandTargetsForExecution(cmd)
    if (expandedCommands.length > 0) {
      clearPendingModelRuntimeNotice()
    }
    for (let i = 0; i < expandedCommands.length; i++) {
      const expandedCmd = expandedCommands[i]
      const cmdForExecution = i === 0 ? expandedCmd : { ...expandedCmd, _skipSyncStartLead: true }
      await executeCommand(cmdForExecution)
    }
  }

  isExecutingCommands = false
  updateAIStatusFromActivity()
}

async function executeSystemCommand(cmd) {
  const type = String(cmd?.type || '').trim()
  if (!type) {
    return
  }

  const gate = shouldSkipSystemCommand(type)
  if (gate.skip) {
    return
  }

  let succeeded = false
  try {
    if (type === 'interface_start') {
      if (isStartingIntiface) {
        return
      }

      const exePath = String(localStorage.getItem('intiface-exe-path') || '').trim()
      if (!exePath) {
        updateStatus('Cannot start Intiface: executable path is not configured', true)
        return
      }

      isStartingIntiface = true
      updateStatus('Starting Intiface Central...')
      emitIntifaceCommandSyncPulse(cmd, 'start')

      const response = await fetch('/api/plugins/intiface-launcher/start', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ exePath })
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || `HTTP ${response.status}`)
      }

      updateStatus('Intiface Central launch requested')
      emitIntifaceUiAction('interface_start')
      succeeded = true
      scheduleIntifaceCommandSyncStop(cmd)
      setTimeout(() => updatePrompt(), 200)
      return
    }

    if (type === 'interface_connect') {
      emitIntifaceCommandSyncPulse(cmd, 'start')
      await connectDevices()
      emitIntifaceUiAction('interface_connect')
      succeeded = true
      scheduleIntifaceCommandSyncStop(cmd)
      setTimeout(() => updatePrompt(), 200)
      return
    }

    if (type === 'interface_disconnect') {
      emitIntifaceCommandSyncPulse(cmd, 'start')
      await disconnectDevices()
      succeeded = true
      scheduleIntifaceCommandSyncStop(cmd)
      setTimeout(() => updatePrompt(), 200)
      return
    }

    if (type === 'interface_scan') {
      emitIntifaceCommandSyncPulse(cmd, 'start')
      if (!client?.connected) {
        updateStatus('Scan requested: connecting first...')
        await connectDevices()
        emitIntifaceUiAction('interface_connect')
      }
      await rescanDevices()
      emitIntifaceUiAction('interface_scan')
      succeeded = true
      scheduleIntifaceCommandSyncStop(cmd)
      setTimeout(() => updatePrompt(), 200)
    }
  } catch (e) {
    const action = String(cmd?.type || 'system command').replace('interface_', '')
    const message = getErrorMessage(e, 'unknown error')
    updateStatus(`Failed to ${action}: ${message}`, true)
    console.error(`${NAME}: System command failed (${cmd?.type}): ${message}`, e)
  } finally {
    finishSystemCommand(type, succeeded)
    if (type === 'interface_start') {
      isStartingIntiface = false
    }
  }
}

function isMediaCommandType(type) {
  return type === 'media_list' ||
    type === 'media_play' ||
    type === 'media_stop' ||
    type === 'media_pause' ||
    type === 'media_resume' ||
    type === 'media_intensity'
}

function isSystemCommandType(type) {
  return type === 'interface_start' ||
    type === 'interface_connect' ||
    type === 'interface_disconnect' ||
    type === 'interface_scan'
}

function isStopCommandType(type) {
  return type === 'stop'
}

function clearAiStopLatch() {
  aiStopLatchActive = false
}

function engageAiStopLatch() {
  aiStopLatchActive = true
  messageCommands = []
  pendingMediaListFromStream = false
  clearSpokenSyncQueueState()
  resetTtsSyncState()
}

function isDeviceCommandType(type) {
  return !isSystemCommandType(type) && !isMediaCommandType(type)
}

async function executeStopCommand(cmd = {}) {
  engageAiStopLatch()

  try {
    if (typeof stopAllSync === 'function') {
      await stopAllSync()
    }
  } catch (e) {
    console.warn(`${NAME}: stopAllSync failed during STOP`, e)
  }

  try {
    if (typeof stopTimeline === 'function' && isTimelinePlaying()) {
      await stopTimeline()
    }
  } catch (e) {
    console.warn(`${NAME}: stopTimeline failed during STOP`, e)
  }

  try {
    if (typeof stopMediaPlayback === 'function') {
      await stopMediaPlayback()
    }
  } catch (e) {
    console.warn(`${NAME}: stopMediaPlayback failed during STOP`, e)
  }

  await executeCommand({ ...cmd, type: 'stop' })

  // STOP should cancel current motion/queue immediately, but must not block
  // subsequent commands that arrive after the STOP tag in the same response.
  clearAiStopLatch()
}

function resolveTargetChannelFromCommand(cmd) {
  const deviceIndex = Number(cmd?.deviceIndex)
  if (!Number.isFinite(deviceIndex)) return null
  if (deviceIndex === TARGET_SENTINEL_ANY_CHANNEL) return '-'
  if (deviceIndex === TARGET_SENTINEL_CHANNEL_A) return 'A'
  if (deviceIndex === TARGET_SENTINEL_CHANNEL_B) return 'B'
  if (deviceIndex === TARGET_SENTINEL_CHANNEL_C) return 'C'
  if (deviceIndex === TARGET_SENTINEL_CHANNEL_D) return 'D'
  return null
}

function resolveDeviceIndexesForTargetChannel(targetChannel) {
  const liveDevices = getConnectedDevices()
  if (!Array.isArray(liveDevices) || liveDevices.length === 0) {
    return []
  }

  const channel = String(targetChannel || '').trim().toUpperCase()
  if (!channel || channel === '-') {
    return liveDevices.map((_, index) => index)
  }

  const indexes = []
  for (let index = 0; index < liveDevices.length; index++) {
    const assigned = String(getDeviceChannel(index) || '-').trim().toUpperCase()
    if (assigned === channel) {
      indexes.push(index)
    }
  }
  return indexes
}

function resolveFallbackIndexForChannelSentinel(deviceIndex, liveDeviceCount) {
  if (!Number.isFinite(deviceIndex) || !Number.isFinite(liveDeviceCount) || liveDeviceCount <= 0) {
    return null
  }

  if (deviceIndex === TARGET_SENTINEL_CHANNEL_A) return liveDeviceCount > 0 ? 0 : null
  if (deviceIndex === TARGET_SENTINEL_CHANNEL_B) return liveDeviceCount > 1 ? 1 : null
  if (deviceIndex === TARGET_SENTINEL_CHANNEL_C) return liveDeviceCount > 2 ? 2 : null
  if (deviceIndex === TARGET_SENTINEL_CHANNEL_D) return liveDeviceCount > 3 ? 3 : null
  return null
}

function expandCommandTargetsForExecution(cmd) {
  if (!cmd || !isDeviceCommandType(cmd?.type)) {
    return cmd ? [cmd] : []
  }

  if (cmd?.type === 'stop') {
    return [cmd]
  }

  const targetChannel = resolveTargetChannelFromCommand(cmd)
  if (!targetChannel) {
    return [cmd]
  }

  const targetIndexes = resolveDeviceIndexesForTargetChannel(targetChannel)
  if (!targetIndexes.length) {
    const liveDevices = getConnectedDevices()
    const fallbackIndex = resolveFallbackIndexForChannelSentinel(Number(cmd?.deviceIndex), Array.isArray(liveDevices) ? liveDevices.length : 0)
    if (Number.isInteger(fallbackIndex)) {
      console.warn(`${NAME}: No devices assigned to channel ${targetChannel}; falling back to device index ${fallbackIndex} for target token`)
      return [{
        ...cmd,
        deviceIndex: fallbackIndex,
        targetChannel,
        targetFallback: 'channel_to_index',
      }]
    }
    return []
  }

  return targetIndexes.map((deviceIndex) => ({
    ...cmd,
    deviceIndex,
    targetChannel,
  }))
}

function decodeCommandEntities(text) {
  return String(text || '')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
}

function classifyTargetToken(rawTarget) {
  const token = String(rawTarget || '').trim().toLowerCase()
  if (!token) return 'legacy'
  if (token === 'any') return 'canonical_any'
  if (token === 'a' || token === 'b' || token === 'c' || token === 'd') return 'canonical_channel'
  if (token === 'interface' || token === 'system' || token === 'intiface' || token === 'media') return 'system_media'
  return 'legacy'
}

function classifyResolvedTargetFromCommand(cmd) {
  const deviceIndex = Number(cmd?.deviceIndex)
  if (!Number.isFinite(deviceIndex)) return 'unknown'
  if (deviceIndex === TARGET_SENTINEL_ANY_CHANNEL) return 'canonical_any'
  if (
    deviceIndex === TARGET_SENTINEL_CHANNEL_A ||
    deviceIndex === TARGET_SENTINEL_CHANNEL_B ||
    deviceIndex === TARGET_SENTINEL_CHANNEL_C ||
    deviceIndex === TARGET_SENTINEL_CHANNEL_D
  ) {
    return 'canonical_channel'
  }
  if (deviceIndex >= 0) return 'legacy_device_index'
  return 'unknown'
}

function summarizeTargetParsing(text) {
  const sourceText = decodeCommandEntities(text)
  const inlineTagRegex = /<([^<>\n:][^<>:\n]*?)\s*:\s*([\s\S]*?)>/gi
  const counts = {
    canonical_any: 0,
    canonical_channel: 0,
    system_media: 0,
    legacy: 0,
  }
  const tokens = []

  let match
  while ((match = inlineTagRegex.exec(sourceText)) !== null) {
    const rawTarget = String(match[1] || '').trim()
    if (!rawTarget) continue
    const kind = classifyTargetToken(rawTarget)
    counts[kind] += 1
    tokens.push(rawTarget)
  }

  return {
    totalTargets: tokens.length,
    counts,
    sampleTargets: tokens.slice(0, 8),
  }
}

function getSystemCommandCooldownMs(type) {
  if (type === 'interface_start') return 8000
  if (type === 'interface_connect') return 2500
  if (type === 'interface_disconnect') return 1500
  if (type === 'interface_scan') return 3000
  return 1000
}

function shouldSkipSystemCommand(type) {
  const now = Date.now()
  const state = systemCommandState.get(type) || { inFlight: false, lastAt: 0 }

  if (state.inFlight) {
    return { skip: true, reason: 'in_flight' }
  }

  const cooldownMs = getSystemCommandCooldownMs(type)
  if ((now - state.lastAt) < cooldownMs) {
    return { skip: true, reason: 'cooldown' }
  }

  systemCommandState.set(type, { inFlight: true, lastAt: now })
  return { skip: false }
}

function finishSystemCommand(type, succeeded) {
  const current = systemCommandState.get(type) || { inFlight: false, lastAt: 0 }
  systemCommandState.set(type, {
    inFlight: false,
    lastAt: succeeded ? current.lastAt : 0,
  })
}

function emitIntifaceDevicePlaybackEvent(payload = {}) {
  try {
    eventSource.emit('intiface_device_playback', {
      ...payload,
      emittedAt: performance.now(),
    })
  } catch (e) {
    // Keep device execution isolated from event bus issues.
  }
}

function emitIntifaceUiAction(actionType, extra = {}) {
  emitIntifaceDevicePlaybackEvent({
    state: 'ui_action',
    actionType: String(actionType || '').trim() || 'unknown',
    ...extra,
  })
}

function emitIntifaceCommandSyncPulse(cmd, state = 'start') {
  const traceId = Number.isFinite(cmd?.traceId)
    ? Number(cmd.traceId)
    : (Number.isFinite(cmd?._traceId) ? Number(cmd._traceId) : null)
  const requestId = typeof cmd?.requestId === 'string'
    ? cmd.requestId
    : (typeof cmd?._meta?.requestId === 'string' ? cmd._meta.requestId : null)
  const messageId = Number.isInteger(cmd?.messageId)
    ? cmd.messageId
    : (Number.isInteger(cmd?._meta?.messageId) ? cmd._meta.messageId : null)

  emitIntifaceDevicePlaybackEvent({
    state: String(state || 'start'),
    commandType: String(cmd?.type || 'unknown'),
    requestId,
    messageId,
    traceId,
    char: typeof cmd?.char === 'string' ? cmd.char : null,
  })
}

const SYSTEM_SYNC_PULSE_STOP_DELAY_MS = 8000

function scheduleIntifaceCommandSyncStop(cmd, delayMs = SYSTEM_SYNC_PULSE_STOP_DELAY_MS) {
  const waitMs = Math.max(120, Number(delayMs) || SYSTEM_SYNC_PULSE_STOP_DELAY_MS)
  setWorkerTimeout(() => {
    emitIntifaceCommandSyncPulse(cmd, 'stop')
  }, waitMs)
}

function getImmediateCommandKey(cmd) {
  return JSON.stringify({
    type: cmd?.type,
    deviceIndex: cmd?.deviceIndex,
    modeName: cmd?.modeName,
    presetName: cmd?.presetName,
    pattern: cmd?.pattern,
    intensity: cmd?.intensity,
    filename: cmd?.filename,
  })
}

function describeCommand(cmd) {
  if (!cmd || typeof cmd !== 'object') return cmd
  return {
    type: cmd.type,
    deviceIndex: cmd.deviceIndex,
    modeName: cmd.modeName,
    presetName: cmd.presetName,
    pattern: cmd.pattern,
    intensity: cmd.intensity,
    min: cmd.min,
    max: cmd.max,
    duration: cmd.duration,
    cycles: cmd.cycles,
    startPos: cmd.startPos,
    endPos: cmd.endPos,
    filename: cmd.filename,
  }
}

function getSpokenSyncCommandKey(cmd, meta = {}) {
  return JSON.stringify({
    type: cmd?.type,
    deviceIndex: cmd?.deviceIndex,
    modeName: cmd?.modeName,
    presetName: cmd?.presetName,
    pattern: cmd?.pattern,
    intensity: cmd?.intensity,
    filename: cmd?.filename,
    commandOffset: Number.isFinite(meta?.commandOffset) ? Number(meta.commandOffset) : null,
  })
}

function hasPotentialCommandTags(text) {
  const value = String(text || '')
  if (!value) return false
  const hasOpen = value.includes('<') || /&lt;/i.test(value)
  const hasClose = value.includes('>') || /&gt;/i.test(value)
  return hasOpen && hasClose
}

function enqueueSpokenSyncCommand(cmd, char = null, meta = {}) {
  if (!cmd || typeof cmd !== 'object' || !cmd?.type) {
    return
  }

  const cmdKey = getSpokenSyncCommandKey(cmd, meta)
  if (spokenSyncQueuedKeysEver.has(cmdKey)) {
    return
  }
  if (pendingSpokenSyncKeys.has(cmdKey)) {
    return
  }

  if (executedCommands.has(cmdKey)) {
    return
  }

  const commandOffset = Number.isFinite(meta?.commandOffset) ? Number(meta.commandOffset) : null
  const targetSubtitleChunkIndex = Number.isFinite(meta?.targetSubtitleChunkIndex) ? Number(meta.targetSubtitleChunkIndex) : null
  const commandRawChunkIndex = Number.isFinite(meta?.commandRawChunkIndex) ? Number(meta.commandRawChunkIndex) : null

  pendingSpokenSyncKeys.add(cmdKey)
  spokenSyncQueuedKeysEver.add(cmdKey)
  pendingSpokenSyncCommands.push({
    ...cmd,
    char: typeof char === 'string' ? char : null,
    _syncKey: cmdKey,
    _execKey: cmdKey,
    _queuedAt: performance.now(),
    _source: 'stream_parse',
    _traceId: ++spokenSyncTraceCounter,
    _ordinal: ++spokenSyncCommandOrdinal,
    _meta: {
      streamLen: Number.isFinite(meta?.streamLen) ? meta.streamLen : null,
      requestId: typeof meta?.requestId === 'string' ? meta.requestId : null,
      messageId: Number.isInteger(meta?.messageId) ? meta.messageId : null,
      commandOffset,
      targetSubtitleChunkIndex,
      commandRawChunkIndex,
    },
  })

  if (TARGET_PARSE_DEBUG) {
    const queued = pendingSpokenSyncCommands[pendingSpokenSyncCommands.length - 1]
    console.log(`${NAME}: [parse-debug] queued`, {
      source: 'spoken-sync',
      type: queued?.type,
      resolvedTarget: classifyResolvedTargetFromCommand(queued),
      deviceIndex: Number.isFinite(queued?.deviceIndex) ? Number(queued.deviceIndex) : null,
      requestId: queued?._meta?.requestId || null,
      messageId: Number.isInteger(queued?._meta?.messageId) ? queued._meta.messageId : null,
      commandOffset: Number.isFinite(queued?._meta?.commandOffset) ? Number(queued._meta.commandOffset) : null,
    })
  }

  console.debug(`${NAME}: [chunk-sync] queued`, {
    traceId: pendingSpokenSyncCommands[pendingSpokenSyncCommands.length - 1]?._traceId,
    type: cmd?.type,
    resolvedTarget: classifyResolvedTargetFromCommand(pendingSpokenSyncCommands[pendingSpokenSyncCommands.length - 1]),
    isCanonicalTarget: (() => {
      const kind = classifyResolvedTargetFromCommand(pendingSpokenSyncCommands[pendingSpokenSyncCommands.length - 1])
      return kind === 'canonical_any' || kind === 'canonical_channel'
    })(),
    requestId: meta?.requestId || null,
    messageId: Number.isInteger(meta?.messageId) ? meta.messageId : null,
    commandOffset,
    targetSubtitleChunkIndex,
    commandRawChunkIndex,
    queueSize: pendingSpokenSyncCommands.length,
  })
}

function requeueSpokenSyncCommandFront(cmd) {
  if (!cmd) return
  if (cmd?._syncKey) {
    pendingSpokenSyncKeys.add(cmd._syncKey)
  }
  pendingSpokenSyncCommands.unshift(cmd)
}

function dequeueSpokenSyncCommandForPayload(payload = {}) {
  const payloadRequestId = String(payload?.requestId || payload?.request_id || '').trim()
  const payloadSubtitleChunkIndex = Number.isFinite(payload?.subtitleChunkIndex) ? Number(payload.subtitleChunkIndex) : null
  const payloadSourceStart = Number.isFinite(payload?.sourceStart) ? Number(payload.sourceStart) : null
  const payloadSourceEnd = Number.isFinite(payload?.sourceEnd) ? Number(payload.sourceEnd) : null

  if (pendingSpokenSyncCommands.length === 0) return null
  if (!Number.isFinite(payloadSubtitleChunkIndex)) return null

  for (let i = 0; i < pendingSpokenSyncCommands.length; i++) {
    const queued = pendingSpokenSyncCommands[i]
    const queuedRequestId = String(queued?._meta?.requestId || '').trim()
    const offset = Number(queued?._meta?.commandOffset)
    const rawTargetSubtitleChunkIndex = queued?._meta?.targetSubtitleChunkIndex
    const hasTargetSubtitleChunkIndex = Number.isFinite(rawTargetSubtitleChunkIndex)
    const targetSubtitleChunkIndex = hasTargetSubtitleChunkIndex ? Number(rawTargetSubtitleChunkIndex) : null

    if (payloadRequestId && queuedRequestId && payloadRequestId !== queuedRequestId) {
      continue
    }
    if (hasTargetSubtitleChunkIndex) {
      // Primary timing mode: chunk-index mapping from VoiceForge.
      // Keep a slight lead so matching commands are not skipped when a command
      // first appears on the same subtitle chunk.
      const animationChunk = Math.max(0, targetSubtitleChunkIndex - CHUNK_SYNC_SUBTITLE_EARLY_LEAD_CHUNKS)
      if (payloadSubtitleChunkIndex < animationChunk) {
        continue
      }
    } else if (Number.isFinite(offset)) {
      // Phase-1 style fallback timing when chunk-index mapping is unavailable.
      // Use sourceEnd cursor + adaptive lead window.
      const chunkSpan = Number.isFinite(payloadSourceEnd) && Number.isFinite(payloadSourceStart)
        ? Math.max(1, payloadSourceEnd - payloadSourceStart)
        : 0
      const earlyLeadChars = Number.isFinite(payloadSourceEnd)
        ? Math.max(
          CHUNK_SYNC_OFFSET_EARLY_LEAD_MIN,
          Math.min(
            CHUNK_SYNC_OFFSET_EARLY_LEAD_MAX,
            Math.round(chunkSpan * 0.35) + 8 + Math.round(chunkSpan * CHUNK_SYNC_OFFSET_EXTRA_CHUNK_LEAD),
          ),
        )
        : 0

      const cursor = Number.isFinite(payloadSourceEnd) ? payloadSourceEnd : payloadSourceStart
      if (!Number.isFinite(cursor) || offset > (cursor + earlyLeadChars)) {
        if (queued?._meta) {
          queued._meta._offsetArmedChunk = null
        }
        continue
      }

      if (Number.isFinite(payloadSubtitleChunkIndex) && CHUNK_SYNC_FALLBACK_CHUNK_DELAY > 0) {
        const now = Date.now()
        const recentlyExecuted = spokenSyncLastExecutionAt > 0 && (now - spokenSyncLastExecutionAt) <= CHUNK_SYNC_RECENT_EXECUTION_WINDOW_MS
        if (!recentlyExecuted) {
          if (queued?._meta) {
            queued._meta._offsetArmedChunk = null
          }
          // No recent command fired: do not hold the first eligible command.
          // Execute as soon as cursor reaches its offset.
          pendingSpokenSyncCommands.splice(i, 1)
          if (queued?._syncKey) {
            pendingSpokenSyncKeys.delete(queued._syncKey)
          }
          return queued
        }

        const armedChunk = Number(queued?._meta?._offsetArmedChunk)
        if (!Number.isFinite(armedChunk)) {
          if (queued?._meta) {
            queued._meta._offsetArmedChunk = payloadSubtitleChunkIndex
            if (CHUNK_SYNC_DEBUG) {
              console.debug(`${NAME}: [chunk-sync] fallback armed`, {
                traceId: queued?._traceId || null,
                offset,
                armedChunk: payloadSubtitleChunkIndex,
                sourceStart: payloadSourceStart,
                sourceEnd: payloadSourceEnd,
              })
            }
          }
          continue
        }

        if (payloadSubtitleChunkIndex < (armedChunk + CHUNK_SYNC_FALLBACK_CHUNK_DELAY)) {
          if (CHUNK_SYNC_DEBUG) {
            console.debug(`${NAME}: [chunk-sync] fallback waiting`, {
              traceId: queued?._traceId || null,
              armedChunk,
              requiredChunk: armedChunk + CHUNK_SYNC_FALLBACK_CHUNK_DELAY,
              currentChunk: payloadSubtitleChunkIndex,
            })
          }
          continue
        }
      }
    } else {
      continue
    }

    pendingSpokenSyncCommands.splice(i, 1)
    if (queued?._syncKey) {
      pendingSpokenSyncKeys.delete(queued._syncKey)
    }
    return queued
  }

  return null
}

async function flushPendingSpokenSyncCommands(reason = 'flush') {
  if (!Array.isArray(pendingSpokenSyncCommands) || pendingSpokenSyncCommands.length === 0) {
    return 0
  }

  const queued = [...pendingSpokenSyncCommands]
  pendingSpokenSyncCommands = []
  pendingSpokenSyncKeys.clear()

  let executed = 0
  for (const rawCmd of queued) {
    if (!rawCmd) continue
    const cmdKey = rawCmd?._execKey || getImmediateCommandKey(rawCmd)
    if (executedCommands.has(cmdKey)) {
      continue
    }

    try {
      executedCommands.add(cmdKey)
      executedCommands.add(getImmediateCommandKey(rawCmd))
      if (isSystemCommandType(rawCmd?.type)) {
        await executeSystemCommand(rawCmd)
      } else if (isMediaCommandType(rawCmd?.type)) {
        await executeMediaCommand(rawCmd, Number.isInteger(rawCmd?._meta?.messageId) ? rawCmd._meta.messageId : null)
      } else if (isStopCommandType(rawCmd?.type)) {
        await executeStopCommand(rawCmd)
      } else {
        if (aiStopLatchActive) {
          continue
        }
        if (!client.connected) {
          continue
        }
        const expandedCommands = expandCommandTargetsForExecution(rawCmd)
        if (expandedCommands.length > 0) {
          clearPendingModelRuntimeNotice()
        }
        for (let i = 0; i < expandedCommands.length; i++) {
          const expandedCmd = expandedCommands[i]
          const cmdForExecution = i === 0 ? expandedCmd : { ...expandedCmd, _skipSyncStartLead: true }
          await executeCommand(cmdForExecution)
        }
      }
      executed += 1
    } catch (e) {
      console.warn(`${NAME}: [chunk-sync] flush command failed (${rawCmd?.type || 'unknown'})`, e)
    }
  }

  if (executed > 0) {
    console.log(`${NAME}: [chunk-sync] ${reason} executed ${executed} queued command(s)`)
  }
  return executed
}

function parseTaggedDeviceCommandsWithOffsets(text) {
  const sourceRaw = String(text || '')
  const sourceDecoded = sourceRaw
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')

  const inlineTagRegex = /<([^<>\n:][^<>:\n]*?)\s*:\s*([\s\S]*?)>/gi
  const blockTagRegex = /<([^<>\n:][^<>:\n]*?)\s*>([\s\S]*?)<\/\s*\1\s*>/gi
  const entries = []
  let match

  while ((match = inlineTagRegex.exec(sourceDecoded)) !== null) {
    const deviceType = String(match[1] || '').trim().toLowerCase()
    const inner = String(match[2] || '').trim()
    if (!deviceType || !inner) continue

    const tagText = `<${deviceType}:${inner}>`
    // VoiceForge chunk events report sourceStart/sourceEnd in raw streamed-text
    // coordinates. Keep command offsets in the same coordinate space so tags
    // stripped from TTS still align to the spoken chunk they arrived with.
    const commandOffset = Number(match.index) || 0
    const parsed = parseDeviceCommands(tagText)
    for (const cmd of parsed) {
      entries.push({ cmd, commandOffset, escaped: false })
    }
  }

  while ((match = blockTagRegex.exec(sourceDecoded)) !== null) {
    const deviceType = String(match[1] || '').trim().toLowerCase()
    const inner = String(match[2] || '').trim()
    if (!deviceType || !inner) continue

    const tagText = `<${deviceType}>${inner}</${deviceType}>`
    const commandOffset = Number(match.index) || 0
    const parsed = parseDeviceCommands(tagText)
    for (const cmd of parsed) {
      entries.push({ cmd, commandOffset, escaped: false })
    }
  }

  entries.sort((a, b) => (Number(a?.commandOffset) || 0) - (Number(b?.commandOffset) || 0))

  if (entries.length === 0) {
    const parsedFallback = parseDeviceCommands(sourceDecoded)
    for (const cmd of parsedFallback) {
      entries.push({ cmd, commandOffset: sourceRaw.length, escaped: false })
    }
  }

  return entries
}

async function executeMediaCommand(cmd, targetMessageId = null) {
  try {
    if (cmd.type === 'media_list') {
      console.log(`${NAME}: Executing media_list (targetMessageId=${targetMessageId ?? 'auto'})`)
      await refreshMenuMediaList()
      await waitMs(0)
      const injected = await injectMediaListIntoLastAssistantMessage(targetMessageId)
      console.log(`${NAME}: media_list injection result: ${injected ? 'success' : 'failed'}`)
      updateStatus(injected ? 'Media list injected into last assistant message' : 'Media list injection failed (assistant message not found)')
      if (injected) {
        emitIntifaceUiAction('media_list')
      }
      return
    }

    if (cmd.type === 'media_play') {
      const filename = String(cmd.filename || '').trim()
      if (!filename) {
        updateStatus('Media play command missing filename', true)
        return
      }
      await loadChatMediaFile(filename)
      return
    }

    if (cmd.type === 'media_stop') {
      await stopMediaPlayback()
      return
    }

    if (cmd.type === 'media_pause' || cmd.type === 'media_resume') {
      const videoEl = document.getElementById('intiface-chat-video-player')
      if (videoEl) {
        if (cmd.type === 'media_pause') {
          await videoEl.pause()
        } else {
          await videoEl.play().catch(() => {})
        }
      }
      return
    }

    if (cmd.type === 'media_intensity') {
      const value = Math.max(0, Math.min(500, Number(cmd.intensity) || 100))
      const intensitySlider = $('#intiface-menu-intensity')
      if (intensitySlider.length > 0) {
        intensitySlider.val(value)
        intensitySlider.trigger('input')
      }
    }
  } catch (e) {
    const action = String(cmd?.type || 'media command').replace('media_', '')
    updateStatus(`Failed media ${action}: ${e?.message || 'unknown error'}`, true)
    console.error(`${NAME}: Media command failed (${cmd?.type}):`, e)
  }
}

async function onStreamTokenReceived(data) {
  if (!aiCommandsEnabled) return

  const chunk = typeof data === 'string' ? data : (data?.text || data?.message || '')
  if (!chunk) return

  const text = String(chunk)

  // SillyTavern emits the whole generated text on STREAM_TOKEN_RECEIVED.
  // Keep the latest full text instead of appending chunks, which causes duplicates.
  if (!lastRawStreamText) {
    streamingText = text
  } else if (text.startsWith(lastRawStreamText)) {
    streamingText = text
  } else if (!streamingText.endsWith(text)) {
    // Fallback for providers that may emit delta-style chunks.
    streamingText += text
  }

  lastRawStreamText = text

  if (!hasPotentialCommandTags(streamingText)) return

  if (aiTtsSyncEnabled) {
    // Chunk-synced mode: parse commands from the live stream so timing offsets
    // are available before spoken chunk events fire.
    const entries = parseTaggedDeviceCommandsWithOffsets(streamingText)
      .filter((entry) => !!entry?.cmd?.type)

    for (const entry of entries) {
      const cmd = entry?.cmd
      if (!cmd) continue
      if (aiStopLatchActive && !isStopCommandType(cmd.type)) continue
      enqueueSpokenSyncCommand(cmd, null, {
        streamLen: streamingText.length,
        requestId: activeTtsRequestId || null,
        messageId: Number.isInteger(activeTtsMessageId) ? activeTtsMessageId : null,
        commandOffset: Number.isFinite(entry?.commandOffset) ? Number(entry.commandOffset) : null,
        sourceText: streamingText,
      })
    }
    return
  }

  const commandEntries = parseDeviceCommands(streamingText).map(cmd => ({ cmd, commandOffset: null }))

  const playerPanel = $("#intiface-chat-media-panel")
  const isMediaPlaying = playerPanel.length > 0 && playerPanel.is(":visible") && mediaPlayer.isPlaying

  for (const entry of commandEntries) {
    const cmd = entry?.cmd
    if (!cmd) continue
    if (aiStopLatchActive && !isStopCommandType(cmd.type)) continue
    const cmdSignature = JSON.stringify({
      type: cmd.type,
      deviceIndex: cmd.deviceIndex,
      modeName: cmd.modeName,
      presetName: cmd.presetName,
      pattern: cmd.pattern,
      intensity: cmd.intensity,
      commandOffset: Number.isFinite(entry?.commandOffset) ? Number(entry.commandOffset) : null,
    })

    if (!seenCommands.has(cmdSignature)) {
      seenCommands.add(cmdSignature)

      if (isSystemCommandType(cmd.type)) {
        console.log(`${NAME}: Deferring system command until final message: ${cmd.type}`)
        continue
      }

      if (isMediaCommandType(cmd.type)) {
        if (cmd.type === 'media_list') {
          console.log(`${NAME}: Deferring media_list injection until CHARACTER_MESSAGE_RENDERED`)
          pendingMediaListFromStream = true
          continue
        }

        console.log(`${NAME}: Deferring media command until final message: ${cmd.type}`)
        continue
      }

      const cmdKey = getImmediateCommandKey(cmd)

      if (!executedCommands.has(cmdKey)) {
        if (isMediaPlaying) {
          if (isStopCommandType(cmd.type)) {
            executedCommands.add(cmdKey)
            armTtsSyncGate()
            messageCommands.push(cmd)
            processCommandQueue()
          } else {
            console.log(`${NAME}: Skipping AI device command - media player is active: ${cmd.type}`)
          }
        } else {
          executedCommands.add(cmdKey)
          armTtsSyncGate()
          messageCommands.push(cmd)
          processCommandQueue()
        }
      }
    }
  }
}

function resolveMessageIdFromEventData(data) {
  if (Number.isInteger(data) && data >= 0) {
    return data
  }

  if (typeof data === 'string') {
    const parsed = Number.parseInt(data, 10)
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
  }

  if (data && typeof data === 'object') {
    const candidates = [
      data.index,
      data.messageId,
      data.message_id,
      data.mesId,
      data.mes_id,
      data.id,
    ]

    for (const candidate of candidates) {
      if (Number.isInteger(candidate) && candidate >= 0) {
        return candidate
      }
      if (typeof candidate === 'string') {
        const parsed = Number.parseInt(candidate, 10)
        if (Number.isInteger(parsed) && parsed >= 0) {
          return parsed
        }
      }
    }
  }

  return null
}

function getChatMessages() {
  const context = window.getContext?.()
  if (Array.isArray(context?.chat)) {
    return context.chat
  }
  if (Array.isArray(globalChat)) {
    return globalChat
  }
  return []
}

function getActiveChatIdentity() {
  try {
    const context = window.getContext?.()
    const explicit = String(context?.chatId || context?.chat_id || context?.groupId || context?.group_id || '').trim()
    if (explicit) return explicit

    // Keep fallback identity stable. Using message tail/length causes false
    // "chat changed" events during normal typing/stream updates.
    return 'default_chat'
  } catch (_e) {
    return 'unknown'
  }
}

function isTypingInSendArea() {
  try {
    const active = document.activeElement
    if (!active) return false
    const id = String(active.id || '').trim().toLowerCase()
    const cls = String(active.className || '').toLowerCase()
    if (id === 'send_textarea' || id === 'chat-input' || cls.includes('send_textarea')) {
      return true
    }
    return false
  } catch (_e) {
    return false
  }
}

async function onChatChangedEvent() {
  console.log(`${NAME}: Chat changed`)

  if (isTypingInSendArea()) {
    // Ignore transient chat-changed notifications caused by input focus/draft
    // updates while typing in the send box.
    return
  }

  const nextChatIdentity = getActiveChatIdentity()
  const sameChat = !!lastKnownChatIdentity && lastKnownChatIdentity === nextChatIdentity
  lastKnownChatIdentity = nextChatIdentity

  if (sameChat) {
    // Ignore noisy CHAT_CHANGED events within the same chat session
    // (typing, streaming UI churn, message redraw). Keep prompt fresh only.
    updatePrompt()
    return
  }

  if (sameChat && aiTtsSyncEnabled && (ttsSyncActive || ttsSyncWaitingForStart || pendingSpokenSyncCommands.length > 0)) {
    console.debug(`${NAME}: Chat changed ignored while spoken sync active`, {
      chat: nextChatIdentity,
      waiting: ttsSyncWaitingForStart,
      active: ttsSyncActive,
      queued: pendingSpokenSyncCommands.length,
    })
    updatePrompt()
    return
  }

  clearTtsInterruptGraceTimer()
  resetTtsSyncState()
  clearSpokenSyncQueueState()
  activeTtsRequestId = null
  updatePrompt()
  hideChatMediaPanel()
}

function onDocumentVisibilityChangeEvent() {
  if (document.hidden) {
    console.log(`${NAME}: Tab hidden - switching to background mode`)
  } else {
    console.log(`${NAME}: Tab visible again`)
  }
}

function removeEventSourceListener(eventName, handler) {
  try {
    if (typeof eventSource?.off === 'function') {
      eventSource.off(eventName, handler)
      return
    }
    if (typeof eventSource?.removeListener === 'function') {
      eventSource.removeListener(eventName, handler)
    }
  } catch (_e) {}
}

function bindRuntimeEventListeners() {
  // Ensure singleton listener binding even if extension init runs multiple times.
  removeEventSourceListener(event_types.MESSAGE_RECEIVED, onMessageReceived)
  removeEventSourceListener(event_types.CHARACTER_MESSAGE_RENDERED, onCharacterMessageRendered)
  removeEventSourceListener(event_types.STREAM_TOKEN_RECEIVED, onStreamTokenReceived)
  removeEventSourceListener(event_types.GENERATION_STARTED, onGenerationStarted)
  removeEventSourceListener(event_types.GENERATION_ENDED, onGenerationEnded)
  removeEventSourceListener('voiceforge_tts_start', onVoiceforgeTtsStart)
  removeEventSourceListener('voiceforge_tts_end', onVoiceforgeTtsEnd)
  removeEventSourceListener('voiceforge_tts_interrupted', onVoiceforgeTtsInterrupted)
  removeEventSourceListener('voiceforge_tts_chunk_start', onVoiceforgeTtsChunkStart)
  removeEventSourceListener(event_types.CHAT_CHANGED, onChatChangedEvent)

  eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived)
  eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onCharacterMessageRendered)
  eventSource.on(event_types.STREAM_TOKEN_RECEIVED, onStreamTokenReceived)
  eventSource.on(event_types.GENERATION_STARTED, onGenerationStarted)
  eventSource.on(event_types.GENERATION_ENDED, onGenerationEnded)
  eventSource.on('voiceforge_tts_start', onVoiceforgeTtsStart)
  eventSource.on('voiceforge_tts_end', onVoiceforgeTtsEnd)
  eventSource.on('voiceforge_tts_interrupted', onVoiceforgeTtsInterrupted)
  eventSource.on('voiceforge_tts_chunk_start', onVoiceforgeTtsChunkStart)
  eventSource.on(event_types.CHAT_CHANGED, onChatChangedEvent)

  document.removeEventListener('visibilitychange', onDocumentVisibilityChangeEvent)
  document.addEventListener('visibilitychange', onDocumentVisibilityChangeEvent)
}

async function onMessageReceived(data, messageType) {
  if (!aiCommandsEnabled) return
  const chunkSyncMode = aiTtsSyncEnabled
  if (chunkSyncMode) {
    if (TARGET_PARSE_DEBUG) {
      console.log(`${NAME}: [parse-debug] parser_mode=chunk (message parser: system/media only)`)
    }
  } else if (TARGET_PARSE_DEBUG) {
    console.log(`${NAME}: [parse-debug] parser_mode=message`)
  }

  const chatMessages = getChatMessages()
  const incomingMessageId = resolveMessageIdFromEventData(data)
  if (!Number.isInteger(incomingMessageId)) return

  const messageId = incomingMessageId

  const message = chatMessages[messageId]

  if (!message || message.is_user) return

  const messageText = message.mes || ''
  if (TARGET_PARSE_DEBUG) {
    const targetSummary = summarizeTargetParsing(messageText)
    console.log(`${NAME}: [parse-debug] source=message`, {
      messageId,
      totalTargets: targetSummary.totalTargets,
      ...targetSummary.counts,
      sampleTargets: targetSummary.sampleTargets,
    })
  }

  let commands = parseDeviceCommands(messageText)

  if (aiStopLatchActive) {
    commands = commands.filter((cmd) => isStopCommandType(cmd?.type) || isSystemCommandType(cmd?.type) || isMediaCommandType(cmd?.type))
  }

  const hasSuspiciousWaveform = commands.some((cmd) => cmd?.type === 'waveform' && String(cmd?.pattern || '').toLowerCase() === 'waveform')
  if (hasSuspiciousWaveform) {
    const repaired = parseTaggedDeviceCommandsWithOffsets(messageText)
      .map((entry) => entry?.cmd)
      .filter((cmd) => !!cmd)
    if (repaired.length > 0) {
      commands = repaired
    }
  }

  if (commands.length === 0) return

  const systemCommands = commands.filter(cmd =>
    isSystemCommandType(cmd.type)
  )
  const mediaCommands = commands.filter(cmd => isMediaCommandType(cmd.type))

  const playerPanel = $("#intiface-chat-media-panel")
  const isMediaPlaying = playerPanel.length > 0 && playerPanel.is(":visible") && mediaPlayer.isPlaying

  const deviceCommandsList = commands.filter(cmd =>
    !isSystemCommandType(cmd.type) &&
    !isMediaCommandType(cmd.type) &&
    (!isMediaPlaying || isStopCommandType(cmd.type))
  )

  const parsedSummary = {
    messageId,
    tags: Array.from(String(messageText || '').matchAll(/<[^>]+>/g)).map((m) => String(m?.[0] || '')).slice(0, 6),
    commands: commands.map(describeCommand),
  }
  console.debug(`${NAME}: Parsed ${commands.length} command(s) from assistant message -> ${JSON.stringify(parsedSummary)}`)

  if (chunkSyncMode) {
    // In VoiceForge/Embody synced mode, STREAM_TOKEN_RECEIVED queues commands
    // and voiceforge_tts_chunk_start releases them. Do not execute a second
    // copy from the rendered final message.
    return
  }

  if (isMediaPlaying && commands.some(cmd =>
    !isSystemCommandType(cmd.type)
  )) {
    console.log(`${NAME}: Skipping AI device commands - media player is active`)
  }

  for (const cmd of systemCommands) {
    const cmdKey = getImmediateCommandKey(cmd)
    if (executedCommands.has(cmdKey)) {
      continue
    }
    executedCommands.add(cmdKey)
    await executeSystemCommand(cmd)
  }

  for (const cmd of mediaCommands) {
    const cmdKey = getImmediateCommandKey(cmd)
    if (executedCommands.has(cmdKey)) {
      continue
    }
    executedCommands.add(cmdKey)
    await executeMediaCommand(cmd, messageId)
  }

  // In chunk-synced mode, device commands are executed from spoken TTS chunk
  // events. Keep message parser for system/media commands only.
  if (chunkSyncMode) {
    return
  }

  const hasNonStopDeviceCommand = deviceCommandsList.some((cmd) => !isStopCommandType(cmd?.type))
  if (!client.connected && deviceCommandsList.length === 0) return
  if (!client.connected && hasNonStopDeviceCommand) {
    const firstType = String(deviceCommandsList[0]?.type || 'device command')
    updateStatus(`Parsed ${deviceCommandsList.length} device command(s) but no Intiface connection (${firstType})`, true)
    setPendingModelRuntimeNotice(`A haptic request was skipped because Intiface is disconnected (first command: ${firstType}).`)
    console.warn(`${NAME}: Parsed device commands but skipped execution because client is not connected`, deviceCommandsList)
    return
  }

  if (!aiTtsSyncEnabled && !mediaPlayer.isPlaying && !document.hidden) {
    messageCommands = []
    executedCommands.clear()
    streamingText = ''

    if (commandQueueInterval) {
      clearWorkerTimeout(commandQueueInterval)
      commandQueueInterval = null
    }

    await stopAllDeviceActions({ silent: true })
  }

  messageCommands = deviceCommandsList.filter(cmd => {
    if (cmd.modeName && !cmd.modeName.includes('_') && cmd.modeName.length < 5) {
      console.log(`${NAME}: Filtering out likely incomplete mode command: ${cmd.modeName}`)
      return false
    }
    return true
  }).map(cmd => ({
    ...cmd,
    char: typeof message?.name === 'string' ? message.name : null,
  }))
  executedCommands = new Set(messageCommands.map(cmd => JSON.stringify(cmd)))

  if (messageCommands.length > 0) {
    armTtsSyncGate()
  }

  processCommandQueue()
}

async function onCharacterMessageRendered(data, messageType) {
  const messageId = resolveMessageIdFromEventData(data)
  if (!Number.isInteger(messageId) || messageId < 0) {
    if (!pendingMediaListFromStream) return
    console.warn(`${NAME}: CHARACTER_MESSAGE_RENDERED missing valid message id for deferred media_list`)
    pendingMediaListFromStream = false
    return
  }

  if (!aiCommandsEnabled || !pendingMediaListFromStream) return

  const chatMessages = getChatMessages()

  const message = chatMessages[messageId]
  if (!message || message.is_user) {
    pendingMediaListFromStream = false
    return
  }

  console.log(`${NAME}: Consuming deferred media_list on CHARACTER_MESSAGE_RENDERED for message #${messageId} (type=${messageType || 'unknown'}, is_system=${!!message.is_system})`)
  pendingMediaListFromStream = false
  await executeMediaCommand({ type: 'media_list' }, messageId)
}

function onGenerationStarted() {
  clearAiStopLatch()
  const preserveSpokenSync = aiCommandsEnabled && aiTtsSyncEnabled && (ttsSyncActive || ttsSyncWaitingForStart || pendingSpokenSyncCommands.length > 0)
  executedCommands.clear()
  seenCommands.clear()
  messageCommands = []
  streamingText = ''
  lastRawStreamText = ''

  if (!preserveSpokenSync) {
    clearSpokenSyncQueueState()
    resetTtsSyncState()
  } else {
    console.debug(`${NAME}: [chunk-sync] preserving spoken sync state on new generation`, {
      waiting: ttsSyncWaitingForStart,
      active: ttsSyncActive,
      queued: pendingSpokenSyncCommands.length,
      activeTtsRequestId,
    })
  }
}

function onGenerationEnded() {
  if (!aiCommandsEnabled) return

  streamingText = ''
  lastRawStreamText = ''
  seenCommands.clear()
  processCommandQueue()
}

async function onVoiceforgeTtsStart(payload) {
  if (!aiCommandsEnabled) return

  if (!aiTtsSyncEnabled) return

  // Call mode may not emit GENERATION_STARTED for every utterance.
  // Clear STOP latch on a fresh TTS start so new haptic sync can resume.
  clearAiStopLatch()

  clearTtsInterruptGraceTimer()

  const req = String(payload?.requestId || payload?.request_id || '').trim()
  const previousRequestId = activeTtsRequestId
  const previousMessageId = activeTtsMessageId
  activeTtsRequestId = req || null
  const payloadMessageIdCandidates = [
    payload?.messageIdResolved,
    payload?.messageId,
    payload?.message_id,
    payload?.mesId,
    payload?.mes_id,
    payload?.id,
  ]
  let payloadMessageId = null
  for (const candidate of payloadMessageIdCandidates) {
    if (Number.isInteger(candidate)) {
      payloadMessageId = candidate
      break
    }
    if (typeof candidate === 'string') {
      const parsed = Number.parseInt(candidate, 10)
      if (Number.isInteger(parsed)) {
        payloadMessageId = parsed
        break
      }
    }
  }
  let nextActiveMessageId = Number.isInteger(payloadMessageId) ? payloadMessageId : null
  if (
    previousRequestId &&
    activeTtsRequestId &&
    previousRequestId === activeTtsRequestId &&
    Number.isInteger(previousMessageId) &&
    Number.isInteger(nextActiveMessageId) &&
    nextActiveMessageId < previousMessageId
  ) {
    nextActiveMessageId = previousMessageId
  }
  activeTtsMessageId = nextActiveMessageId

  // Do not hard-stop on new TTS request start. Let the previous motion continue
  // until the next command is actually ready to execute, which avoids dead-air
  // haptic gaps between utterances.

  console.debug(`${NAME}: [chunk-sync] tts_start ids`, {
    requestId: activeTtsRequestId,
    activeTtsMessageId,
    payloadMessageIdRaw: payload?.messageId ?? payload?.message_id ?? null,
  })

  const messageId = Number.isInteger(payload?.messageId) ? payload.messageId : 'unknown'
  const mode = payload?.mode || 'unknown'
  console.log(`${NAME}: VoiceForge TTS started (message=${messageId}, mode=${mode})`)
  if (TARGET_PARSE_DEBUG) {
    console.log(`${NAME}: [parse-debug] parser_mode=chunk`, {
      requestId: activeTtsRequestId,
      messageId: activeTtsMessageId,
    })
  }

  if (ttsSyncWaitingForStart) {
    releaseTtsSyncGate('tts')
  } else {
    ttsSyncActive = true
    ttsSyncLastReleaseSource = 'tts'
    updateAIStatusFromActivity()
  }

}

async function onVoiceforgeTtsEnd(payload) {
  if (!aiTtsSyncEnabled) return
  clearTtsInterruptGraceTimer()
  await flushPendingSpokenSyncCommands('tts_end')
  ttsSyncActive = false
  clearSpokenSyncQueueState()
  activeTtsRequestId = null
  activeTtsMessageId = null
  updateAIStatusFromActivity()
}

async function onVoiceforgeTtsInterrupted(payload = {}) {
  if (!aiCommandsEnabled || !aiTtsSyncEnabled) return

  const policy = aiTtsInterruptPolicy || 'grace'
  if (policy === 'preserve') {
    return
  }

  clearTtsInterruptGraceTimer()
  ttsSyncActive = false
  updateAIStatusFromActivity()

  if (policy === 'flush') {
    clearSpokenSyncQueueState()
    activeTtsRequestId = null
    activeTtsMessageId = null
    return
  }

  ttsInterruptGraceTimeoutId = setWorkerTimeout(() => {
    ttsInterruptGraceTimeoutId = null
    clearSpokenSyncQueueState()
    activeTtsRequestId = null
    activeTtsMessageId = null
    updateAIStatusFromActivity()
  }, 240)
}

async function executeNextSpokenSyncCommand(payload = {}, source = 'unknown') {
  const messageId = payload?.messageIdResolved ?? payload?.messageId ?? null
  const requestId = payload?.requestId ?? null
  const sequence = payload?.sequence ?? null
  const sourceStart = Number.isFinite(payload?.sourceStart) ? Number(payload.sourceStart) : null
  const sourceEnd = Number.isFinite(payload?.sourceEnd) ? Number(payload.sourceEnd) : null
  const subtitleChunkIndex = Number.isFinite(payload?.subtitleChunkIndex) ? Number(payload.subtitleChunkIndex) : null
  const rawChunkIndex = Number.isFinite(payload?.rawChunkIndex) ? Number(payload.rawChunkIndex) : null

  if (CHUNK_SYNC_DEBUG) {
    console.debug(`${NAME}: [chunk-sync] tick`, {
      source,
      requestId,
      messageId,
      sequence,
      subtitleChunkIndex,
      rawChunkIndex,
      sourceStart,
      sourceEnd,
      queueSize: pendingSpokenSyncCommands.length,
    })
  }

  let rawCmd = dequeueSpokenSyncCommandForPayload(payload)

  if (!rawCmd) {
    if (pendingSpokenSyncCommands.length > 0) {
      if (CHUNK_SYNC_DEBUG) {
        console.debug(`${NAME}: [chunk-sync] no eligible command yet`, {
          source,
          requestId,
          sourceStart,
          sourceEnd,
          queueSize: pendingSpokenSyncCommands.length,
        })
      }
    }
    return
  }

  const cmdKey = rawCmd?._execKey || getImmediateCommandKey(rawCmd)
  if (executedCommands.has(cmdKey)) {
    if (CHUNK_SYNC_DEBUG) {
      console.debug(`${NAME}: [chunk-sync] skipped duplicate`, {
        source,
        type: rawCmd?.type,
        requestId,
        messageId,
      })
    }
    return
  }

  if (aiTtsSyncOffsetMs > 0) {
    await waitMs(aiTtsSyncOffsetMs)
  }

  if (isSystemCommandType(rawCmd?.type)) {
    if (CHUNK_SYNC_DEBUG) {
      console.debug(`${NAME}: [chunk-sync] executing system`, {
        traceId: rawCmd?._traceId || null,
        type: rawCmd?.type,
        requestId,
        messageId,
      })
    }
    const syncCmd = {
      ...rawCmd,
      traceId: rawCmd?._traceId || null,
      requestId: requestId || rawCmd?.requestId || null,
      messageId: Number.isInteger(messageId) ? messageId : (Number.isInteger(rawCmd?.messageId) ? rawCmd.messageId : null),
      char: typeof payload?.char === 'string' ? payload.char : (rawCmd?.char || null),
    }
    executedCommands.add(cmdKey)
    executedCommands.add(getImmediateCommandKey(rawCmd))
    await executeSystemCommand(syncCmd)
    spokenSyncLastExecutionAt = Date.now()
    return
  }

  if (isMediaCommandType(rawCmd?.type)) {
    if (CHUNK_SYNC_DEBUG) {
      console.debug(`${NAME}: [chunk-sync] executing media`, {
        traceId: rawCmd?._traceId || null,
        type: rawCmd?.type,
        requestId,
        messageId,
      })
    }
    const syncCmd = {
      ...rawCmd,
      traceId: rawCmd?._traceId || null,
      requestId: requestId || rawCmd?.requestId || null,
      messageId: Number.isInteger(messageId) ? messageId : (Number.isInteger(rawCmd?.messageId) ? rawCmd.messageId : null),
      char: typeof payload?.char === 'string' ? payload.char : (rawCmd?.char || null),
    }
    executedCommands.add(cmdKey)
    executedCommands.add(getImmediateCommandKey(rawCmd))
    await executeMediaCommand(syncCmd, Number.isInteger(syncCmd?.messageId) ? syncCmd.messageId : null)
    spokenSyncLastExecutionAt = Date.now()
    return
  }

  if (isStopCommandType(rawCmd?.type)) {
    const syncCmd = {
      ...rawCmd,
      traceId: rawCmd?._traceId || null,
      requestId: requestId || rawCmd?.requestId || null,
      messageId: Number.isInteger(messageId) ? messageId : (Number.isInteger(rawCmd?.messageId) ? rawCmd.messageId : null),
      char: typeof payload?.char === 'string' ? payload.char : (rawCmd?.char || null),
    }
    executedCommands.add(cmdKey)
    executedCommands.add(getImmediateCommandKey(rawCmd))
    await executeStopCommand(syncCmd)
    spokenSyncLastExecutionAt = Date.now()
    return
  }

  if (aiStopLatchActive) {
    return
  }

  if (!client.connected) {
    setPendingModelRuntimeNotice(`A haptic request was skipped because Intiface is disconnected (command: ${String(rawCmd?.type || 'unknown')}).`)
    console.warn(`${NAME}: [chunk-sync] command skipped (not connected): ${rawCmd?.type || 'unknown'}`)
    // Do not drop spoken commands while a connect/scan command is still in flight.
    // Keep command queued so it can execute once the socket becomes available.
    requeueSpokenSyncCommandFront(rawCmd)
    return
  }

  executedCommands.add(cmdKey)
  executedCommands.add(getImmediateCommandKey(rawCmd))
  console.debug(`${NAME}: [chunk-sync] executing`, {
    traceId: rawCmd?._traceId || null,
    source,
    type: rawCmd?.type,
    resolvedTarget: classifyResolvedTargetFromCommand(rawCmd),
    requestId,
    messageId,
    subtitleChunkIndex,
    sourceStart,
    sourceEnd,
  })

  const syncCmd = {
    ...rawCmd,
    traceId: rawCmd?._traceId || null,
    requestId: requestId || rawCmd?.requestId || null,
    messageId: Number.isInteger(messageId) ? messageId : (Number.isInteger(rawCmd?.messageId) ? rawCmd.messageId : null),
    char: typeof payload?.char === 'string' ? payload.char : (rawCmd?.char || null),
  }

  const expandedCommands = expandCommandTargetsForExecution(syncCmd)
  if (expandedCommands.length === 0) {
    if (CHUNK_SYNC_DEBUG) {
      console.debug(`${NAME}: [chunk-sync] no target devices for command`, {
        traceId: rawCmd?._traceId || null,
        type: rawCmd?.type,
        targetChannel: resolveTargetChannelFromCommand(rawCmd),
      })
    }
    return
  }

  clearPendingModelRuntimeNotice()
  for (let i = 0; i < expandedCommands.length; i++) {
    const expandedCmd = expandedCommands[i]
    const cmdForExecution = i === 0 ? expandedCmd : { ...expandedCmd, _skipSyncStartLead: true }
    await executeCommand(cmdForExecution)
  }
  spokenSyncLastExecutionAt = Date.now()
}

async function onVoiceforgeTtsChunkStart(payload) {
  if (!aiCommandsEnabled || !aiTtsSyncEnabled) return

  const payloadRequestId = String(payload?.requestId || payload?.request_id || '').trim()
  if (activeTtsRequestId && payloadRequestId && payloadRequestId !== activeTtsRequestId) {
    return
  }

  const dedupeKey = [
    String(payload?.requestId || ''),
    String(payload?.sequence ?? ''),
    String(payload?.segmentId ?? ''),
    String(payload?.sourceStart ?? ''),
    String(payload?.sourceEnd ?? ''),
  ].join('|')
  if (dedupeKey && dedupeKey === spokenSyncLastChunkStartKey) {
    return
  }
  spokenSyncLastChunkStartKey = dedupeKey

  await executeNextSpokenSyncCommand(payload || {}, 'received tts chunk start')
}

// Device connection lifecycle is owned by connected_devices.js

// ==========================================
// PROMPT GENERATION
// ==========================================

let lastPromptHash = ''
let promptUpdateTimer = null

function buildDynamicPromptContext() {
  const connectedDevices = (client?.connected || isClientConnected()) ? devices : []
  const deviceNames = connectedDevices.map((dev) => getDeviceDisplayName(dev)).filter(Boolean)

  let enabledModes = PlayModeLoader?.getEnabledModes ? PlayModeLoader.getEnabledModes() : []

  // Prefer the live UI toggle state when available so prompt injection matches
  // exactly what the user has currently enabled in the checkboxes.
  const allUiToggleModes = $('.playmode-toggle')
  const uiEnabledModes = $('.playmode-toggle:checked').map(function () {
    return String($(this).data('mode') || '')
  }).get().filter(Boolean)

  if (allUiToggleModes.length > 0) {
    enabledModes = ['basic', ...uiEnabledModes.filter((id) => id !== 'basic')]
  }

  enabledModes = [...new Set(enabledModes)]

  const uniquePatterns = new Set()

  enabledModes.forEach((modeId) => {
    const sequences = PlayModeLoader?.getSequencesForMode ? PlayModeLoader.getSequencesForMode(modeId) : {}
    const patterns = PlayModeLoader?.getPatternsForMode ? PlayModeLoader.getPatternsForMode(modeId) : {}

    Object.keys(patterns || {}).forEach((patternName) => uniquePatterns.add(patternName))

  })

  const patternNames = [...uniquePatterns].sort((a, b) => a.localeCompare(b))
  const patternList = patternNames.join(', ')

  return {
    connectedDevices,
    deviceNames,
    patternNames,
    patternList,
    patternExample: patternNames[0] ? `<any:WAVEFORM: ${patternNames[0]}>` : null,
  }
}

function getVisibleMediaFilenames() {
  return $('#intiface-menu-media-list .menu-media-file-item').map(function () {
    return String($(this).data('filename') || '').trim()
  }).get().filter(Boolean)
}

async function injectMediaListIntoLastAssistantMessage(targetMessageId = null) {
  const mediaNames = getVisibleMediaFilenames()
  const chat = getChatMessages()
  if (!Array.isArray(chat) || chat.length === 0) {
    return false
  }

  let lastMessageIndex = -1

  if (Number.isInteger(targetMessageId) && targetMessageId >= 0 && targetMessageId < chat.length) {
    const targetMessage = chat[targetMessageId]
    if (targetMessage && !targetMessage.is_user) {
      lastMessageIndex = targetMessageId
    }
  }

  if (lastMessageIndex < 0) {
    lastMessageIndex = chat.length - 1
    while (lastMessageIndex >= 0 && chat[lastMessageIndex]?.is_user) {
      lastMessageIndex--
    }
  }

  if (lastMessageIndex < 0) {
    return false
  }

  const lastMessage = chat[lastMessageIndex]
  const existingText = String(lastMessage?.mes || '')
  const mediaBlockLabel = 'INTIFACE MEDIA LIBRARY'
  const stripPattern = /\n?```(?:\w+)?\nINTIFACE MEDIA LIBRARY[\s\S]*?\n```\n?/g
  const stripped = existingText.replace(stripPattern, '').trimEnd()

  const sortedMediaNames = [...mediaNames].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  const lines = sortedMediaNames.length > 0
    ? sortedMediaNames.map((name, idx) => `${String(idx + 1).padStart(2, '0')}. ${name}`)
    : ['(no media files found in assets/intiface/media)']

  const block = `\`\`\`text\n${mediaBlockLabel}\nCount: ${sortedMediaNames.length}\n\n${lines.join('\n')}\n\`\`\``
  const nextText = `${stripped}\n\n${block}`

  if (nextText === existingText) {
    return true
  }

  lastMessage.mes = nextText
  if (lastMessage.extra && typeof lastMessage.extra === 'object' && typeof lastMessage.extra.display_text === 'string') {
    lastMessage.extra.display_text = nextText
  }
  if (Array.isArray(lastMessage.swipes) && typeof lastMessage.swipe_id === 'number' && lastMessage.swipe_id >= 0 && lastMessage.swipe_id < lastMessage.swipes.length) {
    lastMessage.swipes[lastMessage.swipe_id] = nextText
  }

  updateMessageBlock(lastMessageIndex, lastMessage)

  saveChatDebounced()
  await eventSource.emit(event_types.MESSAGE_UPDATED, lastMessageIndex)
  return true
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function hashPrompt(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return hash.toString(16)
}

function updatePrompt() {
  if (promptUpdateTimer) {
    clearTimeout(promptUpdateTimer)
  }
  promptUpdateTimer = setTimeout(() => actuallyUpdatePrompt(), 100)
}

function actuallyUpdatePrompt() {
  try {
    if (!aiCommandsEnabled) {
      setExtensionPrompt('intiface_control', '', extension_prompt_types.IN_PROMPT, 2, true, extension_prompt_roles.SYSTEM)
      if (lastPromptHash !== '__disabled__') {
        console.log(`${NAME}: Extension prompt disabled`)
      }
      lastPromptHash = '__disabled__'
      return
    }

    const exePath = localStorage.getItem("intiface-exe-path")
    const canStartIntiface = !!exePath
    const {
      connectedDevices,
      deviceNames,
      patternList,
      patternExample,
    } = buildDynamicPromptContext()
    const isConnected = !!(client?.connected || isClientConnected())
    const connectionState = isConnected ? 'connected' : 'disconnected'
    const hasDevices = connectedDevices.length > 0
    const deviceTypeTokens = [...new Set(connectedDevices.map((dev) => getDeviceType(dev)).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b))
      .map((type) => `INTIFACE_TYPE:${String(type).toLowerCase()}`)

    const deviceLine = deviceNames.length > 0 ? deviceNames.join(', ') : 'none'
    const patternExampleLine = patternExample || ''
    const runtimeNotice = pendingModelRuntimeNotice

    const commandExamples = [
      '<media:LIST>',
      '<media:PLAY: filename.mp4>',
      '<any:STOP>',
    ]

    const needsInterfaceBootstrap = !isConnected || connectedDevices.length === 0

    if (needsInterfaceBootstrap) {
      commandExamples.unshift('<interface:SCAN>')
      commandExamples.unshift('<interface:CONNECT>')
      if (canStartIntiface) {
        commandExamples.unshift('<interface:START>')
      }
      commandExamples.push('<interface:DISCONNECT>')
    }

    if (connectedDevices.length > 0) {
      commandExamples.push('<any:VIBRATE: 50>')
      commandExamples.push('<A:OSCILLATE: 75>')
      commandExamples.push('<B:LINEAR: start=0, end=100, duration=1000>')
      if (patternExampleLine) {
        commandExamples.push(patternExampleLine)
      }
    }

    const modeSectionText = connectedDevices.length > 0
      ? `Target aliases: any=all channels, A/B/C/D=channels\n\nAvailable waveform patterns: ${patternList || 'none'}`
      : `Target aliases: any=all channels, A/B/C/D=channels\n\nAvailable waveform patterns: ${patternList || 'none'}`

    const prompt = `=== DEVICE CONTROL ACTIVE ===

Connection state: ${connectionState}
Connected devices: ${connectedDevices.length}
Device names: ${deviceLine}
${canStartIntiface ? 'Intiface Central startup command is available (<interface:START>).' : 'Startup command disabled (set Intiface executable path to enable <interface:START>).'}
${runtimeNotice ? `Runtime notice: ${runtimeNotice}` : 'Runtime notice: none'}

Runtime tokens:
- INTIFACE_AI:on
- INTIFACE_CONN:${connectionState}
- INTIFACE_HAS_DEVICES:${hasDevices ? 'yes' : 'no'}
- INTIFACE_DEVICE_COUNT:${connectedDevices.length}
- INTIFACE_DISCONNECT_REASON:${lastDisconnectReason}
${deviceTypeTokens.length > 0 ? `- ${deviceTypeTokens.join('\n- ')}` : '- INTIFACE_TYPE:none'}

${modeSectionText}

Use commands like:
${commandExamples.map((line) => `- ${line}`).join('\n')}

Rules:
- If no devices are connected, prefer interface/media commands (connect/scan/start/play/stop).
- Use device and waveform commands only when at least one device is connected.
- If Connected devices is greater than 0 and INTIFACE_CONN is connected, Intiface is already ready.
- When Intiface is already ready, never emit <interface:START>, <interface:CONNECT>, or <interface:SCAN> unless the user explicitly asks for those actions.
- If the user requests haptics/device motion while disconnected or with zero devices, your visible reply must first acknowledge this explicitly (short plain sentence), then offer reconnect/scan action.
- Never imply that haptics/device motion executed when disconnected or with zero devices.
- If Runtime notice is not "none", your next visible reply must start by acknowledging that notice in one short sentence before any other content.
- Commands are hidden from the user and execute instantly.`

    const promptHash = hashPrompt(prompt)
    const promptChanged = promptHash !== lastPromptHash
    try {
      // Always re-apply. This self-heals if another extension lifecycle wipes prompt state.
      setExtensionPrompt('intiface_control', prompt, extension_prompt_types.IN_PROMPT, 2, true, extension_prompt_roles.SYSTEM)

      if (promptChanged) {
        lastPromptHash = promptHash
        console.log(`${NAME}: Extension prompt updated`)
      }

      if (promptChanged) {
        Promise.resolve(getExtensionPromptByName('intiface_control')).then((value) => {
          const len = String(value || '').trim().length
          console.debug(`${NAME}: Prompt verify intiface_control length=${len}`)
        }).catch(() => {})
      }
    } catch (err) {
      console.error(`${NAME}: Failed to set extension prompt:`, err)
    }
  } catch (e) {
    console.error(`${NAME}: updatePrompt() crashed:`, e)
  }
}

// ==========================================
// INITIALIZATION
// ==========================================

let currentPatternCategory = 'basic'

function setActivePlayModeTab(category) {
  $('.playmode-tab').removeClass('active').css('background', '')
  const activeTab = $(`#intiface-tab-${category}`)
  if (activeTab.length) {
    activeTab.addClass('active').css('background', 'rgba(100,150,255,0.3)')
  }
}

function renderPlayModeUI() {
  if (!PlayModeLoader?.generateTabsHTML) return

  const tabsContainer = $('#intiface-playmode-tabs-container')
  const togglesContainer = $('#intiface-playmode-toggles-container')
  const intensityContainer = $('#intiface-playmode-intensity-container')

  tabsContainer.html(PlayModeLoader.generateTabsHTML())
  togglesContainer.html(PlayModeLoader.generateTogglesHTML())
  intensityContainer.html(PlayModeLoader.generateIntensityHTML())

  const enabledModes = new Set(PlayModeLoader.getEnabledModes())
  if (currentPatternCategory !== 'basic' && !enabledModes.has(currentPatternCategory)) {
    currentPatternCategory = 'basic'
  }

  setActivePlayModeTab(currentPatternCategory)
}

async function populatePatternButtons() {
  const container = $('#intiface-pattern-buttons')
  container.empty()

  if (!PlayModeLoader?.getEnabledSequences) {
    container.html('<div style="color: #666; font-size: 0.8em; width: 100%; text-align: center; padding: 20px;">Loading modes...</div>')
    return
  }

  // Get patterns for current category
  let presets = {}

    if (currentPatternCategory === 'basic') {
      const basicPatterns = PlayModeLoader.getPatternsForMode('basic') || {}
      Object.keys(basicPatterns).forEach(patternName => {
        presets[patternName] = {
          type: 'waveform',
          pattern: patternName
        }
      })
    } else {
    const modeId = currentPatternCategory
    const modeSequences = PlayModeLoader.getSequencesForMode(modeId)
    if (modeSequences) {
      for (const [seqName, seqData] of Object.entries(modeSequences)) {
        presets[seqName] = {
          type: 'sequence',
          sequence: seqData.steps,
          repeat: seqData.repeat !== false,
          description: seqData.description || seqName
        }
      }
    }

    const modePatterns = PlayModeLoader.getPatternsForMode(modeId)
    if (modePatterns) {
      Object.entries(modePatterns).forEach(([patternName, patternFunc]) => {
        presets[patternName] = {
          type: 'waveform',
          pattern: patternName
        }
      })
    }
  }

  Object.entries(presets).forEach(([key, preset]) => {
    const displayName = key.replace(/_/g, ' ')
    const btn = $(`
      <button class="menu_button pattern-btn" data-pattern="${key}" data-category="${currentPatternCategory}"
        title="${displayName} - Click to add to scene"
        style="padding: 6px 12px; font-size: 0.75em; border-radius: 4px;">
        ${displayName}
      </button>
    `)
    btn.on('click', () => selectPatternForTimeline(key, currentPatternCategory))
    container.append(btn)
  })

  if (Object.keys(presets).length === 0) {
    container.html('<div style="color: #666; font-size: 0.8em; width: 100%; text-align: center; padding: 20px;">No patterns available for this category</div>')
  }
}

$(document).off('click.intifacePlayModeTabs', '.playmode-tab').on('click.intifacePlayModeTabs', '.playmode-tab', function() {
  const category = $(this).data('category')
  if (!category) return
  currentPatternCategory = category
  setActivePlayModeTab(category)
  populatePatternButtons()
})

$(document).off('change.intifacePlayModeToggles', '.playmode-toggle').on('change.intifacePlayModeToggles', '.playmode-toggle', function() {
  const modeId = $(this).data('mode')
  if (!modeId || !PlayModeLoader?.setModeEnabled) return
  PlayModeLoader.setModeEnabled(modeId, $(this).is(':checked'))
  renderPlayModeUI()
  populatePatternButtons()
  updatePrompt()
})

$(document).off('input.intifacePlayModeIntensity', '[id^="intiface-mode-intensity-"]').on('input.intifacePlayModeIntensity', '[id^="intiface-mode-intensity-"]', function() {
  const modeId = $(this).data('mode')
  if (!modeId || !PlayModeLoader?.setIntensityMultiplier) return
  const value = Math.max(50, Math.min(400, parseInt($(this).val(), 10) || 100))
  PlayModeLoader.setIntensityMultiplier(modeId, value / 100)
  $(`#${$(this).attr('id')}-display`).text(`${value}%`)
})

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script")
    script.src = url
    script.onload = resolve
    script.onerror = reject
    document.head.appendChild(script)
  })
}

$(async () => {
  try {
    if (typeof window !== 'undefined') {
      // Intiface consumes VoiceForge sync exclusively through eventSource.
      // Clear legacy direct bridge hooks to avoid duplicate handler paths.
      window.intifaceOnVoiceforgeTtsChunkStart = null
      window.intifaceOnVoiceforgeTtsSpokenText = null
    }

    // Load buttplug library
    await loadScript(`/scripts/extensions/third-party/${extensionName}/lib/buttplug.js`)
    buttplug = window.buttplug

    // Initialize timer worker
    initTimerWorker()

    // Load settings
    loadGlobalInvert()
    loadDevicePollingRate()
    loadAICommandsEnabled()
    loadAITtsSyncSettings()
    loadDebugLoggingSetting()

    // Create client
    client = new buttplug.ButtplugClient("SillyTavern Intiface Client")

    // Clear stale state
    devices = []
    window.devices = devices
    device = null
    activePatterns.clear()

    // Initialize universal sync
    initSync(devicePollingRate)

    // Initialize device execution module
    initDeviceExecution({
      NAME,
      client,
      devices,
      getConnectedDevices,
      buttplug,
      deviceAssignments,
      globalIntensityScale,
      globalInvert,
      updateStatus,
      updateAIStatusFromActivity,
      emitPlaybackEvent: emitIntifaceDevicePlaybackEvent,
      getSyncStartEventLeadMs: () => aiSyncStartLeadMs,
      clearWorkerTimeout,
      setWorkerTimeout,
      setWorkerInterval
    })

    // Initialize media module
    initMediaModule({
      NAME,
      client,
      devices,
      getConnectedDevices,
      getDeviceChannel,
      deviceAssignments,
      buttplug,
      updateStatus,
      updateAIStatusFromActivity,
      stopAllDeviceActions,
      clearWorkerTimeout,
      getPollingInterval,
      getDeviceType,
      getDeviceDefaultIntensity,
      applyInversion,
      getRequestHeaders,
      aiGenerateRaw: generateRaw,
      messageCommands,
      PlayModeLoader,
      startSync,
      pauseSync,
      resumeSync,
      stopSync,
      stopAllSync
    })

// Set parser name
setParserName(NAME)

// Load UI template
const template = $(await renderExtensionTemplateAsync(`third-party/${extensionName}`, "settings"))
const embodyPanel = $('#embody-intiface-panel')
if (embodyPanel.length) {
  const drawerContent = template.hasClass('drawer') ? template.find('.drawer-content').children() : template
  embodyPanel.empty().append(drawerContent)
} else {
  $("#extensions-settings-button").after(template)
}

// Initialize connected devices module (requires template in DOM)
await initConnectedDevices(client, buttplug)

onDeviceChange(({ devices: currentDevices }) => {
  devices = currentDevices
  if (typeof window !== 'undefined') {
    window.devices = currentDevices
  }

  const nextAssignments = {}
  currentDevices.forEach((_, index) => {
    nextAssignments[index] = getDeviceChannel(index)
  })
  deviceAssignments = nextAssignments
  updatePrompt()
})

// Initialize media player (must be after template is loaded)
initMediaPlayer()

// Initialize timeline module (must be after template is loaded)
initTimelineModule({
  NAME,
  devices: window.devices,
  getConnectedDevices,
  deviceAssignments,
  buttplug,
  PlayModeLoader,
  updateStatus,
  stopAllDeviceActions,
  applyIntensityScale,
  applyInversion,
  getMotorCount: getDeviceMotorCount,
  getPollingInterval,
  executePattern,
  clearWorkerTimeout,
  startSync,
  pauseSync,
  resumeSync,
  stopSync
})

// Apply click handler hack for drawer toggle
function clickHandlerHack() {
  try {
    const element = document.querySelector("#extensions-settings-button .drawer-toggle")
    if (element) {
      const events = $._data(element, "events")
      if (events && events.click && events.click[0]) {
        const doNavbarIconClick = events.click[0].handler
        $("#intiface-connect-button .drawer-toggle").on("click", doNavbarIconClick)
      }
    }
  } catch (error) {
    console.error(`${NAME}: Failed to apply click handler hack.`, error)
  }
}
clickHandlerHack()

// Setup event handlers

// Connect button handled by connected_devices module
$(document).off('click.intifaceDisconnectIntent', '#intiface-connect-action-button').on('click.intifaceDisconnectIntent', '#intiface-connect-action-button', function() {
  if (client?.connected || isClientConnected()) {
    lastUiDisconnectIntentAt = Date.now()
  }
})

// Play Mode Menu toggle (main play mode section)
$("#intiface-playmode-menu-toggle").on("click", function() {
  const content = $("#intiface-playmode-menu-content")
  const arrow = $("#intiface-playmode-menu-arrow")
  if (content.is(":visible")) {
    content.slideUp(200)
    arrow.css("transform", "rotate(0deg)")
  } else {
    content.slideDown(200)
    arrow.css("transform", "rotate(180deg)")
  }
})

// AI Modes toggle (sub-section)
$("#intiface-ai-modes-toggle").on("click", function() {
  const content = $("#intiface-ai-modes-content")
  const arrow = $("#intiface-ai-modes-arrow")
  if (content.is(":visible")) {
    content.slideUp(200)
    arrow.css("transform", "rotate(0deg)")
  } else {
    content.slideDown(200)
    arrow.css("transform", "rotate(180deg)")
  }
})

// Mode Builder toggle
$("#intiface-mode-builder-toggle").on("click", function() {
  const content = $("#intiface-mode-builder-content")
  const arrow = $("#intiface-mode-builder-arrow")
  if (content.is(":visible")) {
    content.slideUp(200)
    arrow.css("transform", "rotate(0deg)")
  } else {
    content.slideDown(200)
    arrow.css("transform", "rotate(180deg)")
  }
})

// Mode Intensity toggle
$("#intiface-intensity-toggle").on("click", function() {
  const content = $("#intiface-intensity-content")
  const arrow = $("#intiface-intensity-arrow")
  if (content.is(":visible")) {
    content.slideUp(200)
    arrow.css("transform", "rotate(0deg)")
  } else {
    content.slideDown(200)
    arrow.css("transform", "rotate(180deg)")
  }
})

// Note: Media Library and Funscript menu toggles are handled in media_playback.js

// Advanced Configuration toggle
$("#intiface-advanced-toggle").on("click", function() {
  const content = $("#intiface-advanced-content")
  const arrow = $("#intiface-advanced-arrow")
  if (content.is(":visible")) {
    content.slideUp(200)
    arrow.removeClass("expanded")
  } else {
    content.slideDown(200)
    arrow.addClass("expanded")
  }
})

// Pattern configuration sliders
$("#intiface-pattern-duration").on("input", function() {
  const val = parseInt($(this).val())
  $("#intiface-pattern-duration-display").text(`${(val/1000).toFixed(1)}s`)
})

$("#intiface-pattern-min").on("input", function() {
  const val = parseInt($(this).val())
  $("#intiface-pattern-min-display").text(`${val}%`)
})

$("#intiface-pattern-max").on("input", function() {
  const val = parseInt($(this).val())
  $("#intiface-pattern-max-display").text(`${val}%`)
})

$("#intiface-pattern-cycles").on("input", function() {
  const val = parseInt($(this).val())
  $("#intiface-pattern-cycles-display").text(val)
})

// Timeline controls
$("#intiface-timeline-play").on("click", async function() {
  if (typeof playTimeline === 'function') {
    await playTimeline()
  }
})

$("#intiface-timeline-pause").on("click", async function() {
  if (typeof pauseTimeline === 'function') {
    await pauseTimeline()
  }
})

$("#intiface-timeline-clear").on("click", function() {
  if (typeof clearTimeline === 'function') {
    clearTimeline()
  }
})

// Reset mode intensities button
$("#intiface-reset-mode-intensities").on("click", function() {
  if (PlayModeLoader && PlayModeLoader.getAllModes) {
    const modes = PlayModeLoader.getAllModes()
    Object.keys(modes).forEach(modeId => {
      if (modeId !== 'basic') {
        PlayModeLoader.setIntensityMultiplier(modeId, 1.0)
      }
    })
    
    // Update all intensity sliders
    $('[id^="intiface-mode-intensity-"]').each(function() {
      const modeId = $(this).data('mode')
      if (modeId && modeId !== 'basic') {
        $(this).val(100)
        $(`#${$(this).attr('id')}-display`).text('100%')
      }
    })
    
    console.log(`${NAME}: Reset all mode intensities to 100%`)
  }
})

// Saved connection settings are handled by connected_devices module

    // Intiface executable path (for AI auto-start)
    loadExePath()
    $("#intiface-exe-path").on('input', function () {
      saveExePath($(this).val())
    })
    $("#intiface-exe-browse").on('click', async function () {
      await browseExePath()
    })

    // AI command toggle
    $("#intiface-ai-enabled").prop('checked', aiCommandsEnabled)
    $("#intiface-ai-enabled").on('change', async function() {
      const enabled = $(this).is(':checked')
      saveAICommandsEnabled(enabled)

      if (!enabled) {
        messageCommands = []
        executedCommands.clear()
        seenCommands.clear()
        streamingText = ''
        pendingSpokenSyncCommands = []
        pendingSpokenSyncKeys.clear()
        spokenSyncQueuedKeysEver.clear()
        spokenSyncSeenCommandSignaturesByRequest.clear()
        spokenSyncLastChunkStartKey = ''
        activeTtsRequestId = null
        resetTtsSyncState()
        if (commandQueueInterval) {
          clearWorkerTimeout(commandQueueInterval)
          commandQueueInterval = null
        }
        await stopAllDeviceActions({ silent: true })
      }

      lastPromptHash = ''
      updatePrompt()
      if (enabled) {
        await ensureIntifaceDeviceLorebook()
      }
      updateAIStatusFromActivity()
      updateStatus(enabled ? 'AI command control enabled' : 'AI command control disabled')
    })

    // AI TTS sync settings
    $("#intiface-ai-tts-sync-enabled").prop('checked', aiTtsSyncEnabled)
    updateAITtsSyncControls()
    $("#intiface-ai-tts-sync-enabled").on('change', function() {
      const enabled = $(this).is(':checked')
      saveAITtsSyncEnabled(enabled)
      updateAITtsSyncControls()

      if (!enabled) {
        resetTtsSyncState()
        processCommandQueue()
      }

      updateAIStatusFromActivity()
      updateStatus(enabled ? 'AI spoken-audio sync enabled' : 'AI spoken-audio sync disabled')
    })

    $("#intiface-ai-tts-sync-offset").val(aiTtsSyncOffsetMs)
    $("#intiface-ai-tts-sync-offset-display").text(`${aiTtsSyncOffsetMs}ms`)
    $("#intiface-ai-tts-sync-offset").on('input', function() {
      const value = Number.parseInt($(this).val(), 10) || 0
      saveAITtsSyncOffsetMs(value)
      $("#intiface-ai-tts-sync-offset-display").text(`${aiTtsSyncOffsetMs}ms`)
    })

    $("#intiface-ai-tts-sync-timeout").val(aiTtsSyncStartTimeoutMs)
    $("#intiface-ai-tts-sync-timeout-display").text(`${aiTtsSyncStartTimeoutMs}ms`)
    $("#intiface-ai-tts-sync-timeout").on('input', function() {
      const value = Number.parseInt($(this).val(), 10) || 1200
      saveAITtsSyncTimeoutMs(value)
      $("#intiface-ai-tts-sync-timeout-display").text(`${aiTtsSyncStartTimeoutMs}ms`)
    })

    $("#intiface-ai-sync-start-lead").val(aiSyncStartLeadMs)
    $("#intiface-ai-sync-start-lead-display").text(`${aiSyncStartLeadMs}ms`)
    $("#intiface-ai-sync-start-lead").on('input', function() {
      const value = Number.parseInt($(this).val(), 10) || 0
      saveAISyncStartLeadMs(value)
      $("#intiface-ai-sync-start-lead-display").text(`${aiSyncStartLeadMs}ms`)
    })

    $("#intiface-ai-tts-interrupt-policy").val(aiTtsInterruptPolicy)
    $("#intiface-ai-tts-interrupt-policy").on('change', function() {
      saveAITtsInterruptPolicy($(this).val())
      const label = aiTtsInterruptPolicy === 'flush'
        ? 'flush'
        : aiTtsInterruptPolicy === 'preserve'
          ? 'preserve'
          : 'grace'
      updateStatus(`AI interrupt policy: ${label}`)
    })

    // Intiface debug logging toggle
    $("#intiface-debug-logging-enabled").prop('checked', intifaceDebugLoggingEnabled)
    $("#intiface-debug-logging-enabled").on('change', function() {
      const enabled = $(this).is(':checked')
      saveDebugLoggingSetting(enabled)
      updateStatus(enabled ? 'Intiface debug logging enabled' : 'Intiface debug logging disabled')
    })

    // Polling rate
    $("#intiface-polling-rate").on("input", function() {
      const val = parseInt($(this).val())
      devicePollingRate = val
      saveDevicePollingRate(val)
      $("#intiface-polling-rate-display").text(`${val}Hz (${getPollingInterval()}ms)`)
      setPollingRate(val)
    })

    $("#intiface-polling-rate").val(devicePollingRate)
    $("#intiface-polling-rate-display").text(`${devicePollingRate}Hz (${getPollingInterval()}ms)`)

    // Global inversion
    $("#intiface-global-invert").prop('checked', globalInvert)
    $("#intiface-global-invert").on('change', function() {
      const isChecked = $(this).is(':checked')
      saveGlobalInvert(isChecked)
      const statusEl = $("#intiface-global-invert-status")
      if (isChecked) {
        statusEl.show()
        updateStatus('Global inversion enabled')
      } else {
        statusEl.hide()
        updateStatus('Global inversion disabled')
      }
    })

    // Initialize PlayModeLoader
    if (PlayModeLoader?.init) {
      await PlayModeLoader.init()
      console.log(`${NAME}: PlayModeLoader initialized`)

      const modeErrors = PlayModeLoader.modeErrors || {}
      const failedModes = Object.entries(modeErrors).filter(([, errors]) => Array.isArray(errors) && errors.length > 0)
      failedModes.forEach(([modeId, errors]) => {
        console.error(`${NAME}: Mode '${modeId}' disabled due to validation errors:`)
        errors.forEach((err) => console.error(` - ${err}`))
      })

      if (failedModes.length > 0) {
        const modeList = failedModes.map(([modeId]) => modeId).join(', ')
        updateStatus(`Disabled invalid playmode(s): ${modeList}. Check console for details.`, true)
      }

      renderPlayModeUI()
      populatePatternButtons()
    }

    const dynamicCommands = initDynamicCommands({
      PlayModeLoader,
      executeCommand,
      updateStatus,
    })

    initModeBuilder({
      NAME,
      PlayModeLoader,
      updateStatus,
      onModesUpdated: async () => {
        renderPlayModeUI()
        await populatePatternButtons()
        dynamicCommands.refresh()
        updatePrompt()
      }
    })

    // Setup timeline event handlers
    setupTimelineEventHandlers()

    // Setup runtime listeners (idempotent)
    bindRuntimeEventListeners()

    // Keep prompt/device state in sync even on unexpected socket drops.
    startConnectionStateMonitoring()

    if (aiCommandsEnabled) {
      await ensureIntifaceDeviceLorebook()
    }

    // Initial prompt update
    updatePrompt()
    setTimeout(() => updatePrompt(), 2000)
    setTimeout(() => updatePrompt(), 3000)

    // Update UI from shared connection state
    lastKnownChatIdentity = getActiveChatIdentity()
    const connectedNow = isClientConnected()
    updateButtonStates(connectedNow)
    updateStatus(connectedNow ? "Connected" : "Disconnected")
    updateAIStatusFromActivity()

    console.log(`${NAME}: Initialization complete`)

  } catch (error) {
    console.error(`${NAME}: Failed to initialize.`, error)
    updateStatus("Failed to load Buttplug.js. Check console.", true)
  }
})

// ==========================================
// EXPORTS
// ==========================================

export {
  stopAllDeviceActions,
  clearWorkerTimeout,
  getPollingInterval,
  updateAIStatusFromActivity,
  updateStatus,
  getDeviceType,
  getDeviceDefaultIntensity,
  applyInversion,
  NAME,
  client,
  devices,
  deviceAssignments,
  buttplug
}
