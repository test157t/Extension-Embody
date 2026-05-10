/**
 * Connected Devices Module
 * 
 * Handles device connection, disconnection, and management.
 * Self-contained - wires its own UI events.
 */

import { getState, setClient, setButtplug, setDevices, setConnected, loadSetting, saveSetting, loadBooleanSetting, updateExtensionPrompt, isClientConnected as sharedIsClientConnected, getButtplug as sharedGetButtplug } from './shared_state.js'
import { updateStatus, updateButtonStates } from './shared_ui.js'

const NAME = 'intiface-connect'

// Device channels
let deviceChannels = new Map()
const deviceChangeListeners = new Set()

async function hardStopDevice(device, buttplugLib = null, options = {}) {
  if (!device) return
  const includeLinearStop = options?.includeLinearStop === true

  try {
    if (typeof device.vibrate === 'function') {
      await device.vibrate(0)
    }
  } catch (_e) {}

  try {
    if (typeof device.oscillate === 'function') {
      await device.oscillate(0)
    }
  } catch (_e) {}

  if (includeLinearStop) {
    try {
      if (typeof device.linear === 'function') {
        await device.linear(0, 100)
      }
    } catch (_e) {}
  }

  try {
    if (typeof device.scalar === 'function' && buttplugLib?.ScalarSubcommand) {
      const attrs = device?.messageAttributes || {}
      const lists = [
        attrs?.ScalarCmd,
        attrs?.VibrateCmd,
        attrs?.OscillateCmd,
        attrs?.RotateCmd,
        attrs?.ConstrictCmd,
        attrs?.InflateCmd,
      ].filter(Array.isArray)

      for (const list of lists) {
        for (let i = 0; i < list.length; i++) {
          const entry = list[i] || {}
          const actuatorType = String(entry?.ActuatorType || 'Vibrate')
          const actuatorIndex = Number.isFinite(entry?.Index) ? Number(entry.Index) : i
          try {
            const scalarCmd = new buttplugLib.ScalarSubcommand(actuatorIndex, 0, actuatorType)
            await device.scalar(scalarCmd)
          } catch (_e) {}
        }
      }
    }
  } catch (_e) {}
}

function saveChannelAssignments() {
  const assignments = Object.fromEntries(deviceChannels.entries())
  saveSetting('device-channels', JSON.stringify(assignments))
  try {
    localStorage.setItem('intiface-device-channels', JSON.stringify(assignments))
  } catch (_e) {}
}

function getDevicePersistentKey(device) {
  if (!device) return null
  const name = (device.displayName || device.name || 'unknown').trim().toLowerCase()
  const vibeCount = Array.isArray(device.vibrateAttributes) ? device.vibrateAttributes.length : 0
  const hasLinear = device?.messageAttributes?.LinearCmd !== undefined ? '1' : '0'
  const hasOscillate = device?.messageAttributes?.OscillateCmd !== undefined ? '1' : '0'
  return `${name}|v${vibeCount}|l${hasLinear}|o${hasOscillate}`
}

function getDeviceKeyByIndex(deviceIndex) {
  const device = getConnectedDevices()[deviceIndex]
  const stableKey = getDevicePersistentKey(device)
  if (stableKey) return stableKey
  return `idx:${deviceIndex}`
}

function loadChannelAssignments() {
  let saved = loadSetting('device-channels', null)
  if (!saved) {
    try {
      saved = localStorage.getItem('intiface-device-channels')
    } catch (_e) {
      saved = null
    }
  }

  if (!saved) {
    deviceChannels = new Map()
    return
  }

  try {
    const parsed = JSON.parse(saved)
    const entries = Object.entries(parsed || {}).filter(([, v]) => typeof v === 'string')
    deviceChannels = new Map(entries)
  } catch (_e) {
    deviceChannels = new Map()
  }
}

function notifyDeviceChange() {
  const payload = {
    devices: getConnectedDevices(),
    channels: new Map(deviceChannels)
  }
  deviceChangeListeners.forEach(listener => {
    try {
      listener(payload)
    } catch (e) {
      console.error(`${NAME}: Device change listener failed:`, e)
    }
  })
}

// Getters
export function getConnectedDevices() {
  return getState().devices
}

export function getDeviceChannel(deviceIndex) {
  const stableKey = getDeviceKeyByIndex(deviceIndex)
  if (deviceChannels.has(stableKey)) {
    return deviceChannels.get(stableKey)
  }

  const legacyNumericKey = String(deviceIndex)
  if (deviceChannels.has(legacyNumericKey)) {
    const migratedChannel = deviceChannels.get(legacyNumericKey)
    deviceChannels.set(stableKey, migratedChannel)
    deviceChannels.delete(legacyNumericKey)
    saveChannelAssignments()
    return migratedChannel
  }

  return '-'
}

