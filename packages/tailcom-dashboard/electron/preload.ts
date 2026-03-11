import { contextBridge, ipcRenderer } from 'electron'

// Expose a safe, typed IPC bridge to the renderer.
// The renderer never touches ipcRenderer directly.

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

  // ── Main → Renderer ───────────────────────────────────────────────────────

  onClientsUpdate: (cb: (clients: ClientStatus[]) => void) => {
    ipcRenderer.on('clients:update', (_event, clients) => cb(clients as ClientStatus[]))
    return () => ipcRenderer.removeAllListeners('clients:update')
  },

  onCallState: (cb: (state: CallState) => void) => {
    ipcRenderer.on('call:state', (_event, state) => cb(state as CallState))
    return () => ipcRenderer.removeAllListeners('call:state')
  },
})

// Types duplicated here so preload (which runs in its own context)
// doesn't need to import from src/
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
