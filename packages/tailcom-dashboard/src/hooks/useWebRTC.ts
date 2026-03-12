import { useEffect, useRef, useCallback } from 'react'
import { useStore } from '../store'

interface SignalMessage {
  type: string
  sdp?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit
}

export function useWebRTC() {
  const isMuted = useStore((s) => s.activeCall.isMuted)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const cleanup = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    pcRef.current?.close()
    pcRef.current = null
  }, [])

  useEffect(() => {
    const offOpen = window.tailcom.onWsOpen(async (_clientId, _clientName) => {
      try {
        const pc = new RTCPeerConnection({ iceServers: [] })
        pcRef.current = pc

        // Capture microphone
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        streamRef.current = stream
        stream.getTracks().forEach((t) => pc.addTrack(t, stream))

        // Play incoming audio from client automatically
        pc.ontrack = (e) => {
          const audio = new Audio()
          audio.srcObject = e.streams[0]
          void audio.play()
        }

        // Forward ICE candidates to client via main → WebSocket
        pc.onicecandidate = (e) => {
          if (e.candidate) {
            void window.tailcom.wsSend({
              type: 'ice-candidate',
              candidate: e.candidate.toJSON(),
            })
          }
        }

        // Create and send SDP offer
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        void window.tailcom.wsSend({ type: 'offer', sdp: { type: offer.type, sdp: offer.sdp } })
      } catch (err) {
        console.error('[tailcom] WebRTC start failed:', err)
        void window.tailcom.hangUp()
      }
    })

    const offMessage = window.tailcom.onWsMessage(async (raw) => {
      const pc = pcRef.current
      if (!pc) return
      const msg = raw as SignalMessage

      try {
        if (msg.type === 'answer' && msg.sdp) {
          await pc.setRemoteDescription(msg.sdp)
        } else if (msg.type === 'ice-candidate' && msg.candidate) {
          await pc.addIceCandidate(msg.candidate)
        } else if (msg.type === 'hangup') {
          cleanup()
        }
      } catch (err) {
        console.error('[tailcom] WebRTC signal error:', err)
      }
    })

    const offClose = window.tailcom.onWsClose(cleanup)

    return () => {
      offOpen()
      offMessage()
      offClose()
      cleanup()
    }
  }, [cleanup])

  // Apply mute/unmute to the live audio track
  useEffect(() => {
    streamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = !isMuted
    })
  }, [isMuted])
}