export function getDevicesOnChannel(channel) {
  const normalizedChannel = String(channel || '-').trim().toUpperCase()
  const devices = getState().devices || []

  if (normalizedChannel === '-') {
    // '-' means All devices in the UI.
    return devices
  }

  return devices.filter((_, index) => String(getDeviceChannel(index) || '-').trim().toUpperCase() === normalizedChannel)
}

export function getActiveChannels() {
  return [...new Set([...deviceChannels.values()])]
}

export function getDeviceMotorCount(device) {
  if (!device) return 1
  if (Array.isArray(device.vibrateAttributes) && device.vibrateAttributes.length > 0) {
    return device.vibrateAttributes.length
  }

  const scalarCount = getScalarActuators(device).length
  if (scalarCount > 0) {
    return scalarCount
  }

  return 1
}

export function getDeviceDisplayName(device) {
  if (!device) return 'Unknown Device'
  return device.displayName || device.name || `Device ${device.index}`
}

export function getDeviceType(device) {
  const name = (device?.displayName || device?.name || '').toLowerCase()
  const hasLinearMotion = Array.isArray(device?.linearAttributes) && device.linearAttributes.length > 0
  if (
    hasLinearMotion ||
    name.includes('handy') ||
    name.includes('launch') ||
    name.includes('onahole') ||
    name.includes('masturbator') ||
    name.includes('stroker') ||
    name.includes('solace') ||
    name.includes('max 2') ||
    name.includes('gush') ||
    name.includes('thrust') ||
    name.includes('blowjob')
  ) {
    return 'stroker'
  } else if (name.includes('cellmate') || name.includes('adorime') || name.includes('cage')) {
    return 'cage'
  } else if (name.includes('plug') || name.includes('prostate') || name.includes('butt')) {
    return 'plug'
  }
  return 'general'
}

export function isClientConnected() {
  return sharedIsClientConnected()
}

export function getButtplug() {
  return sharedGetButtplug()
}

// Setters
export function setDeviceChannel(deviceIndex, channel) {
  const stableKey = getDeviceKeyByIndex(deviceIndex)
  deviceChannels.set(stableKey, channel)
  deviceChannels.delete(String(deviceIndex))
  saveChannelAssignments()
  notifyDeviceChange()
}

export function resetChannelAssignments() {
  deviceChannels.clear()
  saveChannelAssignments()
  renderDeviceList(getConnectedDevices())
  notifyDeviceChange()
}

export function assignAllDevicesToChannel(channel = '-') {
  getConnectedDevices().forEach((device, index) => {
    const stableKey = getDevicePersistentKey(device) || `idx:${index}`
    deviceChannels.set(stableKey, channel)
    deviceChannels.delete(String(index))
  })
  saveChannelAssignments()
  renderDeviceList(getConnectedDevices())
  notifyDeviceChange()
}

export function onDeviceChange(callback) {
  if (typeof callback !== 'function') return () => {}
  deviceChangeListeners.add(callback)
  return () => deviceChangeListeners.delete(callback)
}

export function setConnectedDevices(newDevices) {
  setDevices(newDevices)
  updateExtensionPrompt(newDevices)
  notifyDeviceChange()
}

