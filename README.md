# tailcom

Peer-to-peer voice intercom over a [Tailscale](https://tailscale.com) private network.
Zero central server. Zero VOIP. Audio is WebRTC peer-to-peer — signalling happens directly over WebSocket using known Tailscale IPs.

---

## How it works

```
Dashboard ──WebSocket──▶ Client (Tailscale IP:7654)
          ◀── SDP offer/answer exchange ──▶
          ◀── ICE candidate exchange ──▶
          ◀═══ WebRTC audio P2P over Tailscale ═══▶
```

**tailcom-client** runs silently on each shop machine. It listens for a WebSocket connection, auto-accepts every call, and handles bidirectional audio.

**tailcom-dashboard** is the developer's Electron app. It polls each configured client for online/offline status and lets you start a call with one click.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Tailscale Network (tailnet)              │
│                                                                 │
│   ┌──────────────────────────┐   ┌───────────────────────────┐  │
│   │   tailcom-dashboard      │   │   tailcom-client          │  │
│   │   (developer laptop)     │   │   (shop machine)          │  │
│   │                          │   │                           │  │
│   │  React UI                │   │  Node.js background       │  │
│   │  ● Salt n Pepper         │   │  WebSocket server :7654   │  │
│   │  🔴 LIVE  00:23   [✕]   │   │  Auto-accepts calls       │  │
│   │                          │   │  No UI / No alerts        │  │
│   └──────────────────────────┘   └───────────────────────────┘  │
│            │                               │                     │
│            └──── WebSocket signalling ─────┘                     │
│            └──── WebRTC audio (P2P) ───────┘                     │
└─────────────────────────────────────────────────────────────────┘
```

Connection flow:
1. Dashboard polls each client every 5s with WebSocket ping/pong
2. User clicks **Talk** on an online client
3. Dashboard opens WebSocket → creates SDP offer → sends it
4. Client auto-accepts → creates SDP answer → sends back
5. Both sides exchange ICE candidates over WebSocket
6. WebRTC connects — bidirectional audio flows peer-to-peer
7. Either side hangs up → WebRTC tears down → server stays listening

No STUN. No TURN. No relay. Direct IP via Tailscale.

---

## Monorepo structure

```
tailcom/
├── packages/
│   ├── tailcom-client/     ← npm package, embed in client Electron apps
│   └── tailcom-dashboard/  ← Electron desktop app, developer only
├── package.json            ← npm workspaces
├── tsconfig.json
└── test-local.ts           ← local signalling handshake test
```

---

## Quick start

### Prerequisites

- Node.js 18+
- npm 9+
- Both machines on the same Tailscale network

### Install

```bash
npm install
```

### Configure the dashboard

Edit `packages/tailcom-dashboard/tailcom.config.json`:

```json
{
  "dashboardId": "developer-laptop",
  "clients": [
    {
      "name": "Shop Name",
      "ip": "100.x.x.x",
      "port": 7654
    }
  ]
}
```

Use the Tailscale IP of each client machine. You can also edit this live from inside the app via the ⚙ Settings panel — saves to disk and takes effect without restart.

### Build

```bash
npm run build
```

### Run the dashboard

```bash
npm run start:dashboard
```

---

## Embedding the client

Install the package in your Electron app:

```bash
npm install tailcom-client
```

```typescript
import { TailcomClient } from 'tailcom-client'

const intercom = new TailcomClient({ port: 7654 })

app.whenReady().then(async () => {
  await intercom.start()
})

app.on('before-quit', () => intercom.stop())

intercom.on('call-started', () => { /* optional */ })
intercom.on('call-ended',   () => { /* optional */ })
intercom.on('error', (err) => console.error(err))
```

The client is completely silent — no UI, no OS notifications, no interruptions to your app.

---

## Dashboard UI

| Element | Description |
|---------|-------------|
| Green dot | Client is online and reachable |
| Red dot | Client is offline or unreachable |
| **Talk** button | Starts a call (disabled when offline or already in a call) |
| CallBar | Appears during a call — shows client name, live timer, mute toggle, hang-up button |
| ⚙ Settings | Edit client names, IPs, ports; add/remove clients |
| System tray | Window hides on close; right-click → Show / Quit |

---

## Run the test

```bash
npm test
```

Starts tailcom-client on loopback, runs a mock dashboard through the full
ping → SDP offer/answer → ICE exchange, then hangs up.

Expected output:
```
  ✅ tailcom-client listening on port 7654
  ✅ WebSocket connected to client
  ✅ ping → pong
  ✅ SDP offer → SDP answer received
  ✅ ICE candidate exchange (no errors)
  ✅ hangup sent

✅ Signalling handshake complete
```

---

## Technical notes

- **No STUN or TURN** — works only on direct-routable networks (Tailscale handles NAT traversal)
- **`@roamhq/wrtc`** — WebRTC in Electron main / Node processes
- **`ws`** — WebSocket server and client
- **One connection at a time** — client rejects any second connection while a call is active
- **Audio I/O** — uses `RTCAudioSource` / `RTCAudioSink` from wrtc's nonstandard API; real mic capture and speaker output can be wired in via `node-record-lpcm16` / `node-speaker`

---

## License

MIT
