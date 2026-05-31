// ==========================================
// MEDIA PLAYER MODULE
// Handles video/audio playback UI ONLY
// Funscript execution is handled by universal_funscript_sync.js
// ==========================================

import {
  startSync,
  stopSync,
  stopAllSync
} from './universal_funscript_sync.js'

// Dependencies (set by initMediaModule function)
let moduleDeps = null

// Initialize module with dependencies from main script
function initMediaModule(dependencies) {
  moduleDeps = dependencies
  console.log(`${moduleDeps.NAME || 'Intiface'}: Media module initialized`)
}

// Helper to access dependencies
const d = (name) => moduleDeps?.[name]

function getConnectedDevicesLive() {
  if (typeof d("getConnectedDevices") === 'function') {
    return d("getConnectedDevices")() || []
  }
  return d("devices") || []
}

// Media player state
let mediaPlayer = {
  videoElement: null,
  currentFunscript: null,
  channelFunscripts: {}, // Map of channel letter -> funscript (A, B, C, D, - for all)
  isPlaying: false,
  syncOffset: 0,
  globalIntensity: 100,
  currentMediaPath: null
}

let mediaLibraryState = {
  allFiles: [],
  searchQuery: '',
  typeFilter: 'all',
  sortBy: 'name-asc',
  durationProbePromises: new Map(),
  durationLoadId: 0,
}

let funscriptEditorState = {
  selectedFile: '',
  fileMap: new Map(),
  originalScript: null,
  currentScript: null,
  draftScript: null,
  jsonVisible: false,
}

// Funscript cache
let funscriptCache = new Map()

// Active sync session ID
let mediaSyncSessionId = null

// ==========================================
// MEDIA PLAYER INITIALIZATION
// ==========================================

function initMediaPlayer() {
  console.log(`${d("NAME") || "Intiface"}: Initializing media player...`)

  // Handle menu media section toggle
  $("#intiface-media-menu-toggle").on("click", function () {
    const content = $("#intiface-media-menu-content")
    const arrow = $("#intiface-media-menu-arrow")
    if (content.is(":visible")) {
      content.slideUp(200)
      arrow.css("transform", "rotate(0deg)")
    } else {
      content.slideDown(200)
      arrow.css("transform", "rotate(180deg)")
    }
  })

  // Handle funscript menu section toggle
  $("#intiface-funscript-menu-toggle").on("click", function () {
    const content = $("#intiface-funscript-menu-content")
    const arrow = $("#intiface-funscript-menu-arrow")
    if (content.is(":visible")) {
      content.slideUp(200)
      arrow.css("transform", "rotate(0deg)")
    } else {
      content.slideDown(200)
      arrow.css("transform", "rotate(180deg)")
    }
  })

  // Handle funscript editor section toggle
  $("#intiface-funscript-editor-toggle").on("click", function () {
    const content = $("#intiface-funscript-editor-content")
    const arrow = $("#intiface-funscript-editor-arrow")
    if (content.is(":visible")) {
      content.slideUp(200)
      arrow.css("transform", "rotate(0deg)")
    } else {
      content.slideDown(200)
      arrow.css("transform", "rotate(180deg)")
    }
  })

  // Handle menu refresh button
  $("#intiface-menu-refresh-media-btn").on("click", refreshMenuMediaList)

  const savedSearch = localStorage.getItem('intiface-media-search')
  if (savedSearch !== null) {
    mediaLibraryState.searchQuery = savedSearch
    $("#intiface-menu-media-search").val(savedSearch)
  }

  const savedSort = localStorage.getItem('intiface-media-sort')
  if (savedSort) {
    mediaLibraryState.sortBy = savedSort
    $("#intiface-menu-media-sort").val(savedSort)
  }

  const savedType = localStorage.getItem('intiface-media-type')
  if (savedType) {
    mediaLibraryState.typeFilter = savedType
    $("#intiface-menu-media-type").val(savedType)
  }

  $("#intiface-menu-media-search").on("input", function () {
    mediaLibraryState.searchQuery = String($(this).val() || '').trim().toLowerCase()
    localStorage.setItem('intiface-media-search', String($(this).val() || ''))
    renderMenuMediaList()
  })

  $("#intiface-menu-media-sort").on("change", async function () {
    mediaLibraryState.sortBy = String($(this).val() || 'name-asc')
    localStorage.setItem('intiface-media-sort', mediaLibraryState.sortBy)

    if (mediaLibraryState.sortBy === 'duration-desc' || mediaLibraryState.sortBy === 'duration-asc') {
      await ensureMediaDurationsLoaded()
    }

    renderMenuMediaList()
  })

  $("#intiface-menu-media-type").on("change", function () {
    mediaLibraryState.typeFilter = String($(this).val() || 'all')
    localStorage.setItem('intiface-media-type', mediaLibraryState.typeFilter)
    renderMenuMediaList()
  })

  // Funscript editor controls
  $("#intiface-funscript-editor-refresh").on("click", refreshFunscriptEditorList)
  $("#intiface-funscript-editor-load").on("click", loadSelectedFunscriptForEdit)
  $("#intiface-funscript-editor-save").on("click", saveEditedFunscript)
  $("#intiface-funscript-editor-format").on("click", formatEditedFunscript)
  $("#intiface-funscript-editor-apply-selected").on("click", applySelectedProgrammaticEditsFromUi)
  $("#intiface-funscript-editor-apply-optimize").on("click", applyDeviceOptimizationProfile)
  $("#intiface-funscript-editor-optimize-intensity").on("input", updateOptimizationIntensityDisplay)
  $("#intiface-funscript-editor-ai-edit").on("click", aiEditFunscriptFromInstructions)
  $("#intiface-funscript-editor-accept").on("click", acceptFunscriptDraft)
  $("#intiface-funscript-editor-discard").on("click", discardFunscriptDraft)
  $("#intiface-funscript-editor-toggle-json").on("click", toggleFunscriptJsonVisibility)
  $("#intiface-funscript-editor-json").on("input", syncCurrentScriptFromJsonEditor)
  $("#intiface-funscript-editor-file").on("change", function () {
    funscriptEditorState.selectedFile = String($(this).val() || '')
  })

  // Handle menu media file selection
  $(document).on('click', '.menu-media-file-item', async function() {
    const filename = $(this).data('filename')
    await loadChatMediaFile(filename)
  })

  updateOptimizationIntensityDisplay()

  // Handle menu sync offset
  $("#intiface-menu-sync-offset").on("input", function() {
    mediaPlayer.syncOffset = parseInt($(this).val())
    const display = $("#intiface-menu-sync-display")
    display.text(`${mediaPlayer.syncOffset}ms`)
    if (Math.abs(mediaPlayer.syncOffset) > 1000) {
      display.css("color", "#FFA500")
    } else if (Math.abs(mediaPlayer.syncOffset) > 100) {
      display.css("color", "#FFEB3B")
    } else {
      display.css("color", "#64B5F6")
    }
  })

  // Handle menu intensity
  $("#intiface-menu-intensity").on("input", function() {
    const newIntensity = parseInt($(this).val())
    mediaPlayer.globalIntensity = newIntensity
    if (moduleDeps) moduleDeps.globalIntensityScale = newIntensity
    const display = $("#intiface-menu-intensity-display")
    display.text(`${newIntensity}%`)
    if (newIntensity < 100) {
      display.css("color", "#4CAF50")
    } else if (newIntensity < 200) {
      display.css("color", "#FFEB3B")
    } else if (newIntensity < 300) {
      display.css("color", "#FF9800")
    } else {
      display.css("color", "#F44336")
    }
  })

  // Load saved appearance settings
  loadMediaPlayerAppearance()

  // Handle appearance sliders
  $("#intiface-menu-width").on("input", saveAndApplyAppearance)
  $("#intiface-menu-position").on("change", saveAndApplyAppearance)
  $("#intiface-menu-zindex").on("input", saveAndApplyAppearance)
  $("#intiface-menu-video-opacity").on("input", saveAndApplyAppearance)
  $("#intiface-use-internal-proxy").on("change", handleProxyToggle)
  $("#intiface-reset-appearance-btn").on("click", resetAppearance)

  syncFunscriptEditorUiState()

  console.log(`${d("NAME") || "Intiface"}: Media player initialized`)

  // Auto-load media list on startup
  refreshMenuMediaList().catch(e => {
    console.log(`${d("NAME") || "Intiface"}: Failed to auto-load media list:`, e.message)
  })

  refreshFunscriptEditorList().catch(e => {
    console.log(`${d("NAME") || "Intiface"}: Failed to load funscript editor list:`, e.message)
  })
}

function saveAndApplyAppearance() {
  updateAppearanceDisplayValues()
  saveMediaPlayerAppearance()
  applyMediaPlayerAppearance()
}

