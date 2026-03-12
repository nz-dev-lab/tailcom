import { useEffect, useRef, useCallback } from 'react'
import { useStore } from '../store'

interface SignalMessage {
  type: string
  sdp?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit
}

// ── Module-level singletons (one call at a time) ──────────────────────────────

let _analyser: AnalyserNode | null = null
let _recordingDest: MediaStreamAudioDestinationNode | null = null
let _recorder: MediaRecorder | null = null
let _chunks: Blob[] = []

export function getAnalyser(): AnalyserNode | null {
  return _analyser
}

export function startRecording(clientName: string, onDone: (saved: boolean) => void): void {
  if (_recorder || !_recordingDest) return

  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm'

  _chunks = []
  _recorder = new MediaRecorder(_recordingDest.stream, { mimeType })

  _recorder.ondataavailable = (e) => {
    if (e.data.size > 0) _chunks.push(e.data)
  }

  _recorder.onstop = async () => {
    const blob = new Blob(_chunks, { type: mimeType })
    const ab = await blob.arrayBuffer()
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const safe = clientName.replace(/[^a-z0-9]/gi, '-')
    const filename = `${safe}_${ts}.webm`
    try {
      await window.tailcom.saveRecording(ab, filename)
      onDone(true)
    } catch {
      onDone(false)
    }
  }

  _recorder.start(1000) // collect chunks every 1s
}

export function stopRecording(): void {
  if (_recorder && _recorder.state !== 'inactive') {
    _recorder.stop()
  }
  _recorder = null
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useWebRTC() {
  const isMuted = useStore((s) => s.activeCall.isMuted)
  const setIsRecording = useStore((s) => s.setIsRecording)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)

  const cleanup = useCallback(() => {
    // Stop any active recording
    if (_recorder && _recorder.state !== 'inactive') {
      _recorder.stop()
    }
    _recorder = null
    _analyser = null
    _recordingDest = null
    setIsRecording(false)

    audioCtxRef.current?.close()
    audioCtxRef.current = null

    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null

    pcRef.current?.close()
    pcRef.current = null
  }, [setIsRecording])

  useEffect(() => {
    const offOpen = window.tailcom.onWsOpen(async (_clientId, _clientName) => {
      try {
        const pc = new RTCPeerConnection({ iceServers: [] })
        pcRef.current = pc

        // Capture microphone
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        streamRef.current = stream

        // AudioContext for visualizer + recording mix
        const audioCtx = new AudioContext()
        audioCtxRef.current = audioCtx

        const localSrc = audioCtx.createMediaStreamSource(stream)

        // Analyser reads from local mic — drives the visualizer
        const analyser = audioCtx.createAnalyser()
        analyser.fftSize = 256
        localSrc.connect(analyser)
        _analyser = analyser

        // Recording destination — mix local + remote into one stream
        const dest = audioCtx.createMediaStreamDestination()
        localSrc.connect(dest)
        _recordingDest = dest

        // Add mic tracks to peer connection
        stream.getTracks().forEach((t) => pc.addTrack(t, stream))

        // When remote audio arrives: play through speakers + add to recording mix
        pc.ontrack = (e) => {
          const audio = new Audio()
          audio.srcObject = e.streams[0]
          void audio.play()

          if (audioCtx.state !== 'closed') {
            const remoteSrc = audioCtx.createMediaStreamSource(e.streams[0])
            remoteSrc.connect(dest)
          }
        }

        // Forward ICE candidates
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

  // Mute/unmute the live mic track
  useEffect(() => {
    streamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = !isMuted
    })
  }, [isMuted])
}
