# Axive GUI · design system ("nature morte")

The GUI is Axive drawn for a pointer, not the terminal in a frame. It keeps the
identity the TUI and the site already have (bone on black water, one mark of
dried blood, Cormorant, the Hebrew sigil, letters that surface out of the dark)
and gives it a graphical grammar of its own.

## Direction

A Dutch *nature morte*: a dark ground, a single light from the upper left,
few objects, each placed with care, nothing loud. That is where the brief's
words point once the literal references are taken away: gourmet presentation
(the plate is the composition, not the food), art-house cinematography (one
source of light, held frames, slow movement), esoteric horror (what is not
shown, the sigil, text that rises out of another alphabet), restrained
opulence (generous emptiness, one precious colour used once), unsettling
sophistication (thumbnails that "develop" from grey when you look at them).

What it refuses: cream or off-white grounds, gradients as decoration,
Inter/system sans as display, rounded cards with soft shadows, glass, emoji,
italic accent words in headings, numbered "01/02/03" labels, monospace labels,
pill buttons, and anything literal (blood, food, quotes on cards, red as the
ground or as large fills).

## Colour: roles, not swatches

| Role | Token | Value | Use |
|---|---|---|---|
| ground | `--ground` | `#060609` | the window: black water |
| ground, raised | `--ground-raised` | `#0d0c11` | panels, the rail, popovers |
| ground, sunk | `--ground-sunk` | `#030305` | input wells, progress tracks |
| ink | `--ink` | `#d8d0bf` | primary text, primary button fill (bone) |
| ink, second | `--ink-2` | `#9a94a0` | secondary text, labels, metadata |
| ink, third | `--ink-3` | `#6c6672` | decorative or disabled only, never needed to understand |
| rule | `--rule` | `#25222b` | hairlines between things |
| rule, strong | `--rule-strong` | `#4a4550` | control borders (inputs, secondary buttons) |
| signal | `--signal` | `#7d0f17` | the seal: the one thing alive (running progress, the primary mark) |
| signal, ink | `--signal-ink` | `#d0434b` | the signal as text or a 1px line on ground (errors, live counts) |
| light | `--light` | `rgba(216,208,191,.045)` | the single light source, upper left |

Rules
- Bone is the only bright thing. Red appears at most once on an idle view
  (the seal next to the wordmark) and otherwise only for something moving or
  something wrong.
- No hue is added for success: done is bone with a ∴.
- Text contrast on `--ground`: ink ≥ 12:1, ink-2 ≥ 6:1, signal-ink ≥ 4.5:1
  (all measured, see the verification section). ink-3 is decoration only.
- Thumbnails rest at `grayscale(.65) brightness(.78)` and develop to full
  colour on hover, focus or selection.

## Type

| Role | Face | Size / line | Notes |
|---|---|---|---|
| wordmark | Cormorant SC 500 | 15 / 1, tracking .55em | "AXIVE", the rail and the gate |
| view title | Cormorant 400 | 40 / 1.05, tracking −.005em | one per view, sentence case |
| section title | Cormorant 500 | 24 / 1.15 | |
| label | Cormorant SC 500 | 14.5 / 1.2, tracking .14em | small caps, lowercase source text |
| body | Source Serif 4 (opsz auto) 400 | 16 / 1.55 | interface prose, lists |
| data | Source Serif 4 400, `tnum lnum` | 14.5 / 1.3 | sizes, speeds, times, counts |
| meta | Source Serif 4 400 | 13.5 / 1.4 | captions, paths, hints |
| sigil | FrankRuehl, David, Times New Roman | 15, tracking .6em | אקסיב, set in visual order |

Scale steps 13.5 · 14.5 · 16 · 19 · 26 · 40 (2.4: one step up from 1.4, the owner found the glyphs too small; icons 19 px, rail doors 17.5). Two faces
only, both OFL and bundled: Cormorant (display, already the brand's) and
Source Serif 4 (an optical-size text face made for screens, with tabular
figures for the numbers a download manager is made of).

## Space

Base 4. Steps: 4 · 8 · 12 · 16 · 24 · 32 · 48 · 72 · 112.
- Inside controls: 8 vertical, 16 horizontal.
- Between related items: 12; between groups: 32; view margins: 48 (72 on wide).
- The rail is 216 wide; content measure caps at 760 (prose) and 1040 (lists).
- Composition: the Draw view sits on the window's vertical axis, one-point,
  like a held frame; every other view is left-aligned on a single column with
  hairline rules. Corner ticks (8px, `--rule-strong`) mark the frame of the
  active view: a film gate, not a box.

## Shape

Radius 0 for buttons, inputs and panels; 2 for the focus ring only. Borders are
1px. No shadows; depth comes from ground steps and the light.

## Motion

| Name | Duration | Curve | What |
|---|---|---|---|
| hover | 120ms | linear | ink-2 → ink, rule → rule-strong |
| state | 240ms | cubic-bezier(.2,.6,.2,1) | toggles, selection, thumbnails developing |
| surface | 420ms | cubic-bezier(.2,.6,.2,1) | entering: opacity 0→1, blur 4px→0, 6px rise |
| sink | 280ms | cubic-bezier(.4,0,.6,1) | leaving: opacity →0, 4px fall |
| scramble | 600ms | stepped | notices and the whisper line resolve out of Hebrew letters, as in the TUI |
| breath | 6s | ease-in-out | the sigil's opacity .55↔.9 |
| the deep | always | 30 fps canvas | letters and motes rising behind the window (`alive.tsx`); quicker, with a red tide at the foot, while something draws |
| ripple | 720ms | var(--ease) | a ring from the pointer on any button, door or card: ink dropped in water |
| stagger | 480ms, +35ms a row | var(--ease) | rows, settings and vessels rise in one after another (fill: backwards, so resting rows keep their own opacity) |
| sheen | 1.7s | linear | a light running along live progress; the primary button catches it on hover |
| heartbeat | 5.6s | ease-in-out | the seal beats; the wordmark catches the light every 8s |

2.4: the owner asked for a livelier window. Progress is still a line that
fills linearly, with a sheen on the red while it moves; live counts pulse,
the active filter's diamond turns, switches fill like a drop of ink and ring
once. "animations" off (the in-app setting) stills all of it: the deep goes,
entrances become plain. The OS reduced-motion preference is not followed:
many PCs report it without anyone asking (the owner's do), as on the site.

## Interaction grammar

- Hover lightens; it never lifts. Links and text buttons draw a hairline
  underline from the centre out (240ms).
- Press: the control sinks 1px and its ground darkens one step.
- Focus: a 1px bone ring, 3px out, on `:focus-visible` only; always visible
  for the keyboard.
- Selection in a list: a 2px bone bar on the left edge and the row's ink to
  bone. Red is never selection; red means alive or wrong.
- Primary button: bone fill, ground text, square. Secondary: 1px
  `--rule-strong` border, ink text. Tertiary: small caps text.
- Toggles are squares: an empty 12px square, filled ■ when on.
- Hints: the TUI's hover hints become tooltips, after 500ms, surfacing below
  the control on `--ground-raised` with a hairline; keyboard focus shows them
  too. Every icon button has an accessible name.
- Notices surface at the foot, in the whisper line, and sink by themselves;
  errors stay until dismissed.
- Drag a link, a .torrent or a media file anywhere on the window to offer it.

## Words

Every string goes through the same Simple Language table as the TUI
(`src/core/words.ts`), so the GUI follows the same toggle and the same rule:
words change, nothing else does.
