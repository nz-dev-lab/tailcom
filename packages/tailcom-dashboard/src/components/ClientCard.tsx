import React from 'react'
import type { ClientStatus } from '../types'

interface Props {
  client: ClientStatus
  isInCall: boolean
  onTalk: (clientId: string) => void
}

export default function ClientCard({ client, isInCall, onTalk }: Props) {
  const canTalk = client.online && !isInCall

  return (
    <div style={styles.card}>
      <div style={styles.left}>
        <span
          style={{
            ...styles.dot,
            background: client.online ? '#22C55E' : '#EF4444',
            boxShadow: client.online ? '0 0 6px #22C55E88' : 'none',
          }}
        />
        <span style={styles.name}>{client.name}</span>
      </div>

      <button
        style={{
          ...styles.talkBtn,
          opacity: canTalk ? 1 : 0.35,
          cursor: canTalk ? 'pointer' : 'not-allowed',
        }}
        disabled={!canTalk}
        onClick={() => onTalk(client.id)}
      >
        Talk
      </button>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: '#292524',
    borderRadius: 10,
    padding: '12px 14px',
    marginBottom: 8,
  },
  left: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    overflow: 'hidden',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    flexShrink: 0,
    transition: 'background 0.3s',
  },
  name: {
    fontSize: 14,
    fontWeight: 500,
    color: '#FAFAF9',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  talkBtn: {
    background: '#14B8A6',
    color: '#fff',
    border: 'none',
    borderRadius: 7,
    padding: '6px 16px',
    fontSize: 13,
    fontWeight: 600,
    flexShrink: 0,
    transition: 'opacity 0.15s',
  },
}