function getNumberSetting(selector, fallbackValue) {
  const el = $(selector)
  if (el.length === 0) return fallbackValue
  const parsed = Number.parseInt(String(el.val() ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : fallbackValue
}

function updateAppearanceDisplayValues() {
  const videoOpacity = getNumberSetting('#intiface-menu-video-opacity', 100)
  const width = getNumberSetting('#intiface-menu-width', 100)
  const zindex = getNumberSetting('#intiface-menu-zindex', 1)

  $('#intiface-menu-video-opacity-display').text(`${videoOpacity}%`)
  $('#intiface-menu-width-display').text(`${(width / 100).toFixed(1)}x`)
  $('#intiface-menu-zindex-display').text(String(zindex))
}

function handleProxyToggle() {
  const useProxy = $(this).is(":checked")
  if (useProxy) {
    startInternalProxy()
  } else {
    stopInternalProxy()
  }
  saveMediaPlayerAppearance()
}

function resetAppearance() {
  $("#intiface-menu-video-opacity").val(100)
  $("#intiface-menu-width").val(100)
  $("#intiface-menu-position").val("top")
  $("#intiface-menu-zindex").val(1)
  $("#intiface-use-internal-proxy").prop("checked", false)
  updateAppearanceDisplayValues()
  stopInternalProxy()
  applyMediaPlayerAppearance()
  saveMediaPlayerAppearance()
}

// ==========================================
// APPEARANCE SETTINGS
// ==========================================

function loadMediaPlayerAppearance() {
  const savedVideoOpacity = localStorage.getItem("intiface-player-video-opacity")
  const savedWidth = localStorage.getItem("intiface-player-width")
  const savedPosition = localStorage.getItem("intiface-player-position")
  const savedZIndex = localStorage.getItem("intiface-player-zindex")
  const savedUseProxy = localStorage.getItem("intiface-player-use-proxy")

  if (savedVideoOpacity) {
    $("#intiface-menu-video-opacity").val(savedVideoOpacity)
  }

  if (savedWidth) {
    $("#intiface-menu-width").val(savedWidth)
  }

  if (savedPosition) {
    $("#intiface-menu-position").val(savedPosition)
  }

  if (savedZIndex) {
    $("#intiface-menu-zindex").val(savedZIndex)
  }

  updateAppearanceDisplayValues()

  if (savedUseProxy === "true") {
    $("#intiface-use-internal-proxy").prop("checked", true)
    startInternalProxy().catch(e => {
      console.log(`${d("NAME") || "Intiface"}: Failed to auto-start proxy:`, e.message)
      $("#intiface-use-internal-proxy").prop("checked", false)
    })
  }
}

function saveMediaPlayerAppearance() {
  localStorage.setItem("intiface-player-video-opacity", $("#intiface-menu-video-opacity").val())
  localStorage.setItem("intiface-player-width", $("#intiface-menu-width").val())
  localStorage.setItem("intiface-player-position", $("#intiface-menu-position").val())
  localStorage.setItem("intiface-player-zindex", $("#intiface-menu-zindex").val())
  localStorage.setItem("intiface-player-use-proxy", $("#intiface-use-internal-proxy").is(":checked"))
}

function applyMediaPlayerAppearance() {
  const videoOpacity = getNumberSetting('#intiface-menu-video-opacity', 100) / 100
  const width = getNumberSetting('#intiface-menu-width', 100)
  const position = String($("#intiface-menu-position").val() || 'top')
  const zindex = getNumberSetting('#intiface-menu-zindex', 1)
  const showFilename = true
  const showBorder = true

  const panel = $("#intiface-chat-media-panel")
  if (panel.length === 0) return

  panel.css("background", "rgba(0,0,0,0.55)")
  panel.css("border", showBorder ? "1px solid rgba(255,255,255,0.1)" : "none")
  panel.css("width", `${width}%`)

  const videoContainer = $("#intiface-chat-video-container")
  if (videoContainer.length > 0) {
    // Keep the media element full-width inside the panel.
    // Panel width is already controlled above, so scaling here creates extra gutter.
    videoContainer.css("width", "100%")
    videoContainer.css("margin", "0")
  }

  if (position === "center") {
    panel.css("position", "fixed")
    panel.css("top", "50%")
    panel.css("left", "50%")
    panel.css("transform", "translate(-50%, -50%)")
    panel.css("z-index", Math.max(9999, zindex))
    panel.css("max-height", "80vh")
    panel.css("margin-bottom", "0")
  } else {
    panel.css("position", "")
    panel.css("top", "")
    panel.css("left", "")
    panel.css("transform", "")
    panel.css("z-index", zindex)
    panel.css("max-height", "")
    panel.css("margin-bottom", "10px")
  }

  const videoPlayer = $("#intiface-chat-video-player")
  if (videoPlayer.length > 0) {
    videoPlayer.css("opacity", videoOpacity)
    videoPlayer[0].style.setProperty('opacity', videoOpacity, 'important')
  }

  const filenameDiv = $("#intiface-chat-video-filename")
  if (filenameDiv.length > 0) {
    showFilename ? filenameDiv.show() : filenameDiv.hide()
  }
}

// ==========================================
// WEBSOCKET PROXY
// ==========================================

let proxyProcess = null

async function startInternalProxy() {
  if (proxyProcess) {
    console.log(`${d("NAME") || "Intiface"}: Proxy already running`)
    updateProxyStatus(true)
    return
  }

  try {
    const response = await fetch('/api/plugins/intiface-launcher/proxy/start', {
      method: 'POST',
      headers: d("getRequestHeaders")()
    })

    const data = await response.json()
    if (data.success) {
      console.log(`${d("NAME") || "Intiface"}: Proxy started on port ${data.port}`)
      proxyProcess = { pid: data.pid, port: data.port }
      updateProxyStatus(true)
    }
  } catch (err) {
    console.error(`${d("NAME") || "Intiface"}: Failed to start proxy:`, err)
    updateProxyStatus(false, err.message)
    throw err
  }
}

async function stopInternalProxy() {
  if (!proxyProcess) {
    updateProxyStatus(false)
    return
  }

  try {
    const response = await fetch('/api/plugins/intiface-launcher/proxy/stop', {
      method: 'POST',
      headers: d("getRequestHeaders")()
    })

    const data = await response.json()
    if (data.success) {
      console.log(`${d("NAME") || "Intiface"}: Proxy stopped`)
      proxyProcess = null
      updateProxyStatus(false)
    }
  } catch (err) {
    console.error(`${d("NAME") || "Intiface"}: Failed to stop proxy:`, err)
    proxyProcess = null
    updateProxyStatus(false)
  }
}

function updateProxyStatus(running, errorMessage = null) {
  const statusEl = $("#intiface-proxy-status")
  if (running) {
    statusEl.show()
    statusEl.html('<i class="fa-solid fa-circle" style="color: #4CAF50; font-size: 0.6em; margin-right: 5px;"></i>Proxy running on port 12346')
  } else if (errorMessage) {
    statusEl.show()
    statusEl.html(`<i class="fa-solid fa-circle-exclamation" style="color: #f44336; font-size: 0.6em; margin-right: 5px;"></i>Error: ${errorMessage}`)
  } else {
    statusEl.hide()
  }
}

// ==========================================
// MEDIA FILE MANAGEMENT
// ==========================================

function getDurationMs(file) {
  const rawDuration = file.durationMs ?? file.duration ?? file.lengthMs ?? file.length ?? file.mediaDuration
  if (rawDuration === undefined || rawDuration === null) return null

  let duration = Number(rawDuration)
  if (!Number.isFinite(duration) || duration < 0) return null

  if (duration > 0 && duration < 1000) {
    duration = duration * 1000
  }

  return Math.round(duration)
}

function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return '--:--'

  const totalSeconds = Math.floor(durationMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    const remainingMinutes = minutes % 60
    return `${hours}:${String(remainingMinutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function formatMediaDate(timestampMs) {
  const timestamp = Number(timestampMs)
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'Unknown date'

  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function sortMediaFiles(files) {
  const sorted = [...files]
  const sortBy = mediaLibraryState.sortBy

  sorted.sort((a, b) => {
    if (sortBy === 'name-desc') {
      return String(b.name || '').localeCompare(String(a.name || ''))
    }

    if (sortBy === 'size-desc') {
      return (b.size || 0) - (a.size || 0)
    }

    if (sortBy === 'size-asc') {
      return (a.size || 0) - (b.size || 0)
    }

    if (sortBy === 'date-desc' || sortBy === 'date-asc') {
      const aModified = Number(a.lastModifiedMs)
      const bModified = Number(b.lastModifiedMs)
      const aKnown = Number.isFinite(aModified)
      const bKnown = Number.isFinite(bModified)
      if (!aKnown && !bKnown) return String(a.name || '').localeCompare(String(b.name || ''))
      if (!aKnown) return 1
      if (!bKnown) return -1
      return sortBy === 'date-desc' ? bModified - aModified : aModified - bModified
    }

    if (sortBy === 'duration-desc' || sortBy === 'duration-asc') {
      const aDuration = getDurationMs(a)
      const bDuration = getDurationMs(b)
      const aKnown = Number.isFinite(aDuration)
      const bKnown = Number.isFinite(bDuration)
      if (!aKnown && !bKnown) return String(a.name || '').localeCompare(String(b.name || ''))
      if (!aKnown) return 1
      if (!bKnown) return -1
      return sortBy === 'duration-desc' ? bDuration - aDuration : aDuration - bDuration
    }

    return String(a.name || '').localeCompare(String(b.name || ''))
  })

  return sorted
}

function canHaveDuration(file) {
  return file?.type === 'video' || file?.type === 'audio'
}

function probeDurationMsForFile(file) {
  const key = String(file?.path || file?.name || '')
  if (!key) {
    return Promise.resolve(null)
  }

  const existing = mediaLibraryState.durationProbePromises.get(key)
  if (existing) {
    return existing
  }

  const promise = new Promise((resolve) => {
    const isAudio = file?.type === 'audio'
    const mediaEl = document.createElement(isAudio ? 'audio' : 'video')
    const timeout = setTimeout(() => {
      cleanup()
      resolve(null)
    }, 8000)

    const cleanup = () => {
      clearTimeout(timeout)
      mediaEl.onloadedmetadata = null
      mediaEl.onerror = null
      mediaEl.removeAttribute('src')
      mediaEl.load()
      mediaLibraryState.durationProbePromises.delete(key)
    }

    mediaEl.preload = 'metadata'
    mediaEl.crossOrigin = 'anonymous'

    mediaEl.onloadedmetadata = () => {
      const seconds = Number(mediaEl.duration)
      cleanup()
      if (!Number.isFinite(seconds) || seconds <= 0) {
        resolve(null)
        return
      }
      resolve(Math.round(seconds * 1000))
    }

    mediaEl.onerror = () => {
      cleanup()
      resolve(null)
    }

    mediaEl.src = toAssetUrl(file.path)
  })

  mediaLibraryState.durationProbePromises.set(key, promise)
  return promise
}

async function ensureMediaDurationsLoaded() {
  const targets = mediaLibraryState.allFiles.filter((file) => canHaveDuration(file) && !Number.isFinite(getDurationMs(file)))
  if (targets.length === 0) {
    return
  }

  const queue = [...targets]
  const concurrency = Math.min(6, queue.length)
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const file = queue.shift()
      if (!file) continue
      const durationMs = await probeDurationMsForFile(file)
      if (Number.isFinite(durationMs) && durationMs > 0) {
        file.durationMs = durationMs
      }
    }
  })

  await Promise.all(workers)
}

function renderMenuMediaList() {
  const mediaListEl = $("#intiface-menu-media-list")
  const query = mediaLibraryState.searchQuery

  const filtered = mediaLibraryState.allFiles.filter(file => {
    if (mediaLibraryState.typeFilter !== 'all' && file.type !== mediaLibraryState.typeFilter) {
      return false
    }

    if (!query) return true
    const filename = String(file.name || '').toLowerCase()
    return filename.includes(query)
  })

  const mediaFiles = sortMediaFiles(filtered)

  if (mediaLibraryState.allFiles.length === 0) {
    mediaListEl.html('<div style="color: #888; text-align: center; padding: 20px;">No media files found<br><small>Place videos/audio in assets/intiface/media</small></div>')
    return
  }

  if (mediaFiles.length === 0) {
    mediaListEl.html('<div style="color: #888; text-align: center; padding: 20px;">No matching files<br><small>Try a different search</small></div>')
    return
  }

  let html = ''
  mediaFiles.forEach(file => {
    const sizeMB = ((file.size || 0) / 1024 / 1024).toFixed(1)
    const durationText = formatDuration(getDurationMs(file))
    const dateText = formatMediaDate(file.lastModifiedMs)
    const iconClass = file.type === 'audio' ? 'fa-music' : (file.type === 'video' ? 'fa-film' : 'fa-file-video')
    const iconColor = file.type === 'audio' ? '#9C27B0' : (file.type === 'video' ? '#64B5F6' : '#90A4AE')

    html += `
      <div class="menu-media-file-item" data-filename="${file.name}"
        style="padding: 8px; margin: 3px 0; background: rgba(255,255,255,0.05); border-radius: 3px; cursor: pointer; font-size: 0.85em; display: flex; align-items: center; justify-content: space-between; transition: background 0.2s;"
        onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'">
        <div style="display: flex; align-items: center; gap: 8px; overflow: hidden; min-width: 0;">
          <i class="fa-solid ${iconClass}" style="color: ${iconColor};"></i>
          <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${file.name}</span>
        </div>
        <span style="font-size: 0.75em; color: #888; white-space: nowrap; margin-left: 8px;">${sizeMB} MB | ${durationText} | ${dateText}</span>
      </div>
    `
  })

  mediaListEl.html(html)
}

function setFunscriptEditorStatus(message, isError = false) {
  const statusEl = $("#intiface-funscript-editor-status")
  statusEl.text(message)
  statusEl.css('color', isError ? '#F44336' : '#888')
}

function normalizeFunscriptObject(obj) {
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.actions)) {
    throw new Error('Funscript must contain an actions array')
  }

  const normalizedActions = obj.actions
    .filter(a => a && Number.isFinite(Number(a.at)) && Number.isFinite(Number(a.pos)))
    .map(a => ({
      ...a,
      at: Math.max(0, Math.round(Number(a.at))),
      pos: Math.max(0, Math.min(100, Math.round(Number(a.pos)))),
    }))
    .sort((a, b) => a.at - b.at)

  if (normalizedActions.length === 0) {
    throw new Error('No valid actions found')
  }

  return {
    ...obj,
    actions: normalizedActions,
  }
}

function syncFunscriptEditorUiState() {
  $("#intiface-funscript-editor-accept").prop('disabled', !funscriptEditorState.draftScript)
  $("#intiface-funscript-editor-discard").prop('disabled', !funscriptEditorState.draftScript)

  const toggleBtn = $("#intiface-funscript-editor-toggle-json")
  toggleBtn.html(funscriptEditorState.jsonVisible
    ? '<i class="fa-solid fa-code"></i> Hide JSON'
    : '<i class="fa-solid fa-code"></i> Show JSON')

  const activeScript = funscriptEditorState.currentScript || funscriptEditorState.originalScript
  if (activeScript) {
    $("#intiface-funscript-editor-json").val(JSON.stringify(activeScript, null, 2))
  }

  renderFunscriptWaveforms()
}

function drawFunscriptWave(canvasId, funscript, lineColor) {
  const canvas = document.getElementById(canvasId)
  if (!canvas) return

  const dpr = Math.max(1, Number(window.devicePixelRatio) || 1)
  const cssWidth = Math.max(1, Math.floor(canvas.clientWidth || canvas.width || 520))
  const cssHeight = Math.max(1, Math.floor(canvas.clientHeight || 120))
  const targetWidth = Math.max(1, Math.floor(cssWidth * dpr))
  const targetHeight = Math.max(1, Math.floor(cssHeight * dpr))
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth
    canvas.height = targetHeight
  }

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const width = canvas.width
  const height = canvas.height

  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = 'rgba(8, 12, 16, 0.95)'
  ctx.fillRect(0, 0, width, height)

  ctx.strokeStyle = 'rgba(255,255,255,0.12)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 0; i <= 4; i++) {
    const y = Math.round((i / 4) * (height - 1)) + 0.5
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
  }
  ctx.stroke()

  if (!funscript || !Array.isArray(funscript.actions) || funscript.actions.length === 0) {
    ctx.fillStyle = 'rgba(180,180,180,0.7)'
    ctx.font = `${Math.max(12, Math.round(12 * dpr))}px sans-serif`
    ctx.fillText('No waveform', Math.round(10 * dpr), Math.round(height / 2))
    return
  }

  const actions = funscript.actions
  const maxAt = Math.max(actions[actions.length - 1]?.at || 0, 1)

  ctx.strokeStyle = lineColor
  ctx.lineWidth = 2
  ctx.beginPath()

  actions.forEach((action, index) => {
    const x = Math.max(0, Math.min(width, (action.at / maxAt) * width))
    const y = Math.max(0, Math.min(height, height - (action.pos / 100) * height))
    if (index === 0) {
      ctx.moveTo(x, y)
    } else {
      ctx.lineTo(x, y)
    }
  })

  ctx.stroke()
}

function getWaveDisplayPoints(actions, width, maxAt, height) {
  if (!Array.isArray(actions) || actions.length === 0 || width <= 0 || maxAt <= 0) {
    return []
  }

  const buckets = new Array(width)
  actions.forEach((action) => {
    const at = Math.max(0, Number(action.at) || 0)
    const pos = Math.max(0, Math.min(100, Number(action.pos) || 0))
    const x = Math.max(0, Math.min(width - 1, Math.round((at / maxAt) * (width - 1))))
    const bucket = buckets[x]
    if (!bucket) {
      buckets[x] = { sum: pos, count: 1 }
    } else {
      bucket.sum += pos
      bucket.count += 1
    }
  })

  const points = []
  for (let x = 0; x < buckets.length; x++) {
    const bucket = buckets[x]
    if (!bucket || bucket.count <= 0) continue
    const avgPos = bucket.sum / bucket.count
    const y = Math.max(0, Math.min(height, height - (avgPos / 100) * height))
    points.push({ x, y })
  }

  return points
}

function drawFunscriptWaveOverlay(canvasId, baseFunscript, overlayFunscript) {
  const canvas = document.getElementById(canvasId)
  if (!canvas) return

  const dpr = Math.max(1, Number(window.devicePixelRatio) || 1)
  const cssWidth = Math.max(1, Math.floor(canvas.clientWidth || canvas.width || 520))
  const cssHeight = Math.max(1, Math.floor(canvas.clientHeight || 120))
  const targetWidth = Math.max(1, Math.floor(cssWidth * dpr))
  const targetHeight = Math.max(1, Math.floor(cssHeight * dpr))
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth
    canvas.height = targetHeight
  }

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const width = canvas.width
  const height = canvas.height

  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = 'rgba(8, 12, 16, 0.95)'
  ctx.fillRect(0, 0, width, height)

  ctx.strokeStyle = 'rgba(255,255,255,0.12)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 0; i <= 4; i++) {
    const y = Math.round((i / 4) * (height - 1)) + 0.5
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
  }
  ctx.stroke()

  const baseActions = Array.isArray(baseFunscript?.actions) ? baseFunscript.actions : []
  const overlayActions = Array.isArray(overlayFunscript?.actions) ? overlayFunscript.actions : []
  if (baseActions.length === 0 && overlayActions.length === 0) {
    ctx.fillStyle = 'rgba(180,180,180,0.7)'
    ctx.font = `${Math.max(12, Math.round(12 * dpr))}px sans-serif`
    ctx.fillText('No waveform', Math.round(10 * dpr), Math.round(height / 2))
    return
  }

  const maxAt = Math.max(
    baseActions[baseActions.length - 1]?.at || 0,
    overlayActions[overlayActions.length - 1]?.at || 0,
    1,
  )

  const drawLine = (actions, color, alpha, widthPx) => {
    if (!Array.isArray(actions) || actions.length === 0) return
    const points = getWaveDisplayPoints(actions, width, maxAt, height)
    if (points.length === 0) return

    ctx.globalAlpha = alpha
    ctx.strokeStyle = color
    ctx.lineWidth = widthPx * dpr
    ctx.beginPath()
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y)
      else ctx.lineTo(point.x, point.y)
    })
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  drawLine(baseActions, '#FF8A00', 0.62, 1.6)
  drawLine(overlayActions, '#00B7FF', 0.98, 2.1)
}

function renderFunscriptWaveforms() {
  drawFunscriptWaveOverlay(
    'intiface-funscript-wave-compare',
    funscriptEditorState.originalScript,
    funscriptEditorState.draftScript || funscriptEditorState.currentScript,
  )
}

function toggleFunscriptJsonVisibility() {
  funscriptEditorState.jsonVisible = !funscriptEditorState.jsonVisible
  $("#intiface-funscript-editor-json").toggle(funscriptEditorState.jsonVisible)
  syncFunscriptEditorUiState()
}

function syncCurrentScriptFromJsonEditor() {
  if (!funscriptEditorState.jsonVisible) return
  const raw = String($("#intiface-funscript-editor-json").val() || '').trim()
  if (!raw) return
  try {
    const parsed = normalizeFunscriptObject(JSON.parse(raw))
    funscriptEditorState.currentScript = parsed
    funscriptEditorState.draftScript = null
    renderFunscriptWaveforms()
  } catch (_e) {
    // Keep typing fluid; validation happens on action buttons.
  }
}

function acceptFunscriptDraft() {
  if (!funscriptEditorState.draftScript) return
  funscriptEditorState.currentScript = JSON.parse(JSON.stringify(funscriptEditorState.draftScript))
  funscriptEditorState.draftScript = null
  syncFunscriptEditorUiState()
  setFunscriptEditorStatus('Draft saved')
}

function discardFunscriptDraft() {
  if (!funscriptEditorState.draftScript) return
  funscriptEditorState.draftScript = null
  syncFunscriptEditorUiState()
  setFunscriptEditorStatus('Draft discarded')
}

function stripCodeFences(text) {
  const raw = String(text || '').trim()
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced?.[1] ? fenced[1].trim() : raw
}

function withTimeout(promise, timeoutMs, timeoutMessage) {
  let timeoutId
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
  })
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId))
}

function summarizeActions(actions) {
  if (!Array.isArray(actions) || actions.length === 0) {
    return { count: 0, durationMs: 0, minPos: 0, maxPos: 0, avgPos: 0 }
  }

  let minPos = 100
  let maxPos = 0
  let total = 0

  actions.forEach((a) => {
    const p = Math.max(0, Math.min(100, Number(a.pos) || 0))
    minPos = Math.min(minPos, p)
    maxPos = Math.max(maxPos, p)
    total += p
  })

  return {
    count: actions.length,
    durationMs: Math.max(0, Number(actions[actions.length - 1]?.at) || 0),
    minPos,
    maxPos,
    avgPos: Math.round(total / actions.length),
  }
}

function sampleActions(actions, sampleCount = 160) {
  if (!Array.isArray(actions) || actions.length <= sampleCount) return actions
  const out = []
  const maxIndex = actions.length - 1
  for (let i = 0; i < sampleCount; i++) {
    const idx = Math.round((i / (sampleCount - 1)) * maxIndex)
    out.push(actions[idx])
  }
  return out
}

function applyFunscriptPlan(actions, plan) {
  const scale = Number(plan?.intensityScale)
  const bias = Number(plan?.bias)
  const clampMin = Number(plan?.clampMin)
  const clampMax = Number(plan?.clampMax)
  const smoothingWindow = Math.max(0, Math.min(30, Math.round(Number(plan?.smoothingWindow) || 0)))
  const leadInMs = Math.max(0, Math.round(Number(plan?.leadInMs) || 0))
  const leadOutMs = Math.max(0, Math.round(Number(plan?.leadOutMs) || 0))

  const resolvedScale = Number.isFinite(scale) ? scale : 1
  const resolvedBias = Number.isFinite(bias) ? bias : 0
  const resolvedMin = Number.isFinite(clampMin) ? Math.max(0, Math.min(100, clampMin)) : 0
  const resolvedMax = Number.isFinite(clampMax) ? Math.max(resolvedMin, Math.min(100, clampMax)) : 100

  const duration = Math.max(1, Number(actions[actions.length - 1]?.at) || 1)

  let transformed = actions.map((a) => {
    const at = Math.max(0, Math.round(Number(a.at) || 0))
    let pos = (Number(a.pos) || 0) * resolvedScale + resolvedBias

    if (leadInMs > 0 && at < leadInMs) {
      pos *= (at / leadInMs)
    }
    if (leadOutMs > 0 && at > duration - leadOutMs) {
      pos *= Math.max(0, (duration - at) / leadOutMs)
    }

    pos = Math.max(resolvedMin, Math.min(resolvedMax, pos))

    return { ...a, at, pos: Math.round(pos) }
  })

  if (smoothingWindow > 1) {
    const half = Math.floor(smoothingWindow / 2)
    transformed = transformed.map((a, idx) => {
      let sum = 0
      let count = 0
      for (let i = Math.max(0, idx - half); i <= Math.min(transformed.length - 1, idx + half); i++) {
        sum += transformed[i].pos
        count++
      }
      return { ...a, pos: Math.round(sum / Math.max(1, count)) }
    })
  }

  return transformed
}

function movingAverageActions(actions, windowSize) {
  const safeWindow = Math.max(1, Math.min(101, Math.round(Number(windowSize) || 1)))
  if (safeWindow <= 1) return actions.map(a => ({ ...a }))

  const half = Math.floor(safeWindow / 2)
  return actions.map((action, index) => {
    let sum = 0
    let count = 0
    for (let i = Math.max(0, index - half); i <= Math.min(actions.length - 1, index + half); i++) {
      sum += Number(actions[i].pos) || 0
      count++
    }
    return { ...action, pos: Math.round(sum / Math.max(1, count)) }
  })
}

function applyLeadRampActions(actions, leadInMs, leadOutMs) {
  const duration = Math.max(1, Number(actions[actions.length - 1]?.at) || 1)
  const safeLeadIn = Math.max(0, Math.round(Number(leadInMs) || 0))
  const safeLeadOut = Math.max(0, Math.round(Number(leadOutMs) || 0))

  return actions.map((action) => {
    const at = Math.max(0, Math.round(Number(action.at) || 0))
    let pos = Number(action.pos) || 0

    if (safeLeadIn > 0 && at < safeLeadIn) {
      pos *= (at / safeLeadIn)
    }
    if (safeLeadOut > 0 && at > duration - safeLeadOut) {
      pos *= Math.max(0, (duration - at) / safeLeadOut)
    }

    return {
      ...action,
      at,
      pos: Math.max(0, Math.min(100, Math.round(pos))),
    }
  })
}

function decimateActionsByGap(actions, minGapMs) {
  const safeGap = Math.max(1, Math.round(Number(minGapMs) || 1))
  if (actions.length <= 2) return actions.map(a => ({ ...a }))

  const sorted = actions.map(a => ({ ...a })).sort((a, b) => a.at - b.at)
  const kept = [sorted[0]]

  for (let i = 1; i < sorted.length - 1; i++) {
    const current = sorted[i]
    const lastKept = kept[kept.length - 1]
    if ((Number(current.at) || 0) - (Number(lastKept.at) || 0) >= safeGap) {
      kept.push(current)
    }
  }

  const last = sorted[sorted.length - 1]
  const lastKept = kept[kept.length - 1]
  if ((Number(last.at) || 0) > (Number(lastKept.at) || 0)) {
    kept.push(last)
  } else {
    kept[kept.length - 1] = last
  }

  return kept
}

function normalizeActionRange(actions, targetMin = 0, targetMax = 100) {
  const safeMin = Math.max(0, Math.min(100, Math.round(Number(targetMin) || 0)))
  const safeMax = Math.max(safeMin, Math.min(100, Math.round(Number(targetMax) || 100)))

  let sourceMin = 100
  let sourceMax = 0

  actions.forEach((action) => {
    const pos = Math.max(0, Math.min(100, Number(action.pos) || 0))
    sourceMin = Math.min(sourceMin, pos)
    sourceMax = Math.max(sourceMax, pos)
  })

  if (sourceMax <= sourceMin) {
    const midpoint = Math.round((safeMin + safeMax) / 2)
    return actions.map(action => ({ ...action, pos: midpoint }))
  }

  const sourceRange = sourceMax - sourceMin
  const targetRange = safeMax - safeMin

  return actions.map((action) => {
    const pos = Math.max(0, Math.min(100, Number(action.pos) || 0))
    const normalized = safeMin + ((pos - sourceMin) / sourceRange) * targetRange
    return { ...action, pos: Math.max(safeMin, Math.min(safeMax, Math.round(normalized))) }
  })
}

function getCurrentEditableFunscript() {
  if (funscriptEditorState.currentScript?.actions?.length) {
    return JSON.parse(JSON.stringify(funscriptEditorState.currentScript))
  }

  const raw = String($("#intiface-funscript-editor-json").val() || '').trim()
  if (!raw) {
    throw new Error('Load a funscript first')
  }

  return normalizeFunscriptObject(JSON.parse(raw))
}

function buildProgrammaticEditResult(mode, actions, options = {}) {
  let updatedActions = actions.map(a => ({ ...a }))
  let actionLabel = 'Edit'

  if (mode === 'smooth') {
    const smoothingWindow = Math.max(1, Math.min(101, Math.round(Number(options.smoothingWindow ?? $("#intiface-funscript-editor-smooth-window").val()) || 5)))
    updatedActions = movingAverageActions(updatedActions, smoothingWindow)
    actionLabel = `Smoothed (window ${smoothingWindow})`
  } else if (mode === 'scale') {
    const scalePercent = Number(options.scalePercent ?? $("#intiface-funscript-editor-scale-percent").val())
    if (!Number.isFinite(scalePercent)) {
      throw new Error('Scale % must be a number')
    }
    const factor = scalePercent / 100
    updatedActions = updatedActions.map(a => ({
      ...a,
      pos: Math.max(0, Math.min(100, Math.round((Number(a.pos) || 0) * factor))),
    }))
    actionLabel = `Scaled to ${Math.round(scalePercent)}%`
  } else if (mode === 'bias') {
    const bias = Number(options.bias ?? 0)
    if (!Number.isFinite(bias)) {
      throw new Error('Bias must be a number')
    }
    updatedActions = updatedActions.map(a => ({
      ...a,
      pos: Math.max(0, Math.min(100, Math.round((Number(a.pos) || 0) + bias))),
    }))
    actionLabel = `Bias ${Math.round(bias) >= 0 ? '+' : ''}${Math.round(bias)}`
  } else if (mode === 'clamp') {
    const minPos = Number(options.minPos ?? $("#intiface-funscript-editor-clamp-min").val())
    const maxPos = Number(options.maxPos ?? $("#intiface-funscript-editor-clamp-max").val())
    if (!Number.isFinite(minPos) || !Number.isFinite(maxPos)) {
      throw new Error('Clamp min/max must be numbers')
    }
    const resolvedMin = Math.max(0, Math.min(100, Math.round(minPos)))
    const resolvedMax = Math.max(resolvedMin, Math.min(100, Math.round(maxPos)))
    updatedActions = updatedActions.map(a => ({
      ...a,
      pos: Math.max(resolvedMin, Math.min(resolvedMax, Math.round(Number(a.pos) || 0))),
    }))
    actionLabel = `Clamped to ${resolvedMin}-${resolvedMax}`
  } else if (mode === 'shift') {
    const shiftMs = Math.round(Number(options.shiftMs ?? $("#intiface-funscript-editor-shift-ms").val()) || 0)
    updatedActions = updatedActions.map(a => ({
      ...a,
      at: Math.max(0, Math.round((Number(a.at) || 0) + shiftMs)),
    }))
    actionLabel = `Shifted by ${shiftMs}ms`
  } else if (mode === 'ramp') {
    const leadInMs = Math.max(0, Math.round(Number(options.leadInMs ?? $("#intiface-funscript-editor-ramp-in-ms").val()) || 0))
    const leadOutMs = Math.max(0, Math.round(Number(options.leadOutMs ?? $("#intiface-funscript-editor-ramp-out-ms").val()) || 0))
    if (leadInMs <= 0 && leadOutMs <= 0) {
      throw new Error('Set ramp-in or ramp-out above 0ms')
    }
    updatedActions = applyLeadRampActions(updatedActions, leadInMs, leadOutMs)
    actionLabel = `Applied ramps (in ${leadInMs}ms, out ${leadOutMs}ms)`
  } else if (mode === 'decimate') {
    const minGapMs = Math.max(1, Math.round(Number(options.minGapMs ?? $("#intiface-funscript-editor-decimate-gap-ms").val()) || 40))
    const beforeCount = updatedActions.length
    updatedActions = decimateActionsByGap(updatedActions, minGapMs)
    actionLabel = `Decimated ${beforeCount} -> ${updatedActions.length} (gap ${minGapMs}ms)`
  } else if (mode === 'normalize') {
    const targetMinRaw = Number(options.targetMin ?? 0)
    const targetMaxRaw = Number(options.targetMax ?? 100)
    const targetMin = Number.isFinite(targetMinRaw) ? targetMinRaw : 0
    const targetMax = Number.isFinite(targetMaxRaw) ? targetMaxRaw : 100
    updatedActions = normalizeActionRange(updatedActions, targetMin, targetMax)
    actionLabel = `Normalized to ${Math.round(targetMin)}-${Math.round(targetMax)}`
  } else {
    throw new Error('Unknown edit mode')
  }

  return { updatedActions, actionLabel }
}

function applyProgrammaticEditSequenceToDraft(steps, sequenceLabel = 'Edit sequence') {
  try {
    const baseScript = getCurrentEditableFunscript()
    const actions = Array.isArray(baseScript.actions) ? baseScript.actions : []
    if (actions.length === 0) {
      setFunscriptEditorStatus('No actions to edit', true)
      return
    }

    let updatedActions = actions.map(a => ({ ...a }))
    const labels = []

    for (const step of steps) {
      const result = buildProgrammaticEditResult(step.mode, updatedActions, step.options || {})
      updatedActions = result.updatedActions
      labels.push(result.actionLabel)
    }

    const updated = normalizeFunscriptObject({
      ...baseScript,
      actions: updatedActions,
    })

    funscriptEditorState.draftScript = updated
    syncFunscriptEditorUiState()
    const detail = labels.length > 0 ? `: ${labels.join(' -> ')}` : ''
    setFunscriptEditorStatus(`${sequenceLabel}${detail}. Draft ready (${updated.actions.length} actions). Review and Save.`)
  } catch (error) {
    setFunscriptEditorStatus(`Edit failed: ${error?.message || 'invalid funscript'}`, true)
  }
}

function applyProgrammaticFunscriptEdit(mode) {
  applyProgrammaticEditSequenceToDraft([{ mode }], 'Edit')
}

function applySelectedProgrammaticEditsFromUi() {
  const steps = []

  if ($("#intiface-funscript-editor-use-shift").is(':checked')) {
    steps.push({
      mode: 'shift',
      options: {
        shiftMs: Number($("#intiface-funscript-editor-shift-ms").val()),
      },
    })
  }

  if ($("#intiface-funscript-editor-use-decimate").is(':checked')) {
    steps.push({
      mode: 'decimate',
      options: {
        minGapMs: Number($("#intiface-funscript-editor-decimate-gap-ms").val()),
      },
    })
  }

  if ($("#intiface-funscript-editor-use-smooth").is(':checked')) {
    steps.push({
      mode: 'smooth',
      options: {
        smoothingWindow: Number($("#intiface-funscript-editor-smooth-window").val()),
      },
    })
  }

  if ($("#intiface-funscript-editor-use-normalize").is(':checked')) {
    steps.push({ mode: 'normalize' })
  }

  if ($("#intiface-funscript-editor-use-scale").is(':checked')) {
    steps.push({
      mode: 'scale',
      options: {
        scalePercent: Number($("#intiface-funscript-editor-scale-percent").val()),
      },
    })
  }

  if ($("#intiface-funscript-editor-use-clamp").is(':checked')) {
    steps.push({
      mode: 'clamp',
      options: {
        minPos: Number($("#intiface-funscript-editor-clamp-min").val()),
        maxPos: Number($("#intiface-funscript-editor-clamp-max").val()),
      },
    })
  }

  if ($("#intiface-funscript-editor-use-ramp").is(':checked')) {
    const leadInMs = Number($("#intiface-funscript-editor-ramp-in-ms").val())
    const leadOutMs = Number($("#intiface-funscript-editor-ramp-out-ms").val())
    if ((Number.isFinite(leadInMs) && leadInMs > 0) || (Number.isFinite(leadOutMs) && leadOutMs > 0)) {
      steps.push({
        mode: 'ramp',
        options: {
          leadInMs,
          leadOutMs,
        },
      })
    }
  }

  if (steps.length === 0) {
    setFunscriptEditorStatus('Select at least one edit checkbox (and ramp in/out > 0 if ramp is enabled)', true)
    return
  }

  applyProgrammaticEditSequenceToDraft(steps, 'Selected edits')
}

function inferOptimizationProfileFromConnectedDevices() {
  const devices = getConnectedDevicesLive()
  if (!Array.isArray(devices) || devices.length === 0) {
    return 'general'
  }

  let hasLinear = false
  let hasOscillate = false
  let hasVibrate = false
  let hasCage = false
  let hasPlug = false
  const getDeviceType = d("getDeviceType")

  for (const device of devices) {
    if (device?.messageAttributes?.LinearCmd !== undefined) hasLinear = true
    if (device?.messageAttributes?.OscillateCmd !== undefined) hasOscillate = true
    if (Array.isArray(device?.vibrateAttributes) && device.vibrateAttributes.length > 0) hasVibrate = true
    if (typeof getDeviceType === 'function') {
      const inferred = getDeviceType(device)
      if (inferred === 'cage') hasCage = true
      if (inferred === 'plug') hasPlug = true
      if (inferred === 'stroker') hasLinear = true
    }
  }

  if (hasCage) return 'cage'
  if (hasPlug) return 'plug'
  if (hasOscillate) return 'oscillate'
  if (hasLinear) return 'linear'
  if (hasVibrate) return 'vibrate'

  return 'general'
}

function getOptimizationIntensityFactor() {
  const sliderValue = Number($("#intiface-funscript-editor-optimize-intensity").val())
  if (!Number.isFinite(sliderValue)) return 1
  return Math.max(0.5, Math.min(1.8, sliderValue / 100))
}

function updateOptimizationIntensityDisplay() {
  const sliderValue = Math.max(50, Math.min(180, Math.round(Number($("#intiface-funscript-editor-optimize-intensity").val()) || 100)))
  let tone = 'Balanced'
  if (sliderValue < 90) tone = 'Softer'
  else if (sliderValue > 130) tone = 'Intense'
  else if (sliderValue > 110) tone = 'Punchy'
  $("#intiface-funscript-editor-optimize-intensity-display").text(`${sliderValue}% (${tone})`)
}

function scalePresetStepOptions(mode, options, factor) {
  const next = { ...(options || {}) }
  const safeFactor = Math.max(0.5, Math.min(1.8, Number(factor) || 1))

  if (mode === 'decimate') {
    const baseGap = Number(next.minGapMs)
    if (Number.isFinite(baseGap)) next.minGapMs = Math.max(8, Math.round(baseGap / safeFactor))
  }

  if (mode === 'smooth') {
    const baseWindow = Number(next.smoothingWindow)
    if (Number.isFinite(baseWindow)) {
      const adjusted = Math.round(baseWindow / (0.65 + (safeFactor * 0.35)))
      next.smoothingWindow = Math.max(1, Math.min(101, adjusted))
    }
  }

  if (mode === 'scale') {
    const baseScale = Number(next.scalePercent)
    if (Number.isFinite(baseScale)) next.scalePercent = Math.max(10, Math.min(200, Math.round(baseScale * safeFactor)))
  }

  if (mode === 'bias') {
    const baseBias = Number(next.bias)
    if (Number.isFinite(baseBias)) next.bias = Math.round(baseBias * safeFactor)
  }

  if (mode === 'clamp') {
    const minPos = Number(next.minPos)
    const maxPos = Number(next.maxPos)
    if (Number.isFinite(minPos) || Number.isFinite(maxPos)) {
      const baseMin = Number.isFinite(minPos) ? minPos : 0
      const baseMax = Number.isFinite(maxPos) ? maxPos : 100
      const tension = 2 - safeFactor
      const adjustedMin = Math.max(0, Math.min(100, Math.round(baseMin * tension)))
      const adjustedMax = Math.max(adjustedMin, Math.min(100, Math.round(100 - ((100 - baseMax) * tension))))
      next.minPos = adjustedMin
      next.maxPos = adjustedMax
    }
  }

  if (mode === 'ramp') {
    const inMs = Number(next.leadInMs)
    const outMs = Number(next.leadOutMs)
    if (Number.isFinite(inMs)) next.leadInMs = Math.max(0, Math.round(inMs / safeFactor))
    if (Number.isFinite(outMs)) next.leadOutMs = Math.max(0, Math.round(outMs / safeFactor))
  }

  return next
}

function applyOptimizationIntensityToPreset(preset, factor) {
  return {
    ...preset,
    steps: (preset.steps || []).map((step) => ({
      ...step,
      options: scalePresetStepOptions(step.mode, step.options || {}, factor),
    })),
  }
}

function getDeviceOptimizationPreset(profile) {
  if (profile === 'linear') {
    return {
      label: 'Linear/Stroker tuning',
      steps: [
        { mode: 'decimate', options: { minGapMs: 18 } },
        { mode: 'smooth', options: { smoothingWindow: 3 } },
        { mode: 'normalize' },
        { mode: 'ramp', options: { leadInMs: 120, leadOutMs: 140 } },
      ],
    }
  }

  if (profile === 'vibrate') {
    return {
      label: 'Vibrator tuning',
      steps: [
        { mode: 'smooth', options: { smoothingWindow: 13 } },
        { mode: 'decimate', options: { minGapMs: 85 } },
        { mode: 'normalize', options: { targetMin: 15, targetMax: 85 } },
        { mode: 'scale', options: { scalePercent: 70 } },
        { mode: 'ramp', options: { leadInMs: 280, leadOutMs: 320 } },
      ],
    }
  }

  if (profile === 'oscillate') {
    return {
      label: 'Oscillator tuning',
      steps: [
        { mode: 'smooth', options: { smoothingWindow: 9 } },
        { mode: 'decimate', options: { minGapMs: 40 } },
        { mode: 'normalize', options: { targetMin: 10, targetMax: 90 } },
        { mode: 'ramp', options: { leadInMs: 220, leadOutMs: 220 } },
      ],
    }
  }

  if (profile === 'plug') {
    return {
      label: 'Plug tuning',
      steps: [
        { mode: 'decimate', options: { minGapMs: 22 } },
        { mode: 'smooth', options: { smoothingWindow: 2 } },
        { mode: 'normalize' },
        { mode: 'clamp', options: { minPos: 18, maxPos: 100 } },
        { mode: 'scale', options: { scalePercent: 100 } },
        { mode: 'ramp', options: { leadInMs: 140, leadOutMs: 200 } },
      ],
    }
  }

  if (profile === 'cage') {
    return {
      label: 'Cage tuning',
      steps: [
        { mode: 'decimate', options: { minGapMs: 110 } },
        { mode: 'smooth', options: { smoothingWindow: 15 } },
        { mode: 'normalize', options: { targetMin: 5, targetMax: 45 } },
        { mode: 'scale', options: { scalePercent: 60 } },
        { mode: 'ramp', options: { leadInMs: 700, leadOutMs: 950 } },
      ],
    }
  }

  return {
    label: 'General tuning',
    steps: [
      { mode: 'decimate', options: { minGapMs: 45 } },
      { mode: 'smooth', options: { smoothingWindow: 7 } },
      { mode: 'normalize', options: { targetMin: 5, targetMax: 95 } },
      { mode: 'ramp', options: { leadInMs: 260, leadOutMs: 260 } },
    ],
  }
}

function applyDeviceOptimizationProfile() {
  const selected = String($("#intiface-funscript-editor-device-profile").val() || 'auto')
  const resolvedProfile = selected === 'auto' ? inferOptimizationProfileFromConnectedDevices() : selected
  const preset = getDeviceOptimizationPreset(resolvedProfile)
  const intensityFactor = getOptimizationIntensityFactor()
  const adjustedPreset = applyOptimizationIntensityToPreset(preset, intensityFactor)
  const sliderValue = Math.round(intensityFactor * 100)
  applyProgrammaticEditSequenceToDraft(adjustedPreset.steps, `${adjustedPreset.label} @ ${sliderValue}%`)
}

function parseAiPlanSteps(plan) {
  const parseMode = (mode) => String(mode || '').trim().toLowerCase()
  const finiteOr = (value, fallback) => {
    const num = Number(value)
    return Number.isFinite(num) ? num : fallback
  }
  const out = []

  if (Array.isArray(plan?.steps)) {
    for (const step of plan.steps) {
      const mode = parseMode(step?.mode)
      if (!mode) continue

      if (mode === 'smooth') {
        out.push({ mode: 'smooth', options: { smoothingWindow: finiteOr(step.smoothingWindow ?? step.window ?? step.windowSize, 5) } })
      } else if (mode === 'decimate') {
        out.push({ mode: 'decimate', options: { minGapMs: finiteOr(step.minGapMs ?? step.gapMs ?? step.gap, 40) } })
      } else if (mode === 'normalize') {
        out.push({ mode: 'normalize', options: { targetMin: finiteOr(step.targetMin, 0), targetMax: finiteOr(step.targetMax, 100) } })
      } else if (mode === 'scale') {
        let scalePercent = Number(step.scalePercent)
        if (!Number.isFinite(scalePercent)) {
          const factor = Number(step.factor)
          scalePercent = Number.isFinite(factor) ? factor * 100 : 100
        }
        out.push({ mode: 'scale', options: { scalePercent } })
      } else if (mode === 'bias') {
        out.push({ mode: 'bias', options: { bias: finiteOr(step.bias ?? step.offset, 0) } })
      } else if (mode === 'clamp') {
        out.push({ mode: 'clamp', options: { minPos: finiteOr(step.minPos ?? step.clampMin, 0), maxPos: finiteOr(step.maxPos ?? step.clampMax, 100) } })
      } else if (mode === 'shift') {
        out.push({ mode: 'shift', options: { shiftMs: finiteOr(step.shiftMs ?? step.timeShiftMs ?? step.atShiftMs, 0) } })
      } else if (mode === 'ramp') {
        out.push({ mode: 'ramp', options: { leadInMs: finiteOr(step.leadInMs ?? step.rampInMs, 0), leadOutMs: finiteOr(step.leadOutMs ?? step.rampOutMs, 0) } })
      }
    }
  }

  if (out.length > 0) {
    return out
  }

  // Backward-compatible fallback for older AI planner schema.
  const legacy = []
  const minGapMs = Number(plan?.minGapMs)
  const smoothingWindow = Number(plan?.smoothingWindow)
  const intensityScale = Number(plan?.intensityScale)
  const bias = Number(plan?.bias)
  const clampMin = Number(plan?.clampMin)
  const clampMax = Number(plan?.clampMax)
  const leadInMs = Number(plan?.leadInMs)
  const leadOutMs = Number(plan?.leadOutMs)

  if (Number.isFinite(minGapMs) && minGapMs > 0) legacy.push({ mode: 'decimate', options: { minGapMs } })
  if (Number.isFinite(smoothingWindow) && smoothingWindow > 1) legacy.push({ mode: 'smooth', options: { smoothingWindow } })
  if (Number.isFinite(intensityScale) && intensityScale > 0 && intensityScale !== 1) legacy.push({ mode: 'scale', options: { scalePercent: intensityScale * 100 } })
  if (Number.isFinite(bias) && bias !== 0) legacy.push({ mode: 'bias', options: { bias } })
  if (Number.isFinite(clampMin) || Number.isFinite(clampMax)) {
    legacy.push({ mode: 'clamp', options: { minPos: Number.isFinite(clampMin) ? clampMin : 0, maxPos: Number.isFinite(clampMax) ? clampMax : 100 } })
  }
  if ((Number.isFinite(leadInMs) && leadInMs > 0) || (Number.isFinite(leadOutMs) && leadOutMs > 0)) {
    legacy.push({ mode: 'ramp', options: { leadInMs, leadOutMs } })
  }

  return legacy
}

async function aiEditFunscriptFromInstructions() {
  const instruction = String($("#intiface-funscript-editor-ai-instructions").val() || '').trim()
  const raw = String($("#intiface-funscript-editor-json").val() || '').trim()
  const aiButton = $("#intiface-funscript-editor-ai-edit")

  if (!instruction) {
    setFunscriptEditorStatus('Enter AI edit instructions first', true)
    return
  }

  if (!raw) {
    setFunscriptEditorStatus('Load a funscript first', true)
    return
  }

  let parsed
  try {
    parsed = normalizeFunscriptObject(JSON.parse(raw))
  } catch (_e) {
    setFunscriptEditorStatus('Current funscript JSON is invalid', true)
    return
  }

  const generator = d("aiGenerateRaw")
  if (typeof generator !== 'function') {
    setFunscriptEditorStatus('AI generator unavailable', true)
    return
  }

  const originalHtml = aiButton.html()
  aiButton.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> AI...')
  setFunscriptEditorStatus('AI editing funscript...')

  try {
    const currentScript = funscriptEditorState.currentScript || parsed
    const actions = Array.isArray(currentScript?.actions) ? currentScript.actions : []
    const summary = summarizeActions(actions)
    const sample = sampleActions(actions, actions.length <= 900 ? 260 : 180)

    const planSystem = [
      'You are a funscript editing planner that can only use programmatic operations.',
      'Do NOT return full funscript JSON.',
      'Return ONLY JSON with a steps array.',
      'Each step must be one of: smooth, scale, bias, clamp, shift, ramp, decimate, normalize.',
      'Allowed fields by step:',
      'smooth: smoothingWindow',
      'scale: scalePercent (or factor)',
      'bias: bias',
      'clamp: minPos, maxPos',
      'shift: shiftMs',
      'ramp: leadInMs, leadOutMs',
      'decimate: minGapMs',
      'normalize: targetMin, targetMax',
      'Prefer 2-5 steps unless user asks for minimal edits.',
      'No prose. No markdown.',
    ].join(' ')

    const planPrompt = [
      `Instruction: ${instruction}`,
      `Summary: ${JSON.stringify(summary)}`,
      `Sample actions: ${JSON.stringify(sample)}`,
      'Return only planner JSON. Example: {"steps":[{"mode":"decimate","minGapMs":40},{"mode":"smooth","smoothingWindow":7},{"mode":"normalize","targetMin":0,"targetMax":100}] }',
    ].join('\n\n')

    const planRaw = await withTimeout(
      generator({ prompt: planPrompt, systemPrompt: planSystem, responseLength: 32768 }),
      90000,
      'AI plan request timed out. Try shorter instructions.',
    )

    const plan = JSON.parse(stripCodeFences(planRaw))
    const steps = parseAiPlanSteps(plan)

    if (!Array.isArray(steps) || steps.length === 0) {
      throw new Error('AI plan returned no supported steps')
    }

    const updated = normalizeFunscriptObject({
      ...currentScript,
      actions: (() => {
        let next = actions.map(a => ({ ...a }))
        for (const step of steps) {
          next = buildProgrammaticEditResult(step.mode, next, step.options || {}).updatedActions
        }
        return next
      })(),
    })

    funscriptEditorState.draftScript = updated
    syncFunscriptEditorUiState()
    setFunscriptEditorStatus(`AI plan applied (${steps.length} step${steps.length === 1 ? '' : 's'}). Draft ready (${updated.actions.length} actions). Review and Save.`)
  } catch (e) {
    console.error(`${d("NAME") || "Intiface"}: AI funscript edit failed:`, e)
    setFunscriptEditorStatus(`AI edit failed: ${e?.message || 'invalid response'}`, true)
  } finally {
    aiButton.prop('disabled', false).html(originalHtml)
  }
}

function getFileExtension(filePath) {
  const normalized = decodeURIComponent(String(filePath || ''))
    .replace(/[#?].*$/, '')
    .toLowerCase()
  const dotIndex = normalized.lastIndexOf('.')
  if (dotIndex < 0) return ''
  return normalized.slice(dotIndex)
}

function getMediaTypeFromPath(filePath) {
  const ext = getFileExtension(filePath)
  const videoExtensions = new Set(['.mp4', '.webm', '.ogv', '.mkv', '.avi', '.mov'])
  const audioExtensions = new Set(['.mp3', '.wav', '.ogg', '.flac', '.m4a'])

  if (videoExtensions.has(ext)) return 'video'
  if (audioExtensions.has(ext)) return 'audio'
  return 'unknown'
}

function getFileNameFromPath(filePath) {
  const normalized = decodeURIComponent(String(filePath || '').replace(/\\/g, '/'))
  return normalized.split('/').pop() || ''
}

function normalizeAssetPathForMatch(filePath) {
  return String(filePath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .trim()
    .toLowerCase()
}

function toAssetUrl(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/').replace(/^\/+/, '')
  return `/${normalized}`
}

async function listAssetFilesFromDirectoryListing(directoryUrl, extensionFilter = null) {
  try {
    const response = await fetch(directoryUrl, {
      method: 'GET',
      headers: d("getRequestHeaders")({ omitContentType: true })
    })
    if (!response.ok) return []

    const html = await response.text()
    const hrefMatches = [...html.matchAll(/href=["']([^"']+)["']/gi)].map(m => m[1])
    const files = []

    hrefMatches.forEach((href) => {
      if (!href || href === '../' || href.endsWith('/')) return
      const cleaned = href.split('?')[0].split('#')[0]
      const filename = cleaned.split('/').pop()
      if (!filename || filename.startsWith('.')) return
      if (extensionFilter && !extensionFilter(filename.toLowerCase())) return
      files.push(filename)
    })

    return [...new Set(files)]
  } catch (_e) {
    return []
  }
}

async function getIntifaceAssetList(type) {
  try {
    const response = await fetch(`/api/plugins/intiface-assets/list?type=${encodeURIComponent(type)}`, {
      method: 'GET',
      headers: d("getRequestHeaders")({ omitContentType: true })
    })

    if (!response.ok) {
      return []
    }

    const data = await response.json()
    return Array.isArray(data?.files) ? data.files : []
  } catch (_e) {
    return []
  }
}

async function getAssetMetadata(assetPath) {
  try {
    const response = await fetch(toAssetUrl(assetPath), {
      method: 'HEAD',
      headers: d("getRequestHeaders")({ omitContentType: true })
    })
    if (!response.ok) return { size: null, lastModifiedMs: null }

    const sizeHeader = response.headers.get('content-length')
    const sizeParsed = Number(sizeHeader)
    const size = Number.isFinite(sizeParsed) ? sizeParsed : null

    const modifiedHeader = response.headers.get('last-modified')
    const modifiedParsed = modifiedHeader ? Date.parse(modifiedHeader) : NaN
    const lastModifiedMs = Number.isFinite(modifiedParsed) ? modifiedParsed : null

    return { size, lastModifiedMs }
  } catch (_e) {
    return { size: null, lastModifiedMs: null }
  }
}

async function refreshFunscriptEditorList() {
  const selectEl = $("#intiface-funscript-editor-file")
  selectEl.html('<option value="">Loading...</option>')
  setFunscriptEditorStatus('Loading funscript list...')

  try {
    let files = (await getIntifaceAssetList('funscript'))
      .filter(filePath => normalizeAssetPathForMatch(filePath).startsWith('assets/intiface/funscript/'))
      .filter(filePath => String(filePath || '').toLowerCase().endsWith('.funscript'))
      .map(filePath => ({
        name: getFileNameFromPath(filePath),
        path: filePath,
      }))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))

    if (files.length === 0) {
      const listed = await listAssetFilesFromDirectoryListing('/assets/intiface/funscript/', (name) => name.endsWith('.funscript'))
      files = listed.map((name) => ({
        name,
        path: `assets/intiface/funscript/${name}`,
      }))
    }

    if (files.length === 0) {
      selectEl.html('<option value="">No funscripts found</option>')
      funscriptEditorState.selectedFile = ''
      funscriptEditorState.fileMap = new Map()
      setFunscriptEditorStatus('No funscript files found')
      return
    }

    funscriptEditorState.fileMap = new Map(files.map(file => [file.name, file.path]))

    const options = ['<option value="">Select a funscript...</option>']
    files.forEach(file => {
      options.push(`<option value="${file.name}">${file.name}</option>`)
    })
    selectEl.html(options.join(''))

    if (funscriptEditorState.selectedFile && files.some(f => f.name === funscriptEditorState.selectedFile)) {
      selectEl.val(funscriptEditorState.selectedFile)
    }

    setFunscriptEditorStatus(`Loaded ${files.length} funscript file(s)`)
  } catch (error) {
    console.error(`${d("NAME") || "Intiface"}: Failed to refresh funscript editor list:`, error)
    selectEl.html('<option value="">Error loading list</option>')
    setFunscriptEditorStatus('Failed to load funscript list', true)
  }
}

async function loadSelectedFunscriptForEdit() {
  const fileName = String($("#intiface-funscript-editor-file").val() || '')
  if (!fileName) {
    setFunscriptEditorStatus('Select a funscript first', true)
    return
  }

  funscriptEditorState.selectedFile = fileName
  setFunscriptEditorStatus(`Loading ${fileName}...`)

  try {
    const assetPath = funscriptEditorState.fileMap.get(fileName)
    if (!assetPath) throw new Error('Selected file path not found')

    const response = await fetch(toAssetUrl(assetPath), {
      method: 'GET',
      headers: d("getRequestHeaders")({ omitContentType: true })
    })

    if (!response.ok) throw new Error('Failed to load funscript')

    const data = await response.json()
    const normalized = normalizeFunscriptObject(data)
    funscriptEditorState.originalScript = JSON.parse(JSON.stringify(normalized))
    funscriptEditorState.currentScript = JSON.parse(JSON.stringify(normalized))
    funscriptEditorState.draftScript = null
    syncFunscriptEditorUiState()
    setFunscriptEditorStatus(`Loaded ${fileName}`)
  } catch (error) {
    console.error(`${d("NAME") || "Intiface"}: Failed to load funscript for edit:`, error)
    setFunscriptEditorStatus(`Failed to load ${fileName}`, true)
  }
}

function formatEditedFunscript() {
  const raw = String($("#intiface-funscript-editor-json").val() || '')
  if (!raw.trim()) {
    setFunscriptEditorStatus('Nothing to format', true)
    return
  }

  try {
    const parsed = normalizeFunscriptObject(JSON.parse(raw))
    funscriptEditorState.currentScript = parsed
    funscriptEditorState.draftScript = null
    syncFunscriptEditorUiState()
    setFunscriptEditorStatus('Formatted JSON')
  } catch (_error) {
    setFunscriptEditorStatus('Invalid JSON - cannot format', true)
  }
}

async function saveEditedFunscript() {
  const fileName = String($("#intiface-funscript-editor-file").val() || '')
  if (!fileName) {
    setFunscriptEditorStatus('Select a funscript file to save', true)
    return
  }

  const raw = String($("#intiface-funscript-editor-json").val() || '')
  if (!raw.trim() && !funscriptEditorState.currentScript) {
    setFunscriptEditorStatus('Editor is empty', true)
    return
  }

  let parsed
  try {
    parsed = funscriptEditorState.currentScript
      ? normalizeFunscriptObject(funscriptEditorState.currentScript)
      : normalizeFunscriptObject(JSON.parse(raw))
  } catch (_error) {
    setFunscriptEditorStatus('Invalid JSON - fix before saving', true)
    return
  }

  setFunscriptEditorStatus(`Saving ${fileName}...`)

  try {
    const prettyJson = JSON.stringify(parsed, null, 2)

    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [{
          description: 'Funscript JSON',
          accept: { 'application/json': ['.funscript', '.json'] }
        }]
      })
      const writable = await handle.createWritable()
      await writable.write(prettyJson)
      await writable.close()
    } else {
      const blob = new Blob([prettyJson], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }

    funscriptEditorState.currentScript = parsed
    syncFunscriptEditorUiState()
    setFunscriptEditorStatus(`Saved ${fileName} locally`)
    d("updateStatus")?.(`Saved funscript locally: ${fileName}`)
  } catch (error) {
    console.error(`${d("NAME") || "Intiface"}: Failed to save funscript:`, error)
    setFunscriptEditorStatus(`Save failed: ${error.message}`, true)
  }
}

async function refreshMenuMediaList() {
  const mediaListEl = $("#intiface-menu-media-list")
  mediaListEl.html('<div style="color: #888; text-align: center; padding: 20px;"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</div>')
  const durationLoadId = ++mediaLibraryState.durationLoadId

  try {
    let mediaPaths = (await getIntifaceAssetList('media'))
      .filter(filePath => normalizeAssetPathForMatch(filePath).startsWith('assets/intiface/media/'))

    if (mediaPaths.length === 0) {
      const listed = await listAssetFilesFromDirectoryListing('/assets/intiface/media/', (name) => {
        return ['.mp4', '.webm', '.ogv', '.mkv', '.avi', '.mov', '.mp3', '.wav', '.ogg', '.flac', '.m4a'].some(ext => name.endsWith(ext))
      })
      mediaPaths = listed.map((name) => `assets/intiface/media/${name}`)
    }

    const candidates = mediaPaths
      .map(filePath => ({
        path: filePath,
        name: getFileNameFromPath(filePath),
        type: getMediaTypeFromPath(filePath),
      }))

    if (candidates.length === 0) {
      d("updateStatus")?.('Media scan returned 0 candidates')
    }

    const sizePromises = candidates.map(async (file) => {
      const metadata = await getAssetMetadata(file.path)
      return {
        ...file,
        size: metadata.size,
        lastModifiedMs: metadata.lastModifiedMs,
        durationMs: null,
      }
    })

    mediaLibraryState.allFiles = await Promise.all(sizePromises)

    if (mediaLibraryState.sortBy === 'duration-desc' || mediaLibraryState.sortBy === 'duration-asc') {
      await ensureMediaDurationsLoaded()
    }

    renderMenuMediaList()

    if (mediaLibraryState.sortBy !== 'duration-desc' && mediaLibraryState.sortBy !== 'duration-asc') {
      ensureMediaDurationsLoaded().then(() => {
        if (mediaLibraryState.durationLoadId === durationLoadId) {
          renderMenuMediaList()
        }
      }).catch(() => {})
    }

  } catch (error) {
    console.error(`${d("NAME") || "Intiface"}: Failed to refresh menu media:`, error)
    mediaListEl.html(`<div style="color: #F44336; text-align: center; padding: 20px;">Error loading media</div>`)
  }
}

// ==========================================
// FUNSCRIPT LOADING
// ==========================================

async function loadFunscript(videoPath) {
  try {
    const videoFilename = videoPath.split(/[\\/]/).pop()
    const baseName = videoFilename.replace(/\.[^.]+$/, '')
    const funscriptFilename = `${baseName}.funscript`
    const funscriptUrl = `/assets/intiface/funscript/${encodeURIComponent(funscriptFilename)}`

    console.log(`${d("NAME") || "Intiface"}: Loading Funscript from:`, funscriptUrl)

    // Check cache
    if (funscriptCache.has(funscriptUrl)) {
      mediaPlayer.currentFunscript = funscriptCache.get(funscriptUrl)
      updateChatFunscriptUI(mediaPlayer.currentFunscript)
      return
    }

    const response = await fetch(funscriptUrl, {
      method: 'GET',
      headers: d("getRequestHeaders")()
    })

    if (!response.ok) {
      if (response.status === 404) {
        console.log(`${d("NAME") || "Intiface"}: No funscript found for:`, funscriptFilename)
        return
      }
      throw new Error('Failed to load Funscript')
    }

    const rawFunscript = await response.json()
    const funscript = processFunscript(rawFunscript)
    funscriptCache.set(funscriptUrl, funscript)

    mediaPlayer.currentFunscript = funscript
    updateChatFunscriptUI(funscript)

  } catch (error) {
    console.error(`${d("NAME") || "Intiface"}: Failed to load Funscript:`, error)
    $("#intiface-chat-funscript-info").text(`Error: ${error.message}`).css("color", "#F44336")
  }
}

function processFunscript(rawFunscript) {
  const rawActions = Array.isArray(rawFunscript?.actions) ? rawFunscript.actions : []
  const normalizePosToPercent = (value) => {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return 0

    // Accept canonical funscript 0..100 plus 0..1 / -1..1 variants.
    if (numeric >= 0 && numeric <= 1) {
      return Math.round(numeric * 100)
    }
    if (numeric >= -1 && numeric <= 1) {
      return Math.round(((numeric + 1) / 2) * 100)
    }
    if (numeric >= 0 && numeric <= 100) {
      return Math.round(numeric)
    }
    return Math.round(Math.max(0, Math.min(100, numeric)))
  }

  const actions = rawActions
    .map((a) => ({
      at: Math.max(0, Math.round(Number(a?.at) || 0)),
      pos: normalizePosToPercent(a?.pos),
    }))
    .sort((a, b) => a.at - b.at)

  const duration = actions.length > 0 ? actions[actions.length - 1].at : 0
  const avgPos = actions.reduce((sum, a) => sum + a.pos, 0) / actions.length || 0
  const maxPos = Math.max(...actions.map(a => a.pos), 0)
  const minPos = Math.min(...actions.map(a => a.pos), 100)

  return {
    actions: actions,
    duration: duration,
    inverted: rawFunscript.inverted || false,
    range: rawFunscript.range || 100,
    stats: {
      actionCount: actions.length,
      avgPosition: Math.round(avgPos),
      maxPosition: maxPos,
      minPosition: minPos
    }
  }
}

// ==========================================
// MEDIA PLAYBACK - Uses universal sync
// ==========================================

function startFunscriptSync() {
  if (!mediaPlayer.currentFunscript || !mediaPlayer.videoElement) {
    console.log(`${d("NAME") || "Intiface"}: Cannot start sync - no funscript or video`)
    return
  }

  // Stop any existing sync
  stopFunscriptSync()

  // Prepare channel funscripts
  const channelFunscripts = { '-': mediaPlayer.currentFunscript }
  Object.assign(channelFunscripts, mediaPlayer.channelFunscripts)

  // Start universal sync
  mediaSyncSessionId = startSync(
    channelFunscripts,
    () => (mediaPlayer.videoElement.currentTime * 1000) + mediaPlayer.syncOffset
  )

  console.log(`${d("NAME") || "Intiface"}: Started funscript sync with session ${mediaSyncSessionId}`)
  $("#intiface-chat-funscript-info").text("Playing - Funscript active").css("color", "#4CAF50")
}

function stopFunscriptSync() {
  if (mediaSyncSessionId) {
    stopSync(mediaSyncSessionId)
    console.log(`${d("NAME") || "Intiface"}: Stopped funscript sync session ${mediaSyncSessionId}`)
    mediaSyncSessionId = null
  }
}

function stopMediaPlayback() {
  if (mediaPlayer.videoElement) {
    mediaPlayer.videoElement.pause()
    mediaPlayer.videoElement.currentTime = 0
  }

  mediaPlayer.isPlaying = false
  stopFunscriptSync()
  d("stopAllDeviceActions")?.({ silent: true })
  $("#intiface-funscript-state").text("Stopped").css("color", "#888")
}

function updateMediaPlayerStatus(status) {
  $("#intiface-status-panel").text(`Status: ${status}`)
}

// ==========================================
// CHAT MEDIA PANEL
// ==========================================

function createChatSidebarPanel() {
  if ($("#intiface-chat-media-panel").length > 0) return

  const panelHtml = `
    <div id="intiface-chat-media-panel" style="display: none; width: 100%; position: relative; margin-bottom: 10px; padding: 0;">
      <div id="intiface-chat-video-container" style="position: relative; width: 100%; line-height: 0;">
        <video id="intiface-chat-video-player" style="width: 100%; height: auto; border-radius: 4px; background: #000; display: block;" controls>
          Your browser does not support the video tag.
        </video>
        <button id="intiface-close-chat-media" class="menu_button" style="position: absolute; top: 8px; right: 8px; padding: 4px 8px; font-size: 0.8em; opacity: 0; transition: opacity 0.2s; z-index: 10;" title="Close">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    </div>
  `

  const chatElement = $("#chat")
  if (chatElement.length > 0) {
    chatElement.before(panelHtml)
    setupChatPanelEventHandlers()
  }
}

function setupChatPanelEventHandlers() {
  $("#intiface-close-chat-media").on("click", () => hideChatMediaPanel())

  const videoContainer = $("#intiface-chat-video-container")
  const closeButton = $("#intiface-close-chat-media")

  videoContainer.on("mouseenter", function() {
    closeButton.css("opacity", "1")
  }).on("mouseleave", function() {
    closeButton.css("opacity", "0")
  })
}

function showChatMediaPanel() {
  const panel = $("#intiface-chat-media-panel")
  if (panel.length === 0) {
    createChatSidebarPanel()
  }
  $("#intiface-chat-media-panel").show()
  applyMediaPlayerAppearance()
}

function hideChatMediaPanel() {
  $("#intiface-chat-media-panel").hide()
  stopMediaPlayback()
}

function normalizeMediaName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[\\/]+/g, '/')
    .replace(/[^a-z0-9._-]+/g, '')
}

function levenshteinDistance(a, b) {
  const s = String(a || '')
  const t = String(b || '')
  const m = s.length
  const n = t.length

  if (m === 0) return n
  if (n === 0) return m

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      )
    }
  }

  return dp[m][n]
}

async function resolveMediaFilename(requestedName) {
  const cleaned = String(requestedName || '')
    .trim()
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/^[*_]+|[*_]+$/g, '')
    .trim()

  if (!cleaned) {
    return { filename: null, fuzzy: false }
  }

  let knownFiles = (mediaLibraryState.allFiles || []).map((f) => String(f?.name || '').trim()).filter(Boolean)
  if (knownFiles.length === 0) {
    await refreshMenuMediaList()
    knownFiles = (mediaLibraryState.allFiles || []).map((f) => String(f?.name || '').trim()).filter(Boolean)
  }

  if (knownFiles.length === 0) {
    return { filename: null, fuzzy: false }
  }

  const exact = knownFiles.find((name) => name.toLowerCase() === cleaned.toLowerCase())
  if (exact) {
    return { filename: exact, fuzzy: false }
  }

  const requestedExt = cleaned.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || ''
  const requestedNorm = normalizeMediaName(cleaned)
  const pool = requestedExt
    ? knownFiles.filter((name) => name.toLowerCase().endsWith(`.${requestedExt}`))
    : knownFiles

  if (pool.length === 0) {
    return { filename: null, fuzzy: false }
  }

  let bestName = ''
  let bestScore = -1

  for (const candidate of pool) {
    const candidateNorm = normalizeMediaName(candidate)
    if (!candidateNorm) continue

    let score = 0
    if (candidateNorm === requestedNorm) {
      score = 1
    } else if (candidateNorm.includes(requestedNorm) || requestedNorm.includes(candidateNorm)) {
      score = 0.9
    } else {
      const dist = levenshteinDistance(requestedNorm, candidateNorm)
      const maxLen = Math.max(requestedNorm.length, candidateNorm.length, 1)
      score = 1 - (dist / maxLen)
    }

    if (score > bestScore) {
      bestScore = score
      bestName = candidate
    }
  }

  if (!bestName || bestScore < 0.55) {
    return { filename: null, fuzzy: false }
  }

  return { filename: bestName, fuzzy: true }
}

async function loadChatMediaFile(filename) {
  console.log(`${d("NAME") || "Intiface"}: Loading media file in chat:`, filename)

  try {
    const resolved = await resolveMediaFilename(filename)
    if (!resolved.filename) {
      const message = `Media file not found: ${filename}`
      console.warn(`${d("NAME") || "Intiface"}: ${message}`)
      d("updateStatus")?.(message, true)
      return false
    }

    const selectedFilename = resolved.filename
    const videoUrl = `/assets/intiface/media/${encodeURIComponent(selectedFilename)}`

    showChatMediaPanel()
    $("#intiface-chat-video-filename").text(selectedFilename)

    if (resolved.fuzzy) {
      d("updateStatus")?.(`Media fuzzy matched: ${filename} -> ${selectedFilename}`)
      console.log(`${d("NAME") || "Intiface"}: Fuzzy matched media file:`, `${filename} -> ${selectedFilename}`)
    }

    const videoPlayer = $("#intiface-chat-video-player")
    videoPlayer.attr('src', videoUrl)

    // Check for audio file
    const audioExtensions = ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.opus']
    const isAudioFile = audioExtensions.some(ext => selectedFilename.toLowerCase().endsWith(ext))

    if (isAudioFile) {
      videoPlayer.css({ 'height': '54px', 'max-height': '54px', 'object-fit': 'none', 'background': 'transparent', 'border': 'none', 'padding': '0', 'margin': '0', 'display': 'block' })
      $("#intiface-chat-video-container").css({ 'height': '54px', 'max-height': '54px', 'line-height': '1', 'margin-bottom': '0', 'padding': '0', 'overflow': 'hidden' })
      videoPlayer.addClass('audio-mode')
    } else {
      videoPlayer.css({ 'height': 'auto', 'max-height': 'none', 'object-fit': 'contain', 'background': '#000', 'border': '', 'padding': '', 'margin': '' })
      $("#intiface-chat-video-container").css({ 'height': '', 'max-height': '', 'line-height': '0', 'margin-bottom': '0', 'padding': '', 'overflow': '' })
      videoPlayer.removeClass('audio-mode')
    }

    mediaPlayer.videoElement = videoPlayer[0]
    mediaPlayer.currentMediaPath = `assets/intiface/media/${selectedFilename}`

    // Load funscripts
    await loadChannelFunscripts(selectedFilename)

    // Setup video event listeners
    setupChatVideoEventListeners()

    // Auto-play
    videoPlayer[0].play().catch(e => {
      console.log(`${d("NAME") || "Intiface"}: Auto-play prevented, user must click play`)
    })

    return true

  } catch (error) {
    console.error(`${d("NAME") || "Intiface"}: Failed to load media:`, error)
    d("updateStatus")?.(`Media load failed: ${error.message}`, true)
    return false
  }
}

async function loadChannelFunscripts(filename) {
  const baseName = filename.replace(/\.[^.]+$/, '')

  // Clear previous channel funscripts
  mediaPlayer.channelFunscripts = {}

  // Get active channels
  const activeChannels = new Set(['-'])
  const connectedDevices = getConnectedDevicesLive()

  for (let index = 0; index < connectedDevices.length; index++) {
    let channel = '-'

    if (typeof d("getDeviceChannel") === 'function') {
      channel = d("getDeviceChannel")(index) || '-'
    } else {
      const device = connectedDevices[index]
      channel = d("deviceAssignments")?.[device?.index] || '-'
    }

    activeChannels.add(String(channel).toUpperCase())
  }

  console.log(`${d("NAME") || "Intiface"}: Active channels: ${Array.from(activeChannels).join(', ')}`)

  // Load funscripts for active channels
  const loadPromises = Array.from(activeChannels).map(async (channel) => {
    const suffix = channel === '-' ? '' : `_${channel}`
    const funscriptFilename = `${baseName}${suffix}.funscript`
    const funscriptUrl = `/assets/intiface/funscript/${encodeURIComponent(funscriptFilename)}`

    try {
      const response = await fetch(funscriptUrl, {
        method: 'GET',
        headers: d("getRequestHeaders")()
      })

      if (response.ok) {
        const data = await response.json()
        const funscript = processFunscript(data)
        funscriptCache.set(funscriptUrl, funscript)
        mediaPlayer.channelFunscripts[channel] = funscript
        console.log(`${d("NAME") || "Intiface"}: Loaded funscript for channel ${channel}: ${funscriptFilename}`)
        return { channel, success: true }
      }
    } catch (e) {
      console.log(`${d("NAME") || "Intiface"}: Funscript not found for channel ${channel}: ${funscriptFilename}`)
    }
    return { channel, success: false }
  })

  await Promise.all(loadPromises)

  // Set current funscript
  if (mediaPlayer.channelFunscripts['-']) {
    mediaPlayer.currentFunscript = mediaPlayer.channelFunscripts['-']
    updateChatFunscriptUI(mediaPlayer.currentFunscript)
  } else {
    const firstChannel = Object.keys(mediaPlayer.channelFunscripts)[0]
    if (firstChannel) {
      mediaPlayer.currentFunscript = mediaPlayer.channelFunscripts[firstChannel]
      updateChatFunscriptUI(mediaPlayer.currentFunscript)
    }
  }
}

function setupChatVideoEventListeners() {
  const video = mediaPlayer.videoElement
  if (!video) return

  console.log(`${d("NAME") || "Intiface"}: Setting up video event listeners`)

  // Remove old listeners
  video.onplay = null
  video.onpause = null
  video.onended = null
  video.onseeked = null

  // Add new listeners
  video.onplay = async () => {
    console.log(`${d("NAME") || "Intiface"}: Video onplay event fired`)
    await new Promise(resolve => setTimeout(resolve, 50))
    
    mediaPlayer.isPlaying = true
    
    // Clear any pending AI commands when video starts
    const msgCmds = d("messageCommands")
    if (msgCmds?.length > 0) {
      console.log(`${d("NAME") || "Intiface"}: Clearing ${msgCmds.length} pending AI commands - video playback has priority`)
      msgCmds.length = 0
    }

    startFunscriptSync()
    d("updateStatus")(`Playing funscript on ${getConnectedDevicesLive().length} device(s)`)
    $("#intiface-chat-funscript-info").text("Playing - Funscript active").css("color", "#4CAF50")
  }

  video.onpause = async () => {
    console.log(`${d("NAME") || "Intiface"}: Video onpause triggered`)
    if (document.hidden) return
    
    mediaPlayer.isPlaying = false
    stopFunscriptSync()
    await new Promise(resolve => setTimeout(resolve, 100))
    await d("stopAllDeviceActions")?.({ silent: true })
    $("#intiface-chat-funscript-info").text("Paused").css("color", "#FFA500")
  }

  video.onended = () => {
    console.log(`${d("NAME") || "Intiface"}: Video onended event fired`)
    mediaPlayer.isPlaying = false
    stopFunscriptSync()

    if ($("#intiface-menu-loop").is(":checked")) {
      video.currentTime = 0
      video.play()
    } else {
      $("#intiface-chat-funscript-info").text("Finished").css("color", "#888")
      d("stopAllDeviceActions")?.({ silent: true })
    }
  }

  video.onseeked = () => {
    console.log(`${d("NAME") || "Intiface"}: Video seeked to ${video.currentTime}s`)
    // Universal sync handles seeking automatically
  }
}

function updateChatFunscriptUI(funscript) {
  if (!funscript) return

  const availableChannels = Object.keys(mediaPlayer.channelFunscripts || {})
  const channelInfo = availableChannels.length > 1
    ? `<div style="font-size: 0.7em; color: #64B5F6; margin-top: 2px;">
        <i class="fa-solid fa-layer-group"></i> Channels: ${availableChannels.filter(c => c !== '-').join(', ')}
       </div>`
    : ''

  $("#intiface-chat-funscript-duration").text(`${(funscript.duration / 1000).toFixed(1)}s`)
  $("#intiface-chat-funscript-info").html(`
    ${funscript.stats.actionCount} actions |
    Range: ${funscript.stats.minPosition}-${funscript.stats.maxPosition}%
    ${channelInfo}
  `).css("color", "#888")
}

// ==========================================
// VIDEO MENTION DETECTION
// ==========================================

function checkForVideoMentions(text) {
  const mediaExtensions = 'mp4|m4a|mp3|wav|webm|mkv|avi|mov|ogg|oga|ogv';
  const patterns = [
    new RegExp(`<media:PLAY:\\s*([^<>]+?\\.(${mediaExtensions}))>`, 'i'),
    new RegExp(`<video:\\s*([^<>]+?\\.(${mediaExtensions}))>`, 'i'),
    new RegExp(`(?:play|playing|loads?|show|watch)\\s+(?:the\\s+)?(?:video|audio|media)?\\s*["']([^"']+\\.(${mediaExtensions}))["']`, 'i'),
    new RegExp(`(?:play|playing|loads?|show|watch)\\s+(?:the\\s+)?(?:video|audio|media)?\\s*["']?([^"'\\s<>]+\\.(${mediaExtensions}))["']?`, 'i'),
    new RegExp(`["']([^"']+\\.(${mediaExtensions}))["']`, 'i'),
    new RegExp(`\\b([^"'\\s<>]+\\.(${mediaExtensions}))\\b`, 'i')
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      const filename = match[1].trim()
      console.log(`${d("NAME") || "Intiface"}: Detected video mention:`, filename)
      return filename
    }
  }

  return null
}

// ==========================================
// EXPORTS
// ==========================================

export { mediaPlayer, funscriptCache }

export {
  initMediaModule,
  initMediaPlayer,
  loadMediaPlayerAppearance,
  saveMediaPlayerAppearance,
  applyMediaPlayerAppearance,
  startInternalProxy,
  stopInternalProxy,
  refreshMenuMediaList,
  loadFunscript,
  processFunscript,
  startFunscriptSync,
  stopFunscriptSync,
  stopMediaPlayback,
  updateMediaPlayerStatus,
  createChatSidebarPanel,
  setupChatPanelEventHandlers,
  showChatMediaPanel,
  hideChatMediaPanel,
  loadChatMediaFile,
  setupChatVideoEventListeners,
  updateChatFunscriptUI,
  checkForVideoMentions
}
