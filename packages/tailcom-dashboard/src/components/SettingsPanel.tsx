import React, { useState } from 'react'
import { useStore } from '../store'
import type { ClientStatus } from '../types'

interface ClientRow {
  id: string
  name: string
  ip: string
  port: string // string while editing
}

interface Props {
  onClose: () => void
}

export default function SettingsPanel({ onClose }: Props) {
  const storeClients = useStore((s) => s.clients)
  const [rows, setRows] = useState<ClientRow[]>(() =>
    storeClients.map((c) => ({ id: c.id, name: c.name, ip: c.ip, port: String(c.port) }))
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function updateRow(id: string, field: keyof Omit<ClientRow, 'id'>, value: string) {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    )
  }

  function addRow() {
    const newId = `client-new-${Date.now()}`
    setRows((prev) => [...prev, { id: newId, name: '', ip: '', port: '7654' }])
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id))
  }

  async function handleSave() {
    setError(null)

    // Validate
    for (const row of rows) {
      if (!row.name.trim()) { setError('Every client needs a name.'); return }
      if (!row.ip.trim()) { setError('Every client needs an IP address.'); return }
      const port = parseInt(row.port, 10)
      if (isNaN(port) || port < 1 || port > 65535) {
        setError(`Invalid port for "${row.name}".`)
        return
      }
    }

    const newConfig = {
      dashboardId: 'developer-laptop',
      clients: rows.map((r) => ({
        name: r.name.trim(),
        ip: r.ip.trim(),
        port: parseInt(r.port, 10),
      })),
    }

    setSaving(true)
    const result = await window.tailcom.saveConfig(newConfig)
    setSaving(false)

    if (result.ok) {
      onClose()
    } else {
      setError(result.reason ?? 'Save failed.')
    }
  }

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.title}>Settings</span>
        <button style={styles.closeBtn} onClick={onClose}>✕</button>
      </div>

      <p style={styles.sectionLabel}>Clients</p>

      <div style={styles.clientList}>
        {rows.map((row, i) => (
          <div key={row.id} style={styles.clientRow}>
            <span style={styles.rowNum}>{i + 1}</span>

            <div style={styles.fields}>
              <input
                style={styles.input}
                placeholder="Name"
                value={row.name}
                onChange={(e) => updateRow(row.id, 'name', e.target.value)}
              />
              <div style={styles.ipPort}>
                <input
                  style={{ ...styles.input, flex: 1 }}
                  placeholder="Tailscale IP"
                  value={row.ip}
                  onChange={(e) => updateRow(row.id, 'ip', e.target.value)}
                />
                <input
                  style={{ ...styles.input, width: 64 }}
                  placeholder="Port"
                  value={row.port}
                  onChange={(e) => updateRow(row.id, 'port', e.target.value)}
                />
              </div>
            </div>

            <button
              style={styles.removeBtn}
              title="Remove client"
              onClick={() => removeRow(row.id)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <button style={styles.addBtn} onClick={addRow}>+ Add client</button>

      {error && <p style={styles.errorMsg}>{error}</p>}

      <button
        style={{ ...styles.saveBtn, opacity: saving ? 0.5 : 1 }}
        disabled={saving}
        onClick={() => void handleSave()}
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  sectionLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: '#78716C',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  clientList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  clientRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    background: '#292524',
    borderRadius: 8,
    padding: '8px 10px',
  },
  rowNum: {
    fontSize: 11,
    color: '#78716C',
    paddingTop: 7,
    minWidth: 14,
    textAlign: 'center',
  },
  fields: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
  },
  ipPort: {
    display: 'flex',
    gap: 5,
  },
  input: {
    background: '#1C1917',
    border: '1px solid #3D3735',
    borderRadius: 6,
    color: '#FAFAF9',
    fontSize: 12,
    padding: '5px 8px',
    outline: 'none',
    width: '100%',
  },
  removeBtn: {
    background: 'none',
    border: 'none',
    color: '#78716C',
    fontSize: 12,
    cursor: 'pointer',
    paddingTop: 6,
    flexShrink: 0,
  },
  addBtn: {
    background: 'none',
    border: '1px dashed #3D3735',
    borderRadius: 7,
    color: '#78716C',
    fontSize: 12,
    padding: '6px 0',
    cursor: 'pointer',
    width: '100%',
  },
  errorMsg: {
    fontSize: 12,
    color: '#EF4444',
  },
  saveBtn: {
    background: '#14B8A6',
    border: 'none',
    borderRadius: 7,
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    padding: '8px 0',
    cursor: 'pointer',
    width: '100%',
    transition: 'opacity 0.15s',
  },
}
