import { generateRaw } from '../../../../../script.js'

const STORAGE_KEY = 'intiface-custom-modes'
const ASSET_CATEGORY = 'intiface'

function loadCustomModesMap() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (_e) {
    return {}
  }
}

function saveCustomModesMap(modes) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(modes))
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function defaultPatternCode() {
  return 'return intensity;'
}

function defaultStepsJson() {
  return '[{"pattern":"sine","duration":5000,"min":20,"max":80}]'
}

function toModeToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function buildActivationTrigger(modeId, modeName = '') {
  const token = toModeToken(modeId) || toModeToken(modeName)
  if (!token) return ''
  return `/ifmode mode=${token}`
}

function toPascalCase(value) {
  return String(value || '')
    .split(/[_-]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('')
}

function buildPatternsModuleText(modeId, patterns) {
  const varName = `${toPascalCase(modeId)}Patterns`
  const entries = Object.entries(patterns || {})

  const patternLines = entries.map(([name, code]) => {
    const safeName = String(name || '').trim()
    const body = String(code || 'return intensity;').trim()
    return `  ${JSON.stringify(safeName)}: (phase, intensity) => {\n    ${body.replace(/\n/g, '\n    ')}\n  },`
  }).join('\n')

  return `/**\n * ${varName}\n * Auto-generated from Mode Builder\n */\n\nconst ${varName} = {\n${patternLines}\n};\n\nif (typeof module !== 'undefined' && module.exports) {\n  module.exports = ${varName};\n}\n\nif (typeof window !== 'undefined') {\n  window.${varName} = ${varName};\n}\n`
}

function getAuthHeaders() {
  try {
    if (typeof window !== 'undefined' && typeof window.getRequestHeaders === 'function') {
      return window.getRequestHeaders()
    }
  } catch (_e) {}
  return {}
}

async function writeAssetFile(relativePath, content) {
  const response = await fetch('/api/plugins/intiface-assets/write', {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      category: ASSET_CATEGORY,
      path: relativePath,
      content,
    }),
  })

  if (!response.ok) {
    const msg = await response.text().catch(() => '')
    throw new Error(msg || `HTTP ${response.status}`)
  }

  return await response.json().catch(() => ({ success: true }))
}

async function saveModeToAssetsFolder(modeId, modeData) {
  const modeJson = {
    id: modeId,
    name: modeData.name,
    description: modeData.description,
    intensityMultiplier: modeData.intensityMultiplier,
    ui: modeData.ui,
    aiPrompts: modeData.aiPrompts,
  }

  const sequencesJson = modeData.sequences || {}
  const patternsJs = buildPatternsModuleText(modeId, modeData.patterns || {})

  await writeAssetFile(`playmodes/${modeId}/mode.json`, `${JSON.stringify(modeJson, null, 2)}\n`)
  await writeAssetFile(`playmodes/${modeId}/sequences.json`, `${JSON.stringify(sequencesJson, null, 2)}\n`)
  await writeAssetFile(`playmodes/${modeId}/patterns.js`, patternsJs)

  return { success: true }
}

function deriveModeIdFromName(modeName) {
  return toModeToken(modeName)
}

function stripCodeFences(text) {
  const raw = String(text || '').trim()
  const fenced = raw.match(/^```(?:json|javascript|js|txt)?\s*([\s\S]*?)\s*```$/i)
  if (fenced?.[1]) return fenced[1].trim()
  return raw
}

function currentModeContextText() {
  const name = String($('#intiface-mode-name').val() || '').trim()
  const personality = String($('#intiface-mode-personality').val() || '').trim()
  const description = String($('#intiface-mode-description').val() || '').trim()
  const systemPrompt = String($('#intiface-mode-system-prompt').val() || '').trim()

  return [
    `Display Name: ${name || '(empty)'}`,
    `Personality: ${personality || '(empty)'}`,
    `Description: ${description || '(empty)'}`,
    `System Prompt: ${systemPrompt || '(empty)'}`,
  ].join('\n')
}