// Connection functions
export async function connect(isAutoConnect = false) {
  const state = getState()
  console.log(`${NAME}: connect() called${isAutoConnect ? ' (auto-connect mode)' : ''}`)

  if (state.client?.connected) {
    console.log(`${NAME}: connect() skipped - already connected`)
    if (!isAutoConnect) {
      updateStatus('Already connected')
      updateButtonStates(true)
    }
    return
  }
  
  try {
    const serverIpInput = document.getElementById('intiface-ip-input')
    const serverIp = serverIpInput ? serverIpInput.value.replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '') : '127.0.0.1:12345'
    const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://'
    const serverUrl = `${protocol}${serverIp}`
    
    console.log(`${NAME}: Connecting to ${serverUrl}`)
    saveSetting('server-ip', serverIp)
    try {
      localStorage.setItem('intiface-server-ip', serverIp)
    } catch (_e) {}
    
    const connector = new state.buttplug.ButtplugBrowserWebsocketClientConnector(serverUrl)
    
    if (!isAutoConnect) {
      updateStatus("Connecting...")
    }
    
    await state.client.connect(connector)
    console.log(`${NAME}: Connected successfully`)
    
    setConnected(true)
    updateStatus("Connected")
    updateButtonStates(true)
    
    // Attach device event handlers
    attachDeviceEventHandlers()
    
    // Update devices list
    const internalDevices = state.client._devices || new Map()
    const deviceArray = Array.from(internalDevices.values())

    // Ensure newly connected devices start from a hard stop state, so no
    // residual motion continues from prior sessions/apps.
    await Promise.all(deviceArray.map((dev) => hardStopDevice(dev, state.buttplug, { includeLinearStop: false })))

    setConnectedDevices(deviceArray)
    renderDeviceList(deviceArray)
    
    // Try scanning if no devices
    if (deviceArray.length === 0) {
      setTimeout(async () => {
        try {
          await state.client.startScanning()
          setTimeout(() => {
            state.client.stopScanning().catch(() => {})
          }, 3000)
        } catch (e) {
          console.log(`${NAME}: Could not start scanning:`, e)
        }
      }, 500)
    }
    
    updateExtensionPrompt(deviceArray)
    
  } catch (e) {
    let errorMsg = e?.message || e?.toString?.() || String(e) || 'Unknown error'
    
    if (!errorMsg || errorMsg === 'undefined' || errorMsg === 'null') {
      errorMsg = 'Server not available'
    } else if (errorMsg.includes('WebSocket') && errorMsg.includes('failed')) {
      errorMsg = 'Server not available'
    } else if (errorMsg.includes('ECONNREFUSED') || errorMsg.includes('refused')) {
      errorMsg = 'Connection refused - server may be offline'
    } else if (errorMsg.includes('ENOTFOUND') || errorMsg.includes('not found')) {
      errorMsg = 'Server address not found'
    } else if (errorMsg.includes('ETIMEDOUT') || errorMsg.includes('timeout')) {
      errorMsg = 'Connection timed out'
    }
    
    if (isAutoConnect) {
      console.log(`${NAME}: Auto-connect failed:`, errorMsg)
    } else {
      console.error(`${NAME}: Connect failed:`, errorMsg)
      updateStatus(errorMsg, true)
    }

    throw new Error(errorMsg)
  }
}

export async function disconnect() {
  const state = getState()
  console.log(`${NAME}: Disconnect called`)
  
  try {
    await state.client.disconnect()
    
    setConnected(false)
    updateStatus("Disconnected")
    updateButtonStates(false)
    
    // Clear devices display
    const devicesContainer = document.getElementById('intiface-devices')
    if (devicesContainer) {
      devicesContainer.innerHTML = ''
    }
    
    setDevices([])
    notifyDeviceChange()
    
    updateExtensionPrompt([])
    
  } catch (e) {
    console.error(`${NAME}: Disconnect error:`, e)
    updateStatus(`Error disconnecting: ${e?.message || 'Unknown error'}`, true)
    
    // Force clear state even on error
    setDevices([])
    notifyDeviceChange()
  }
}

export async function toggleConnection() {
  const state = getState()
  if (state.client?.connected) {
    await disconnect()
  } else {
    try {
      await connect()
    } catch (e) {
      console.log(`${NAME}: Connect failed in toggleConnection`)
    }
  }
}

// Device event handlers
function attachDeviceEventHandlers() {
  const state = getState()
  
  state.client.removeAllListeners("deviceadded")
  state.client.removeAllListeners("deviceremoved")
  
  state.client.on("deviceadded", async (newDevice) => {
    console.log(`${NAME}: Device added: ${newDevice.name}`)

    await hardStopDevice(newDevice, state.buttplug, { includeLinearStop: false })
    
    const currentDevices = getConnectedDevices()
    if (!currentDevices.find(d => d.index === newDevice.index)) {
      const updatedDevices = [...currentDevices, newDevice]
      setConnectedDevices(updatedDevices)
      renderDeviceList(updatedDevices)
    }
    
    updateStatus(`Device found: ${newDevice.name}`)
  })
  
  state.client.on("deviceremoved", (removedDevice) => {
    console.log(`${NAME}: Device removed: ${removedDevice.name}`)
    
    const currentDevices = getConnectedDevices()
    const updatedDevices = currentDevices.filter(d => d.index !== removedDevice.index)
    setConnectedDevices(updatedDevices)
    renderDeviceList(updatedDevices)
    
    updateStatus(`Device removed: ${removedDevice.name}`)
  })
}

