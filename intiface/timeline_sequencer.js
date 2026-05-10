/**
 * Timeline Sequencer Module
 * Multi-track pattern editor for organizing and playing back patterns over time
 */

// Timeline Sequencer state
let timelineBlocks = [] // Array of { id, patternName, category, channel, startTime, duration }
let timelineBlockIdCounter = 0
let timelineSelectedPattern = null // Currently selected pattern from palette
let timelinePlaybackStartTime = 0
let timelinePlaybackTimer = null
let timelineCurrentPosition = 0 // Current playback position in ms
let timelineIsPlaying = false // INDEPENDENT play state - do NOT use mediaPlayer.isPlaying
let timelineSyncSessionId = null // Universal sync session ID
let timelineChannelFunscripts = {}
let timelineChannelLastActionIndex = {}
const TIMELINE_MIN_DURATION = 30000 // Minimum 30 seconds
const TIMELINE_PADDING_MULTIPLIER = 2.0 // Double the content duration (100% extra space)

// Timeline dragging state
let timelineIsDragging = false
let timelineDragBlock = null
let timelineDragStartX = 0
let timelineDragStartTime = 0
let timelineSequenceTimeouts = new Set() // Track timeouts for cleanup

// Category colors for timeline blocks (matching the UI theme)
const categoryColors = {
  basic: { bg: 'rgba(100,100,100,0.6)', border: 'rgba(150,150,150,0.8)' },
  denial: { bg: 'rgba(255,100,100,0.6)', border: 'rgba(255,100,100,0.8)' },
  milking: { bg: 'rgba(100,255,100,0.6)', border: 'rgba(100,255,100,0.8)' },
  training: { bg: 'rgba(100,100,255,0.6)', border: 'rgba(100,100,255,0.8)' },
  robotic: { bg: 'rgba(255,0,255,0.6)', border: 'rgba(255,0,255,0.8)' },
  sissy: { bg: 'rgba(255,100,200,0.6)', border: 'rgba(255,100,200,0.8)' },
  prejac: { bg: 'rgba(0,255,255,0.6)', border: 'rgba(0,255,255,0.8)' },
  evil: { bg: 'rgba(191,0,255,0.6)', border: 'rgba(191,0,255,0.8)' },
  frustration: { bg: 'rgba(255,255,0,0.6)', border: 'rgba(255,255,0,0.8)' },
  hypno: { bg: 'rgba(221,160,221,0.6)', border: 'rgba(221,160,221,0.8)' },
  chastity: { bg: 'rgba(255,192,203,0.6)', border: 'rgba(255,192,203,0.8)' }
}

// External dependencies (will be injected via initTimelineModule)
let deps = {
  NAME: 'intiface-connect',
  devices: [],
  deviceAssignments: {},
  buttplug: null,
  PlayModeLoader: null,
  updateStatus: () => {},
  stopAllDeviceActions: () => {},
  applyIntensityScale: (values) => values,
  applyInversion: (value) => value,
  getMotorCount: () => 1,
  getPollingInterval: () => 33,
  executePattern: () => {},
  clearWorkerTimeout: (id) => clearTimeout(id)
}

function getLiveConnectedDevices() {
  if (typeof deps.getConnectedDevices === 'function') {
    return deps.getConnectedDevices() || []
  }
  return deps.devices || []
}

/**
 * Initialize the timeline module with required dependencies
 * @param {Object} dependencies - Object containing all required dependencies
 */
export function initTimelineModule(dependencies) {
  deps = { ...deps, ...dependencies }
  console.log(`${deps.NAME}: Timeline module initialized`)
}

/**
 * Calculate dynamic timeline duration based on blocks (with padding for visual editing)
 * @returns {number} Duration in milliseconds
 */
export function getTimelineDuration() {
  if (timelineBlocks.length === 0) {
    return TIMELINE_MIN_DURATION
  }

  // Find the end time of the last block
  const lastEndTime = Math.max(...timelineBlocks.map(b => b.startTime + b.duration))
  // Add 100% extra space (double the content duration)
  const dynamicDuration = lastEndTime * TIMELINE_PADDING_MULTIPLIER

  return Math.max(TIMELINE_MIN_DURATION, dynamicDuration)
}

/**
 * Get the actual content duration (longest pattern end time) without padding
 * This is used for playback slider max and funscript export
 * @returns {number} Duration in milliseconds
 */
export function getContentDuration() {
  if (timelineBlocks.length === 0) {
    return 0
  }

  // Find the end time of the last block (actual content end, no padding)
  const lastEndTime = Math.max(...timelineBlocks.map(b => b.startTime + b.duration))

  return lastEndTime
}

/**
 * Format milliseconds to mm:ss for timeline display
 * @param {number} ms - Milliseconds
 * @returns {string} Formatted time string
 */
