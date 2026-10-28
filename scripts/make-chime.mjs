// Synthesizes the ghost chime: build/chime.wav (16-bit PCM, mono, 44.1 kHz).
// Our own work, no samples: two soft sine notes a perfect fifth apart
// (E6 then B6, overlapping), each with an 8 ms raised-cosine attack and an
// exponential decay, normalized to -14 dBFS and faded to exact zero.
// Run: node scripts/make-chime.mjs
import {mkdirSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const RATE = 44100
const SECONDS = 0.6
const PEAK_DBFS = -14
const ATTACK = 0.008
const TAIL = 0.06 // final fade so the last sample is exactly 0

const notes = [
  // {start s, frequency Hz, level, decay time constant s}
  {start: 0.0, freq: 1318.51, level: 1.0, tau: 0.11}, // E6
  {start: 0.085, freq: 1975.53, level: 0.8, tau: 0.13}, // B6, a fifth above
]

const n = Math.round(RATE * SECONDS)
const buf = new Float64Array(n)
for (const note of notes) {
  const first = Math.round(note.start * RATE)
  for (let i = first; i < n; i++) {
    const t = (i - first) / RATE
    const attack = t < ATTACK ? 0.5 - 0.5 * Math.cos((Math.PI * t) / ATTACK) : 1
    const env = attack * Math.exp(-t / note.tau)
    // a faint octave partial gives the sine a little body without harshness
    const s = Math.sin(2 * Math.PI * note.freq * t) + 0.12 * Math.sin(2 * Math.PI * note.freq * 2 * t) * Math.exp(-t / (note.tau / 2))
    buf[i] += note.level * env * s
  }
}
const tailStart = n - Math.round(TAIL * RATE)
for (let i = tailStart; i < n; i++) {
  const x = (i - tailStart) / (n - 1 - tailStart)
  buf[i] *= 0.5 + 0.5 * Math.cos(Math.PI * x)
}
buf[n - 1] = 0

let peak = 0
for (const v of buf) peak = Math.max(peak, Math.abs(v))
const gain = 10 ** (PEAK_DBFS / 20) / peak
const pcm = Buffer.alloc(n * 2)
for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[i] * gain)) * 32767), i * 2)

const header = Buffer.alloc(44)
header.write('RIFF', 0)
header.writeUInt32LE(36 + pcm.length, 4)
header.write('WAVE', 8)
header.write('fmt ', 12)
header.writeUInt32LE(16, 16)
header.writeUInt16LE(1, 20) // PCM
header.writeUInt16LE(1, 22) // mono
header.writeUInt32LE(RATE, 24)
header.writeUInt32LE(RATE * 2, 28)
header.writeUInt16LE(2, 32)
header.writeUInt16LE(16, 34)
header.write('data', 36)
header.writeUInt32LE(pcm.length, 40)

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'chime.wav')
mkdirSync(dirname(out), {recursive: true})
const wav = Buffer.concat([header, pcm])
writeFileSync(out, wav)
let peakSample = 0
for (let i = 0; i < n; i++) peakSample = Math.max(peakSample, Math.abs(pcm.readInt16LE(i * 2)))
console.log(`build/chime.wav: ${wav.length} bytes, ${Math.round((n / RATE) * 1000)} ms, peak ${(20 * Math.log10(peakSample / 32767)).toFixed(1)} dBFS, last sample ${pcm.readInt16LE((n - 1) * 2)}`)
