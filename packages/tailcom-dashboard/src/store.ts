import { create } from 'zustand'
import type { ClientStatus, CallState } from './types'

interface TailcomStore {
  clients: ClientStatus[]
  activeCall: CallState
  isRecording: boolean
  setClients: (clients: ClientStatus[]) => void
  setCallState: (state: CallState) => void
  setIsRecording: (v: boolean) => void
}

export const useStore = create<TailcomStore>((set) => ({
  clients: [],
  activeCall: {
    active: false,
    clientId: null,
    clientName: null,
    isMuted: false,
    startedAt: null,
  },
  isRecording: false,
  setClients: (clients) => set({ clients }),
  setCallState: (activeCall) => set({ activeCall }),
  setIsRecording: (isRecording) => set({ isRecording }),
}))