export function formatTimelineTime(ms) {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

/**
 * Format duration in ms to compact string (e.g., "5s", "1m05s", "30m00s")
 * @param {number} ms - Milliseconds
 * @returns {string} Formatted duration string
 */
export function formatDurationShort(ms) {
  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) {
    return `${totalSeconds}s`
  }
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m${seconds.toString().padStart(2, '0')}s`
}

/**
 * Get motor count for a channel (returns 1 if multi-motor not enabled)
 * @param {string} channel - Channel letter (A, B, C, D)
 * @returns {number} Motor count
 */
export function getChannelMotorCount(channel) {
  const channelLower = channel.toLowerCase()
  const checkbox = $(`#channel-${channelLower}-multi-motor`)
  const input = $(`#channel-${channelLower}-motor-count`)

  if (checkbox.is(':checked')) {
    const count = parseInt(input.val()) || 2
    return Math.max(1, Math.min(8, count))
  }

  return 1
}

function getModeForCategory(category) {
  if (!deps.PlayModeLoader) return null
  if (deps.PlayModeLoader.getMode) {
    const direct = deps.PlayModeLoader.getMode(category)
    if (direct) return direct
  }

  const allModes = deps.PlayModeLoader.getAllModes ? deps.PlayModeLoader.getAllModes() : {}
  for (const modeData of Object.values(allModes || {})) {
    if (String(modeData?.category || '').toLowerCase() === String(category || '').toLowerCase()) {
      return modeData
    }
  }
  return null
}

function getModeIdForCategory(category) {
  if (!deps.PlayModeLoader) return null
  if (deps.PlayModeLoader.getMode && deps.PlayModeLoader.getMode(category)) {
    return category
  }

  const allModes = deps.PlayModeLoader.getAllModes ? deps.PlayModeLoader.getAllModes() : {}
  for (const [modeId, modeData] of Object.entries(allModes || {})) {
    if (String(modeData?.category || '').toLowerCase() === String(category || '').toLowerCase()) {
      return modeId
    }
  }
  return null
}

function getSequencesForCategory(category) {
  const modeId = getModeIdForCategory(category)
  if (!modeId || !deps.PlayModeLoader?.getSequencesForMode) return {}
  return deps.PlayModeLoader.getSequencesForMode(modeId) || {}
}

function getStepCyclesValue(step) {
  if (Number.isFinite(Number(step?.cycles))) return Number(step.cycles)
  if (Array.isArray(step?.cyclesRange) && step.cyclesRange.length >= 2) {
    const lo = Number(step.cyclesRange[0])
    const hi = Number(step.cyclesRange[1])
    if (Number.isFinite(lo) && Number.isFinite(hi)) return (Math.min(lo, hi) + Math.max(lo, hi)) / 2
  }
  return 1
}

function deriveDefaultsFromSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return null

  let totalDuration = 0
  let totalMin = 0
  let totalMax = 0
  let totalCycles = 0
  let validCount = 0

  for (const step of steps) {
    const min = Number(step?.min)
    const max = Number(step?.max)
    const duration = Number(step?.duration)
    if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(duration)) {
      continue
    }
    totalMin += min
    totalMax += max
    totalDuration += duration
    totalCycles += getStepCyclesValue(step)
    validCount++
  }

  if (validCount === 0) return null

  return {
    min: Math.round(totalMin / validCount),
    max: Math.round(totalMax / validCount),
    duration: Math.max(100, Math.round(totalDuration / validCount)),
    cycles: Math.max(1, Math.round(totalCycles / validCount)),
  }
}

function parseWaveformDefaultsFromMode(modeData, patternName) {
  const wf = modeData?.waveformDefaults
  if (!wf || typeof wf !== 'object') return null

  const candidate = wf[patternName] || wf.default
  if (!candidate || typeof candidate !== 'object') return null

  const min = Number(candidate.min)
  const max = Number(candidate.max)
  const duration = Number(candidate.duration)
  const cycles = Number(candidate.cycles)
  if (![min, max, duration, cycles].every(Number.isFinite)) {
    return null
  }

  return {
    min: Math.max(0, Math.min(100, Math.round(min))),
    max: Math.max(0, Math.min(100, Math.round(max))),
    duration: Math.max(100, Math.round(duration)),
    cycles: Math.max(1, Math.round(cycles)),
  }
}

/**
 * Get default values for any pattern (waveform or mode)
 * @param {string} patternName - Name of the pattern
 * @param {string} category - Category of the pattern
 * @returns {Object} Default values for min, max, duration, cycles
 */
export function getPatternDefaults(patternName, category) {
  const modeData = getModeForCategory(category)
  const modeSequences = getSequencesForCategory(category)
  const sequence = modeSequences[patternName]

  if (sequence && Array.isArray(sequence.steps) && sequence.steps.length > 0) {
    const derived = deriveDefaultsFromSteps(sequence.steps)
    if (derived) return derived
  }

  const explicit = parseWaveformDefaultsFromMode(modeData, patternName)
  if (explicit) {
    return explicit
  }

  const matches = []
  for (const seq of Object.values(modeSequences || {})) {
    const steps = Array.isArray(seq?.steps) ? seq.steps : []
    for (const step of steps) {
      if (String(step?.pattern || '').toLowerCase() === String(patternName || '').toLowerCase()) {
        matches.push(step)
      }
    }
  }
  const derivedFromUsage = deriveDefaultsFromSteps(matches)
  if (derivedFromUsage) return derivedFromUsage

  return null
}

/**
 * Get pattern duration for display
 * @param {string} patternName - Name of the pattern
 * @param {string} category - Category of the pattern
 * @returns {number} Duration in milliseconds
 */
