import { SlashCommandParser } from '../../../../slash-commands/SlashCommandParser.js'
import { SlashCommand } from '../../../../slash-commands/SlashCommand.js'
import { ARGUMENT_TYPE, SlashCommandNamedArgument } from '../../../../slash-commands/SlashCommandArgument.js'
import { SlashCommandEnumValue } from '../../../../slash-commands/SlashCommandEnumValue.js'
import { macros as macroSystem } from '../../../../macros/macro-system.js'
import { MacrosParser } from '../../../../macros.js'
import { power_user } from '../../../../power-user.js'

const registeredDynamicMacroKeys = new Set()
let slashCommandsInitialized = false

function safeToken(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '')
}

function uniquePatternNames(playModeLoader) {
  const allPatterns = playModeLoader?.getAllPatterns?.() || {}
  const names = new Set()
  Object.values(allPatterns).forEach((modePatterns) => {
    Object.keys(modePatterns || {}).forEach((patternName) => names.add(patternName))
  })
  return [...names].sort((a, b) => a.localeCompare(b))
}

function modeEnumProvider(playModeLoader) {
  return () => Object.keys(playModeLoader?.getAllModes?.() || {})
    .sort((a, b) => a.localeCompare(b))
    .map((modeId) => new SlashCommandEnumValue(modeId, playModeLoader?.getMode?.(modeId)?.description || null))
}

function patternEnumProvider(playModeLoader) {
  return () => uniquePatternNames(playModeLoader).map((name) => new SlashCommandEnumValue(name, null))
}

function parseIntOr(value, fallback) {
  const parsed = parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function ensureSlashCommands({ PlayModeLoader, executeCommand, updateStatus }) {
  if (slashCommandsInitialized) return

  if (!SlashCommandParser.commands.ifmode) {
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
      name: 'ifmode',
      aliases: ['intiface-mode'],
      namedArgumentList: [
        SlashCommandNamedArgument.fromProps({
          name: 'mode',
          description: 'Mode id',
          typeList: [ARGUMENT_TYPE.STRING],
          isRequired: true,
          enumProvider: modeEnumProvider(PlayModeLoader),
        }),
        SlashCommandNamedArgument.fromProps({
          name: 'sequence',
          description: 'Sequence name (optional)',
          typeList: [ARGUMENT_TYPE.STRING],
          isRequired: false,
        }),
        SlashCommandNamedArgument.fromProps({
          name: 'device',
          description: 'Device index',
          typeList: [ARGUMENT_TYPE.NUMBER],
          isRequired: false,
        }),
      ],
      callback: async (args) => {
        const modeId = String(args.mode || '').trim().toLowerCase()
        if (!modeId) return ''

        const modeSequences = PlayModeLoader?.getSequencesForMode?.(modeId) || {}
        const sequenceNames = Object.keys(modeSequences)
        const selectedSequence = String(args.sequence || sequenceNames[0] || '').trim().toLowerCase()

        if (!selectedSequence || !modeSequences[selectedSequence]) {
          updateStatus(`No sequence found for mode: ${modeId}`, true)
          return ''
        }

        const deviceIndex = clamp(parseIntOr(args.device, 0), 0, 128)
        await executeCommand({
          type: modeId,
          modeName: selectedSequence,
          deviceIndex,
        })
        updateStatus(`Mode ${modeId}:${selectedSequence} on device ${deviceIndex}`)
        return ''
      },
      helpString: 'Run an Intiface mode sequence. Example: /ifmode mode=denial sequence=edge device=0',
    }))
  }

  if (!SlashCommandParser.commands.ifpattern) {
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
      name: 'ifpattern',
      aliases: ['intiface-pattern'],
      namedArgumentList: [
        SlashCommandNamedArgument.fromProps({
          name: 'pattern',
          description: 'Pattern name',
          typeList: [ARGUMENT_TYPE.STRING],
          isRequired: true,
          enumProvider: patternEnumProvider(PlayModeLoader),
        }),
        SlashCommandNamedArgument.fromProps({ name: 'min', description: 'Min intensity (0-100)', typeList: [ARGUMENT_TYPE.NUMBER], isRequired: false }),
        SlashCommandNamedArgument.fromProps({ name: 'max', description: 'Max intensity (0-100)', typeList: [ARGUMENT_TYPE.NUMBER], isRequired: false }),
        SlashCommandNamedArgument.fromProps({ name: 'duration', description: 'Duration ms', typeList: [ARGUMENT_TYPE.NUMBER], isRequired: false }),
        SlashCommandNamedArgument.fromProps({ name: 'cycles', description: 'Cycle count', typeList: [ARGUMENT_TYPE.NUMBER], isRequired: false }),
        SlashCommandNamedArgument.fromProps({ name: 'device', description: 'Device index', typeList: [ARGUMENT_TYPE.NUMBER], isRequired: false }),
      ],
      callback: async (args) => {
        const pattern = String(args.pattern || '').trim().toLowerCase()
        if (!pattern) return ''

        const deviceIndex = clamp(parseIntOr(args.device, 0), 0, 128)
        const min = clamp(parseIntOr(args.min, 20), 0, 100)
        const max = clamp(parseIntOr(args.max, 80), 0, 100)
        const duration = clamp(parseIntOr(args.duration, 5000), 100, 300000)
        const cycles = clamp(parseIntOr(args.cycles, 3), 1, 500)

        await executeCommand({
          type: 'waveform',
          pattern,
          min,
          max,
          duration,
          cycles,
          deviceIndex,
        })

        updateStatus(`Pattern ${pattern} on device ${deviceIndex}`)
        return ''
      },
      helpString: 'Run an Intiface waveform pattern. Example: /ifpattern pattern=sine min=20 max=80 duration=5000 cycles=3',
    }))
  }

  slashCommandsInitialized = true
}

