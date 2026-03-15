// Renderer-side types (mirror of what preload exposes)

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

// Typed window.tailcom bridge (injected by preload)
declare global {
  interface Window {
    tailcom: {
      startCall(clientId: string): Promise<{ ok: boolean; reason?: string }>
      hangUp(): Promise<void>
      setMuted(muted: boolean): Promise<void>
      saveConfig(config: unknown): Promise<{ ok: boolean; reason?: string }>
      wsSend(msg: unknown): Promise<void>
      onClientsUpdate(cb: (clients: ClientStatus[]) => void): () => void
      onCallState(cb: (state: CallState) => void): () => void
      onWsOpen(cb: (clientId: string, clientName: string) => void): () => void
      onWsMessage(cb: (msg: unknown) => void): () => void
      onWsClose(cb: () => void): () => void
      saveRecording(data: ArrayBuffer, filename: string): Promise<{ ok: boolean; path?: string }>
      getRecordingsPath(): Promise<string>
      windowMinimize(): void
      windowClose(): void
    }
  }
}