export function getPatternDuration(patternName, category) {
  const modeSequences = getSequencesForCategory(category)
  const sequence = modeSequences[patternName]
  if (sequence && Array.isArray(sequence.steps)) {
    return sequence.steps.reduce((sum, step) => sum + Number(step?.duration || 0) + Number(step?.pause || 0), 0)
  }

  const defaults = getPatternDefaults(patternName, category)
  return defaults?.duration || 0
}

/**
 * Select a pattern from the palette (click to select, then click timeline to place)
 * @param {string} patternName - Name of the pattern
 * @param {string} category - Category of the pattern
 */
export function selectPatternForTimeline(patternName, category) {
  // Get pattern defaults first
  const defaults = getPatternDefaults(patternName, category)
  if (!defaults) {
    deps.updateStatus(`No defaults found for '${patternName}' in mode '${category}'. Define waveformDefaults in mode.json or add sequence references.`)
    return
  }

  timelineSelectedPattern = {
    patternName,
    category,
    defaultMin: defaults.min,
    defaultMax: defaults.max,
    defaultDuration: defaults.duration,
    defaultCycles: defaults.cycles
  }

  // Show selected pattern indicator
  const displayName = patternName.replace(/_/g, ' ')
  const categoryLabel = category.charAt(0).toUpperCase() + category.slice(1)
  $('#intiface-timeline-selected').show()
  $('#intiface-timeline-selected-text').text(`Click on Channel A, B, C, or D track to place "${displayName}" (${categoryLabel})`)

  // Highlight pattern buttons
  $('.pattern-btn').css('opacity', '0.5')
  $(`.pattern-btn[data-pattern="${patternName}"]`).css('opacity', '1')

  // Update sliders with defaults
  $('#intiface-pattern-duration').val(defaults.duration)
  $('#intiface-pattern-duration-display').text(formatDurationShort(defaults.duration))
  $('#intiface-pattern-min').val(defaults.min)
  $('#intiface-pattern-min-display').text(`${defaults.min}%`)
  $('#intiface-pattern-max').val(defaults.max)
  $('#intiface-pattern-max-display').text(`${defaults.max}%`)
  $('#intiface-pattern-cycles').val(defaults.cycles)
  $('#intiface-pattern-cycles-display').text(defaults.cycles)

  deps.updateStatus(`Selected: ${displayName} - Click timeline track to place (${(defaults.duration/1000).toFixed(1)}s)`)
}

/**
 * Add pattern block to timeline
 * @param {string} channel - Channel letter (A, B, C, D)
 * @param {number} startTime - Start time in milliseconds
 * @param {number} motor - Motor number (default 1)
 */
export function addTimelineBlock(channel, startTime, motor = 1) {
  if (!timelineSelectedPattern) {
    deps.updateStatus('Select a pattern first, then click timeline track')
    return
  }

  timelineBlockIdCounter++

  // Get duration from slider or use default
  const durationSlider = $('#intiface-pattern-duration').val()
  const duration = durationSlider ? parseInt(durationSlider) : timelineSelectedPattern.defaultDuration

  // Get other parameters from sliders
  const min = Number.parseInt($('#intiface-pattern-min').val(), 10)
  const max = Number.parseInt($('#intiface-pattern-max').val(), 10)
  const cycles = Number.parseInt($('#intiface-pattern-cycles').val(), 10)

  const block = {
    id: timelineBlockIdCounter,
    patternName: timelineSelectedPattern.patternName,
    category: timelineSelectedPattern.category,
    channel: channel,
    motor: motor,
    startTime: startTime,
    duration: duration,
    min: Number.isFinite(min) ? min : timelineSelectedPattern.defaultMin,
    max: Number.isFinite(max) ? max : timelineSelectedPattern.defaultMax,
    cycles: Number.isFinite(cycles) ? cycles : timelineSelectedPattern.defaultCycles
  }

  timelineBlocks.push(block)

  // Render the timeline
  renderTimeline()

  deps.updateStatus(`Added "${timelineSelectedPattern.patternName}" to channel ${channel}`)

  // Keep pattern selected for multiple placements
  // timelineSelectedPattern = null
  // $('#intiface-timeline-selected').hide()
}

/**
 * Remove block from timeline
 * @param {number} id - Block ID to remove
 */
export function removeTimelineBlock(id) {
  timelineBlocks = timelineBlocks.filter(block => block.id !== id)
  renderTimeline()
}

/**
* Clear all timeline blocks
*/
export function clearTimeline() {
  // Clear ALL timeline-related state
  timelineBlocks = []
  timelineBlockIdCounter = 0
  timelineCurrentPosition = 0
  timelineIsPlaying = false
  
  // Clear timeline funscripts
  timelineChannelFunscripts = {}
  timelineChannelLastActionIndex = {}
  
  // Clear timers
  clearInterval(timelinePlaybackTimer)
  timelinePlaybackTimer = null
  
  if (timelineSyncSessionId && typeof deps.stopSync === 'function') {
    deps.stopSync(timelineSyncSessionId)
    timelineSyncSessionId = null
  }

  // Clear sequence timeouts
  timelineSequenceTimeouts.forEach(id => clearTimeout(id))
  timelineSequenceTimeouts.clear()

  $('#intiface-timeline-scrubber').val(0)
  $('#intiface-timeline-current-time').text('0:00')

  renderTimeline()
  deps.updateStatus('Timeline cleared')
}