function unregisterDynamicMacros() {
  registeredDynamicMacroKeys.forEach((key) => {
    try {
      if (power_user.experimental_macro_engine) {
        macroSystem.registry.unregisterMacro(key)
      } else {
        MacrosParser.unregisterMacro(key)
      }
    } catch (_e) {}
  })
  registeredDynamicMacroKeys.clear()
}

function registerDynamicMacro(key, description, handler) {
  if (!key) return

  if (power_user.experimental_macro_engine) {
    if (macroSystem.registry.hasMacro(key)) {
      try {
        macroSystem.registry.unregisterMacro(key)
      } catch (_e) {}
    }

    macroSystem.registry.registerMacro(key, {
      category: macroSystem.category?.STATE || 'state',
      description,
      handler,
    })
  } else {
    try {
      if (MacrosParser.has(key)) {
        MacrosParser.unregisterMacro(key)
      }
    } catch (_e) {}
    MacrosParser.registerMacro(key, () => String(handler() ?? ''), description)
  }

  registeredDynamicMacroKeys.add(key)
}

function refreshDynamicMacros({ PlayModeLoader }) {
  unregisterDynamicMacros()

  const modeIds = Object.keys(PlayModeLoader?.getAllModes?.() || {}).sort((a, b) => a.localeCompare(b))
  const patterns = uniquePatternNames(PlayModeLoader)

  registerDynamicMacro('if_modes', 'Comma-separated available Intiface mode IDs', () => modeIds.join(', '))
  registerDynamicMacro('if_patterns', 'Comma-separated available Intiface pattern names', () => patterns.join(', '))

  patterns.forEach((patternName) => {
    const token = safeToken(patternName)
    registerDynamicMacro(
      `if_pattern_${token}`,
      `Pattern name macro for ${patternName}`,
      () => patternName,
    )
  })

  modeIds.forEach((modeId) => {
    const modeToken = safeToken(modeId)
    const modeSequences = PlayModeLoader?.getSequencesForMode?.(modeId) || {}
    const sequenceNames = Object.keys(modeSequences).sort((a, b) => a.localeCompare(b))
    const defaultSequence = sequenceNames[0] || ''

    registerDynamicMacro(
      `if_sequences_${modeToken}`,
      `Comma-separated sequence names for mode ${modeId}`,
      () => sequenceNames.join(', '),
    )

    registerDynamicMacro(
      `if_default_sequence_${modeToken}`,
      `Default sequence for mode ${modeId}`,
      () => defaultSequence,
    )

    registerDynamicMacro(
      `if_cmd_${modeToken}`,
      `Default command tag for mode ${modeId}`,
      () => defaultSequence ? `<any:${modeId.toUpperCase()}: ${defaultSequence}>` : '',
    )
  })
}

export function initDynamicCommands({ PlayModeLoader, executeCommand, updateStatus }) {
  ensureSlashCommands({ PlayModeLoader, executeCommand, updateStatus })
  refreshDynamicMacros({ PlayModeLoader })

  return {
    refresh: () => {
      refreshDynamicMacros({ PlayModeLoader })
    },
  }
}
