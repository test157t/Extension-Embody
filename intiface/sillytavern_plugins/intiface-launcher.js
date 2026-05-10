// SillyTavern Server Plugin for Intiface Central Launcher

const { spawn, spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const info = {
  id: 'intiface-launcher',
  name: 'Intiface Central Launcher',
  description: 'Starts Intiface Central and manages Intiface proxy only',
}

let proxyProcess = null
const PROXY_PORT = 12346

async function startProxy() {
  if (proxyProcess) {
    return { success: true, port: PROXY_PORT, pid: proxyProcess.pid }
  }

  const proxyScriptPath = path.join(__dirname, 'intiface-proxy.js')
  if (!fs.existsSync(proxyScriptPath)) {
    throw new Error(`Proxy script not found: ${proxyScriptPath}`)
  }

  return new Promise((resolve, reject) => {
    try {
      proxyProcess = spawn('node', [proxyScriptPath], {
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      proxyProcess.stdout.on('data', (data) => {
        console.log(`[Intiface Proxy] ${data.toString().trim()}`)
      })

      proxyProcess.stderr.on('data', (data) => {
        console.error(`[Intiface Proxy Error] ${data.toString().trim()}`)
      })

      proxyProcess.on('error', (err) => {
        proxyProcess = null
        reject(err)
      })

      proxyProcess.on('exit', () => {
        proxyProcess = null
      })

      setTimeout(() => {
        if (proxyProcess?.pid) {
          resolve({ success: true, port: PROXY_PORT, pid: proxyProcess.pid })
        } else {
          reject(new Error('Proxy failed to start'))
        }
      }, 1000)
    } catch (err) {
      reject(err)
    }
  })
}

async function stopProxy() {
  if (!proxyProcess) {
    return { success: true, message: 'Proxy not running' }
  }

  return new Promise((resolve) => {
    proxyProcess.kill('SIGTERM')

    setTimeout(() => {
      if (proxyProcess) {
        try {
          proxyProcess.kill('SIGKILL')
        } catch (_e) {}
        proxyProcess = null
      }
      resolve({ success: true, message: 'Proxy stopped' })
    }, 2000)
  })
}

function browseIntifaceExecutable() {
  const platform = process.platform

  if (platform === 'win32') {
    const psScript = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$dialog = New-Object System.Windows.Forms.OpenFileDialog',
      '$dialog.Filter = "Executable files (*.exe)|*.exe|All files (*.*)|*.*"',
      '$dialog.Title = "Select IntifaceCentral.exe"',
      '$defaultDir = Join-Path $env:ProgramFiles "Intiface"',
      'if (Test-Path $defaultDir) { $dialog.InitialDirectory = $defaultDir }',
      '$result = $dialog.ShowDialog()',
      'if ($result -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.FileName }',
    ].join('; ')

    const proc = spawnSync('powershell.exe', ['-NoProfile', '-Command', psScript], { encoding: 'utf8' })
    if (proc.error) throw proc.error
    return (proc.stdout || '').trim() || null
  }

  if (platform === 'darwin') {
    const proc = spawnSync('osascript', ['-e', 'POSIX path of (choose file with prompt "Select Intiface app/executable")'], { encoding: 'utf8' })
    if (proc.error) throw proc.error
    return (proc.stdout || '').trim() || null
  }

  const proc = spawnSync('zenity', ['--file-selection', '--title=Select Intiface executable'], { encoding: 'utf8' })
  if (proc.error) throw proc.error
  return (proc.stdout || '').trim() || null
}

async function init(router) {
  console.log('[Intiface Launcher Plugin] Initializing...')

  router.post('/proxy/start', async (_req, res) => {
    try {
      const result = await startProxy()
      res.json(result)
    } catch (error) {
      console.error('[Intiface Launcher] Proxy start error:', error)
      res.status(500).json({ success: false, error: error.message })
    }
  })

  router.post('/proxy/stop', async (_req, res) => {
    try {
      const result = await stopProxy()
      res.json(result)
    } catch (error) {
      console.error('[Intiface Launcher] Proxy stop error:', error)
      res.status(500).json({ success: false, error: error.message })
    }
  })

  router.get('/proxy/status', (_req, res) => {
    res.json({ success: true, running: proxyProcess !== null, port: PROXY_PORT })
  })

  router.get('/browse-exe', async (_req, res) => {
    try {
      const selectedPath = browseIntifaceExecutable()
      if (!selectedPath) {
        return res.json({ success: true, cancelled: true, path: null })
      }
      return res.json({ success: true, path: selectedPath })
    } catch (error) {
      console.error('[Intiface Launcher] Browse executable error:', error)
      return res.status(500).json({ success: false, error: error.message })
    }
  })

  router.post('/start', async (req, res) => {
    try {
      const exePath = String(req.body?.exePath || '')

      if (!exePath) {
        return res.status(400).json({ success: false, error: 'No executable path provided' })
      }

      if (!exePath.endsWith('.exe') && !exePath.endsWith('.app')) {
        return res.status(400).json({ success: false, error: 'Path must point to an executable file' })
      }

      const platform = process.platform
      let pid = null

      if (platform === 'win32') {
        const psScript = [
          `$shell = New-Object -ComObject WScript.Shell`,
          `$shell.Run('"${exePath.replace(/'/g, "''")}"', 7, $false)`,
          `Start-Sleep -Milliseconds 500`,
          `Write-Output 'started'`,
        ].join('; ')

        const proc = spawnSync('powershell.exe', ['-NoProfile', '-Command', psScript], { encoding: 'utf8', windowsHide: true })
        if (proc.error) {
          return res.status(500).json({ success: false, error: proc.error.message })
        }
        return res.json({ success: true, message: 'Intiface Central started (minimized, no focus steal)' })
      }

      const intifaceProcess = spawn(exePath, [], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })

      intifaceProcess.on('error', (err) => {
        console.error('[Intiface Launcher] Failed to start:', err.message)
      })

      intifaceProcess.unref()
      pid = intifaceProcess.pid

      await new Promise(resolve => setTimeout(resolve, 500))

      if (pid && !intifaceProcess.killed) {
        return res.json({ success: true, message: 'Intiface Central started', pid })
      }

      return res.status(500).json({ success: false, error: 'Process failed to start' })
    } catch (error) {
      console.error('[Intiface Launcher] Error:', error)
      return res.status(500).json({ success: false, error: error.message })
    }
  })

  console.log('[Intiface Launcher Plugin] Initialized')
  console.log('[Intiface Launcher] Endpoints:')
  console.log(' POST /api/plugins/intiface-launcher/start')
  console.log(' POST /api/plugins/intiface-launcher/proxy/start')
  console.log(' POST /api/plugins/intiface-launcher/proxy/stop')
  console.log(' GET  /api/plugins/intiface-launcher/proxy/status')
  console.log(' GET  /api/plugins/intiface-launcher/browse-exe')
}

module.exports = { info, init }
