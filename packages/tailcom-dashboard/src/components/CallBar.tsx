import React, { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'

export default function CallBar() {
  const activeCall = useStore((s) => s.activeCall)
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (activeCall.active && activeCall.startedAt) {
      setElapsed(Math.floor((Date.now() - activeCall.startedAt) / 1000))
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - (activeCall.startedAt ?? Date.now())) / 1000))
      }, 1000)
    } else {
      setElapsed(0)
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [activeCall.active, activeCall.startedAt])

  if (!activeCall.active) return null

  return (
    <div style={styles.bar}>
      {/* Live indicator */}
      <div style={styles.liveGroup}>
        <span style={styles.liveDot} />
        <span style={styles.liveName}>{activeCall.clientName}</span>
      </div>

      {/* Timer */}
      <span style={styles.timer}>{formatElapsed(elapsed)}</span>

      {/* Controls */}
      <div style={styles.controls}>
        <button
          style={{
            ...styles.iconBtn,
            color: activeCall.isMuted ? '#EF4444' : '#A8A29E',
          }}
          title={activeCall.isMuted ? 'Unmute' : 'Mute'}
          onClick={() => void window.tailcom.setMuted(!activeCall.isMuted)}
        >
          {activeCall.isMuted ? '🔇' : '🎙'}
        </button>

        <button
          style={{ ...styles.iconBtn, ...styles.hangupBtn }}
          title="Hang up"
          onClick={() => void window.tailcom.hangUp()}
        >
          ✕
        </button>
      </div>
    </div>
  )
}

function formatElapsed(secs: number): string {
  const m = Math.floor(secs / 60).toString().padStart(2, '0')
  const s = (secs % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

const pulse: string = `
  @keyframes tailcom-pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.3; }
  }
`

// Inject keyframes once
if (typeof document !== 'undefined') {
  const styleId = 'tailcom-callbar-styles'
  if (!document.getElementById(styleId)) {
    const el = document.createElement('style')
    el.id = styleId
    el.textContent = pulse
    document.head.appendChild(el)
  }
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: '#292524',
    borderTop: '1px solid #3D3735',
    padding: '10px 14px',
    flexShrink: 0,
    gap: 8,
  },
  liveGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    minWidth: 0,
    flex: 1,
  },
  liveDot: {
    width: 9,
    height: 9,
    borderRadius: '50%',
    background: '#EF4444',
    flexShrink: 0,
    animation: 'tailcom-pulse 1.4s ease-in-out infinite',
  },
  liveName: {
    fontSize: 13,
    fontWeight: 500,
    color: '#FAFAF9',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  timer: {
    fontSize: 13,
    color: '#A8A29E',
    fontVariantNumeric: 'tabular-nums',
    flexShrink: 0,
  },
  controls: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  iconBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 16,
    lineHeight: 1,
    padding: '4px 6px',
    borderRadius: 6,
    color: '#A8A29E',
    transition: 'color 0.15s',
  },
  hangupBtn: {
    background: '#EF4444',
    color: '#fff',
    fontWeight: 700,
    fontSize: 12,
    borderRadius: 6,
    padding: '5px 10px',
  },
}
