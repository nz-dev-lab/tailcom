import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { WebSocket } from 'ws'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ClientConfig {
  name: string
  ip: string
  port: number
}

interface TailcomConfig {
  dashboardId: string
  clients: ClientConfig[]
}

interface ClientStatus extends ClientConfig {
  id: string
  online: boolean
}

interface CallState {
  active: boolean
  clientId: string | null
  clientName: string | null
  isMuted: boolean
  startedAt: number | null
}

interface SignalMessage {
  type: string
  [key: string]: unknown
}

// ── State ─────────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let config: TailcomConfig = { dashboardId: 'developer-laptop', clients: [] }
let clients: ClientStatus[] = []
let pollTimer: ReturnType<typeof setInterval> | null = null

let callState: CallState = {
  active: false,
  clientId: null,
  clientName: null,
  isMuted: false,
  startedAt: null,
}

// Active call WebSocket (signalling only — WebRTC lives in renderer)
let callSocket: WebSocket | null = null

// ── Config ────────────────────────────────────────────────────────────────────

const configPath = path.join(__dirname, '..', '..', 'tailcom.config.json')

function loadConfig(): void {
  try {
    const raw = fs.readFileSync(configPath, 'utf-8')
    config = JSON.parse(raw) as TailcomConfig
    clients = config.clients.map((c, i) => ({
      ...c,
      id: `client-${i}`,
      online: false,
    }))
  } catch {
    // Use defaults if file missing
  }
}

function saveConfig(newConfig: TailcomConfig): void {
  config = newConfig
  fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2))
  clients = newConfig.clients.map((c, i) => ({
    ...c,
    id: `client-${i}`,
    online: clients.find((x) => x.id === `client-${i}`)?.online ?? false,
  }))
  sendClientsUpdate()
}

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 380,
    height: 540,
    resizable: false,
    maximizable: false,
    alwaysOnTop: true,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const rendererPath = path.join(__dirname, '..', 'src', 'index.html')
  void mainWindow.loadFile(rendererPath)

  mainWindow.on('close', (e) => {
    e.preventDefault()
    mainWindow?.hide()
  })
}

// ── Tray ──────────────────────────────────────────────────────────────────────

function createTray(): void {
  const icon = nativeImage.createEmpty()
  tray = new Tray(icon)
  tray.setToolTip('tailcom')

  const menu = Menu.buildFromTemplate([
    {
      label: 'Show',
      click: () => {
        mainWindow?.show()
        mainWindow?.focus()
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.exit(0) },
  ])

  tray.setContextMenu(menu)
  tray.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow?.show()
      mainWindow?.focus()
    }
  })
}

// ── Online/offline polling ────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 5000
const PING_TIMEOUT_MS = 2000

async function pingClient(client: ClientStatus): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      ws.terminate()
      resolve(false)
    }, PING_TIMEOUT_MS)

    const ws = new WebSocket(`ws://${client.ip}:${client.port}`)

    ws.on('open', () => ws.send(JSON.stringify({ type: 'ping' })))

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as { type: string }
        if (msg.type === 'pong' && !settled) {
          settled = true
          clearTimeout(timer)
          ws.close()
          resolve(true)
        }
      } catch { /* ignore */ }
    })

    ws.on('error', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(false)
    })
  })
}

function startPolling(): void {
  pollTimer = setInterval(async () => {
    let changed = false
    for (const client of clients) {
      const online = await pingClient(client)
      if (client.online !== online) {
        client.online = online
        changed = true
      }
    }
    if (changed) sendClientsUpdate()
  }, POLL_INTERVAL_MS)
}

// ── IPC helpers ───────────────────────────────────────────────────────────────

function sendClientsUpdate(): void {
  mainWindow?.webContents.send('clients:update', clients)
}

function sendCallState(): void {
  mainWindow?.webContents.send('call:state', callState)
}

// ── Call teardown ─────────────────────────────────────────────────────────────

function teardownCall(): void {
  // Notify renderer to teardown WebRTC
  mainWindow?.webContents.send('ws:close')

  if (callSocket) {
    try {
      if (callSocket.readyState === WebSocket.OPEN) {
        callSocket.send(JSON.stringify({ type: 'hangup' }))
        callSocket.close()
      }
    } catch { /* ignore */ }
    callSocket = null
  }

  callState = {
    active: false,
    clientId: null,
    clientName: null,
    isMuted: false,
    startedAt: null,
  }
  sendCallState()
}

// ── Call start (WebSocket only — WebRTC handled by renderer) ──────────────────

function startCall(client: ClientStatus): { ok: boolean; reason?: string } {
  if (callSocket) return { ok: false, reason: 'already in call' }

  const ws = new WebSocket(`ws://${client.ip}:${client.port}`)
  callSocket = ws

  ws.on('open', () => {
    // Tell renderer to start WebRTC — renderer creates offer, sends back via ws:send
    mainWindow?.webContents.send('ws:open', client.id, client.name)

    callState = {
      active: true,
      clientId: client.id,
      clientName: client.name,
      isMuted: false,
      startedAt: Date.now(),
    }
    sendCallState()
  })

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString()) as SignalMessage
      if (msg.type === 'hangup') {
        teardownCall()
      } else {
        // Forward answer / ice-candidate to renderer WebRTC
        mainWindow?.webContents.send('ws:message', msg)
      }
    } catch { /* ignore */ }
  })

  ws.on('close', () => teardownCall())
  ws.on('error', () => teardownCall())

  return { ok: true }
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('call:start', (_event, clientId: string) => {
  if (callState.active) return { ok: false, reason: 'already in call' }

  const client = clients.find((c) => c.id === clientId)
  if (!client) return { ok: false, reason: 'client not found' }
  if (!client.online) return { ok: false, reason: 'client offline' }

  return startCall(client)
})

ipcMain.handle('call:hangup', () => {
  teardownCall()
})

ipcMain.handle('call:mute', (_event, muted: boolean) => {
  callState.isMuted = muted
  sendCallState()
})

// Renderer sends a WebRTC signalling message — forward over WebSocket to client
ipcMain.handle('ws:send', (_event, msg: unknown) => {
  if (callSocket?.readyState === WebSocket.OPEN) {
    callSocket.send(JSON.stringify(msg))
  }
})

ipcMain.handle('config:save', (_event, newConfig: unknown) => {
  try {
    saveConfig(newConfig as TailcomConfig)
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: String(err) }
  }
})

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  loadConfig()
  createWindow()
  createTray()
  startPolling()

  mainWindow?.webContents.on('did-finish-load', () => {
    sendClientsUpdate()
    sendCallState()
  })
})

app.on('before-quit', () => {
  if (pollTimer) clearInterval(pollTimer)
  teardownCall()
})

app.on('window-all-closed', (e: Event) => {
  e.preventDefault()
})
