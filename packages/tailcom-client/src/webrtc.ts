import { EventEmitter } from 'events'
import type { IceCandidateMessage } from './types'

// Load wrtc for Node/Electron main process.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const wrtc = require('@roamhq/wrtc') as {
  RTCPeerConnection: typeof RTCPeerConnection
  RTCSessionDescription: typeof RTCSessionDescription
  RTCIceCandidate: typeof RTCIceCandidate
  nonstandard: {
    RTCAudioSource: new () => {
      createTrack(): MediaStreamTrack
      onData(data: unknown): void
    }
    RTCAudioSink: new (track: MediaStreamTrack) => {
      ondata: ((data: unknown) => void) | null
      stop(): void
    }
  }
}

export type WebRTCEvents = {
  'ice-candidate': (msg: IceCandidateMessage) => void
  'connected': () => void
  'disconnected': () => void
  'error': (err: Error) => void
}

export class WebRTCHandler extends EventEmitter {
  private pc: RTCPeerConnection | null = null
  private audioSink: { ondata: ((data: unknown) => void) | null; stop(): void } | null = null

  createPeerConnection(): RTCPeerConnection {
    const pc = new wrtc.RTCPeerConnection({
      iceServers: [], // No STUN/TURN — direct Tailscale IP only
    })

    pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
      if (event.candidate) {
        this.emit('ice-candidate', {
          type: 'ice-candidate',
          candidate: event.candidate.toJSON(),
        } satisfies IceCandidateMessage)
      }
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        this.emit('connected')
      } else if (
        pc.connectionState === 'disconnected' ||
        pc.connectionState === 'failed' ||
        pc.connectionState === 'closed'
      ) {
        this.emit('disconnected')
      }
    }

    pc.ontrack = (event: RTCTrackEvent) => {
      // Incoming audio track from dashboard — attach a sink to play it
      const track = event.track
      if (track.kind !== 'audio') return

      // wrtc nonstandard sink outputs PCM frames; in a real Electron renderer
      // you would pipe these to the system speaker via node-speaker or similar.
      // Here we create the sink so the track stays active.
      const sink = new wrtc.nonstandard.RTCAudioSink(track)
      this.audioSink = sink
      // Silence the lint warning — actual audio playback is wired in client.ts
      sink.ondata = null
    }

    this.pc = pc
    return pc
  }

  async createAnswer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    if (!this.pc) throw new Error('No peer connection — call createPeerConnection() first')

    await this.pc.setRemoteDescription(new wrtc.RTCSessionDescription(offer))
    const answer = await this.pc.createAnswer()
    await this.pc.setLocalDescription(answer)

    if (!this.pc.localDescription) throw new Error('Failed to set local description')
    return this.pc.localDescription
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.pc) return
    try {
      await this.pc.addIceCandidate(new wrtc.RTCIceCandidate(candidate))
    } catch (err) {
      // Non-fatal — stale candidates are normal
    }
  }

  getMicTrack(): MediaStreamTrack | null {
    if (!this.pc) return null
    const senders = this.pc.getSenders()
    return senders.length > 0 ? senders[0].track : null
  }

  addMicTrack(track: MediaStreamTrack): void {
    if (!this.pc) return
    this.pc.addTrack(track)
  }

  teardown(): void {
    if (this.audioSink) {
      try { this.audioSink.stop() } catch { /* ignore */ }
      this.audioSink = null
    }
    if (this.pc) {
      try { this.pc.close() } catch { /* ignore */ }
      this.pc = null
    }
  }
}
