import React, { useEffect, useCallback } from 'react'
import { useStore } from './store'
import ClientList from './components/ClientList'
import CallBar from './components/CallBar'
import SettingsPanel from './components/SettingsPanel'
import { useWebRTC } from './hooks/useWebRTC'

export default function App() {
  const setClients = useStore((s) => s.setClients)
  const setCallState = useStore((s) => s.setCallState)

  // Browser WebRTC — handles offer/answer/ICE + mic/speaker in renderer
  useWebRTC()
  const [showSettings, setShowSettings] = React.useState(false)

  useEffect(() => {
    const offClients = window.tailcom.onClientsUpdate(setClients)
    const offCall = window.tailcom.onCallState(setCallState)
    return () => {
      offClients()
      offCall()
    }
  }, [setClients, setCallState])

  const handleTalk = useCallback(async (clientId: string) => {
    const result = await window.tailcom.startCall(clientId)
    if (!result.ok) {
      console.warn('[tailcom] call failed:', result.reason)
    }
  }, [])

  return (
    <div style={styles.root}>
      {/* Title bar — drag region + app name + settings button */}
      <div style={styles.titleBar as React.CSSProperties}>
        <span style={styles.appName as React.CSSProperties}>tailcom</span>
        <button
          style={styles.settingsBtn as React.CSSProperties}
          title="Settings"
          onClick={() => setShowSettings((v) => !v)}
        >
          ⚙
        </button>
      </div>

      <div style={styles.content}>
        {showSettings ? (
          <SettingsPanel onClose={() => setShowSettings(false)} />
        ) : (
          <ClientList onTalk={handleTalk} />
        )}
      </div>

      <CallBar />
    </div>
  )
}

const styles: Record<string, React.CSSProperties & { WebkitAppRegion?: string }> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    background: '#1C1917',
    color: '#FAFAF9',
  },
  titleBar: {
    height: 44,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 14px',
    flexShrink: 0,
    WebkitAppRegion: 'drag',
    background: '#1C1917',
  },
  appName: {
    fontSize: 15,
    fontWeight: 700,
    letterSpacing: '0.03em',
    color: '#14B8A6',
    WebkitAppRegion: 'drag',
  },
  settingsBtn: {
    background: 'none',
    border: 'none',
    color: '#78716C',
    fontSize: 18,
    cursor: 'pointer',
    lineHeight: 1,
    padding: 4,
    WebkitAppRegion: 'no-drag',
  },
  content: {
    flex: 1,
    overflow: 'hidden auto',
    padding: '4px 12px 8px',
  },
}
