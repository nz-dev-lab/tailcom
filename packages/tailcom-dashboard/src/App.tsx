import React, { useEffect } from 'react'
import { useStore } from './store'

// Sub-components are built in Steps 5–8.
// This scaffold wires IPC listeners and renders placeholder sections.

export default function App() {
  const setClients = useStore((s) => s.setClients)
  const setCallState = useStore((s) => s.setCallState)

  useEffect(() => {
    const offClients = window.tailcom.onClientsUpdate(setClients)
    const offCall = window.tailcom.onCallState(setCallState)
    return () => {
      offClients()
      offCall()
    }
  }, [setClients, setCallState])

  return (
    <div style={styles.root}>
      {/* Drag region — lets user move the frameless window */}
      <div style={styles.dragRegion} />

      {/* Content area — filled in Steps 5–8 */}
      <div style={styles.content}>
        <p style={styles.placeholder}>tailcom loading…</p>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    background: '#1C1917',
    color: '#FAFAF9',
  },
  dragRegion: {
    height: 32,
    // Electron frameless window drag region
    WebkitAppRegion: 'drag',
    background: '#1C1917',
    flexShrink: 0,
  } as React.CSSProperties & { WebkitAppRegion: string },
  content: {
    flex: 1,
    overflow: 'hidden auto',
    padding: '8px 12px',
  },
  placeholder: {
    color: '#78716C',
    fontSize: 13,
    marginTop: 16,
  },
}