/**
 * Render timeline blocks
 */
export function renderTimeline() {
  // Clear existing blocks
  $('.timeline-block').remove()

  // Get both durations: visual (padded) and content (actual)
  const visualDuration = getTimelineDuration()
  const contentDuration = getContentDuration()

  // Set scrubber max to content duration (not padded visual duration)
  $('#intiface-timeline-scrubber').attr('max', contentDuration)

  // Update end time label to show actual content end time
  const totalSeconds = Math.floor(contentDuration / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes > 0) {
    $('#intiface-timeline-end-time').text(`${minutes}m ${seconds}s`)
  } else {
    $('#intiface-timeline-end-time').text(`${seconds}s`)
  }

  // Update scale markers (0%, 25%, 50%, 75%, 100%) using visual (padded) duration
  const scalePositions = [0, 0.25, 0.5, 0.75, 1.0]
  scalePositions.forEach((pos, index) => {
    const timeMs = Math.round(visualDuration * pos)
    const timeSec = Math.floor(timeMs / 1000)
    const timeMin = Math.floor(timeSec / 60)
    const timeRem = timeSec % 60
    const timeLabel = timeMin > 0 ? `${timeMin}:${timeRem.toString().padStart(2, '0')}` : `${timeSec}s`
    $(`#timeline-scale-${index}`).text(timeLabel)
  })

  // Render blocks on each track
  timelineBlocks.forEach(block => {
    const displayName = block.patternName.replace(/_/g, ' ')
    const leftPercent = (block.startTime / visualDuration) * 100
    const widthPercent = (block.duration / visualDuration) * 100

    // Get color based on category
    const colors = categoryColors[block.category] || categoryColors.basic

    const blockHtml = `
      <div class="timeline-block" data-id="${block.id}"
        style="position: absolute; top: 2px; left: ${leftPercent}%; width: ${widthPercent}%;
        height: calc(100% - 4px); background: ${colors.bg}; border: 1px solid ${colors.border};
        border-radius: 2px; cursor: move; display: flex; align-items: center; justify-content: center;
        font-size: 0.65em; color: #fff; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; padding: 0 4px; user-select: none;"
        title="${displayName} (${block.category}) - Click and drag to move, right-click to delete">
        ${displayName}
      </div>
    `

    $(`.timeline-track-lane[data-channel="${block.channel}"][data-motor="${block.motor || 1}"]`).append(blockHtml)
  })

  // Attach event handlers to blocks
  attachBlockEventHandlers()
}

/**
 * Attach event handlers to timeline blocks
 */
function attachBlockEventHandlers() {
  $('.timeline-block').on('mousedown', function(e) {
    if (e.button !== 0) return // Only left click
    const id = $(this).data('id')
    timelineIsDragging = true
    timelineDragBlock = timelineBlocks.find(b => b.id === id)
    timelineDragStartX = e.pageX

    const lane = $(e.target).closest('.timeline-track-lane')[0]
    if (lane) {
      timelineDragStartTime = timelineDragBlock.startTime
    }

    // Mouse move handler
    const onMouseMove = (e) => {
      if (!timelineIsDragging || !timelineDragBlock) return

      const deltaX = e.pageX - timelineDragStartX

      // Convert pixel delta to time delta (approximate)
      const laneWidth = $('.timeline-track-lanes').first().width() || 800
      const visualDuration = getTimelineDuration()
      const deltaTime = (deltaX / laneWidth) * visualDuration

      let newTime = timelineDragStartTime + deltaTime
      newTime = Math.max(0, Math.min(newTime, getTimelineDuration() - timelineDragBlock.duration))

      timelineDragBlock.startTime = Math.round(newTime)
      renderTimeline()
    }

    // Mouse up handler
    const onMouseUp = () => {
      timelineIsDragging = false
      timelineDragBlock = null
      $(document).off('mousemove', onMouseMove)
      $(document).off('mouseup', onMouseUp)
    }

    $(document).on('mousemove', onMouseMove)
    $(document).on('mouseup', onMouseUp)
  })

  // Right-click to remove
  $('.timeline-block').on('contextmenu', function(e) {
    e.preventDefault()
    const id = $(this).data('id')
    removeTimelineBlock(id)
  })
}

/**
 * Convert timeline blocks to funscript format for unified playback
 * Each channel gets its own funscript with actions at the appropriate times
 * @returns {Object} Channel funscripts object
 */
