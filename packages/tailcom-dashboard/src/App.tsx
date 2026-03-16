import React, { useEffect, useCallback } from 'react'
import { useStore } from './store'
import ClientList from './components/ClientList'
import CallScreen from './components/CallScreen'
import SettingsPanel from './components/SettingsPanel'
import { useWebRTC } from './hooks/useWebRTC'

export default function App() {
  const setClients = useStore((s) => s.setClients)
  const setCallState = useStore((s) => s.setCallState)
  const activeCall = useStore((s) => s.activeCall)

  // Browser WebRTC — handles offer/answer/ICE + mic/speaker in renderer
  useWebRTC()
  const [showSettings, setShowSettings] = React.useState(false)
  const [tsState, setTsState] = React.useState<'up' | 'down' | 'loading'>('loading')
  const [tsToggling, setTsToggling] = React.useState(false)

  useEffect(() => {
    const offClients = window.tailcom.onClientsUpdate(setClients)
    const offCall = window.tailcom.onCallState(setCallState)
    const offTs = window.tailcom.onTailscaleState(setTsState)
    void window.tailcom.tailscaleStatus().then(setTsState)
    return () => {
      offClients()
      offCall()
      offTs()
    }
  }, [setClients, setCallState])

  const handleTailscaleToggle = async () => {
    if (tsToggling) return
    setTsToggling(true)
    if (tsState === 'up') {
      await window.tailcom.tailscaleDown()
    } else {
      await window.tailcom.tailscaleUp()
    }
    setTsToggling(false)
  }

  const handleTalk = useCallback(async (clientId: string) => {
    const result = await window.tailcom.startCall(clientId)
    if (!result.ok) {
      console.warn('[tailcom] call failed:', result.reason)
    }
  }, [])

  return (
    <div style={styles.root}>
      {/* Title bar */}
      <div style={styles.titleBar as React.CSSProperties}>
        <span style={styles.appName as React.CSSProperties}>tailcom</span>
        <div style={styles.titleBarRight as React.CSSProperties}>
          <button
            style={{
              ...styles.tsPill,
              background: tsState === 'up' ? '#14532D' : tsState === 'down' ? '#450A0A' : '#292524',
              opacity: tsToggling ? 0.6 : 1,
              cursor: tsToggling ? 'not-allowed' : 'pointer',
            } as React.CSSProperties}
            title={tsState === 'up' ? 'Tailscale ON — click to disconnect' : 'Tailscale OFF — click to connect'}
            onClick={handleTailscaleToggle}
            disabled={tsToggling}
          >
            <span style={{ color: tsState === 'up' ? '#4ADE80' : '#F87171', fontSize: 8 }}>●</span>
            {' '}TS
          </button>
          {!activeCall.active && (
            <button
              style={styles.settingsBtn as React.CSSProperties}
              title="Settings"
              onClick={() => setShowSettings((v) => !v)}
            >
              ⚙
            </button>
          )}
          <button
            style={styles.winBtn as React.CSSProperties}
            title="Minimize"
            onClick={() => window.tailcom.windowMinimize()}
          >
            ─
          </button>
          <button
            style={{ ...styles.winBtn, ...styles.winBtnClose } as React.CSSProperties}
            title="Close"
            onClick={() => window.tailcom.windowClose()}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Full call screen replaces content when in a call */}
      {activeCall.active ? (
        <CallScreen />
      ) : (
        <div style={styles.content}>
          {showSettings ? (
            <SettingsPanel onClose={() => setShowSettings(false)} />
          ) : (
            <ClientList onTalk={handleTalk} />
          )}
        </div>
      )}
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
  titleBarRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    WebkitAppRegion: 'no-drag',
  },
  tsPill: {
    border: 'none',
    borderRadius: 12,
    padding: '3px 9px',
    fontSize: 11,
    fontWeight: 600,
    color: '#FAFAF9',
    letterSpacing: '0.04em',
    WebkitAppRegion: 'no-drag',
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
  winBtn: {
    background: 'none',
    border: 'none',
    color: '#78716C',
    fontSize: 13,
    cursor: 'pointer',
    lineHeight: 1,
    padding: '4px 8px',
    borderRadius: 4,
    WebkitAppRegion: 'no-drag',
  },
  winBtnClose: {
    color: '#EF4444',
  },
  content: {
    flex: 1,
    overflow: 'hidden auto',
    padding: '4px 12px 8px',
  },
}
