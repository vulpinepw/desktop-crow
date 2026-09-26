# Credits

## Author

**Desktop Crow is made by tordev.** Idea, design, code, art, animation and
sound: tordev. Copyright (c) 2026 tordev, released under the MIT licence (see
`LICENSE`).

## Art, animation and sound

Everything you see and hear from the crow was made by tordev for this project
and is covered by the project's MIT licence (see `LICENSE`), except where the
table says otherwise:

| Asset | What it is | Source |
|---|---|---|
| The crow | A procedural 3D rig (ellipsoid body and head, beak, eyes, wings, tail, and two-bone IK legs with toes) seen by a tilted camera from any side, projected and drawn with the Canvas API at run time. No image files, sprite sheets or third-party models. | `src/core/rig.js`, `src/renderer/draw.js` |
| Animations | idle, walk, hop, fly, land, perch, eat, sleep, peck, gift-drop, react-to-click, react-to-food-spawn, being carried, dancing and being petted: all procedural (springs, IK, planned flight paths). | `src/core/crow.js` |
| The box | The cardboard box the crow arrives in (red tape, *OPEN ME* in red marker, opening flaps) and the mood bubbles: drawn with the Canvas API at run time. | `src/renderer/art.js` |
| Food, shiny things and gifts | Vector drawings in code. | `src/renderer/art.js` |
| Crumbs, sparkles, dust, notes | Particle effects in code. | `src/renderer/fx.js` |
| Sounds (caw, chirp, flap, drop, pick-up, thud) | Synthesized with WebAudio at run time; no audio files. | `src/renderer/audio.js` |
| App and tray icons | Rendered from the same crow rig by `npm run icons`. | `scripts/make-icons.js`, `build/`, `assets/` |
| Settings decoration | Roses, brambles, blackberries, falling petals, the moon and the five stage emblems (thorny stem, sprout, bud, opening rose, full rose): drawn as SVG and CSS by code at run time, and animated with CSS. | `src/renderer/thicket.js`, `src/renderer/settings.css` |
| Interface icons | Line icons drawn as SVG paths. Several follow the shapes of [Lucide](https://lucide.dev) icons (see *Lucide* below). | `src/renderer/icons.js` |
| Fonts | The operating system's own UI fonts; none are bundled. | |

Design references: the idea of a mischievous desktop animal comes from *Desktop
Goose* by samperson, and the settings window follows the clean look of
[shadcn/ui](https://ui.shadcn.com). No code, art or sound from either is used,
and this project is not affiliated with them.

### Lucide

Some interface icon paths in `src/renderer/icons.js` are based on Lucide icons.

> ISC License. Copyright (c) for portions of Lucide are held by Cole Bemis
> 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held
> by Lucide Contributors 2022.
>
> Permission to use, copy, modify, and/or distribute this software for any
> purpose with or without fee is hereby granted, provided that the above
> copyright notice and this permission notice appear in all copies.
>
> THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
> REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
> AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
> INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
> LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
> OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
> PERFORMANCE OF THIS SOFTWARE.

## Software

Shipped inside the installers:

| Component | Version | Licence | Use |
|---|---|---|---|
| [Electron](https://www.electronjs.org/) | 44.4.5 | MIT | App runtime (includes Chromium, BSD-3-Clause and others, and Node.js, MIT; their full licence texts are shipped next to the app as `LICENSE.electron.txt` and `LICENSES.chromium.html`) |
| [koffi](https://koffi.dev/) | 3.3.1 | MIT | FFI used to read other windows' positions (user32/dwmapi on Windows, libX11 on Linux) and to colour the Settings window's title bar on Windows 11 |

The music detection uses what the operating system already provides: Windows
PowerShell and the Windows media controls API on Windows, `dbus-send` and MPRIS
on Linux. Neither is shipped with the app.

Used only to build:

| Tool | Version | Licence |
|---|---|---|
| [electron-builder](https://www.electron.build/) | 26.15.3 | MIT |
| [esbuild](https://esbuild.github.io/) | 0.28.2 | MIT |
| [Node.js](https://nodejs.org/) test runner | 22+ | MIT |
