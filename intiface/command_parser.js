/**
 * Command Parser Module
 * Parses AI commands from chat messages
 */

import { PlayModeLoader } from './_loader.js'

let NAME = 'intiface-connect'

const TARGET_SENTINEL_ANY_CHANNEL = -1
const TARGET_SENTINEL_CHANNEL_A = -101
const TARGET_SENTINEL_CHANNEL_B = -102
const TARGET_SENTINEL_CHANNEL_C = -103
const TARGET_SENTINEL_CHANNEL_D = -104

function decodeCommandEntities(text) {
  return String(text || '')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
}

function normalizeCommandTextForMatch(text) {
  return String(text || '')
    .replace(/\r?\n+/g, ' ')
    .replace(/^[\s`"'*_\-–—.,;:!?()\[\]{}]+|[\s`"'*_\-–—.,;:!?()\[\]{}]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

const RESERVED_COMMAND_PREFIXES = new Set([
  'waveform', 'dual', 'gradient', 'vibrate', 'oscillate', 'linear', 'pattern',
  'preset', 'stop', 'start', 'connect', 'disconnect', 'scan', 'media', 'interface',
])

function parseCommandNumberOption(text, key, fallback) {
  const escapedKey = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`${escapedKey}\\s*[=:]\\s*(\\d+)`, 'i')
  const match = String(text || '').match(regex)
  if (!match) return fallback
  const value = Number.parseInt(match[1], 10)
  return Number.isFinite(value) ? value : fallback
}

function parseExplicitWaveformCommand(commandText, targetDeviceIndex) {
  const source = String(commandText || '')
  if (!/\bWAVEFORM\b/i.test(source)) return null

  const afterKeyword = source.replace(/^.*?\bWAVEFORM\b\s*[:\-]?\s*/i, '').trim()
  const patternMatch = afterKeyword.match(/^([a-z0-9_\-]+)/i)
  const pattern = String(patternMatch?.[1] || '').trim().toLowerCase()
  if (!pattern) return null
  if (pattern === 'waveform') return null
  if (pattern === 'mode') {
    const modeMatch = source.match(/\bmode\s*[=:]\s*([a-z0-9_\-]+)/i)
    const modeName = String(modeMatch?.[1] || '').trim().toLowerCase()
    if (!modeName) return null

    return {
      type: 'waveform',
      pattern: modeName,
      min: parseCommandNumberOption(source, 'min', 20),
      max: parseCommandNumberOption(source, 'max', 80),
      duration: parseCommandNumberOption(source, 'duration', 5000),
      cycles: parseCommandNumberOption(source, 'cycles', 3),
      deviceIndex: targetDeviceIndex,
    }
  }

  return {
    type: 'waveform',
    pattern,
    min: parseCommandNumberOption(source, 'min', 20),
    max: parseCommandNumberOption(source, 'max', 80),
    duration: parseCommandNumberOption(source, 'duration', 5000),
    cycles: parseCommandNumberOption(source, 'cycles', 3),
    deviceIndex: targetDeviceIndex,
  }
}

function normalizeDeviceName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim()
}

function resolveTargetDeviceIndex(tagName) {
  const normalizedTag = normalizeDeviceName(tagName)
  if (!normalizedTag || normalizedTag === 'any') return TARGET_SENTINEL_ANY_CHANNEL
  if (normalizedTag === 'a' || normalizedTag === 'channela') return TARGET_SENTINEL_CHANNEL_A
  if (normalizedTag === 'b' || normalizedTag === 'channelb') return TARGET_SENTINEL_CHANNEL_B
  if (normalizedTag === 'c' || normalizedTag === 'channelc') return TARGET_SENTINEL_CHANNEL_C
  if (normalizedTag === 'd' || normalizedTag === 'channeld') return TARGET_SENTINEL_CHANNEL_D
  if (['interface', 'system', 'intiface', 'media'].includes(normalizedTag)) return 0

  try {
    const liveDevices = Array.isArray(window?.devices) ? window.devices : []
    if (!liveDevices.length) return 0

    // Explicit index selectors: <device2:...>, <toy1:...>
    const numericMatch = normalizedTag.match(/(?:device|toy)(\d{1,2})$/)
    if (numericMatch) {
      const idx = Math.max(0, Number.parseInt(numericMatch[1], 10) - 1)
      if (Number.isInteger(idx) && idx >= 0 && idx < liveDevices.length) {
        return idx
      }
    }

    for (let i = 0; i < liveDevices.length; i++) {
      const dev = liveDevices[i]
      const candidates = [
        normalizeDeviceName(dev?.displayName),
        normalizeDeviceName(dev?.name),
      ].filter(Boolean)

      if (candidates.some((name) => name === normalizedTag || name.includes(normalizedTag) || normalizedTag.includes(name))) {
        return i
      }
    }
  } catch (_e) {}

  return 0
}

/**
 * Parse device commands from text
 * @param {string} text - Text to parse
  * @param {boolean} skipModeCommands - Whether to skip parsing mode commands
  * @returns {Array} Array of command objects
  */
export function parseDeviceCommands(text, skipModeCommands = false) {
  const commands = []
  const sourceText = decodeCommandEntities(text)

  // Match both inline and block tags.
  // Inline: <interface:SCAN>
  // Block: <interface>SCAN</interface>
  const inlineTagRegex = /<([^<>\n:][^<>:\n]*?)\s*:\s*([\s\S]*?)>/gi
  const blockTagRegex = /<([^<>\n:][^<>:\n]*?)\s*>([\s\S]*?)<\/\s*\1\s*>/gi
  const tagMatches = []

  let match
  while ((match = inlineTagRegex.exec(sourceText)) !== null) {
    tagMatches.push({
      index: Number(match.index) || 0,
      tagName: String(match[1] || '').trim().toLowerCase(),
      tagContent: String(match[2] || '').trim(),
    })
  }
  while ((match = blockTagRegex.exec(sourceText)) !== null) {
    tagMatches.push({
      index: Number(match.index) || 0,
      tagName: String(match[1] || '').trim().toLowerCase(),
      tagContent: String(match[2] || '').trim(),
    })
  }

  tagMatches.sort((a, b) => a.index - b.index)

  for (const tagMatch of tagMatches) {
    const tagName = tagMatch.tagName
    const tagContent = tagMatch.tagContent
    if (!tagName || !tagContent) continue

    // Resolve target device from tag name when possible, fallback to first device.
    let targetDeviceIndex = resolveTargetDeviceIndex(tagName)

    // Support explicit mode tags, e.g. <basic: warmup> or <frustration: fairy_dust_tickle>
    // before generic command parsing paths.
    if (!skipModeCommands && PlayModeLoader && PlayModeLoader.getModeNames) {
      const knownModes = PlayModeLoader.getModeNames().map((m) => String(m || '').toLowerCase())
      if (knownModes.includes(tagName)) {
        const requestedModeName = String(tagContent || '').trim().toLowerCase()
        if (requestedModeName && PlayModeLoader.getSequence && PlayModeLoader.getSequence(tagName, requestedModeName)) {
          commands.push({
            type: tagName,
            modeName: requestedModeName,
            deviceIndex: targetDeviceIndex,
          })
          continue
        }

      }
    }

    // Support explicit device selector format inside generic device tags:
    // <device:XBox:VIBRATE:80> -> target "XBox", command "VIBRATE:80"
    // <deviceName:Adorime Chastity Cage:OSCILLATE:40> -> same behavior
    let effectiveTagContent = tagContent
    if (tagName === 'device' || tagName === 'devicename' || tagName === 'device_name') {
      const selectorParts = tagContent.split(':')
      if (selectorParts.length >= 2) {
        const maybeSelector = String(selectorParts[0] || '').trim()
        const resolvedSelectorIndex = resolveTargetDeviceIndex(maybeSelector)
        const remainder = selectorParts.slice(1).join(':').trim()
        if (remainder) {
          targetDeviceIndex = resolvedSelectorIndex
          effectiveTagContent = remainder
        }
      }
    }

    // Handle MODE:COMMAND format (e.g., <any:BASIC: pulse>)
    // Only split if the first part is a known PlayModeLoader mode
    const colonParts = effectiveTagContent.split(':')
    let rawCommandText = effectiveTagContent
    let modePrefix = ''

    if (colonParts.length >= 2) {
      const potentialMode = colonParts[0].trim().toUpperCase()
      // Check if this is actually a known PlayModeLoader mode
      if (PlayModeLoader && PlayModeLoader.getModeNames) {
        const knownModes = PlayModeLoader.getModeNames()
        if (knownModes.includes(potentialMode.toLowerCase())) {
          modePrefix = potentialMode
          rawCommandText = colonParts.slice(1).join(':').trim()
        }
      }
      // Also allow explicit "WAVEFORM:", "VIBRATE:", etc. as the command itself (not a mode)
      // Don't treat them as mode prefixes - they'll be parsed as commands
    }

    const commandText = rawCommandText.toUpperCase()
    const normalizedCommandText = normalizeCommandTextForMatch(rawCommandText)

    const explicitWaveform = parseExplicitWaveformCommand(rawCommandText, targetDeviceIndex)
    if (explicitWaveform) {
      commands.push(explicitWaveform)
      continue
    }

    // Check for STOP command first
    if (/^(STOP|HALT|END)$/.test(normalizedCommandText)) {
      commands.push({ type: 'stop', deviceIndex: targetDeviceIndex })
      continue
    }

    // Accept interface lifecycle commands even when model uses a generic tag
    // like <any:SCAN> or wraps command text with punctuation/newlines.
    if (/^START\b/.test(normalizedCommandText)) {
      commands.push({ type: 'interface_start' })
      continue
    }
    if (/^CONNECT\b/.test(normalizedCommandText)) {
      commands.push({ type: 'interface_connect' })
      continue
    }
    if (/^DISCONNECT\b/.test(normalizedCommandText)) {
      commands.push({ type: 'interface_disconnect' })
      continue
    }
    if (/^SCAN\b/.test(normalizedCommandText)) {
      commands.push({ type: 'interface_scan' })
      continue
    }

    // Try flexible parse on the command content
    const flexibleCommands = tryFlexibleParse(rawCommandText, targetDeviceIndex, sourceText, modePrefix, skipModeCommands)
    if (flexibleCommands.length > 0) {
      commands.push(...flexibleCommands)
      continue
    }

    // If the tag explicitly used a mode prefix (e.g. BASIC: ...), and mode
    // resolution produced no valid command, do not reinterpret the remainder
    // as waveform/preset/intensity fallback text.
    if (!skipModeCommands && modePrefix) {
      continue
    }

    // Check for INTERFACE system commands (start, connect, disconnect)
    if (tagName === 'interface' || tagName === 'system' || tagName === 'intiface') {
      if (/^START\b/.test(normalizedCommandText)) {
        commands.push({ type: 'interface_start' })
        continue
      }
      if (/^CONNECT\b/.test(normalizedCommandText)) {
        commands.push({ type: 'interface_connect' })
        continue
      }
      if (/^DISCONNECT\b/.test(normalizedCommandText)) {
        commands.push({ type: 'interface_disconnect' })
        continue
      }
      if (/^SCAN\b/.test(normalizedCommandText)) {
        commands.push({ type: 'interface_scan' })
        continue
      }
    }

    // Check for MEDIA commands
    if (tagName === 'media') {
      if (/^LIST\b/.test(normalizedCommandText)) {
        commands.push({ type: 'media_list' })
        continue
      }
      if (/^STOP\b/.test(normalizedCommandText)) {
        commands.push({ type: 'media_stop' })
        continue
      }
      if (/^PAUSE\b/.test(normalizedCommandText)) {
        commands.push({ type: 'media_pause' })
        continue
      }
      if (/^(RESUME|PLAY)\b$/.test(normalizedCommandText)) {
        commands.push({ type: 'media_resume' })
        continue
      }
      // Parse PLAY command with filename
      const playMatch = rawCommandText.match(/PLAY[\s:]+(.+)/i)
      if (playMatch) {
        const cleanedFilename = playMatch[1]
          .trim()
          .replace(/^['"`]+|['"`]+$/g, '')
          .replace(/^[*_]+|[*_]+$/g, '')
        commands.push({
          type: 'media_play',
          filename: cleanedFilename
        })
        continue
      }
      // Parse INTENSITY command for funscript
      const intensityMatch = commandText.match(/INTENSITY[\s:]+(\d+)/i)
      if (intensityMatch) {
        const intensity = parseInt(intensityMatch[1])
        if (intensity >= 0 && intensity <= 500) {
          commands.push({
            type: 'media_intensity',
            intensity: intensity
          })
        } else {
          console.debug(`${NAME}: Ignoring out-of-range media intensity: ${intensity}%`)
        }
        continue
      }
    }

    // Parse PRESET command
    const presetMatch = commandText.match(/PRESET[\s:]+(\w+)/i)
    if (presetMatch) {
      commands.push({
        type: 'preset',
        presetName: presetMatch[1].toLowerCase(),
        deviceIndex: targetDeviceIndex
      })
      continue
    }

    // Parse mode commands dynamically from PlayModeLoader (skip during streaming)
    if (!skipModeCommands && PlayModeLoader) {
      const enabledModes = PlayModeLoader.getEnabledModes ? PlayModeLoader.getEnabledModes() : []
      for (const modeId of enabledModes) {
        const modeData = PlayModeLoader.modes[modeId]
        if (!modeData) continue
        if (RESERVED_COMMAND_PREFIXES.has(String(modeId || '').toLowerCase())) continue

        // Build regex from mode ID (convert snake_case to UPPER_SNAKE_CASE)
        const modePrefix = modeId.toUpperCase().replace(/_/g, '_')
        const regex = new RegExp(`${modePrefix}\\s*[:\\s]\\s*([\\w_]+)`, 'i')
        const match = commandText.match(regex)

        if (match) {
          const modeName = match[1].toLowerCase()
          // Validate sequence exists before queuing
          const sequence = PlayModeLoader.getSequence ? PlayModeLoader.getSequence(modeId, modeName) : null
          if (sequence) {
            commands.push({
              type: modeId,
              modeName: modeName,
              deviceIndex: targetDeviceIndex
            })
          } else {
            console.debug(`${NAME}: Mode command matched ${modeId}:${modeName} but sequence not found -`, PlayModeLoader.getSequencesForMode ? `Available sequences: ${Object.keys(PlayModeLoader.getSequencesForMode(modeId) || {}).join(', ')}` : 'PlayModeLoader not ready')
          }
          break // Found a match, no need to check other modes
        }
      }
    }

    // Parse DUAL command (independent motor patterns)
    const dualMatch = commandText.match(/DUAL[\s:]+pattern1[=:]?(\w+)(?:[\s,]+pattern2[=:]?(\w+))?(?:[\s,]+min[=:]?(\d+))?(?:[\s,]+max[=:]?(\d+))?(?:[\s,]+duration[=:]?(\d+))?(?:[\s,]+cycles[=:]?(\d+))?/i)
    if (dualMatch) {
      commands.push({
        type: 'dual_waveform',
        pattern1: dualMatch[1].toLowerCase(),
        pattern2: dualMatch[2] ? dualMatch[2].toLowerCase() : dualMatch[1].toLowerCase(),
        min: dualMatch[3] ? parseInt(dualMatch[3]) : 20,
        max: dualMatch[4] ? parseInt(dualMatch[4]) : 80,
        duration: dualMatch[5] ? parseInt(dualMatch[5]) : 5000,
        cycles: dualMatch[6] ? parseInt(dualMatch[6]) : 3,
        deviceIndex: targetDeviceIndex
      })
      continue
    }

    // Parse WAVEFORM command
    const waveformMatch = commandText.match(/WAVEFORM\s*[:\-]?\s*([a-z0-9_\-]+)/i)
    if (waveformMatch) {
      const min = parseCommandNumberOption(commandText, 'min', 20)
      const max = parseCommandNumberOption(commandText, 'max', 80)
      const duration = parseCommandNumberOption(commandText, 'duration', 5000)
      const cycles = parseCommandNumberOption(commandText, 'cycles', 3)
      let pattern = String(waveformMatch[1] || '').toLowerCase()
      if (pattern === 'mode') {
        const modeMatch = rawCommandText.match(/\bmode\s*[=:]\s*([a-z0-9_\-]+)/i)
        const modeName = String(modeMatch?.[1] || '').trim().toLowerCase()
        if (!modeName) {
          continue
        }
        pattern = modeName
      }
      if (!pattern || pattern === 'waveform') {
        const fallback = parseExplicitWaveformCommand(rawCommandText, targetDeviceIndex)
        if (fallback) {
          commands.push(fallback)
          continue
        }
      }
      commands.push({
        type: 'waveform',
        pattern,
        min,
        max,
        duration,
        cycles,
        deviceIndex: targetDeviceIndex
      })
      continue
    }

    // Parse GRADIENT command
    const gradientMatch = commandText.match(/GRADIENT[\s:]+start[=:]?(\d+)(?:[\s,]+end[=:]?(\d+))(?:[\s,]+duration[=:]?(\d+))?(?:[\s,]+hold[=:]?(\d+))?(?:[\s,]+release[=:]?(\d+))?/i)
    if (gradientMatch) {
      commands.push({
        type: 'gradient',
        start: parseInt(gradientMatch[1]),
        end: parseInt(gradientMatch[2]),
        duration: gradientMatch[3] ? parseInt(gradientMatch[3]) : 10000,
        hold: gradientMatch[4] ? parseInt(gradientMatch[4]) : 0,
        release: gradientMatch[5] ? parseInt(gradientMatch[5]) : 0,
        deviceIndex: targetDeviceIndex
      })
      continue
    }

    // Parse INTENSITY command for AI to set global intensity
    const intensityMatch = commandText.match(/INTENSITY[\s:]+(\d+)/i)
    if (intensityMatch) {
      commands.push({
        type: 'set_intensity',
        intensity: Math.max(0, Math.min(400, parseInt(intensityMatch[1]))),
        deviceIndex: targetDeviceIndex
      })
      continue
    }

    // Parse VIBRATE command
    const vibrateMatch = commandText.match(/VIBRATE[:\s]+(\d+)/i)
    if (vibrateMatch) {
      commands.push({
        type: 'vibrate',
        intensity: Math.max(0, Math.min(100, parseInt(vibrateMatch[1]))),
        motorIndex: 0,
        deviceIndex: targetDeviceIndex
      })
      continue
    }

    // Parse OSCILLATE command
    const oscillateMatch = commandText.match(/OSCILLATE[:\s]+(\d+)/i)
    if (oscillateMatch) {
      commands.push({
        type: 'oscillate',
        intensity: Math.max(0, Math.min(100, parseInt(oscillateMatch[1]))),
        deviceIndex: targetDeviceIndex
      })
      continue
    }

    // Parse LINEAR command
    const linearMatch = commandText.match(/LINEAR[:\s]+start[=:\s]*(\d+)[,\s]+end[=:\s]*(\d+)[,\s]+duration[=:\s]*(\d+)/i)
    if (linearMatch) {
      commands.push({
        type: 'linear',
        startPos: parseInt(linearMatch[1]),
        endPos: parseInt(linearMatch[2]),
        duration: parseInt(linearMatch[3]),
        deviceIndex: targetDeviceIndex
      })
      continue
    }

    // Parse PATTERN command
    const patternMatch = commandText.match(/PATTERN[:\s]+\[([^\]]+)\](?:[,\s]+interval[=:\s]+\[([^\]]+)\])?(?:[,\s]+loop[=:\s]*(\d+))?/i)
    if (patternMatch) {
      const intensities = patternMatch[1].split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n))
      const intervals = patternMatch[2]
        ? patternMatch[2].split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n))
        : [1000]
      const loop = patternMatch[3] ? parseInt(patternMatch[3]) : undefined

      if (intensities.length > 0) {
        commands.push({
          type: 'vibrate_pattern',
          pattern: intensities,
          intervals: intervals,
          loop: loop,
          deviceIndex: targetDeviceIndex
        })
      }
      continue
    }

    // Try old JSON format as fallback
    try {
      const jsonText = commandText.startsWith('{') ? commandText : `{${commandText}}`
      const command = JSON.parse(jsonText)

      if (command.VIBRATE !== undefined) {
        if (typeof command.VIBRATE === 'number') {
          commands.push({
            type: 'vibrate',
            intensity: Math.max(0, Math.min(100, command.VIBRATE)),
            motorIndex: 0,
            deviceIndex: targetDeviceIndex
          })
        } else if (typeof command.VIBRATE === 'object') {
          commands.push({
            type: 'vibrate_pattern',
            pattern: command.VIBRATE.pattern || [50],
            intervals: command.VIBRATE.interval || [1000],
            loop: command.VIBRATE.loop,
            deviceIndex: targetDeviceIndex
          })
        }
      }

      if (command.OSCILLATE !== undefined) {
        if (typeof command.OSCILLATE === 'number') {
          commands.push({
            type: 'oscillate',
            intensity: Math.max(0, Math.min(100, command.OSCILLATE)),
            deviceIndex: targetDeviceIndex
          })
        } else if (typeof command.OSCILLATE === 'object') {
          commands.push({
            type: 'oscillate_pattern',
            pattern: command.OSCILLATE.pattern || [50],
            intervals: command.OSCILLATE.interval || [1000],
            loop: command.OSCILLATE.loop,
            deviceIndex: targetDeviceIndex
          })
        }
      }

      if (command.LINEAR !== undefined && typeof command.LINEAR === 'object') {
        commands.push({
          type: 'linear',
          startPos: command.LINEAR.start_position || 0,
          endPos: command.LINEAR.end_position || 100,
          duration: command.LINEAR.duration || 1000,
          deviceIndex: targetDeviceIndex
        })
      }

      if (command.STOP !== undefined) {
        commands.push({ type: 'stop' })
      }
    } catch (e) {
      // Try flexible parsing: extract KEY=VALUE pairs from anywhere in the command
      const flexibleParsed = tryFlexibleParse(commandText, targetDeviceIndex, sourceText)
      if (flexibleParsed.length > 0) {
        commands.push(...flexibleParsed)
      } else {
        console.debug(`${NAME}: Unrecognized command format: ${commandText}`)
      }
    }
  }

  return commands
}

