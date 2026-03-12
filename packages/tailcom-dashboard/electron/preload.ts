import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('tailcom', {
  // ── Renderer → Main ───────────────────────────────────────────────────────

  startCall: (clientId: string) =>
    ipcRenderer.invoke('call:start', clientId),

  hangUp: () =>
    ipcRenderer.invoke('call:hangup'),

  setMuted: (muted: boolean) =>
    ipcRenderer.invoke('call:mute', muted),

  saveConfig: (config: unknown) =>
    ipcRenderer.invoke('config:save', config),

  // Send a WebRTC signalling message to the client over WebSocket (via main)
  wsSend: (msg: unknown) =>
    ipcRenderer.invoke('ws:send', msg),

  // ── Main → Renderer ───────────────────────────────────────────────────────

  onClientsUpdate: (cb: (clients: ClientStatus[]) => void) => {
    ipcRenderer.on('clients:update', (_event, clients) => cb(clients as ClientStatus[]))
    return () => ipcRenderer.removeAllListeners('clients:update')
  },

  onCallState: (cb: (state: CallState) => void) => {
    ipcRenderer.on('call:state', (_event, state) => cb(state as CallState))
    return () => ipcRenderer.removeAllListeners('call:state')
  },

  // WebSocket opened — renderer should start WebRTC
  onWsOpen: (cb: (clientId: string, clientName: string) => void) => {
    ipcRenderer.on('ws:open', (_event, clientId, clientName) => cb(clientId as string, clientName as string))
    return () => ipcRenderer.removeAllListeners('ws:open')
  },

  // Incoming signalling message from client — forward to renderer WebRTC logic
  onWsMessage: (cb: (msg: unknown) => void) => {
    ipcRenderer.on('ws:message', (_event, msg) => cb(msg))
    return () => ipcRenderer.removeAllListeners('ws:message')
  },

  // WebSocket closed — renderer should teardown WebRTC
  onWsClose: (cb: () => void) => {
    ipcRenderer.on('ws:close', _event => cb())
    return () => ipcRenderer.removeAllListeners('ws:close')
  },

  // Save a recording file via main process
  saveRecording: (data: ArrayBuffer, filename: string) =>
    ipcRenderer.invoke('recording:save', data, filename),

  // Get current recordings folder path
  getRecordingsPath: () =>
    ipcRenderer.invoke('recording:path:get'),
})

export interface ClientStatus {
  id: string
  name: string
  ip: string
  port: number
  online: boolean
}

export interface CallState {
  active: boolean
  clientId: string | null
  clientName: string | null
  isMuted: boolean
  startedAt: number | null
}