// UI Rendering
function renderDeviceList(devices) {
  const container = document.getElementById('intiface-devices')
  if (!container) return
  
  if (devices.length === 0) {
    container.innerHTML = '<div style="color: #888; text-align: center; padding: 20px;">No devices connected</div>'
    return
  }
  
  let html = '<div style="display: flex; flex-direction: column; gap: 10px;">'
  
  devices.forEach((dev, index) => {
    const deviceName = getDeviceDisplayName(dev)
    const motorCount = getDeviceMotorCount(dev)
    const deviceType = getDeviceType(dev)
    
    html += `
      <div class="device-card" data-device-index="${index}" style="padding: 10px; background: rgba(100,100,200,0.1); border-radius: 4px; border: 1px solid rgba(100,100,200,0.2);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span style="font-weight: bold;">${deviceName}</span>
          <span style="font-size: 0.75em; color: #888;">${deviceType}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
          <span style="font-size: 0.75em; min-width: 60px; color: #aaa;">Channel</span>
          <select class="device-channel-select" data-device-index="${index}" style="flex: 1; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.15); border-radius: 3px; color: #fff; font-size: 0.75em; padding: 2px 4px;">
            ${renderChannelOptions(getDeviceChannel(index))}
          </select>
        </div>
        ${renderMotorControls(dev, index, motorCount)}
      </div>
    `
  })
  
  html += '</div>'
  container.innerHTML = html
  
  // Attach motor control handlers
  attachMotorControlHandlers(devices)
  attachChannelControlHandlers()
}

function renderChannelOptions(selectedChannel) {
  const channels = ['-', 'A', 'B', 'C', 'D']
  return channels.map(channel => `<option value="${channel}" ${selectedChannel === channel ? 'selected' : ''}>${channel === '-' ? 'All (-)' : channel}</option>`).join('')
}