/**
 * Flexible parser: extract valid commands from partial/unknown formats
 * Parses KEY=VALUE, KEY:VALUE, KEY VALUE formats anywhere in text
 * Also handles MODE:COMMAND format (e.g., "BASIC: pulse")
 */
function tryFlexibleParse(commandText, targetDeviceIndex, sourceText, modePrefix = '', skipModeCommands = false) {
  const commands = []
  const upper = commandText.toUpperCase()

  // Handle MODE:COMMAND format (e.g., "BASIC: pulse" or "VIBRATE: 50")
  let effectiveCommand = commandText
  let effectivePrefix = modePrefix
  let hadExplicitPrefix = false

  const colonParts = commandText.split(':')
  if (colonParts.length >= 2) {
    const firstPart = colonParts[0].trim().toUpperCase()
    const secondPart = colonParts.slice(1).join(':').trim()
    // If first part looks like a mode or action keyword, treat it as prefix
    if (/^(BASIC|PULSE|VIBRATE|WAVE|OSCILLATE|THROB|TEASE|CLICK|SHARP|SOFT|GENTLE|FAST|SLOW|STOP)$/i.test(firstPart)) {
      hadExplicitPrefix = true
      effectivePrefix = firstPart
      effectiveCommand = secondPart
    }
  }

  const effectiveUpper = effectiveCommand.toUpperCase()

  // Try PlayModeLoader mode commands (e.g., "BASIC: pulse")
  if (effectivePrefix && !skipModeCommands && PlayModeLoader) {
    const modeId = effectivePrefix.toLowerCase()
    const modeName = effectiveCommand.toLowerCase().trim()
    if (modeName && PlayModeLoader.getSequence && PlayModeLoader.getSequence(modeId, modeName)) {
      commands.push({
        type: modeId,
        modeName: modeName,
        deviceIndex: targetDeviceIndex
      })
      return commands
    }

    // If an explicit mode prefix was provided (e.g. BASIC:foo) but the
    // sequence is invalid, do not reinterpret it as a waveform pattern.
    if (modeName && PlayModeLoader.getMode && PlayModeLoader.getMode(modeId)) {
      return commands
    }
  }

  // If the model used an explicit mode-like prefix but we couldn't resolve
  // it to a valid mode sequence, do not reinterpret as waveform.
  const explicitModeLikePrefix = String(effectivePrefix || '').toLowerCase() === 'basic' ||
    (!!PlayModeLoader?.getMode && !!PlayModeLoader.getMode(String(effectivePrefix || '').toLowerCase()))
  if (!skipModeCommands && hadExplicitPrefix && explicitModeLikePrefix) {
    return commands
  }

  // Check for standalone commands: PULSE, VIBRATE, WAVE, etc. (with optional numeric value)
  const standaloneMatch = effectiveCommand.match(/^(PULSE|VIBRATE|OSCILLATE|THROB|TEASE|CLICK|EDGE|WAVE)\s*(\d+)?\s*$/i) ||
                          effectiveCommand.match(/^(PULSE|VIBRATE|OSCILLATE|THROB|TEASE|CLICK|EDGE|WAVE)\s*$/i)
  if (standaloneMatch) {
    const action = standaloneMatch[1].toUpperCase()
    const value = standaloneMatch[2] ? parseInt(standaloneMatch[2]) : null

    if (action === 'STOP' || action === 'HALT') {
      commands.push({ type: 'stop', deviceIndex: targetDeviceIndex })
      return commands
    }

    if (value !== null) {
      // PULSE 50 or VIBRATE 50
      commands.push({
        type: 'vibrate',
        intensity: Math.max(0, Math.min(100, value)),
        motorIndex: 0,
        deviceIndex: targetDeviceIndex
      })
    } else {
      // Just PULSE, WAVE, etc. - treat as waveform pattern
      commands.push({
        type: 'waveform',
        pattern: action.toLowerCase(),
        min: 30,
        max: 70,
        duration: 5000,
        cycles: 3,
        deviceIndex: targetDeviceIndex
      })
    }
    return commands
  }

  // Extract pattern name - prefer PATTERN=xxx, fall back to bare keyword
  let pattern = null
  const explicitPatternMatch = effectiveCommand.match(/PATTERN\s*[=:]\s*(\w+)/i)
  if (explicitPatternMatch) {
    pattern = explicitPatternMatch[1].toLowerCase()
  } else {
    // Look for bare pattern keywords anywhere in text
    const barePatternMatch = effectiveCommand.match(/\b(PULSE|WAVE|THROB|TEASE|CLICK|GENTLE|CRESCENDO|RAMP|HEARTBEAT|SHARP|SOFT|EDGE|BUILD|RUIN|SINE|SQUARE|SAWTOOTH|RAMP_UP|RAMP_DOWN)\b/gi)
    if (barePatternMatch) {
      pattern = barePatternMatch[0].toLowerCase().replace(/pattern\s*=\s*/i, '')
    } else {
      // Check if first word (before comma/space) looks like a pattern name
      const firstWordMatch = effectiveCommand.match(/^([a-z_][a-z0-9_]*)\b/i)
      if (firstWordMatch) {
        const firstWord = firstWordMatch[1].toLowerCase()
        // If it's not a keyword and not in the skip list, treat as pattern
        const skipWords = ['waveform', 'mode', 'min', 'max', 'duration', 'cycles', 'intensity', 'intensity_level', 'start', 'end', 'loop', 'interval', 'on', 'off', 'low', 'medium', 'high', 'max', 'moderate', 'firm', 'soft', 'gentle', 'intense', 'variable', 'slow', 'fast', 'sharp', 'gentle']
        if (!skipWords.includes(firstWord) && firstWord.length > 2) {
          pattern = firstWord
        }
      }
    }
  }

  // Extract duration (handles 10S, 10s, 10000ms, etc)
  const durationMatch = effectiveCommand.match(/DURATION\s*[=:]\s*(\d+)\s*(MS|S|M)?/i) ||
                        effectiveCommand.match(/(\d+)\s*(?:SECOND|S|S\b)/i)
  let duration = 5000 // default
  if (durationMatch) {
    let val = parseInt(durationMatch[1])
    const unit = (durationMatch[2] || '').toUpperCase()
    if (unit === 'MS') {
      duration = val
    } else if (unit === 'M') {
      duration = val * 60 * 1000
    } else if (unit === 'S') {
      duration = val * 1000
    } else {
      duration = val >= 1000 ? val : val * 1000
    }
  }

  // Extract cycles
  const cyclesMatch = effectiveCommand.match(/CYCLES\s*[=:]\s*(\d+)/i)
  let cycles = cyclesMatch ? parseInt(cyclesMatch[1]) : 3

  // Extract min/max intensity
  const minMatch = effectiveCommand.match(/MIN\s*[=:]\s*(\d+)/i)
  const maxMatch = effectiveCommand.match(/MAX\s*[=:]\s*(\d+)/i)
  let min = minMatch ? parseInt(minMatch[1]) : 20
  let max = maxMatch ? parseInt(maxMatch[1]) : 80

  // Extract intensity level (LOW=20, MEDIUM=50, HIGH=80, MAX=100, MODERATE=35-55)
  const intensityLevelMatch = effectiveCommand.match(/INTENSITY\s*[=:]\s*(\w+)/i)
  if (intensityLevelMatch) {
    const level = intensityLevelMatch[1].toUpperCase()
    if (level === 'OFF' || level === 'NONE') { min = 0; max = 0 }
    else if (level === 'LOW' || level === 'SOFT' || level === 'GENTLE') { min = 10; max = 30 }
    else if (level === 'MODERATE' || level === 'MEDIUM' || level === 'MID') { min = 35; max = 55 }
    else if (level === 'HIGH' || level === 'FIRM' || level === 'STRONG') { min = 65; max = 85 }
    else if (level === 'MAX' || level === 'INTENSE' || level === 'FULL' || level === 'VARIABLE') { min = 85; max = 100 }
  }

  // Check for numeric intensity (INTENSITY=50)
  const numericIntensityMatch = effectiveCommand.match(/INTENSITY\s*[=:]\s*(\d+)/i)
  if (numericIntensityMatch) {
    const intensity = parseInt(numericIntensityMatch[1])
    if (intensity <= 100) {
      commands.push({
        type: 'vibrate',
        intensity: Math.max(0, Math.min(100, intensity)),
        motorIndex: 0,
        deviceIndex: targetDeviceIndex
      })
    }
  }

  // If we found a pattern, create waveform command
  if (pattern && !['low', 'medium', 'high', 'max', 'on', 'off', 'moderate', 'firm', 'soft', 'gentle', 'intense', 'variable'].includes(pattern)) {
    commands.push({
      type: 'waveform',
      pattern: pattern,
      min: min,
      max: max,
      duration: duration,
      cycles: cycles,
      deviceIndex: targetDeviceIndex
    })
  }

  // Check for VIBRATE with key=value format
  const vibrateMatch = effectiveCommand.match(/VIBRATE\s*[=:\s]+(\d+)/i)
  if (vibrateMatch) {
    commands.push({
      type: 'vibrate',
      intensity: Math.max(0, Math.min(100, parseInt(vibrateMatch[1]))),
      motorIndex: 0,
      deviceIndex: targetDeviceIndex
    })
  }

  // Check for OSCILLATE
  const oscillateMatch = effectiveCommand.match(/OSCILLATE\s*[=:\s]+(\d+)/i)
  if (oscillateMatch) {
    commands.push({
      type: 'oscillate',
      intensity: Math.max(0, Math.min(100, parseInt(oscillateMatch[1]))),
      deviceIndex: targetDeviceIndex
    })
  }

  // Check for STOP
  if (/STOP|END|HALT/i.test(effectiveCommand)) {
    commands.push({ type: 'stop', deviceIndex: targetDeviceIndex })
  }

  return commands
}

/**
 * Set the module name for logging
 */
export function setParserName(name) {
  NAME = name
}

// Default export
export default {
  parseDeviceCommands,
  setParserName
}
