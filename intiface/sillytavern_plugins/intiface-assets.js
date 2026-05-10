const fs = require('fs')
const path = require('path')

const info = {
  id: 'intiface-assets',
  name: 'Intiface Assets',
  description: 'Asset listing/writing for Intiface extension',
}

function normalizeSlashes(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\/+/, '')
}

function ensureIntifaceRoot(userDirs) {
  const root = path.join(userDirs.assets, 'intiface')
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true })
  }
  for (const child of ['media', 'funscript', 'playmodes']) {
    const childPath = path.join(root, child)
    if (!fs.existsSync(childPath)) {
      fs.mkdirSync(childPath, { recursive: true })
    }
  }
  return root
}

function listFilesRecursive(dir) {
  const out = []
  if (!fs.existsSync(dir)) return out
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.placeholder') continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(fullPath))
    } else {
      out.push(fullPath)
    }
  }
  return out
}

function toClientAssetPath(userDirs, absPath) {
  const rel = path.relative(userDirs.root, absPath)
  return normalizeSlashes(rel)
}

function resolveSafeIntifacePath(userDirs, relativePath) {
  const intifaceRoot = ensureIntifaceRoot(userDirs)
  const normalized = normalizeSlashes(relativePath)
  if (!normalized || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    return null
  }
  const fullPath = path.resolve(path.join(intifaceRoot, normalized))
  const rootResolved = path.resolve(intifaceRoot)
  if (!fullPath.startsWith(rootResolved)) {
    return null
  }
  return { intifaceRoot: rootResolved, fullPath, normalized }
}

async function init(router) {
  console.log('[Intiface Assets Plugin] Initializing...')

  router.get('/list', async (req, res) => {
    try {
      const type = String(req.query.type || '').toLowerCase()
      const intifaceRoot = ensureIntifaceRoot(req.user.directories)

      const listForSubdir = (subdir) => {
        const base = path.join(intifaceRoot, subdir)
        return listFilesRecursive(base).map((f) => toClientAssetPath(req.user.directories, f))
      }

      if (type === 'media') {
        return res.json({ success: true, files: listForSubdir('media') })
      }

      if (type === 'funscript') {
        return res.json({ success: true, files: listForSubdir('funscript') })
      }

      if (type === 'playmodes') {
        const playmodesRoot = path.join(intifaceRoot, 'playmodes')
        const modes = []
        if (fs.existsSync(playmodesRoot)) {
          const entries = fs.readdirSync(playmodesRoot, { withFileTypes: true })
          for (const entry of entries) {
            if (!entry.isDirectory()) continue
            const modeId = entry.name
            const modeJson = path.join(playmodesRoot, modeId, 'mode.json')
            if (fs.existsSync(modeJson)) {
              modes.push(modeId)
            }
          }
        }
        modes.sort((a, b) => a.localeCompare(b))
        return res.json({ success: true, modes })
      }

      return res.status(400).json({ success: false, error: 'Invalid type. Use media|funscript|playmodes' })
    } catch (error) {
      console.error('[Intiface Assets] list error:', error)
      return res.status(500).json({ success: false, error: error.message })
    }
  })

  router.post('/write', async (req, res) => {
    try {
      const relPath = String(req.body?.path || '')
      const content = String(req.body?.content ?? '')
      const resolved = resolveSafeIntifacePath(req.user.directories, relPath)
      if (!resolved) {
        return res.status(400).json({ success: false, error: 'Invalid path' })
      }

      const ext = path.extname(resolved.fullPath).toLowerCase()
      if (!['.json', '.js', '.funscript'].includes(ext)) {
        return res.status(400).json({ success: false, error: 'Unsupported extension' })
      }

      const parent = path.dirname(resolved.fullPath)
      if (!fs.existsSync(parent)) {
        fs.mkdirSync(parent, { recursive: true })
      }

      fs.writeFileSync(resolved.fullPath, content, 'utf8')
      return res.json({ success: true, path: toClientAssetPath(req.user.directories, resolved.fullPath) })
    } catch (error) {
      console.error('[Intiface Assets] write error:', error)
      return res.status(500).json({ success: false, error: error.message })
    }
  })

  router.post('/delete', async (req, res) => {
    try {
      const relPath = String(req.body?.path || '')
      const recursive = req.body?.recursive === true
      const resolved = resolveSafeIntifacePath(req.user.directories, relPath)
      if (!resolved) {
        return res.status(400).json({ success: false, error: 'Invalid path' })
      }

      if (!fs.existsSync(resolved.fullPath)) {
        return res.status(404).json({ success: false, error: 'Path not found' })
      }

      const stat = fs.statSync(resolved.fullPath)
      if (stat.isDirectory()) {
        if (!recursive) {
          return res.status(400).json({ success: false, error: 'Directory delete requires recursive=true' })
        }
        fs.rmSync(resolved.fullPath, { recursive: true, force: true })
      } else {
        fs.unlinkSync(resolved.fullPath)
      }

      return res.json({ success: true })
    } catch (error) {
      console.error('[Intiface Assets] delete error:', error)
      return res.status(500).json({ success: false, error: error.message })
    }
  })

  console.log('[Intiface Assets Plugin] Initialized')
  console.log(' GET  /api/plugins/intiface-assets/list?type=media|funscript|playmodes')
  console.log(' POST /api/plugins/intiface-assets/write')
  console.log(' POST /api/plugins/intiface-assets/delete')
}

module.exports = { info, init }
