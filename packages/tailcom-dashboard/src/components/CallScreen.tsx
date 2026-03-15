import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useStore } from '../store'
import { getAnalyser, getRemoteAnalyser, startRecording, stopRecording } from '../hooks/useWebRTC'

// Inject keyframe animations once
if (typeof document !== 'undefined') {
  const id = 'tailcom-callscreen-styles'
  if (!document.getElementById(id)) {
    const el = document.createElement('style')
    el.id = id
    el.textContent = `
      @keyframes tc-recdot { 0%,100%{opacity:1} 50%{opacity:0} }
      @keyframes tc-ring   { 0%{box-shadow:0 0 0 0 rgba(20,184,166,0.4)} 70%{box-shadow:0 0 0 14px rgba(20,184,166,0)} 100%{box-shadow:0 0 0 0 rgba(20,184,166,0)} }
    `
    document.head.appendChild(el)
  }
}

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60).toString().padStart(2, '0')
  const s = (secs % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

export default function CallScreen() {
  const activeCall = useStore((s) => s.activeCall)
  const isRecording = useStore((s) => s.isRecording)
  const setIsRecording = useStore((s) => s.setIsRecording)
  const [elapsed, setElapsed] = useState(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<number>(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const ecgRef = useRef<HTMLCanvasElement>(null)
  const ecgAnimRef = useRef<number>(0)
  const localBuf = useRef<number[]>(new Array(150).fill(0))
  const remoteBuf = useRef<number[]>(new Array(150).fill(0))

  // ── Timer ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeCall.startedAt) return
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - (activeCall.startedAt ?? Date.now())) / 1000))
    }, 1000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [activeCall.startedAt])

  // ── Audio visualizer (canvas) ─────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const BAR_COUNT = 24
    const BAR_W = 4
    const GAP = 3
    const totalW = BAR_COUNT * (BAR_W + GAP) - GAP

    const draw = () => {
      animRef.current = requestAnimationFrame(draw)
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const analyser = getAnalyser()
      const startX = (canvas.width - totalW) / 2
      const maxH = canvas.height - 4

      if (!analyser) {
        // flat line when idle
        for (let i = 0; i < BAR_COUNT; i++) {
          ctx.fillStyle = 'rgba(20,184,166,0.2)'
          ctx.beginPath()
          ctx.roundRect?.(startX + i * (BAR_W + GAP), canvas.height / 2 - 2, BAR_W, 4, 2)
          ctx.fill()
        }
        return
      }

      const data = new Uint8Array(analyser.frequencyBinCount)
      analyser.getByteTimeDomainData(data)

      for (let i = 0; i < BAR_COUNT; i++) {
        const idx = Math.floor((i / BAR_COUNT) * data.length)
        const v = Math.abs(data[idx] - 128) / 128
        const center = BAR_COUNT / 2
        const dist = Math.abs(i - center) / center
        const h = Math.max(4, v * maxH * (1 - dist * 0.25))
        const y = (canvas.height - h) / 2
        const alpha = 0.3 + v * 0.7

        ctx.fillStyle = `rgba(20,184,166,${alpha})`
        ctx.beginPath()
        if (ctx.roundRect) {
          ctx.roundRect(startX + i * (BAR_W + GAP), y, BAR_W, h, 2)
        } else {
          ctx.rect(startX + i * (BAR_W + GAP), y, BAR_W, h)
        }
        ctx.fill()
      }
    }

    animRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(animRef.current)
  }, [activeCall.active])

  // ── ECG dual-channel visualizer ───────────────────────────────────────────────
  useEffect(() => {
    const canvas = ecgRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = canvas.width
    const H = canvas.height
    const SAMPLES = 150
    let frame = 0

    const drawLine = (buf: number[], color: string) => {
      ctx.strokeStyle = color
      ctx.lineWidth = 1.5
      ctx.beginPath()
      const step = W / SAMPLES
      buf.forEach((v, i) => {
        const x = i * step
        const y = H / 2 - v * (H / 2 - 2)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()
    }

    const draw = () => {
      ecgAnimRef.current = requestAnimationFrame(draw)
      frame++
      if (frame % 6 === 0) {
        const sample = (analyser: AnalyserNode | null, buf: number[]) => {
          if (!analyser) { buf.push(0) } else {
            const d = new Uint8Array(analyser.frequencyBinCount)
            analyser.getByteTimeDomainData(d)
            const peak = d.reduce((m, v) => Math.max(m, Math.abs(v - 128)), 0) / 128
            buf.push(peak)
          }
          if (buf.length > SAMPLES) buf.shift()
        }
        sample(getAnalyser(), localBuf.current)
        sample(getRemoteAnalyser(), remoteBuf.current)
      }

      ctx.clearRect(0, 0, W, H)
      ctx.strokeStyle = 'rgba(255,255,255,0.06)'
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke()
      drawLine(localBuf.current, 'rgba(20,184,166,0.85)')
      drawLine(remoteBuf.current, 'rgba(168,85,247,0.85)')
    }

    ecgAnimRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(ecgAnimRef.current)
  }, [activeCall.active])

  // ── Recording toggle ──────────────────────────────────────────────────────────
  const handleToggleRecord = useCallback(() => {
    if (isRecording) {
      stopRecording()
      setIsRecording(false)
    } else {
      setIsRecording(true)
      startRecording(activeCall.clientName ?? 'unknown', (saved) => {
        setIsRecording(false)
        if (saved) console.log('[tailcom] recording saved')
      })
    }
  }, [isRecording, activeCall.clientName, setIsRecording])

  const initial = (activeCall.clientName ?? '?')[0].toUpperCase()

  return (
    <div style={s.screen}>
      {/* Recording badge */}
      {isRecording && (
        <div style={s.recBadge}>
          <span style={s.recDot} />
          REC
        </div>
      )}

      {/* Avatar */}
      <div style={{ ...s.avatarRing, animation: 'tc-ring 2s ease-out infinite' }}>
        <div style={s.avatar}>{initial}</div>
      </div>

      {/* Name + status */}
      <div style={s.name}>{activeCall.clientName}</div>
      <div style={s.status}>CONNECTED</div>

      {/* Timer */}
      <div style={s.timer}>{formatTime(elapsed)}</div>

      {/* Visualizer */}
      <canvas ref={canvasRef} width={300} height={56} style={s.canvas} />

      {/* ECG dual-channel */}
      <canvas ref={ecgRef} width={300} height={44} style={s.canvas} />
      <div style={s.ecgLegend}>
        <span style={{ color: 'rgba(20,184,166,0.85)' }}>■ you</span>
        <span style={{ color: 'rgba(168,85,247,0.85)' }}>■ kitchen</span>
      </div>

      {/* Controls */}
      <div style={s.controls}>

        {/* Mute */}
        <div style={s.ctrlGroup}>
          <button
            style={{ ...s.ctrlBtn, ...(activeCall.isMuted ? s.ctrlBtnLit : {}) }}
            onClick={() => void window.tailcom.setMuted(!activeCall.isMuted)}
            title={activeCall.isMuted ? 'Unmute' : 'Mute'}
          >
            <span style={s.ctrlIcon}>{activeCall.isMuted ? '🔇' : '🎤'}</span>
          </button>
          <span style={s.ctrlLabel}>{activeCall.isMuted ? 'Unmute' : 'Mute'}</span>
        </div>

        {/* Hang up */}
        <div style={s.ctrlGroup}>
          <button
            style={{ ...s.ctrlBtn, ...s.hangupBtn }}
            onClick={() => void window.tailcom.hangUp()}
            title="End call"
          >
            <span style={{ fontSize: 20, color: '#fff', fontWeight: 700 }}>✕</span>
          </button>
          <span style={s.ctrlLabel}>End</span>
        </div>

        {/* Record */}
        <div style={s.ctrlGroup}>
          <button
            style={{ ...s.ctrlBtn, ...(isRecording ? s.ctrlBtnRec : {}) }}
            onClick={handleToggleRecord}
            title={isRecording ? 'Stop recording' : 'Record call'}
          >
            <span style={s.ctrlIcon}>⏺</span>
          </button>
          <span style={s.ctrlLabel}>{isRecording ? 'Stop' : 'Record'}</span>
        </div>

      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  screen: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '16px 20px 28px',
    background: '#1C1917',
    position: 'relative',
  },
  recBadge: {
    position: 'absolute',
    top: 10,
    right: 14,
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 11,
    fontWeight: 700,
    color: '#EF4444',
    letterSpacing: '0.08em',
  },
  recDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#EF4444',
    display: 'inline-block',
    animation: 'tc-recdot 1s ease-in-out infinite',
  },
  avatarRing: {
    width: 84,
    height: 84,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #14B8A6 0%, #0D9488 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  avatar: {
    fontSize: 34,
    fontWeight: 700,
    color: '#fff',
    lineHeight: 1,
    userSelect: 'none',
  },
  name: {
    fontSize: 20,
    fontWeight: 600,
    color: '#FAFAF9',
    textAlign: 'center',
    maxWidth: 300,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  status: {
    fontSize: 11,
    fontWeight: 600,
    color: '#14B8A6',
    letterSpacing: '0.12em',
    marginBottom: 4,
  },
  timer: {
    fontSize: 38,
    fontWeight: 200,
    color: '#FAFAF9',
    fontFamily: 'monospace',
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '0.04em',
  },
  canvas: {
    display: 'block',
    margin: '6px 0 0',
  },
  ecgLegend: {
    display: 'flex',
    gap: 12,
    fontSize: 10,
    marginBottom: 10,
    opacity: 0.7,
  },
  controls: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: 32,
    marginTop: 8,
  },
  ctrlGroup: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
  },
  ctrlBtn: {
    width: 58,
    height: 58,
    borderRadius: '50%',
    background: '#292524',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background 0.15s',
  },
  ctrlBtnLit: {
    background: '#44403C',
  },
  ctrlBtnRec: {
    background: '#7F1D1D',
  },
  ctrlIcon: {
    fontSize: 22,
    lineHeight: 1,
  },
  ctrlLabel: {
    fontSize: 11,
    color: '#78716C',
    whiteSpace: 'nowrap',
  },
  hangupBtn: {
    background: '#EF4444',
    width: 64,
    height: 64,
  },
}
