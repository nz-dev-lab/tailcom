# tailcom

A peer-to-peer voice intercom system that works exclusively over a Tailscale private network (tailnet). Zero central server. Zero VOIP. Audio is peer-to-peer via WebRTC. Signalling (SDP handshake) happens over a direct WebSocket connection from dashboard to client using known Tailscale IPs.

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
│   │  ┌────────────────────┐  │   │  ┌─────────────────────┐  │  │
│   │  │  Electron App      │  │   │  │  Node.js / Electron │  │  │
│   │  │  React UI          │  │   │  │  Background Process │  │  │
│   │  │                    │  │   │  │                     │  │  │
│   │  │  [Client List]     │  │   │  │  WebSocket Server   │  │  │
│   │  │  ● Salt n Pepper   │  │   │  │  port :7654         │  │  │
│   │  │  ○ Client 2        │  │   │  │                     │  │  │
│   │  │                    │  │   │  │  Auto-accepts calls │  │  │
│   │  │  [Call Bar]        │  │   │  │  No UI / No alerts  │  │  │
│   │  │  🔴 LIVE  00:23    │  │   │  └─────────────────────┘  │  │
│   │  └────────────────────┘  │   └───────────────────────────┘  │
│   │                          │                │                  │
│   │  WebSocket client ───────┼────────────────▶ WebSocket server │
│   │                          │   (1) ping/pong status polling    │
│   │                          │   (2) SDP offer/answer exchange   │
│   │                          │   (3) ICE candidate exchange      │
│   │                          │                                   │
│   │  WebRTC (audio) ◀────────┼────────────────▶ WebRTC (audio)  │
│   │                          │   peer-to-peer over Tailscale     │
│   └──────────────────────────┘                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

Connection Flow:
  1. Dashboard polls each client every 5s with WebSocket ping/pong
  2. User clicks "Talk" on an online client
  3. Dashboard opens WebSocket to client's Tailscale IP:7654
  4. Dashboard creates WebRTC offer (offerer role)
  5. Client receives offer, creates WebRTC answer (answerer role)
  6. Both sides exchange ICE candidates over WebSocket
  7. WebRTC connects — bidirectional audio flows peer-to-peer
  8. WebSocket stays open for hangup signalling
  9. Either side sends hangup → WebRTC tears down → server stays listening

No STUN servers. No TURN servers. No relay. Direct IP via Tailscale.
```

---

## Packages

| Package | Description |
|---|---|
| `tailcom-client` | npm package — embed in any Electron app to make it callable |
| `tailcom-dashboard` | Electron desktop app — developer's intercom panel |

---

*Full documentation coming in Step 10.*
