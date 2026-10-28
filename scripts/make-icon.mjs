// Draws Axive's icon — the tree of life, ten blood-red sefirot on black
// water — and writes it as a multi-size .ico (PNG entries, Vista+).
// usage: node scripts/make-icon.mjs <out.ico>
import {writeFileSync} from 'node:fs'
import {deflateSync} from 'node:zlib'

const out = process.argv[2]
if (!out) throw new Error('usage: make-icon.mjs <out.ico>')

// same layout as the boot screen: [column, row] on a 22×14 grid
const NODES = [[11, 0], [22, 2], [0, 2], [22, 6], [0, 6], [11, 8], [22, 10], [0, 10], [11, 12], [11, 14]]
const PATHS = [
  [0, 1], [0, 2], [0, 5], [1, 2], [1, 5], [1, 3], [2, 5], [2, 4], [3, 4], [3, 5], [3, 6],
  [4, 5], [4, 7], [5, 6], [5, 8], [5, 7], [6, 7], [6, 8], [6, 9], [7, 8], [7, 9], [8, 9],
]
const BG = [6, 6, 9]
const RIM = [58, 14, 20]
const PATH = [111, 106, 114]
const NODE = [163, 20, 30]
const CROWN = [216, 208, 191]

const segDist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}
const blend = (dst, src, a) => dst.map((c, i) => c + (src[i] - c) * a)

function render(size) {
  const SS = 4 // supersampling per axis
  const px = new Uint8Array(size * size * 4)
  const nodes = NODES.map(([c, r]) => [0.27 + (c / 22) * 0.46, 0.13 + (r / 14) * 0.74])
  const nodeR = Math.max(0.043, 1.4 / size)
  const lineW = Math.max(0.009, 0.6 / size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let acc = [0, 0, 0], alpha = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size
          const v = (y + (sy + 0.5) / SS) / size
          // rounded square, a thin red rim inside its edge
          const q = Math.max(Math.abs(u - 0.5) - 0.32, Math.abs(v - 0.5) - 0.32)
          const corner = Math.hypot(Math.max(Math.abs(u - 0.5) - 0.32, 0), Math.max(Math.abs(v - 0.5) - 0.32, 0))
          const d = (q > 0 ? corner : q) - 0.16
          if (d > 0) continue
          let color = d > -Math.max(0.018, 0.8 / size) ? RIM : BG
          for (const [a, b] of PATHS) {
            const [ax, ay] = nodes[a], [bx, by] = nodes[b]
            if (segDist(u, v, ax, ay, bx, by) < lineW) color = blend(color, PATH, 0.85)
          }
          nodes.forEach(([nx, ny], i) => {
            if (Math.hypot(u - nx, v - ny) < nodeR) color = i === 0 ? CROWN : NODE
          })
          acc = acc.map((c, i) => c + color[i])
          alpha++
        }
      }
      const o = (y * size + x) * 4
      if (alpha) for (let i = 0; i < 3; i++) px[o + i] = Math.round(acc[i] / alpha)
      px[o + 3] = Math.round((alpha / (SS * SS)) * 255)
    }
  }
  return png(size, px)
}

const CRC = Array.from({length: 256}, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = buf => {
  let c = 0xffffffff
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, {level: 9})),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const sizes = [16, 24, 32, 48, 64, 128, 256]
const images = sizes.map(render)
const header = Buffer.alloc(6 + sizes.length * 16)
header.writeUInt16LE(1, 2) // type: icon
header.writeUInt16LE(sizes.length, 4)
let offset = header.length
sizes.forEach((size, i) => {
  const e = 6 + i * 16
  header[e] = size === 256 ? 0 : size
  header[e + 1] = size === 256 ? 0 : size
  header.writeUInt16LE(1, e + 4) // planes
  header.writeUInt16LE(32, e + 6) // bpp
  header.writeUInt32LE(images[i].length, e + 8)
  header.writeUInt32LE(offset, e + 12)
  offset += images[i].length
})
writeFileSync(out, Buffer.concat([header, ...images]))
// the 256px frame doubles as a preview
writeFileSync(out.replace(/\.ico$/i, '.png'), images.at(-1))
console.log(`wrote ${out}`)