export function convertTimelineToFunscripts() {
  const channelFunscripts = {}
  const channels = ['A', 'B', 'C', 'D', '-']

  const normalizePatternOutput = (value) => {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return 0

    // Most extension patterns output 0..1. Some legacy generators output -1..1.
    // Support both to avoid collapsing usable stroke range.
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

  const resolvePatternFunc = (patternName, category) => {
    const targetName = String(patternName || '').trim()
    if (!targetName) return null

    if (deps.PlayModeLoader?.getPattern) {
      const direct = deps.PlayModeLoader.getPattern(targetName)
      if (typeof direct === 'function') {
        return direct
      }
    }

    const modeId = getModeIdForCategory(category)
    if (modeId && deps.PlayModeLoader?.getPatternsForMode) {
      const modePatterns = deps.PlayModeLoader.getPatternsForMode(modeId) || {}
      if (typeof modePatterns[targetName] === 'function') {
        return modePatterns[targetName]
      }

      const normalizedTarget = targetName.toLowerCase()
      for (const [key, fn] of Object.entries(modePatterns)) {
        if (String(key || '').toLowerCase() === normalizedTarget && typeof fn === 'function') {
          return fn
        }
      }
    }

    return null
  }

  const addWaveformActions = ({ funscript, motorCount, startAt, duration, min, max, cycles, patternFunc }) => {
    const safeDuration = Math.max(0, Number(duration) || 0)
    if (safeDuration <= 0) return

    const steps = Math.max(1, Math.floor(safeDuration / 100))
    const safeMin = Math.max(0, Math.min(100, Number(min) || 0))
    const safeMax = Math.max(0, Math.min(100, Number(max) || 100))
    const safeCycles = Math.max(1, Number(cycles) || 1)

    for (let i = 0; i < steps; i++) {
      const progress = i / steps
      const phase = (progress * safeCycles) % 1
      const rawValue = patternFunc(phase, 1)

      const normalizedValue = normalizePatternOutput(rawValue)
      const pos = Math.round(safeMin + (safeMax - safeMin) * normalizedValue)
      const at = Math.round(startAt + (i * 100))

      if (motorCount > 1) {
        const positions = []
        for (let motor = 0; motor < motorCount; motor++) {
          const motorPhase = (phase + (motor / motorCount)) % 1
          const motorRawValue = patternFunc(motorPhase, 1)
          const motorNormalized = normalizePatternOutput(motorRawValue)
          const motorPos = Math.round(safeMin + (safeMax - safeMin) * motorNormalized)
          positions.push(Math.min(100, Math.max(0, motorPos)))
        }
        funscript.actions.push({ at, pos: positions })
      } else {
        funscript.actions.push({ at, pos: Math.min(100, Math.max(0, pos)) })
      }
    }
  }

  // Initialize funscripts for each channel
  const contentDuration = getContentDuration()
  channels.forEach(channel => {
    channelFunscripts[channel] = {
      actions: [],
      inverted: false,
      metadata: {
        creator: 'Extension-Intiface Timeline',
        description: `Timeline playback for channel ${channel}`,
        duration: contentDuration,
        type: 'funscript'
      }
    }
  })

  // Get all blocks sorted by start time
  const sortedBlocks = [...timelineBlocks].sort((a, b) => a.startTime - b.startTime)

  // Generate actions for each block
  sortedBlocks.forEach(block => {
    const funscript = channelFunscripts[block.channel]
    if (!funscript) return

    // Get motor count for this channel
    const motorCount = getChannelMotorCount(block.channel)

    const min = Number(block.min)
    const max = Number(block.max)
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      throw new Error(`Timeline block '${block.patternName}' has invalid min/max values`)
    }

    const modeSequences = getSequencesForCategory(block.category)
    const selectedSequence = modeSequences?.[block.patternName]

    if (selectedSequence && Array.isArray(selectedSequence.steps) && selectedSequence.steps.length > 0) {
      const blockEndTime = block.startTime + Math.max(0, Number(block.duration) || 0)
      let cursor = block.startTime
      const repeatSequence = selectedSequence.repeat !== false
      const sequenceSteps = selectedSequence.steps
      const safetyMaxLoops = 256
      let loops = 0

      while (cursor < blockEndTime && loops < safetyMaxLoops) {
        loops++
        let sequenceProgressed = false

        for (const step of sequenceSteps) {
          const patternName = String(step?.pattern || '').trim()
          const stepDuration = Math.max(0, Number(step?.duration) || 0)
          const stepPause = Math.max(0, Number(step?.pause) || 0)
          const stepMin = Number.isFinite(Number(step?.min)) ? Number(step.min) : min
          const stepMax = Number.isFinite(Number(step?.max)) ? Number(step.max) : max
          const stepCycles = Number.isFinite(Number(step?.cycles)) ? Number(step.cycles) : (block.cycles || 1)

          if (stepDuration > 0 && patternName) {
            const patternFunc = resolvePatternFunc(patternName, block.category)
            if (typeof patternFunc !== 'function') {
              throw new Error(`Timeline sequence '${block.patternName}' references unknown pattern '${patternName}' in mode '${block.category}'`)
            }

            const segmentDuration = Math.max(0, Math.min(stepDuration, blockEndTime - cursor))
            addWaveformActions({
              funscript,
              motorCount,
              startAt: cursor,
              duration: segmentDuration,
              min: stepMin,
              max: stepMax,
              cycles: stepCycles,
              patternFunc,
            })
            cursor += segmentDuration
            sequenceProgressed = sequenceProgressed || segmentDuration > 0
          }

          if (cursor >= blockEndTime) break

          if (stepPause > 0) {
            const pauseDuration = Math.min(stepPause, blockEndTime - cursor)
            cursor += pauseDuration
            sequenceProgressed = sequenceProgressed || pauseDuration > 0
          }

          if (cursor >= blockEndTime) break
        }

        if (!repeatSequence || !sequenceProgressed) {
          break
        }
      }
    } else {
      const patternFunc = resolvePatternFunc(block.patternName, block.category)
      if (typeof patternFunc !== 'function') {
        throw new Error(`Timeline block references unknown pattern '${block.patternName}' in mode '${block.category}'`)
      }

      addWaveformActions({
        funscript,
        motorCount,
        startAt: block.startTime,
        duration: Number(block.duration) || 0,
        min,
        max,
        cycles: block.cycles || 1,
        patternFunc,
      })
    }
  })

  // Sort actions by timestamp for each channel
  channels.forEach(channel => {
    channelFunscripts[channel].actions.sort((a, b) => a.at - b.at)

    // Calculate actual max action time for this funscript
    const actions = channelFunscripts[channel].actions
    if (actions.length > 0) {
      const maxActionTime = actions[actions.length - 1].at
      channelFunscripts[channel].metadata.duration = maxActionTime
    } else {
      channelFunscripts[channel].metadata.duration = 0
    }
  })

  return channelFunscripts
}

