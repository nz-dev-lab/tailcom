import { useEffect, useRef, useCallback } from 'react'
import { useStore } from '../store'

interface SignalMessage {
  type: string
  sdp?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit
}

// ── Module-level singletons (one call at a time) ──────────────────────────────

let _analyser: AnalyserNode | null = null
let _remoteAnalyser: AnalyserNode | null = null
let _recordingDest: MediaStreamAudioDestinationNode | null = null
let _recorder: MediaRecorder | null = null
let _chunks: Blob[] = []

export function getAnalyser(): AnalyserNode | null {
  return _analyser
}

export function getRemoteAnalyser(): AnalyserNode | null {
  return _remoteAnalyser
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

// ── Logging helper ────────────────────────────────────────────────────────────

function log(msg: string): void {
  console.log(`[tailcom:webrtc] ${msg}`)
  window.tailcom.log(`[renderer:webrtc] ${msg}`)
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useWebRTC() {
  const isMuted = useStore((s) => s.activeCall.isMuted)
  const setIsRecording = useStore((s) => s.setIsRecording)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null)

  const cleanup = useCallback(() => {
    // Stop any active recording
    if (_recorder && _recorder.state !== 'inactive') {
      _recorder.stop()
    }
    _recorder = null
    _analyser = null
    _remoteAnalyser = null
    _recordingDest = null
    setIsRecording(false)

    remoteAudioRef.current?.pause()
    remoteAudioRef.current = null

    audioCtxRef.current?.close()
    audioCtxRef.current = null

    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null

    pcRef.current?.close()
    pcRef.current = null
  }, [setIsRecording])

  useEffect(() => {
    const offOpen = window.tailcom.onWsOpen(async (_clientId, clientName) => {
      log(`=== CALL START — client: ${clientName} ===`)
      try {
        const pc = new RTCPeerConnection({ iceServers: [] })
        pcRef.current = pc

        // ── RTCPeerConnection state observers ─────────────────────────────────
        pc.onconnectionstatechange = () => {
          log(`connectionState → ${pc.connectionState}`)
        }
        pc.oniceconnectionstatechange = () => {
          log(`iceConnectionState → ${pc.iceConnectionState}`)
        }
        pc.onicegatheringstatechange = () => {
          log(`iceGatheringState → ${pc.iceGatheringState}`)
        }
        pc.onsignalingstatechange = () => {
          log(`signalingState → ${pc.signalingState}`)
        }

        // Capture microphone
        log('requesting getUserMedia...')
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        streamRef.current = stream
        const micTrack = stream.getAudioTracks()[0]
        log(`mic acquired — label: "${micTrack?.label ?? 'unknown'}" enabled: ${micTrack?.enabled ?? false}`)

        // AudioContext for visualizer + recording mix
        const audioCtx = new AudioContext()
        audioCtxRef.current = audioCtx
        log(`AudioContext created — state: ${audioCtx.state} sampleRate: ${audioCtx.sampleRate}`)

        const localSrc = audioCtx.createMediaStreamSource(stream)

        const analyser = audioCtx.createAnalyser()
        analyser.fftSize = 256
        localSrc.connect(analyser)
        _analyser = analyser

        const dest = audioCtx.createMediaStreamDestination()
        localSrc.connect(dest)
        _recordingDest = dest

        // Add mic tracks to peer connection
        stream.getTracks().forEach((t) => pc.addTrack(t, stream))
        log(`local mic track added to peer connection`)

        // When remote audio arrives
        pc.ontrack = (e) => {
          const t = e.track
          log(`ontrack — kind: ${t.kind} | id: ${t.id} | enabled: ${t.enabled} | muted: ${t.muted} | readyState: ${t.readyState} | streams: ${e.streams.length}`)

          if (audioCtx.state === 'closed') {
            log('ERROR: AudioContext is closed when ontrack fired — cannot play audio')
            return
          }

          log(`AudioContext state at ontrack: ${audioCtx.state}`)
          void audioCtx.resume().then(() => log(`AudioContext resumed — state now: ${audioCtx.state}`))

          const remoteStream = e.streams[0] ?? new MediaStream([t])
          log(`remoteStream created — tracks: ${remoteStream.getTracks().length} id: ${remoteStream.id}`)

          // Audio element — kept in ref to prevent GC killing playback
          const remoteAudio = new Audio()
          remoteAudio.autoplay = true
          remoteAudio.srcObject = remoteStream
          remoteAudioRef.current = remoteAudio

          // Instrument the audio element
          remoteAudio.onplaying    = () => log('remoteAudio: playing ✅')
          remoteAudio.onpause      = () => log('remoteAudio: paused ⚠️')
          remoteAudio.onended      = () => log('remoteAudio: ended')
          remoteAudio.onstalled    = () => log('remoteAudio: stalled ⚠️')
          remoteAudio.onwaiting    = () => log('remoteAudio: waiting...')
          remoteAudio.onerror      = () => log(`remoteAudio: error — code: ${remoteAudio.error?.code ?? '?'} msg: ${remoteAudio.error?.message ?? '?'}`)
          remoteAudio.onloadeddata = () => log('remoteAudio: loadeddata — first frame available')

          // Track lifecycle events
          t.onmute   = () => log('remote track: muted')
          t.onunmute = () => log('remote track: unmuted')
          t.onended  = () => log('remote track: ended')

          const playAudio = () => {
            log(`attempting remoteAudio.play() — paused: ${remoteAudio.paused} readyState: ${remoteAudio.readyState}`)
            void remoteAudio.play().catch((err: Error) => log(`remoteAudio.play() FAILED: ${err.message}`))
          }

          if (t.muted) {
            log('track is initially muted — will play on unmute event')
            t.onunmute = () => {
              log('remote track: unmuted — triggering play')
              playAudio()
            }
          } else {
            playAudio()
          }

          // Web Audio graph for visualizer + recording
          const remoteSrc = audioCtx.createMediaStreamSource(remoteStream)
          remoteSrc.connect(dest)
          const remoteAnalyser = audioCtx.createAnalyser()
          remoteAnalyser.fftSize = 256
          remoteSrc.connect(remoteAnalyser)
          _remoteAnalyser = remoteAnalyser
          log('remote audio connected to AudioContext graph')

          // Periodic health check — logs audio levels every 5s
          const buf = new Uint8Array(remoteAnalyser.frequencyBinCount)
          const healthTimer = setInterval(() => {
            remoteAnalyser.getByteFrequencyData(buf)
            const avg = buf.reduce((s, v) => s + v, 0) / buf.length
            const audioElState = `paused:${remoteAudio.paused} readyState:${remoteAudio.readyState} currentTime:${remoteAudio.currentTime.toFixed(2)}`
            const trackState   = `enabled:${t.enabled} muted:${t.muted} readyState:${t.readyState}`
            const ctxState     = `audioCtx:${audioCtx.state}`
            log(`[HEALTH] remoteLevel:${avg.toFixed(1)} | ${audioElState} | ${trackState} | ${ctxState}`)
          }, 5000)

          // Clear health timer when track ends
          t.onended = () => {
            log('remote track: ended — clearing health timer')
            clearInterval(healthTimer)
          }
        }

        // ICE candidates
        pc.onicecandidate = (e) => {
          if (e.candidate) {
            log(`sending ICE candidate — protocol: ${e.candidate.protocol} type: ${e.candidate.type}`)
            void window.tailcom.wsSend({
              type: 'ice-candidate',
              candidate: e.candidate.toJSON(),
            })
          } else {
            log('ICE gathering complete (null candidate)')
          }
        }

        // Create and send SDP offer
        log('creating SDP offer...')
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        log(`offer created — type: ${offer.type} sdp length: ${offer.sdp?.length ?? 0}`)
        void window.tailcom.wsSend({ type: 'offer', sdp: { type: offer.type, sdp: offer.sdp } })
        log('offer sent to client')

      } catch (err) {
        log(`WebRTC start FAILED: ${String(err)}`)
        void window.tailcom.hangUp()
      }
    })

    const offMessage = window.tailcom.onWsMessage(async (raw) => {
      const pc = pcRef.current
      if (!pc) return
      const msg = raw as SignalMessage

      try {
        if (msg.type === 'answer' && msg.sdp) {
          log(`received answer — sdp length: ${msg.sdp.sdp?.length ?? 0}`)
          await pc.setRemoteDescription(msg.sdp)
          log('remote description set')
        } else if (msg.type === 'ice-candidate' && msg.candidate) {
          log(`received ICE candidate from client`)
          await pc.addIceCandidate(msg.candidate)
        } else if (msg.type === 'hangup') {
          log('received hangup from client')
          cleanup()
        }
      } catch (err) {
        log(`WebRTC signal error: ${String(err)}`)
      }
    })

    const offClose = window.tailcom.onWsClose(() => {
      log('WebSocket closed — tearing down')
      cleanup()
    })

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