async function runAiAssist(systemPrompt, prompt, responseLength = 320) {
  const response = await generateRaw({ prompt, systemPrompt, responseLength })
  return stripCodeFences(response)
}

function setButtonLoading(button, loading) {
  const btn = $(button)
  if (!btn.length) return
  if (loading) {
    btn.data('original-html', btn.html())
    btn.prop('disabled', true)
    btn.html('<i class="fa-solid fa-spinner fa-spin"></i>')
  } else {
    btn.prop('disabled', false)
    btn.html(btn.data('original-html') || '<i class="fa-solid fa-wand-magic-sparkles"></i>')
  }
}

function ensureIconOption(iconClass) {
  const icon = String(iconClass || '').trim() || 'fa-star'
  const select = $('#intiface-mode-icon')
  if (!select.find(`option[value="${icon}"]`).length) {
    select.append(`<option value="${icon}">${icon.replace('fa-', '').replace(/-/g, ' ')}</option>`)
  }
}

function updateIconPreview() {
  const icon = String($('#intiface-mode-icon').val() || 'fa-star').trim() || 'fa-star'
  $('#intiface-mode-icon-preview').html(`<i class="fa-solid ${icon}"></i>`)
}

function updateModeIdPreview(modeId) {
  $('#intiface-mode-id').val(modeId)
  $('#intiface-mode-id-preview').text(modeId || '--')
}