/**
* Start timeline playback - Uses universal sync system
*/
export async function playTimeline() {
  if (timelineBlocks.length === 0) {
    deps.updateStatus('Timeline is empty - add patterns first')
    return
  }

  if (getLiveConnectedDevices().length === 0) {
    deps.updateStatus('No devices connected')
    return
  }

  // Convert timeline to funscripts per channel
  let channelFunscripts
  try {
    channelFunscripts = convertTimelineToFunscripts()
  } catch (error) {
    const reason = error?.message || String(error)
    deps.updateStatus(`Timeline build failed: ${reason}`)
    console.error(`${deps.NAME}: Timeline conversion failed`, error)
    return
  }
  console.log(`${deps.NAME}: Timeline loaded funscripts for channels:`, Object.keys(channelFunscripts).filter(c => channelFunscripts[c].actions.length > 0))

  // Set up timeline sync
  timelinePlaybackStartTime = Date.now() - timelineCurrentPosition
  timelineIsPlaying = true

  // Start universal sync with timeline funscripts
  const startSyncFn = deps.startSync
  if (startSyncFn) {
    timelineSyncSessionId = startSyncFn(
      channelFunscripts,
      () => timelineCurrentPosition, // getCurrentTime function
      () => {
        // onStop callback - timeline finished
        timelineIsPlaying = false
        if (timelinePlaybackTimer) {
          clearInterval(timelinePlaybackTimer)
          timelinePlaybackTimer = null
        }
        deps.updateStatus('Timeline playback complete')
      }
    )
  }

  deps.updateStatus('Playing timeline...')

  // Start timeline position tracking UI updates
  timelinePlaybackTimer = setInterval(() => {
    if (!timelineIsPlaying) return

    timelineCurrentPosition = Date.now() - timelinePlaybackStartTime

    // Update scrubber
    $('#intiface-timeline-scrubber').val(timelineCurrentPosition)
    $('#intiface-timeline-current-time').text(formatDurationShort(timelineCurrentPosition))

    // Stop at end of actual content
    if (timelineCurrentPosition >= getContentDuration()) {
      stopTimeline()
      timelineCurrentPosition = 0
      $('#intiface-timeline-scrubber').val(0)
      $('#intiface-timeline-current-time').text('0:00')
      deps.updateStatus('Timeline playback complete')
    }
  }, 50) // 50ms = 20fps
}

/**
* Pause timeline playback (maintains position)
*/
export async function pauseTimeline() {
  if (!timelineIsPlaying) {
    return
  }

  // Pause timeline playback
  timelineIsPlaying = false

  if (timelineSyncSessionId && typeof deps.pauseSync === 'function') {
    deps.pauseSync(timelineSyncSessionId)
  } else if (timelineSyncSessionId && typeof deps.stopSync === 'function') {
    deps.stopSync(timelineSyncSessionId)
    timelineSyncSessionId = null
  }

  // Clear UI timer but keep position
  if (timelinePlaybackTimer) {
    clearInterval(timelinePlaybackTimer)
    timelinePlaybackTimer = null
  }

  // Stop device actions
  if (deps.stopAllDeviceActions) {
    await deps.stopAllDeviceActions({ silent: true })
  }

  deps.updateStatus('Timeline paused')
  $('#intiface-timeline-current-time').text(formatDurationShort(timelineCurrentPosition) + ' (paused)')
}

