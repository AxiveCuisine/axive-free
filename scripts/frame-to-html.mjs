// Turns a raw frame captured with AXIVE_FRAME_DUMP (<file>.ansi) into an HTML
// page that looks like the Axive window: used to make the site's screenshots.
//
//   node scripts/frame-to-html.mjs build/shots/home.ansi build/shots/home.html [--title "a x i v e"]
import fs from 'node:fs'

const [input, output] = process.argv.slice(2)
const whisperAt = process.argv.indexOf('--whisper')
const whisper = whisperAt > 0 ? process.argv[whisperAt + 1] : undefined
const lines = fs.readFileSync(input, 'utf8').split('\n')
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function render(line) {
  let out = ''
  let style = {}
  let open = false
  const close = () => {
    if (open) out += '</span>'
    open = false
  }
  const apply = () => {
    close()
    const css = []
    if (style.fg) css.push(`color:${style.fg}`)
    if (style.bg) css.push(`background:${style.bg}`)
    if (style.bold) css.push('font-weight:700')
    if (style.italic) css.push('font-style:italic')
    if (style.dim) css.push('opacity:.6')
    if (css.length) {
      out += `<span style="${css.join(';')}">`
      open = true
    }
  }
  const re = /\x1b\[([0-9;]*)m|\x1b\[[0-9;?]*[A-Za-z]|\x1b[78]|\x1b#[0-9]|\x1b\][^\x07]*\x07/g
  let last = 0
  let m
  while ((m = re.exec(line))) {
    out += esc(line.slice(last, m.index))
    last = re.lastIndex
    if (m[1] === undefined) continue
    const codes = m[1] === '' ? [0] : m[1].split(';').map(Number)
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i]
      if (c === 0) style = {}
      else if (c === 1) style.bold = true
      else if (c === 2) style.dim = true
      else if (c === 3) style.italic = true
      else if (c === 22) (style.bold = false), (style.dim = false)
      else if (c === 23) style.italic = false
      else if (c === 39) delete style.fg
      else if (c === 49) delete style.bg
      else if ((c === 38 || c === 48) && codes[i + 1] === 2) {
        const rgb = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`
        if (c === 38) style.fg = rgb
        else style.bg = rgb
        i += 4
      }
    }
    apply()
  }
  out += esc(line.slice(last))
  close()
  return out
}

const plain = lines.map(l => l.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b[78]|\x1b#[0-9]|\x1b\][^\x07]*\x07/g, ''))
const rows = []
for (let i = 0; i < lines.length; i++) {
  // two identical, half-width rows in a row: the double-height sigil
  const twin = plain[i].trim() && plain[i] === plain[i + 1] && (/[֐-׿Ͱ-Ͽ　-鿿A-Z] ·/.test(plain[i]) || plain[i].includes("A X I V E"))
  if (twin) {
    rows.push(`<div class="row grand">${render(lines[i])}</div>`)
    i++
  } else rows.push(`<div class="row">${render(lines[i]) || ' '}</div>`)
}

// a still frame can catch the whisper mid-turn: let it say something whole
if (whisper) {
  const pad = Math.max(0, Math.floor((112 - whisper.length) / 2))
  rows[rows.length - 1] = '<div class="row">' + ' '.repeat(pad) + '<span style="color:#3d3842;font-style:italic">' + esc(whisper) + '</span></div>'
}

fs.writeFileSync(
  output,
  `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:transparent}
.frame{display:inline-block;margin:36px;border-radius:10px;overflow:hidden;background:#060609;box-shadow:0 30px 90px rgba(0,0,0,.65),0 0 0 1px #1c1a20}
.screen{padding:8px 14px 12px;background:radial-gradient(ellipse at center,transparent 55%,rgba(0,0,0,.5)),#060609}
.row{unicode-bidi:bidi-override;direction:ltr;font:16px/20px 'Cascadia Mono','Cascadia Code',Consolas,monospace;white-space:pre;color:#d8d0bf;height:20px}
.row span{unicode-bidi:bidi-override;direction:ltr}
.row.grand{font-size:32px;line-height:40px;height:40px}
</style><div class="frame"><div class="screen">${rows.join('')}</div></div>`,
)
console.log(`wrote ${output}: ${rows.length} rows`)
