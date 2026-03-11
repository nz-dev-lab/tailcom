/**
 * test-local.ts — local signalling handshake test
 *
 * Starts tailcom-client on port 7654 (loopback), then runs a mock dashboard
 * that performs the full ping → offer → answer → ICE exchange.
 *
 * Run with: npx ts-node test-local.ts
 */

import { TailcomClient } from './packages/tailcom-client/src/index'
import { WebSocket } from 'ws'

const PORT = 7654
const TIMEOUT_MS = 8000

// ── Helpers ───────────────────────────────────────────────────────────────────

function pass(msg: string) {
  console.log(`  ✅ ${msg}`)
}

function fail(msg: string) {
  console.error(`  ❌ Failed: ${msg}`)
  process.exit(1)
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout: ${label}`)), ms)
    ),
  ])
}

// ── Mock SDP (no wrtc dependency in test) ────────────────────────────────────

const MOCK_OFFER: RTCSessionDescriptionInit = {
  type: 'offer',
  sdp: [
    'v=0',
    'o=- 0 0 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    'c=IN IP4 0.0.0.0',
    'a=rtcp:9 IN IP4 0.0.0.0',
    'a=ice-ufrag:test',
    'a=ice-pwd:testpassword12345678901',
    'a=fingerprint:sha-256 00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00',
    'a=setup:actpass',
    'a=mid:0',
    'a=rtcp-mux',
    'a=sendrecv',
    'a=rtpmap:111 opus/48000/2',
    'a=ssrc:1 cname:test',
  ].join('\r\n') + '\r\n',
}

// ── Test runner ───────────────────────────────────────────────────────────────

async function run() {
  console.log('\ntailcom — local signalling handshake test\n')

  // 1. Start client
  const client = new TailcomClient({ port: PORT, autoAccept: true })
  client.on('error', (err) => fail(`client error: ${err.message}`))

  await withTimeout(client.start(), TIMEOUT_MS, 'client start')
  pass(`tailcom-client listening on port ${PORT}`)

  // 2. Connect mock dashboard WebSocket
  const ws = await withTimeout(
    new Promise<WebSocket>((resolve, reject) => {
      const sock = new WebSocket(`ws://127.0.0.1:${PORT}`)
      sock.on('open', () => resolve(sock))
      sock.on('error', reject)
    }),
    TIMEOUT_MS,
    'WebSocket connect',
  )
  pass('WebSocket connected to client')

  function send(msg: object) {
    ws.send(JSON.stringify(msg))
  }

  function nextMessage(): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      ws.once('message', (data) => {
        try { resolve(JSON.parse(data.toString()) as Record<string, unknown>) }
        catch { reject(new Error('invalid JSON')) }
      })
      ws.once('error', reject)
    })
  }

  // 3. Ping → pong
  send({ type: 'ping' })
  const pong = await withTimeout(nextMessage(), TIMEOUT_MS, 'pong')
  if (pong.type !== 'pong') fail(`expected pong, got: ${pong.type as string}`)
  pass('ping → pong')

  // 4. Send SDP offer → expect SDP answer
  send({ type: 'offer', sdp: MOCK_OFFER })
  const answer = await withTimeout(nextMessage(), TIMEOUT_MS, 'SDP answer')
  if (answer.type !== 'answer') fail(`expected answer, got: ${answer.type as string}`)
  if (!answer.sdp) fail('answer missing sdp field')
  pass('SDP offer → SDP answer received')

  // 5. Send a mock ICE candidate → expect the client to accept silently
  //    (no crash = pass)
  send({
    type: 'ice-candidate',
    candidate: {
      candidate: 'candidate:0 1 UDP 2113667327 127.0.0.1 54321 typ host',
      sdpMid: '0',
      sdpMLineIndex: 0,
    },
  })
  // Give it 200ms to process without error
  await new Promise((r) => setTimeout(r, 200))
  pass('ICE candidate exchange (no errors)')

  // 6. Hang up
  send({ type: 'hangup' })
  await new Promise((r) => setTimeout(r, 200))
  pass('hangup sent')

  // Done
  ws.close()
  client.stop()

  console.log('\n✅ Signalling handshake complete\n')
  process.exit(0)
}

run().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`\n❌ Failed: ${msg}\n`)
  process.exit(1)
})