/**
* Resume timeline playback from current position
*/
export async function resumeTimeline() {
  if (timelineIsPlaying) {
    return
  }

  // Check if there are actually timeline blocks to play
  if (timelineBlocks.length === 0) {
    deps.updateStatus('Timeline is empty - add patterns first')
    return
  }

  // Check if we have timeline data loaded
  if (Object.keys(timelineChannelFunscripts || {}).length === 0) {
    // No timeline loaded, need to convert blocks again
    try {
      timelineChannelFunscripts = convertTimelineToFunscripts()
    } catch (error) {
      const reason = error?.message || String(error)
      deps.updateStatus(`Timeline build failed: ${reason}`)
      console.error(`${deps.NAME}: Timeline conversion failed`, error)
      return
    }
    
    // Initialize per-channel action indices
    timelineChannelLastActionIndex = {}
    Object.keys(timelineChannelFunscripts).forEach(channel => {
      if (timelineChannelFunscripts[channel].actions.length > 0) {
        timelineChannelLastActionIndex[channel] = 0
      }
    })
  }

  // Resume from current position
  timelinePlaybackStartTime = Date.now() - timelineCurrentPosition
  timelineIsPlaying = true

  if (timelineSyncSessionId && typeof deps.resumeSync === 'function') {
    deps.resumeSync(timelineSyncSessionId)
  } else {
    const startSyncFn = deps.startSync
    if (startSyncFn) {
      timelineSyncSessionId = startSyncFn(
        timelineChannelFunscripts,
        () => timelineCurrentPosition,
        () => {
          timelineIsPlaying = false
          if (timelinePlaybackTimer) {
            clearInterval(timelinePlaybackTimer)
            timelinePlaybackTimer = null
          }
          deps.updateStatus('Timeline playback complete')
        }
      )
    }
  }

  // Restart timeline position tracking UI
  timelinePlaybackTimer = setInterval(() => {
    if (!timelineIsPlaying) return

    timelineCurrentPosition = Date.now() - timelinePlaybackStartTime

    // Update scrubber
    $('#intiface-timeline-scrubber').val(timelineCurrentPosition)
    $('#intiface-timeline-current-time').text(formatDurationShort(timelineCurrentPosition))

    // Stop at end of actual content
    if (timelineCurrentPosition >= getContentDuration()) {
      stopTimeline()
      timelineCurrentPosition = 0
      $('#intiface-timeline-scrubber').val(0)
      $('#intiface-timeline-current-time').text('0:00')
      deps.updateStatus('Timeline playback complete')
    }
  }, 50)

  deps.updateStatus('Timeline resumed')
}

/**
* Stop timeline playback
*/
export async function stopTimeline() {
  // Stop timeline playback
  timelineIsPlaying = false

  if (timelineSyncSessionId && typeof deps.stopSync === 'function') {
    deps.stopSync(timelineSyncSessionId)
    timelineSyncSessionId = null
  }

  // Clear timeline timer
  if (timelinePlaybackTimer) {
    clearInterval(timelinePlaybackTimer)
    timelinePlaybackTimer = null
  }

  // Stop device actions
  if (deps.stopAllDeviceActions) {
    await deps.stopAllDeviceActions({ silent: true })
  }

  // Clear timeline funscript data
  timelineChannelFunscripts = {}
  timelineChannelLastActionIndex = {}

  // Reset position
  timelineCurrentPosition = 0
  $('#intiface-timeline-scrubber').val(0)
  $('#intiface-timeline-current-time').text('0:00')

  deps.updateStatus('Timeline stopped')
}

/**
* Update timeline from scrubber
* @param {number} value - New position in milliseconds
*/
export function scrubTimeline(value) {
  timelineCurrentPosition = parseInt(value)
  $('#intiface-timeline-current-time').text(formatDurationShort(timelineCurrentPosition))

  if (timelineIsPlaying) {
    timelinePlaybackStartTime = Date.now() - timelineCurrentPosition
    
    // Recalculate action indices for all channels based on new position
    Object.keys(timelineChannelFunscripts).forEach(channel => {
      const funscript = timelineChannelFunscripts[channel]
      if (!funscript || !funscript.actions) return
      
      // Find the correct action index for this position
      let newIndex = 0
      for (let i = 0; i < funscript.actions.length; i++) {
        if (funscript.actions[i].at <= timelineCurrentPosition) {
          newIndex = i + 1
        } else {
          break
        }
      }
      timelineChannelLastActionIndex[channel] = newIndex
    })
  }
}

/**
 * Update motor lanes for a channel
 * @param {string} channel - Channel letter (A, B, C, D)
 * @param {number} motorCount - Number of motors
 */
export function updateMotorLanes(channel, motorCount) {
  const lanesContainer = $(`.timeline-track-lanes[data-channel="${channel}"]`)

  // Get channel color
  const channelColors = {
    'A': '255,100,100',
    'B': '100,255,100',
    'C': '100,100,255',
    'D': '255,0,255'
  }
  const color = channelColors[channel] || '100,100,100'

  // Clear existing lanes
  lanesContainer.empty()

  // Create lanes for each motor
  for (let i = 1; i <= motorCount; i++) {
    const lane = $(`
      <div class="timeline-track-lane"
        style="height: ${motorCount === 1 ? '28px' : '24px'}; position: relative; background: rgba(0,0,0,0.2); cursor: pointer; ${i < motorCount ? `border-bottom: 1px solid rgba(${color},0.15);` : ''}"
        data-channel="${channel}"
        data-motor="${i}">
        ${motorCount > 1 ? `<span style="position: absolute; left: 2px; top: 2px; font-size: 0.5em; color: rgba(${color},0.5);">${i}</span>` : ''}
      </div>
    `)
    lanesContainer.append(lane)
  }

  // Re-attach click handlers
  attachLaneClickHandlers()

  // Re-render blocks if any exist
  renderTimeline()
}

