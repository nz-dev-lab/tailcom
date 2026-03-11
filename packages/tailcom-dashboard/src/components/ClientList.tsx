import React from 'react'
import { useStore } from '../store'
import ClientCard from './ClientCard'

interface Props {
  onTalk: (clientId: string) => void
}

export default function ClientList({ onTalk }: Props) {
  const clients = useStore((s) => s.clients)
  const activeCall = useStore((s) => s.activeCall)

  if (clients.length === 0) {
    return <p style={styles.empty}>No clients configured.</p>
  }

  return (
    <div style={styles.list}>
      {clients.map((client) => (
        <ClientCard
          key={client.id}
          client={client}
          isInCall={activeCall.active}
          onTalk={onTalk}
        />
      ))}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  list: {
    display: 'flex',
    flexDirection: 'column',
  },
  empty: {
    color: '#78716C',
    fontSize: 13,
    marginTop: 12,
    textAlign: 'center',
  },
}
