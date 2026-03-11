import { spawn, ChildProcess } from 'child_process'

// Inline types — no @types/node-record-lpcm16 on npm
// eslint-disable-next-line @typescript-eslint/no-require-imports
const record = require('node-record-lpcm16') as {
  record(options: {
    sampleRate: number; channels: number; audioType: string
    recorder: string; verbose: boolean; silence: number
  }): { stream(): import('stream').Readable; stop(): void }
}

const SAMPLE_RATE = 48000
const CHANNELS = 1
const BIT_DEPTH = 16
const FRAME_MS = 10
const FRAME_SAMPLES = (SAMPLE_RATE * FRAME_MS) / 1000   // 480
const BYTES_PER_FRAME = FRAME_SAMPLES * (BIT_DEPTH / 8) // 960

export interface AudioSource {
  onData(data: {
    samples: Int16Array
    sampleRate: number
    bitsPerSample: number
    channelCount: number
    numberOfFrames: number
  }): void
}

export interface AudioSink {
  ondata: ((data: {
    samples: Int16Array
    sampleRate: number
    bitsPerSample: number
    channelCount: number
    numberOfFrames: number
  }) => void) | null
}

// ── Mic capture ───────────────────────────────────────────────────────────────

export function startMicCapture(
  source: AudioSource,
  isMuted: () => boolean,
): () => void {
  const recorder = record.record({
    sampleRate: SAMPLE_RATE,
    channels: CHANNELS,
    audioType: 'raw',
    recorder: process.platform === 'win32' ? 'sox' : 'arecord',
    verbose: false,
    silence: 0,
  })

  let overflow = Buffer.alloc(0)

  const stream = recorder.stream()
  stream.on('data', (chunk: Buffer) => {
    overflow = Buffer.concat([overflow, chunk])
    while (overflow.length >= BYTES_PER_FRAME) {
      const frame = overflow.slice(0, BYTES_PER_FRAME)
      overflow = overflow.slice(BYTES_PER_FRAME)

      if (!isMuted()) {
        const samples = new Int16Array(FRAME_SAMPLES)
        for (let i = 0; i < FRAME_SAMPLES; i++) {
          samples[i] = frame.readInt16LE(i * 2)
        }
        source.onData({
          samples,
          sampleRate: SAMPLE_RATE,
          bitsPerSample: BIT_DEPTH,
          channelCount: CHANNELS,
          numberOfFrames: FRAME_SAMPLES,
        })
      }
    }
  })

  stream.on('error', () => { /* non-fatal */ })

  return () => {
    try { recorder.stop() } catch { /* ignore */ }
  }
}

// ── Speaker playback ──────────────────────────────────────────────────────────

export function startSpeakerPlayback(sink: AudioSink): () => void {
  let player: ChildProcess | null = null

  if (process.platform === 'win32') {
    player = spawn('sox', [
      '-t', 'raw',
      '-r', String(SAMPLE_RATE),
      '-e', 'signed-integer',
      '-b', String(BIT_DEPTH),
      '-c', String(CHANNELS),
      '-',
      '-d',
    ], { stdio: ['pipe', 'ignore', 'ignore'] })
  } else {
    player = spawn('aplay', [
      '-r', String(SAMPLE_RATE),
      '-c', String(CHANNELS),
      '-f', 'S16_LE',
      '-t', 'raw',
      '-',
    ], { stdio: ['pipe', 'ignore', 'ignore'] })
  }

  player.on('error', () => { /* non-fatal */ })

  sink.ondata = (data) => {
    if (!player?.stdin?.writable) return
    player.stdin.write(
      Buffer.from(data.samples.buffer, data.samples.byteOffset, data.samples.byteLength)
    )
  }

  return () => {
    sink.ondata = null
    try { player?.stdin?.end() } catch { /* ignore */ }
    try { player?.kill() } catch { /* ignore */ }
    player = null
  }
}
