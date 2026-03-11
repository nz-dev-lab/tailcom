import React from 'react'

interface Props {
  onClose: () => void
}

// Full implementation in Step 8.
export default function SettingsPanel({ onClose }: Props) {
  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.title}>Settings</span>
        <button style={styles.closeBtn} onClick={onClose}>✕</button>
      </div>
      <p style={styles.placeholder}>Settings coming in next step…</p>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  title: {
    fontSize: 14,
    fontWeight: 600,
    color: '#FAFAF9',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#78716C',
    fontSize: 14,
    cursor: 'pointer',
    padding: 4,
  },
  placeholder: {
    color: '#78716C',
    fontSize: 13,
  },
}
