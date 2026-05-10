import { setExtensionPrompt, extension_prompt_types, extension_prompt_roles } from "../../../../../script.js"

const NAME = "intiface-connect"

let state = {
  client: null,
  buttplug: null,
  devices: [],
  deviceAssignments: {},
  globalIntensityScale: 100,
  globalInvert: false,
  devicePollingRate: 30,
  isConnected: false,
}

export function getState() { return state }
export function getClient() { return state.client }
export function getButtplug() { return state.buttplug }
export function getDevices() { return state.devices }
export function getDeviceAssignments() { return state.deviceAssignments }
export function isClientConnected() { return state.client?.connected || false }
export function getGlobalIntensityScale() { return state.globalIntensityScale }
export function getGlobalInvert() { return state.globalInvert }
export function getDevicePollingRate() { return state.devicePollingRate }

export function setClient(client) { state.client = client }
export function setButtplug(buttplug) { state.buttplug = buttplug }
export function setDevices(devices) {
  state.devices = devices
  if (typeof window !== "undefined") window.devices = devices
}
export function setDeviceAssignments(assignments) { state.deviceAssignments = assignments }
export function setGlobalIntensityScale(scale) { state.globalIntensityScale = scale }
export function setGlobalInvert(invert) { state.globalInvert = invert }
export function setDevicePollingRate(rate) { state.devicePollingRate = rate }
export function setConnected(connected) { state.isConnected = connected }

export function getPollingInterval() {
  return Math.round(1000 / state.devicePollingRate)
}

export function applyInversion(value) {
  return state.globalInvert ? 100 - value : value
}

export function loadSetting(key, defaultValue = null) {
  try {
    const saved = localStorage.getItem(`intiface-${key}`)
    return saved !== null ? saved : defaultValue
  } catch (_e) {
    return defaultValue
  }
}

export function saveSetting(key, value) {
  try {
    localStorage.setItem(`intiface-${key}`, value)
  } catch (e) {
    console.error(`${NAME}: Failed to save setting ${key}:`, e)
  }
}

export function loadBooleanSetting(key, defaultValue = false) {
  const saved = loadSetting(key)
  return saved !== null ? saved === "true" : defaultValue
}

export function loadIntSetting(key, defaultValue = 0) {
  const saved = loadSetting(key)
  return saved !== null ? parseInt(saved, 10) || defaultValue : defaultValue
}

let lastPromptHash = ""

function hashPrompt(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return hash.toString(16)
}

export function updateExtensionPrompt(connectedDevices) {
  const managedByIndex = (typeof globalThis !== 'undefined' && globalThis.__intifacePromptManagedByIndex) ||
    (typeof window !== 'undefined' && window.__intifacePromptManagedByIndex)

  if (managedByIndex) {
    console.debug(`${NAME}: Skipping shared_state prompt update - index.js manages prompt`)
    return
  }

  const canStartIntiface = !!loadSetting("exe-path")

  const prompt = `=== DEVICE CONTROL ACTIVE ===

Connected devices: ${connectedDevices.length}
${canStartIntiface ? "Intiface Central can be started via <interface:START>" : ""}

Use commands like:
- <deviceName:VIBRATE: 50>
- <deviceName:OSCILLATE: 75>
- <deviceName:LINEAR: start=0, end=100, duration=1000>
- <deviceName:PRESET: tease>
- <deviceName:WAVEFORM: sine, min=10, max=80, duration=5000, cycles=3>
- <media:PLAY: filename.mp4>
- <any:STOP>

Commands are hidden from the user and execute instantly.`

  const promptHash = hashPrompt(prompt)
  if (promptHash !== lastPromptHash) {
    try {
      setExtensionPrompt("intiface_control", prompt, extension_prompt_types.IN_PROMPT, 2, true, extension_prompt_roles.SYSTEM)
      lastPromptHash = promptHash
    } catch (err) {
      console.error(`${NAME}: Failed to set extension prompt:`, err)
    }
  }
}