function renderMotorControls(device, deviceIndex, motorCount) {
  let html = '<div style="display: flex; flex-direction: column; gap: 5px;">'
  
  for (let i = 0; i < motorCount; i++) {
    html += `
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="font-size: 0.75em; min-width: 60px;">Motor ${i + 1}</span>
        <input type="range" class="motor-slider" data-device="${deviceIndex}" data-motor="${i}" 
          min="0" max="100" value="0" style="flex: 1;">
        <span class="motor-value" style="font-size: 0.75em; min-width: 35px;">0%</span>
      </div>
    `
  }
  
  html += '</div>'
  return html
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

async function applySliderIntensity(state, device, intensity, motorIndex = 0) {
  const intensityValue = Math.max(0, Math.min(100, Number(intensity) || 0)) / 100

  if (typeof device?.vibrate === 'function') {
    try {
      await device.vibrate(intensityValue)
      return true
    } catch (_e) {}
  }

  if (typeof device?.scalar === 'function' && state.buttplug?.ScalarSubcommand) {
    const actuators = getScalarActuators(device)
    if (actuators.length > 0) {
      const target = actuators.find((a) => a.index === motorIndex) || actuators[0]
      try {
        const scalarCmd = new state.buttplug.ScalarSubcommand(
          Number(target.index) || 0,
          intensityValue,
          String(target.actuatorType || 'Vibrate')
        )
        await device.scalar(scalarCmd)
        return true
      } catch (_e) {}
    }
  }

  if (typeof device?.oscillate === 'function') {
    try {
      await device.oscillate(intensityValue)
      return true
    } catch (_e) {}
  }

  if (typeof device?.linear === 'function') {
    try {
      await device.linear(intensityValue, 120)
      return true
    } catch (_e) {}
  }

  return false
}

function attachMotorControlHandlers(devices) {
  const state = getState()
  
  document.querySelectorAll('.motor-slider').forEach(slider => {
    slider.addEventListener('input', async (e) => {
      const deviceIndex = parseInt(e.target.dataset.device)
      const motorIndex = parseInt(e.target.dataset.motor)
      const intensity = parseInt(e.target.value)
      
      const device = devices[deviceIndex]
      if (!device || !state.client?.connected) return

      // Keep UI responsive even if command path fails.
      const valueDisplay = e.target.nextElementSibling
      if (valueDisplay) {
        valueDisplay.textContent = `${intensity}%`
      }
      
      try {
        const ok = await applySliderIntensity(state, device, intensity, motorIndex)
        if (!ok) {
          updateStatus(`Device ${getDeviceDisplayName(device)} does not expose a controllable motor path`, true)
        }
      } catch (e) {
        console.error(`${NAME}: Motor control failed:`, e)
        updateStatus('Motor control failed', true)
      }
    })
  })
}

function attachChannelControlHandlers() {
  document.querySelectorAll('.device-channel-select').forEach(select => {
    select.addEventListener('change', (e) => {
      const deviceIndex = parseInt(e.target.dataset.deviceIndex, 10)
      const channel = e.target.value || '-'
      setDeviceChannel(deviceIndex, channel)
    })
  })
}

// Stop all devices
export async function stopAllDevices() {
  const state = getState()
  const devices = getConnectedDevices()
  
  if (devices.length === 0) return
  
  const stopPromises = devices.map(async (dev) => {
    try {
      await hardStopDevice(dev, state.buttplug, { includeLinearStop: true })
    } catch (e) {
      // Ignore errors
    }
  })
  
  await Promise.all(stopPromises)
  
  // Reset sliders
  document.querySelectorAll('.motor-slider').forEach(slider => {
    slider.value = 0
    const valueDisplay = slider.nextElementSibling
    if (valueDisplay) {
      valueDisplay.textContent = '0%'
    }
  })
}

// Rescan
export async function rescan() {
  const state = getState()
  if (!state.client?.connected) {
    updateStatus("Not connected")
    return
  }

  const rescanBtn = document.getElementById('intiface-rescan-button')
  if (rescanBtn) {
    rescanBtn.disabled = true
  }
  
  updateStatus("Scanning for devices...")
  console.log(`${NAME}: Starting device scan...`)
  
  try {
    await state.client.startScanning()

    setTimeout(async () => {
      try {
        await state.client.stopScanning()
      } catch (_e) {}

      const internalDevices = state.client._devices || new Map()
      const deviceArray = Array.from(internalDevices.values())
      setConnectedDevices(deviceArray)
      renderDeviceList(deviceArray)

      updateStatus(`Scan complete (${deviceArray.length} device${deviceArray.length === 1 ? '' : 's'})`)
      console.log(`${NAME}: Scan complete, found ${deviceArray.length} device(s)`)

      if (rescanBtn) {
        rescanBtn.disabled = false
      }
    }, 5000)
  } catch (e) {
    console.error(`${NAME}: Rescan failed:`, e)
    updateStatus("Rescan failed", true)
    if (rescanBtn) {
      rescanBtn.disabled = false
    }
  }
}

// Initialization
export async function initConnectedDevices(legacyClient = null, legacyButtplug = null) {
  console.log(`${NAME}: Initializing connected devices module...`)
  
  const state = getState()

  loadChannelAssignments()

  if (!state.buttplug) {
    const buttplugLib = legacyButtplug || window?.buttplug || null
    if (buttplugLib) {
      setButtplug(buttplugLib)
    }
  }

  if (!state.buttplug) {
    throw new Error(`${NAME}: Buttplug library not loaded`)
  }
  
  // Initialize client
  if (legacyClient) {
    setClient(legacyClient)
  } else if (!state.client) {
    setClient(new state.buttplug.ButtplugClient("SillyTavern Intiface Client"))
  }
  
  // Wire UI events
  const connectBtn = document.getElementById('intiface-connect-action-button')
  if (connectBtn) {
    connectBtn.addEventListener('click', toggleConnection)
  }
  
  const rescanBtn = document.getElementById('intiface-rescan-button')
  if (rescanBtn) {
    rescanBtn.addEventListener('click', rescan)
  }
  
  // Load saved server IP
  const savedIp =
    loadSetting('server-ip', null) ||
    (() => {
      try {
        return localStorage.getItem('intiface-server-ip') || localStorage.getItem('server-ip')
      } catch (_e) {
        return null
      }
    })() ||
    '127.0.0.1:12345'
  const ipInput = document.getElementById('intiface-ip-input')
  if (ipInput) {
    ipInput.value = savedIp
    ipInput.addEventListener('input', (e) => {
      saveSetting('server-ip', e.target.value)
      try {
        localStorage.setItem('intiface-server-ip', e.target.value)
      } catch (_e) {}
    })
  }
  
  // Auto-connect
  const autoConnect = loadBooleanSetting('auto-connect', false)
  const autoConnectCheckbox = document.getElementById('intiface-auto-connect')
  if (autoConnectCheckbox) {
    autoConnectCheckbox.checked = autoConnect
    autoConnectCheckbox.addEventListener('change', (e) => {
      saveSetting('auto-connect', e.target.checked)
    })
  }
  
  if (autoConnect) {
    setTimeout(() => {
      if (!state.client.connected) {
        connect(true).catch(() => {})
      }
    }, 2000)
  }
  
  console.log(`${NAME}: Connected devices module initialized`)
  
  return {
    connect,
    disconnect,
    toggleConnection,
    rescan,
    getConnectedDevices,
    getDeviceChannel,
    setDeviceChannel,
    getDevicesOnChannel,
    getActiveChannels,
    getDeviceMotorCount,
    getDeviceDisplayName,
    getDeviceType,
    setConnectedDevices,
    stopAllDevices,
    resetChannelAssignments,
    assignAllDevicesToChannel,
    onDeviceChange
  }
}
