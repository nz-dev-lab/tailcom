import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { WebSocket } from 'ws'

// Load wrtc for WebRTC in Electron main (Node) process
// eslint-disable-next-line @typescript-eslint/no-require-imports
const wrtc = require('@roamhq/wrtc') as {
  RTCPeerConnection: typeof RTCPeerConnection
  RTCSessionDescription: typeof RTCSessionDescription
  RTCIceCandidate: typeof RTCIceCandidate
  nonstandard: {
    RTCAudioSource: new () => {
      createTrack(): MediaStreamTrack
      onData(data: AudioSample): void
    }
    RTCAudioSink: new (track: MediaStreamTrack) => {
      ondata: ((data: AudioSample) => void) | null
      stop(): void
    }
  }
}

interface AudioSample {
  samples: Int16Array
  sampleRate: number
  bitsPerSample: number
  channelCount: number
  numberOfFrames: number
}

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
  type: 'pong' | 'answer' | 'ice-candidate' | 'hangup'
  sdp?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit
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

// Active call handles
let callSocket: WebSocket | null = null
let peerConnection: RTCPeerConnection | null = null
let micSource: { createTrack(): MediaStreamTrack; onData(d: AudioSample): void } | null = null
let audioSink: { ondata: ((d: AudioSample) => void) | null; stop(): void } | null = null
let silenceTimer: ReturnType<typeof setInterval> | null = null

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
  // Stop silence pump
  if (silenceTimer) {
    clearInterval(silenceTimer)
    silenceTimer = null
  }

  // Stop audio sink
  if (audioSink) {
    try { audioSink.stop() } catch { /* ignore */ }
    audioSink = null
  }
  micSource = null

  // Close peer connection
  if (peerConnection) {
    try { peerConnection.close() } catch { /* ignore */ }
    peerConnection = null
  }

  // Close signalling socket
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

// ── Call start (WebRTC offerer) ───────────────────────────────────────────────

async function startCall(client: ClientStatus): Promise<{ ok: boolean; reason?: string }> {
  const ws = new WebSocket(`ws://${client.ip}:${client.port}`)
  callSocket = ws

  return new Promise((resolve) => {
    let resolved = false

    function fail(reason: string) {
      if (resolved) return
      resolved = true
      teardownCall()
      resolve({ ok: false, reason })
    }

    ws.on('error', (err) => fail(err.message))
    ws.on('close', () => {
      if (!resolved) teardownCall()
    })

    ws.on('open', async () => {
      try {
        // Create peer connection (no STUN/TURN — direct Tailscale IP)
        const pc = new wrtc.RTCPeerConnection({ iceServers: [] })
        peerConnection = pc

        // Create a mic audio source track (RTCAudioSource = wrtc nonstandard)
        // Pushes silence by default; real mic capture needs a system audio lib.
        const source = new wrtc.nonstandard.RTCAudioSource()
        micSource = source
        const micTrack = source.createTrack()
        pc.addTrack(micTrack)

        // Pump silence so the track stays alive
        const SAMPLE_RATE = 48000
        const FRAME_MS = 10
        const FRAMES = (SAMPLE_RATE * FRAME_MS) / 1000 // 480
        const silenceBuf = new Int16Array(FRAMES)
        silenceTimer = setInterval(() => {
          if (!callState.isMuted) {
            source.onData({
              samples: silenceBuf,
              sampleRate: SAMPLE_RATE,
              bitsPerSample: 16,
              channelCount: 1,
              numberOfFrames: FRAMES,
            })
          }
        }, FRAME_MS)

        // Receive incoming audio from client
        pc.ontrack = (event: RTCTrackEvent) => {
          if (event.track.kind !== 'audio') return
          const sink = new wrtc.nonstandard.RTCAudioSink(event.track)
          audioSink = sink
          // Audio frames arrive via sink.ondata — wire to speaker here when ready
          sink.ondata = null
        }

        // Forward local ICE candidates to client
        pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
          if (event.candidate && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'ice-candidate',
              candidate: event.candidate.toJSON(),
            }))
          }
        }

        pc.onconnectionstatechange = () => {
          if (
            pc.connectionState === 'disconnected' ||
            pc.connectionState === 'failed' ||
            pc.connectionState === 'closed'
          ) {
            teardownCall()
          }
        }

        // Handle messages from client (answer, ice-candidate, hangup)
        ws.on('message', (data) => {
          let msg: SignalMessage
          try { msg = JSON.parse(data.toString()) as SignalMessage }
          catch { return }

          void handleSignalMessage(pc, ws, msg, () => {
            if (resolved) return
            resolved = true
            callState = {
              active: true,
              clientId: client.id,
              clientName: client.name,
              isMuted: false,
              startedAt: Date.now(),
            }
            sendCallState()
            resolve({ ok: true })
          })
        })

        // Create and send SDP offer
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        ws.send(JSON.stringify({ type: 'offer', sdp: pc.localDescription }))

      } catch (err) {
        fail(String(err))
      }
    })
  })
}

async function handleSignalMessage(
  pc: RTCPeerConnection,
  ws: WebSocket,
  msg: SignalMessage,
  onAnswered: () => void,
): Promise<void> {
  switch (msg.type) {
    case 'answer':
      if (msg.sdp) {
        await pc.setRemoteDescription(new wrtc.RTCSessionDescription(msg.sdp))
        onAnswered()
      }
      break

    case 'ice-candidate':
      if (msg.candidate) {
        try {
          await pc.addIceCandidate(new wrtc.RTCIceCandidate(msg.candidate))
        } catch { /* stale candidate — ignore */ }
      }
      break

    case 'hangup':
      teardownCall()
      break
  }
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('call:start', async (_event, clientId: string) => {
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