/**
 * Attach click handlers to timeline lanes
 */
export function attachLaneClickHandlers() {
  $(document).off('click', '.timeline-track-lane')
  $(document).on('click', '.timeline-track-lane', function(e) {
    if (e.target !== this) return

    const lane = $(this)
    const channel = lane.data('channel')
    const motor = lane.data('motor') || 1

    if (!timelineSelectedPattern) {
      deps.updateStatus('Select a pattern first, then click on a timeline track')
      return
    }

    // Calculate position from click
    const rect = this.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const laneWidth = rect.width
    const clickPercent = Math.max(0, Math.min(1, clickX / laneWidth))
    const startTime = Math.round(clickPercent * getTimelineDuration())

    // Add block with motor info
    addTimelineBlock(channel, startTime, motor)
  })
}

/**
 * Setup timeline event handlers
 * This should be called after the DOM is ready
 */
export function setupTimelineEventHandlers() {
  // Timeline control buttons
  $("#intiface-timeline-play").on("click", async function() {
    // If paused (has data but not playing), resume from current position
    if (!timelineIsPlaying && Object.keys(timelineChannelFunscripts || {}).length > 0) {
      resumeTimeline()
    } else if (timelineIsPlaying) {
      // Already playing - restart from beginning
      await stopTimeline()
      playTimeline()
    } else {
      // Fresh start
      playTimeline()
    }
  })

  $("#intiface-timeline-pause").on("click", async function() {
    await pauseTimeline()
  })

  $("#intiface-timeline-clear").on("click", function() { clearTimeline() })
  $("#intiface-timeline-scrubber").on("input", function() {
    scrubTimeline($(this).val())
  })

  // Pattern duration slider
  $("#intiface-pattern-duration").on("input", function() {
    const duration = parseInt($(this).val())
    $("#intiface-pattern-duration-display").text(formatDurationShort(duration))

    // Auto-calculate cycles multiplicatively
    if (timelineSelectedPattern && timelineSelectedPattern.defaultDuration && timelineSelectedPattern.defaultCycles) {
      const defaultDuration = timelineSelectedPattern.defaultDuration
      const defaultCycles = timelineSelectedPattern.defaultCycles
      const cycles = Math.max(1, Math.round(defaultCycles * duration / defaultDuration))
      $("#intiface-pattern-cycles").val(cycles)
      $("#intiface-pattern-cycles-display").text(cycles)
    }
  })

  // Channel motor count controls
  const channels = ['a', 'b', 'c', 'd']
  channels.forEach(channel => {
    const checkbox = $(`#channel-${channel}-multi-motor`)
    const input = $(`#channel-${channel}-motor-count`)
    const channelUpper = channel.toUpperCase()

    checkbox.on('change', function() {
      const isChecked = $(this).is(':checked')
      const lanesContainer = $(`.timeline-track-lanes[data-channel="${channelUpper}"]`)

      if (isChecked) {
        input.show()
        if (!input.val() || parseInt(input.val()) < 2) {
          input.val(2)
        }
        updateMotorLanes(channelUpper, parseInt(input.val()) || 2)
      } else {
        input.hide()
        updateMotorLanes(channelUpper, 1)
      }
    })

    input.on('change', function() {
      let val = parseInt($(this).val())
      if (val < 1) val = 1
      if (val > 8) val = 8
      $(this).val(val)
      if (checkbox.is(':checked')) {
        updateMotorLanes(channelUpper, val)
      }
    })
  })

  // Pattern intensity range sliders
  $("#intiface-pattern-min").on("input", function() {
    const min = parseInt($(this).val())
    $("#intiface-pattern-min-display").text(`${min}%`)
    const max = parseInt($("#intiface-pattern-max").val())
    if (min > max) {
      $("#intiface-pattern-max").val(min)
      $("#intiface-pattern-max-display").text(`${min}%`)
    }
  })

  $("#intiface-pattern-max").on("input", function() {
    const max = parseInt($(this).val())
    $("#intiface-pattern-max-display").text(`${max}%`)
    const min = parseInt($("#intiface-pattern-min").val())
    if (max < min) {
      $("#intiface-pattern-min").val(max)
      $("#intiface-pattern-min-display").text(`${max}%`)
    }
  })

  $("#intiface-pattern-cycles").on("input", function() {
    const cycles = parseInt($(this).val())
    $("#intiface-pattern-cycles-display").text(cycles)
  })

  // Initialize all channels with single motor lanes
  try {
    ['A', 'B', 'C', 'D'].forEach(channel => updateMotorLanes(channel, 1))
  } catch (e) {
    console.error(`${deps.NAME}: Error initializing motor lanes:`, e)
  }

  // Attach initial lane click handlers
  attachLaneClickHandlers()
}

// Export timeline state getters for external access
export function getTimelineBlocks() { return timelineBlocks }
export function getTimelineCurrentPosition() { return timelineCurrentPosition }
export function isTimelinePlaying() { return timelineIsPlaying }
export function getTimelineChannelFunscripts() { return timelineChannelFunscripts }

// Export category colors for external use
export { categoryColors }
