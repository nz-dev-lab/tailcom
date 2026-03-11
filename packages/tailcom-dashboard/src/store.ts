import { create } from 'zustand'
import type { ClientStatus, CallState } from './types'

interface TailcomStore {
  clients: ClientStatus[]
  activeCall: CallState
  setClients: (clients: ClientStatus[]) => void
  setCallState: (state: CallState) => void
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
  setClients: (clients) => set({ clients }),
  setCallState: (activeCall) => set({ activeCall }),
}))