export function initModeBuilder({ NAME, PlayModeLoader, updateStatus, onModesUpdated }) {
  let editingModeId = null

  function patternFunctionToEditorBody(patternFn) {
    if (typeof patternFn !== 'function') return defaultPatternCode()
    const src = String(patternFn).trim()

    if (src.includes('=>')) {
      const body = src.split('=>').slice(1).join('=>').trim()
      if (body.startsWith('{') && body.endsWith('}')) {
        return body.slice(1, -1).trim() || defaultPatternCode()
      }
      return `return ${body.replace(/;?\s*$/, '')};`
    }

    const match = src.match(/^[\s\S]*?\{([\s\S]*)\}$/)
    if (match?.[1]) {
      return match[1].trim() || defaultPatternCode()
    }

    return defaultPatternCode()
  }

  function getModeEditorData(modeId) {
    const localModes = loadCustomModesMap()
    if (localModes[modeId]) {
      return { mode: localModes[modeId], source: 'local' }
    }

    const mode = PlayModeLoader?.getMode?.(modeId)
    if (!mode) {
      return { mode: null, source: 'unknown' }
    }

    const loadedPatterns = PlayModeLoader?.getPatternsForMode?.(modeId) || {}
    const loadedSequences = PlayModeLoader?.getSequencesForMode?.(modeId) || {}

    const patterns = {}
    Object.entries(loadedPatterns).forEach(([name, fn]) => {
      patterns[name] = patternFunctionToEditorBody(fn)
    })

    const sequences = {}
    Object.entries(loadedSequences).forEach(([name, seq]) => {
      sequences[name] = { steps: Array.isArray(seq?.steps) ? seq.steps : [] }
    })

    return {
      source: 'assets',
      mode: {
        ...mode,
        patterns,
        sequences,
      },
    }
  }

  function getBasicReferenceBundle() {
    const basicMode = PlayModeLoader?.getMode?.('basic') || {}
    const basicPatterns = PlayModeLoader?.getPatternsForMode?.('basic') || {}
    const basicSequences = PlayModeLoader?.getSequencesForMode?.('basic') || {}

    const patternExampleName = Object.keys(basicPatterns)[0] || 'sine'
    const patternExampleBody = patternFunctionToEditorBody(basicPatterns[patternExampleName])

    const sequenceExampleName = Object.keys(basicSequences)[0] || 'intro'
    const sequenceExampleSteps = basicSequences[sequenceExampleName]?.steps || [
      { pattern: patternExampleName, min: 20, max: 80, duration: 5000, pause: 1000 },
    ]

    return {
      mode: {
        name: basicMode?.name || 'Basic',
        description: basicMode?.description || 'General purpose patterns',
        personality: basicMode?.aiPrompts?.personality || 'neutral',
        systemPrompt: basicMode?.aiPrompts?.systemPrompt || '',
      },
      pattern: {
        name: patternExampleName,
        body: patternExampleBody || 'return intensity;',
      },
      sequence: {
        name: sequenceExampleName,
        steps: sequenceExampleSteps,
      },
    }
  }

  function renderCustomModesList() {
    const localModes = loadCustomModesMap()
    const loadedModes = PlayModeLoader?.getAllModes?.() || {}
    const container = $('#intiface-custom-modes-list')
    const ids = Object.keys(loadedModes)
      .filter((id) => id !== 'basic')
      .sort((a, b) => a.localeCompare(b))

    if (ids.length === 0) {
      container.html(`
        <div style="color: #666; font-size: 0.8em; text-align: center; padding: 10px;">
          <i class="fa-solid fa-circle-info"></i> Custom modes will appear here
        </div>
      `)
      return
    }

    container.html(ids.map((id) => {
      const mode = loadedModes[id] || {}
      const name = mode?.name || id
      const color = mode?.ui?.color || '#888888'
      const isLocal = !!localModes[id]
      const sourceLabel = isLocal ? 'Local' : 'Assets'
      return `
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px; margin-bottom:6px; border:1px solid rgba(255,255,255,0.12); border-radius:4px; background: rgba(0,0,0,0.15);">
          <div style="min-width:0;">
            <div style="font-size:0.8em; color:${escapeHtml(color)}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(name)}</div>
            <div style="font-size:0.7em; color:#888;">${escapeHtml(id)} <span style="opacity:0.8;">(${sourceLabel})</span></div>
          </div>
          <div style="display:flex; gap:6px;">
            <button class="menu_button mode-edit-btn" data-mode-id="${escapeHtml(id)}" style="font-size:0.72em; padding:4px 8px;">Edit</button>
            <button class="menu_button mode-delete-btn" data-mode-id="${escapeHtml(id)}" data-source="${sourceLabel.toLowerCase()}" title="Delete mode from assets and local cache" style="font-size:0.72em; padding:4px 8px; background: rgba(255,100,100,0.2);">Delete</button>
          </div>
        </div>
      `
    }).join(''))
  }

  function addPatternRow(name = '', code = defaultPatternCode()) {
    $('#intiface-patterns-list').append(`
      <div class="mode-pattern-row" style="margin-bottom:8px; padding:8px; border:1px solid rgba(255,255,255,0.1); border-radius:4px;">
        <div style="display:flex; gap:6px; align-items:center; margin-bottom:6px;">
          <input type="text" class="text_pole pattern-name" placeholder="pattern_name" value="${escapeHtml(name)}" style="width:100%; font-size:0.75em;">
          <button class="menu_button pattern-ai-name-btn" title="AI improve pattern name" style="padding:2px 6px; font-size:0.7em; background: rgba(160,120,255,0.25);"><i class="fa-solid fa-wand-magic-sparkles"></i></button>
        </div>
        <div style="display:flex; gap:6px; align-items:flex-start;">
          <textarea class="text_pole pattern-code" style="width:100%; min-height:60px; font-size:0.72em; resize:vertical;" placeholder="JS body: return ...;">${escapeHtml(code)}</textarea>
          <button class="menu_button pattern-ai-code-btn" title="AI improve pattern code" style="padding:2px 6px; font-size:0.7em; background: rgba(160,120,255,0.25);"><i class="fa-solid fa-wand-magic-sparkles"></i></button>
        </div>
        <button class="menu_button pattern-remove-btn" title="Remove pattern" style="margin-top:6px; font-size:0.7em; padding:3px 6px; background:#c62828; color:#fff; border:1px solid rgba(255,255,255,0.18);">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    `)
  }

  function addSequenceRow(name = '', stepsJson = defaultStepsJson()) {
    $('#intiface-sequences-list').append(`
      <div class="mode-sequence-row" style="margin-bottom:8px; padding:8px; border:1px solid rgba(255,255,255,0.1); border-radius:4px;">
        <div style="display:flex; gap:6px; align-items:center; margin-bottom:6px;">
          <input type="text" class="text_pole sequence-name" placeholder="sequence_name" value="${escapeHtml(name)}" style="width:100%; font-size:0.75em;">
          <button class="menu_button sequence-ai-name-btn" title="AI improve sequence name" style="padding:2px 6px; font-size:0.7em; background: rgba(160,120,255,0.25);"><i class="fa-solid fa-wand-magic-sparkles"></i></button>
        </div>
        <div style="display:flex; gap:6px; align-items:flex-start;">
          <textarea class="text_pole sequence-steps" style="width:100%; min-height:70px; font-size:0.72em; resize:vertical;" placeholder='JSON array of steps'>${escapeHtml(stepsJson)}</textarea>
          <button class="menu_button sequence-ai-steps-btn" title="AI improve sequence steps" style="padding:2px 6px; font-size:0.7em; background: rgba(160,120,255,0.25);"><i class="fa-solid fa-wand-magic-sparkles"></i></button>
        </div>
        <button class="menu_button sequence-remove-btn" title="Remove sequence" style="margin-top:6px; font-size:0.7em; padding:3px 6px; background:#c62828; color:#fff; border:1px solid rgba(255,255,255,0.18);">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    `)
  }

  function clearEditor() {
    editingModeId = null
    updateModeIdPreview('')
    $('#intiface-mode-name').val('')
    $('#intiface-mode-description').val('')
    $('#intiface-mode-icon').val('fa-star')
    updateIconPreview()
    $('#intiface-mode-color').val('#6464ff')
    $('#intiface-mode-multiplier').val('1.0')
    $('#intiface-mode-multiplier-display').text('1.0x')
    $('#intiface-mode-system-prompt').val('')
    $('#intiface-mode-personality').val('')
    $('#intiface-patterns-list').empty()
    $('#intiface-sequences-list').empty()
  }

  function openEditor(modeId = null) {
    clearEditor()

    if (modeId) {
      const { mode } = getModeEditorData(modeId)
      if (!mode) return
      editingModeId = modeId
      $('#intiface-mode-name').val(mode.name || modeId)
      updateModeIdPreview(deriveModeIdFromName(mode.name || modeId))
      $('#intiface-mode-description').val(mode.description || '')
      ensureIconOption(mode?.ui?.icon || 'fa-star')
      $('#intiface-mode-icon').val(mode?.ui?.icon || 'fa-star')
      updateIconPreview()
      $('#intiface-mode-color').val(mode?.ui?.color || '#6464ff')
      $('#intiface-mode-multiplier').val(String(mode.intensityMultiplier ?? 1.0))
      $('#intiface-mode-multiplier-display').text(`${(mode.intensityMultiplier ?? 1.0).toFixed(1)}x`)
      $('#intiface-mode-system-prompt').val(mode?.aiPrompts?.systemPrompt || '')
      $('#intiface-mode-personality').val(mode?.aiPrompts?.personality || '')

      const patterns = mode.patterns || {}
      Object.entries(patterns).forEach(([name, code]) => addPatternRow(name, code))

      const sequences = mode.sequences || {}
      Object.entries(sequences).forEach(([name, seq]) => {
        const steps = Array.isArray(seq?.steps) ? seq.steps : []
        addSequenceRow(name, JSON.stringify(steps, null, 2))
      })
    }

    if (!modeId) {
      updateModeIdPreview(deriveModeIdFromName($('#intiface-mode-name').val()))
      updateIconPreview()
    }

    $('#intiface-mode-editor').show()
  }

  async function refreshModesAndUi() {
    try {
      if (PlayModeLoader?.refresh) {
        await PlayModeLoader.refresh()
      }
      if (typeof onModesUpdated === 'function') {
        await onModesUpdated()
      }
    } catch (e) {
      console.error(`${NAME}: Failed to refresh mode UI:`, e)
    }
  }

  async function saveModeFromEditor() {
    const modeName = String($('#intiface-mode-name').val() || '').trim()
    if (!modeName) {
      updateStatus('Display Name is required', true)
      return
    }

    let modeId = deriveModeIdFromName(modeName)
    if (!modeId) {
      updateStatus('Display Name must contain letters or numbers', true)
      return
    }

    const modes = loadCustomModesMap()
    const loadedModes = PlayModeLoader?.getAllModes?.() || {}
    if (editingModeId !== modeId && (modes[modeId] || loadedModes[modeId])) {
      let suffix = 2
      while (modes[`${modeId}_${suffix}`] || loadedModes[`${modeId}_${suffix}`]) {
        suffix++
      }
      modeId = `${modeId}_${suffix}`
    }
    updateModeIdPreview(modeId)
    const patterns = {}
    let patternInvalid = false
    $('#intiface-patterns-list .mode-pattern-row').each(function () {
      const name = String($(this).find('.pattern-name').val() || '').trim()
      const code = String($(this).find('.pattern-code').val() || '').trim()
      if (!name && !code) return
      if (!name || !code) {
        patternInvalid = true
        return
      }
      patterns[name] = code
    })

    if (patternInvalid) {
      updateStatus('Each pattern needs both a name and code', true)
      return
    }

    const sequences = {}
    let sequenceError = null
    $('#intiface-sequences-list .mode-sequence-row').each(function () {
      const name = String($(this).find('.sequence-name').val() || '').trim()
      const json = String($(this).find('.sequence-steps').val() || '').trim()
      if (!name && !json) return
      if (!name) {
        sequenceError = 'Each sequence needs a name'
        return
      }
      try {
        const steps = JSON.parse(json)
        if (!Array.isArray(steps)) {
          sequenceError = `Sequence ${name} steps must be a JSON array`
          return
        }
        sequences[name] = { steps }
      } catch (_e) {
        sequenceError = `Invalid JSON in sequence ${name}`
      }
    })

    if (sequenceError) {
      updateStatus(sequenceError, true)
      return
    }

    const multiplier = parseFloat(String($('#intiface-mode-multiplier').val() || '1.0')) || 1.0
    const activationTrigger = buildActivationTrigger(modeId, modeName)

    const modeData = {
      name: modeName,
      description: String($('#intiface-mode-description').val() || '').trim(),
      intensityMultiplier: multiplier,
      ui: {
        icon: String($('#intiface-mode-icon').val() || 'fa-star').trim(),
        color: String($('#intiface-mode-color').val() || '#6464ff').trim(),
        toggleable: true,
        defaultEnabled: false,
      },
      aiPrompts: {
        systemPrompt: String($('#intiface-mode-system-prompt').val() || '').trim(),
        activationTrigger,
        personality: String($('#intiface-mode-personality').val() || '').trim(),
      },
      patterns,
      sequences,
    }

    if (editingModeId && editingModeId !== modeId) {
      delete modes[editingModeId]
    }
    modes[modeId] = modeData
    saveCustomModesMap(modes)

    try {
      await saveModeToAssetsFolder(modeId, modeData)
    } catch (e) {
      console.warn(`${NAME}: Failed to write mode to assets folder:`, e)
      updateStatus(`Saved mode locally (asset export failed: ${e?.message || 'unknown error'})`, true)
    }

    $('#intiface-mode-editor').hide()
    renderCustomModesList()
    refreshModesAndUi()
    updateStatus(`Saved custom mode: ${modeData.name}`)
  }

  async function deleteMode(modeId) {
    const modes = loadCustomModesMap()
    const hadLocal = !!modes[modeId]
    if (hadLocal) {
      delete modes[modeId]
    }
    saveCustomModesMap(modes)

    try {
      const response = await fetch('/api/plugins/intiface-assets/delete', {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          category: ASSET_CATEGORY,
          path: `playmodes/${modeId}`,
          recursive: true,
        }),
      })

      if (!response.ok && response.status !== 404) {
        const msg = await response.text().catch(() => '')
        throw new Error(msg || `HTTP ${response.status}`)
      }
    } catch (e) {
      console.warn(`${NAME}: Failed deleting asset mode folder ${modeId}:`, e)
      if (!hadLocal) {
        updateStatus(`Delete failed: ${e?.message || 'unknown error'}`, true)
        return
      }
    }

    renderCustomModesList()
    await refreshModesAndUi()
    updateStatus(`Deleted custom mode: ${modeId}`)
  }

  function exportModes() {
    const modes = loadCustomModesMap()
    const blob = new Blob([JSON.stringify(modes, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'intiface-custom-modes.json'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    updateStatus('Exported custom modes')
  }

  function importModes(file) {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const imported = JSON.parse(String(reader.result || '{}'))
        if (!imported || typeof imported !== 'object') {
          updateStatus('Invalid import file format', true)
          return
        }
        const current = loadCustomModesMap()
        saveCustomModesMap({ ...current, ...imported })
        renderCustomModesList()
        refreshModesAndUi()
        updateStatus('Imported custom modes')
      } catch (_e) {
        updateStatus('Failed to import modes: invalid JSON', true)
      }
    }
    reader.readAsText(file)
  }

  $(document)
    .off('click.intifaceModeBuilderCreate', '#intiface-create-mode-btn')
    .on('click.intifaceModeBuilderCreate', '#intiface-create-mode-btn', () => openEditor())

  $(document)
    .off('click.intifaceModeBuilderSave', '#intiface-save-mode-btn')
    .on('click.intifaceModeBuilderSave', '#intiface-save-mode-btn', saveModeFromEditor)

  $(document)
    .off('click.intifaceModeBuilderCancel', '#intiface-cancel-mode-btn')
    .on('click.intifaceModeBuilderCancel', '#intiface-cancel-mode-btn', () => {
      $('#intiface-mode-editor').hide()
      clearEditor()
    })

  $(document)
    .off('click.intifaceModeBuilderAddPattern', '#intiface-add-pattern-btn')
    .on('click.intifaceModeBuilderAddPattern', '#intiface-add-pattern-btn', () => addPatternRow())

  $(document)
    .off('click.intifaceModeBuilderAddSequence', '#intiface-add-sequence-btn')
    .on('click.intifaceModeBuilderAddSequence', '#intiface-add-sequence-btn', () => addSequenceRow())

  $(document)
    .off('click.intifaceModeBuilderRemovePattern', '.pattern-remove-btn')
    .on('click.intifaceModeBuilderRemovePattern', '.pattern-remove-btn', function () {
      $(this).closest('.mode-pattern-row').remove()
    })

  $(document)
    .off('click.intifaceModeBuilderRemoveSequence', '.sequence-remove-btn')
    .on('click.intifaceModeBuilderRemoveSequence', '.sequence-remove-btn', function () {
      $(this).closest('.mode-sequence-row').remove()
    })

  $(document)
    .off('click.intifaceModeBuilderEdit', '.mode-edit-btn')
    .on('click.intifaceModeBuilderEdit', '.mode-edit-btn', function () {
      openEditor($(this).data('mode-id'))
    })

  $(document)
    .off('click.intifaceModeBuilderDelete', '.mode-delete-btn')
    .on('click.intifaceModeBuilderDelete', '.mode-delete-btn', async function () {
      await deleteMode($(this).data('mode-id'))
    })

  $(document)
    .off('click.intifaceModeBuilderExport', '#intiface-export-modes-btn')
    .on('click.intifaceModeBuilderExport', '#intiface-export-modes-btn', exportModes)

  $(document)
    .off('click.intifaceModeBuilderImport', '#intiface-import-modes-btn')
    .on('click.intifaceModeBuilderImport', '#intiface-import-modes-btn', () => $('#intiface-import-file').trigger('click'))

  $(document)
    .off('change.intifaceModeBuilderImportFile', '#intiface-import-file')
    .on('change.intifaceModeBuilderImportFile', '#intiface-import-file', function () {
      const file = this.files?.[0]
      if (!file) return
      importModes(file)
      $(this).val('')
    })

  $(document)
    .off('input.intifaceModeBuilderMultiplier', '#intiface-mode-multiplier')
    .on('input.intifaceModeBuilderMultiplier', '#intiface-mode-multiplier', function () {
      const val = parseFloat(String($(this).val() || '1.0')) || 1.0
      $('#intiface-mode-multiplier-display').text(`${val.toFixed(1)}x`)
    })

  $(document)
    .off('click.intifaceModeBuilderFieldAi', '.mode-ai-wand')
    .on('click.intifaceModeBuilderFieldAi', '.mode-ai-wand', async function () {
      const button = this
      const target = String($(this).data('target') || '')
      const kind = String($(this).data('kind') || 'field')
      const field = $(target)
      if (!field.length) return

      setButtonLoading(button, true)
      try {
        const basicRef = getBasicReferenceBundle()
        const current = String(field.val() || '').trim()
        const system = 'You are an assistant helping author an Intiface play mode. Return only the requested field text, with no markdown or code fences.'
        const prompt = `Mode context:\n${currentModeContextText()}\n\nBasic mode reference:\n- Name: ${basicRef.mode.name}\n- Personality: ${basicRef.mode.personality || '(empty)'}\n- Description: ${basicRef.mode.description}\n\nTarget field: ${kind}\nCurrent value: ${current || '(empty)'}\n\nReturn an improved value that fits the mode.`
        const result = await runAiAssist(system, prompt, 300)
        if (result) {
          field.val(result)
          field.trigger('input')
          updateStatus('AI suggestion applied')
        }
      } catch (e) {
        console.warn(`${NAME}: AI field assist failed:`, e)
        updateStatus('AI assist failed for field', true)
      } finally {
        setButtonLoading(button, false)
      }
    })

  $(document)
    .off('click.intifaceModeBuilderPatternNameAi', '.pattern-ai-name-btn')
    .on('click.intifaceModeBuilderPatternNameAi', '.pattern-ai-name-btn', async function () {
      const button = this
      const row = $(this).closest('.mode-pattern-row')
      const input = row.find('.pattern-name')
      setButtonLoading(button, true)
      try {
        const basicRef = getBasicReferenceBundle()
        const current = String(input.val() || '').trim()
        const prompt = `Mode context:\n${currentModeContextText()}\n\nBasic pattern name example: ${basicRef.pattern.name}\n\nCurrent pattern name: ${current || '(empty)'}\nReturn a concise snake_case pattern name only.`
        const result = await runAiAssist('Return only a snake_case waveform pattern name.', prompt, 120)
        if (result) {
          input.val(toModeToken(result))
          updateStatus('Pattern name updated')
        }
      } catch (e) {
        updateStatus('AI assist failed for pattern name', true)
      } finally {
        setButtonLoading(button, false)
      }
    })

  $(document)
    .off('click.intifaceModeBuilderPatternCodeAi', '.pattern-ai-code-btn')
    .on('click.intifaceModeBuilderPatternCodeAi', '.pattern-ai-code-btn', async function () {
      const button = this
      const row = $(this).closest('.mode-pattern-row')
      const name = String(row.find('.pattern-name').val() || '').trim()
      const codeEl = row.find('.pattern-code')
      const currentCode = String(codeEl.val() || '').trim() || defaultPatternCode()
      setButtonLoading(button, true)
      try {
        const basicRef = getBasicReferenceBundle()
        const prompt = `Mode context:\n${currentModeContextText()}\n\nBasic pattern reference (${basicRef.pattern.name}) JS body:\n${basicRef.pattern.body}\n\nPattern name: ${name || '(unnamed)'}\nCurrent JS body:\n${currentCode}\n\nReturn ONLY JavaScript function body code using variables phase and intensity, and include a return statement. Keep style compatible with the basic pattern example.`
        const result = await runAiAssist('Return only JavaScript function body code. No markdown.', prompt, 450)
        if (result) {
          codeEl.val(stripCodeFences(result))
          updateStatus('Pattern code updated')
        }
      } catch (e) {
        updateStatus('AI assist failed for pattern code', true)
      } finally {
        setButtonLoading(button, false)
      }
    })

  $(document)
    .off('click.intifaceModeBuilderSequenceNameAi', '.sequence-ai-name-btn')
    .on('click.intifaceModeBuilderSequenceNameAi', '.sequence-ai-name-btn', async function () {
      const button = this
      const row = $(this).closest('.mode-sequence-row')
      const input = row.find('.sequence-name')
      setButtonLoading(button, true)
      try {
        const basicRef = getBasicReferenceBundle()
        const current = String(input.val() || '').trim()
        const prompt = `Mode context:\n${currentModeContextText()}\n\nBasic sequence name example: ${basicRef.sequence.name}\n\nCurrent sequence name: ${current || '(empty)'}\nReturn a concise snake_case sequence name only.`
        const result = await runAiAssist('Return only a snake_case sequence name.', prompt, 120)
        if (result) {
          input.val(toModeToken(result))
          updateStatus('Sequence name updated')
        }
      } catch (e) {
        updateStatus('AI assist failed for sequence name', true)
      } finally {
        setButtonLoading(button, false)
      }
    })

  $(document)
    .off('click.intifaceModeBuilderSequenceStepsAi', '.sequence-ai-steps-btn')
    .on('click.intifaceModeBuilderSequenceStepsAi', '.sequence-ai-steps-btn', async function () {
      const button = this
      const row = $(this).closest('.mode-sequence-row')
      const stepsEl = row.find('.sequence-steps')
      const sequenceName = String(row.find('.sequence-name').val() || '').trim()
      const current = String(stepsEl.val() || '').trim() || defaultStepsJson()
      const patternNames = $('#intiface-patterns-list .pattern-name').map(function () {
        return String($(this).val() || '').trim()
      }).get().filter(Boolean)

      setButtonLoading(button, true)
      try {
        const basicRef = getBasicReferenceBundle()
        const prompt = `Mode context:\n${currentModeContextText()}\n\nBasic sequence steps reference (${basicRef.sequence.name}):\n${JSON.stringify(basicRef.sequence.steps, null, 2)}\n\nSequence name: ${sequenceName || '(unnamed)'}\nAvailable patterns: ${patternNames.join(', ') || 'sine'}\nCurrent steps JSON array:\n${current}\n\nReturn ONLY a JSON array of step objects with keys: pattern, min, max, duration, pause. Keep values realistic and varied, and compatible with basic reference structure.`
        const result = await runAiAssist('Return only valid JSON array. No markdown or explanation.', prompt, 700)
        const parsed = JSON.parse(stripCodeFences(result))
        if (!Array.isArray(parsed)) {
          throw new Error('AI response was not an array')
        }
        stepsEl.val(JSON.stringify(parsed, null, 2))
        updateStatus('Sequence steps updated')
      } catch (e) {
        console.warn(`${NAME}: AI sequence steps assist failed:`, e)
        updateStatus('AI assist failed for sequence steps', true)
      } finally {
        setButtonLoading(button, false)
      }
    })

  $(document)
    .off('input.intifaceModeBuilderModeName', '#intiface-mode-name')
    .on('input.intifaceModeBuilderModeName', '#intiface-mode-name', function () {
      const modeName = $('#intiface-mode-name').val()
      updateModeIdPreview(deriveModeIdFromName(modeName))
    })

  $(document)
    .off('change.intifaceModeBuilderIcon', '#intiface-mode-icon')
    .on('change.intifaceModeBuilderIcon', '#intiface-mode-icon', function () {
      updateIconPreview()
    })

  renderCustomModesList()
  updateIconPreview()
  console.log(`${NAME}: Mode builder initialized`)
}
