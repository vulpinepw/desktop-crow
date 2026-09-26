# Desktop Crow

<table>
<tr>
<td><img width="1306" alt="image" src="https://github.com/user-attachments/assets/ce849ffa-0ea7-4e40-931e-8907af442c03" /></td>
<td>

**Made by tordev.**

A small pet crow that lives on your desktop, inspired by *Desktop Goose*.
Your screen is its floor, seen from slightly above: it walks, hops and flies
all over it, perches on the top edges of your windows and on the taskbar,
naps, pecks at things, watches your pointer, eats the snacks that drop onto
your screen and, once it trusts you, brings you shiny gifts. You can pick it
up and carry it wherever you like.

Available on multiple OS: a Windows installer and a Linux AppImage (plus a
`.deb` for Debian/Ubuntu).

</td>
</tr>
</table>

## Install and run

### Windows 10/11 (x64)

1. Run `Desktop-Crow-Setup-1.3.0.exe`. It installs for your user only (no
   administrator rights) into `%LOCALAPPDATA%\Programs\desktop-crow`, with a
   Start-menu entry and a desktop shortcut.
2. The installer is not code-signed, so SmartScreen may say *"Windows protected
   your PC"*: click **More info → Run anyway**.
3. Start **Desktop Crow** from the Start menu. On first launch it asks for your
   crow's name and whether it is a *she* or a *he*; then the crow flies in.
   The crow icon appears in the notification area (it may be under the **^**
   overflow arrow).
4. Updating from an earlier version: install over it. Your crow, its trust
   and its treasures are kept, and your trust turns straight into the matching
   friendship level. Since 1.2 the blue button is no longer a gift, so
   collected buttons leave the Treasures list. Coming from 1.0, the crow comes
   back 20 % smaller (the size slider in Settings still goes bigger).

### Linux (x86_64)

**AppImage (any distribution):**

```bash
chmod +x Desktop-Crow-1.3.0-x86_64.AppImage
./Desktop-Crow-1.3.0-x86_64.AppImage
```

AppImages need FUSE 2. If it complains about FUSE, install it
(`sudo apt install libfuse2` on Ubuntu 22.04, `sudo apt install libfuse2t64`
on Ubuntu 24.04) or start it with `--appimage-extract-and-run`.

**Debian/Ubuntu package:**

```bash
sudo apt install ./desktop-crow_1.3.0_amd64.deb
```

Then start **Desktop Crow** from the application menu, or run `desktop-crow`.

Notes for Linux desktops:

* **Wayland:** the overlay needs X11 features (staying above other windows,
  the global pointer position, other windows' positions), so on Wayland the app
  re-launches itself on XWayland automatically. GNOME and KDE ship XWayland.
  The crow can only perch on windows that also run through XWayland; native
  Wayland apps don't reveal their window positions to other programs.
* **Tray icon on GNOME:** GNOME only shows tray icons with the *AppIndicator*
  extension (Ubuntu has it enabled). Without a tray, right-click the crow: it
  opens the same menu.
* **Ubuntu 24.04 and newer:** they restrict the user namespaces Chromium's
  sandbox uses inside AppImages. If the AppImage closes immediately with a
  *SUID sandbox* message, use the `.deb` or start it with `--no-sandbox`.

## A few screenshots

<div style="overflow-x: auto;">
<table>
<tr>
<td><img width="380" alt="screenshot 1" src="https://github.com/user-attachments/assets/b973babb-d4b6-4943-80ce-051733be48ec" /></td>
<td><img width="380" alt="screenshot 2" src="https://github.com/user-attachments/assets/770d42c0-e955-4252-9f35-39544594b65d" /></td>
<td><img width="380" alt="screenshot 3" src="https://github.com/user-attachments/assets/f40fc74e-34a2-46ce-b749-b347de62e271" /></td>
<td><img width="380" alt="screenshot 4" src="https://github.com/user-attachments/assets/16bbe847-80ff-4a9e-a65c-d09d429be53a" /></td>
<td><img width="380" alt="screenshot 5" src="https://github.com/user-attachments/assets/3f85353b-8fb7-42df-979e-f52fb87aa482" /></td>
</tr>
</table>
</div>

## Using it

Everything is in the tray menu (left- or right-click the crow icon) and in the
menu you get by right-clicking the crow itself:

| Menu item | What it does |
|---|---|
| **Hide *name*** / **Show *name*** | The crow flies off-screen (and uses almost no CPU while away) or comes back. |
| **Rename *name*…** | Change the name. |
| **Settings…** | Five tabs. **Crow:** how it feels right now (fullness, energy, happiness), name, pronouns, size (60–160 %) and your statistics. **Friendship:** your level, the five stages, milestones and how trust grows. **Treasures:** everything shiny you have collected. **Behaviour:** how lively it is, how often snacks appear, pointer reactions, perching on windows, other monitors, dancing to your music, sound and notifications. **System:** start with your computer, the animated decorations, the save folder and a reset. |
| **Feed *name*** | A treat drops in front of the crow and it eats it. |
| **Pause** / **Resume** | The crow settles down and stays put. |
| **Quit Desktop Crow** | Saves and stops the app completely. |

* **The box:** every time the app starts, your crow arrives in a cardboard box
  taped shut with red tape and marked *OPEN ME*. The box wobbles now and then
  while the crow waits. Click it (or use **Feed**) and the crow pops out and
  flies off onto your desktop; the empty box fades away.
* **Petting:** stroke your pointer back and forth over the crow a few times,
  without clicking. It fluffs up, closes its eyes, hearts float up and it
  chirps. Petting earns a little trust, up to 20 points a day.
* **How it feels:** the crow keeps track of how hungry, tired and happy it is.
  Now and then it tells you in a speech bubble with a bar (*Hungry*, *Tired*,
  *Happy*, *Satisfied* or *Sad*), and clicking it asks how it feels. Settings →
  Crow shows the same three bars, live.
* **Music:** when Spotify, Deezer, YouTube Music, a music video on YouTube or
  another music player is playing, the crow sometimes dances: head bobbing,
  little hops and turns, with music notes. Turn it off in Settings →
  Behaviour. See *Privacy* below for how this works.
* **Picking it up:** press on the crow and drag. It dangles from the pointer,
  flapping now and then, wherever you take it (other monitors included). Let
  go and it flutters down to the desktop right there; let go with its feet at
  a window's top edge (or the taskbar) and it sits on that edge. A flick as
  you let go sends it off in that direction.
* **Hand-feeding:** drag a snack that turned up on your screen up to the
  crow's beak and let go. Hand-feeding earns the most trust.
* **Gifts and treasures:** a crow that trusts you sometimes flies off and comes
  back with something shiny (you get a notification: *"*name* brought you
  something!"*). Click the gift to add it to your treasures (listed in
  Settings). Pick the crow up while it is bringing one and it drops it on the
  spot. Shiny things that drop onto your desktop are treasures too: click one
  to keep it, and the ones the crow flies off with are added as well.
* **Clicking the crow** (without dragging) startles it into a little reaction;
  clicking it three times quickly annoys it (it flies off, and loses a little
  trust in you).
* **Windows:** the crow likes to sit on the top edges of windows, and rides
  along when you move the window.
* **Friendship levels:** every snack you share, gift you collect and day you
  spend together earns trust points. They add up through 20 levels in five
  stages (Wary, Curious, Friendly, Trusting, Bonded); each stage changes how
  the crow behaves around you and how often it brings gifts. A little message
  pops up over the crow at every new level. Settings → Friendship shows your
  level, what the next stage brings and twelve milestones to unlock.
* How trust grows, the levels, the gift odds and the snack table are documented
  in [docs/AFFECTION.md](docs/AFFECTION.md).

## Stopping it

* Tray menu (or right-click the crow) → **Quit Desktop Crow**. This saves and
  ends every Desktop Crow process.
* From a terminal:
  * Windows: `"%LOCALAPPDATA%\Programs\desktop-crow\Desktop Crow.exe" --quit`
  * Linux: `desktop-crow --quit` (`.deb`) or `./Desktop-Crow-1.3.0-x86_64.AppImage --quit`
* To keep it but have it gone for a while, use **Hide** instead.
* Last resort: end *Desktop Crow* in Task Manager, or `pkill -f desktop-crow`.

**Uninstall:** Windows: *Settings → Apps → Desktop Crow → Uninstall*.
Linux: delete the AppImage, or `sudo apt remove desktop-crow`. If you turned
on *Start with my computer* on Linux, turn it off first (or delete
`~/.config/autostart/desktop-crow.desktop`). The Windows uninstaller removes
that entry itself. Your save file is kept; delete the data folder below to
forget your crow.

## Privacy

Desktop Crow does not use the network. To dance to your music it asks the
operating system what is playing, the same information your volume flyout or
media keys show: on Windows through the system media controls (a small
PowerShell helper that checks every few seconds and exits with the app), on
Linux through MPRIS (`dbus-send`). Only the app, title and artist are read, only
to decide whether it is music and to show *Now playing* in Settings; nothing is
stored or sent anywhere. Turning off *Dances to your music* stops the check.

## Save data

| | Location |
|---|---|
| Windows | `%APPDATA%\desktop-crow\save.json` |
| Linux | `~/.config/desktop-crow/save.json` (or `$XDG_CONFIG_HOME/desktop-crow`) |

It holds the crow's name and pronouns, its trust (affection), its mood, the
treasures you have collected and any gifts still lying on screen or on their
way, statistics (snacks eaten, days together, flights, naps, petting, dances…),
settings and where the crow was when you quit.
It is written atomically (temporary file, then rename) with a backup
(`save.json.bak`); a damaged file is set aside and the backup loaded instead.
Use `--data-dir=<folder>` or the `DESKTOP_CROW_DATA_DIR` environment variable
to keep it somewhere else.

## Resource use

Measured on the development PC (Windows 11, 12-thread CPU, 1920×1080 at 125 %),
version 1.1.0, all four processes together:

| Situation | CPU | Memory |
|---|---|---|
| Crow wandering around | 22–27 % of one core (about 2 % of the whole CPU); the higher figure with a few snacks lying around the screen | about 230–260 MB private |
| Paused | 14–17 % of one core | about the same |
| Hidden | about 1.5 % of one core (the simulation pauses; the overlays are hidden and stop drawing) | about 200–240 MB private |

Nearly all of the CPU goes into Chromium repainting a transparent window, and
that cost is per frame, whatever the crow's size. So the overlay repaints at
60 fps only while something moves fast (flying, hopping, eating, falling
snacks), at 30 fps while the crow walks or idles, and at 15 fps while it is
perched or asleep. Only the region around the crow is repainted.

## Building from source

Requirements: [Node.js](https://nodejs.org) 20 or newer (22 LTS used here).

```bash
npm ci          # install dependencies
npm start       # run from source
npm test        # the automated test suite (about a minute)
```

**Windows installer** (on Windows): `npm run dist:win`, or
`powershell -ExecutionPolicy Bypass -File scripts\build-win.ps1` (installs,
tests, builds) → `dist\Desktop-Crow-Setup-1.3.0.exe`.

**Linux AppImage and .deb** (on Linux): `bash scripts/build-linux.sh --deb`
→ `dist/Desktop-Crow-1.3.0-x86_64.AppImage`, `dist/desktop-crow_1.3.0_amd64.deb`.

**Linux build from Windows** (WSL 2 with Node.js 20+ inside the distribution):
`powershell -ExecutionPolicy Bypass -File scripts\build-linux-wsl.ps1 -Deb`
(add `-Distro <name>` to pick a distribution). The sources are copied into WSL,
built there, and the packages copied back to `dist\`.

Other scripts:

| Command | Purpose |
|---|---|
| `npm run icons` | Re-render the app and tray icons from the crow rig. |
| `npm run test:quick` | Fast unit tests (run by the build scripts). |
| `npm run test:matrix` | Every animation state (being carried included) into every other, at 6 points of each cycle, both seeds. |
| `npm run test:soak` | 9 monitor layouts × 24 seeds × 30 simulated minutes of random use, including picking the crow up (about 25 minutes on one core). |
| `npm run test:e2e:win` | Drives the real app on Windows with the real mouse (moves it briefly, including one drag of the crow). Pass an exe path to test a packaged build. |
| `npm run qa:sheets` | Renders animation contact sheets to `qa/out/`. `electron scripts/qa-render.js --page=turntable` renders the crow from 12 sides. |
| `npm run start:diag` | Runs with `--diag`: live animation checks, `diag.log` and `status.json` in the data folder. |

## Why Electron, and why an AppImage

**Electron** gives the same behaviour on both systems for what this app
needs most: frameless, per-pixel transparent, always-on-top overlay windows
whose click-through can be switched on and off per window
(`setIgnoreMouseEvents`), plus tray menus and notifications, from one
JavaScript codebase. The whole simulation (crow, animation, world,
progression) is plain JavaScript with no Electron dependency, which is what
lets the test suite check every frame headlessly. electron-builder makes the
NSIS installer, the AppImage and the `.deb` from one configuration. The costs
are a larger download (about 110 MB) and more memory than a native app. The
alternatives were weaker for this job: Tauri's transparency and click-through
differ between its Windows (WebView2) and Linux (WebKitGTK) backends, Qt means
a native toolchain and packaging per platform, and game engines such as Godot
or Unity need platform-specific tricks for click-through transparent windows.

**AppImage** was chosen as the main Linux build because one file runs on
practically every x86_64 distribution (Ubuntu, Debian, Fedora, Arch,
openSUSE…) without root and without touching the system; uninstalling means
deleting the file. Its drawbacks are the FUSE requirement on some
distributions and the lack of an automatic menu entry, so a `.deb` is built
as well for Debian/Ubuntu users who prefer a normal package.

## Troubleshooting

* **The crow never sits on my windows:** maximized windows have no top edge on
  screen; the crow needs a visible edge with room above it. Check that
  *Perches on windows* is on in Settings. On Wayland, see the note above.
* **I lost the crow:** use **Show** in the tray menu; it flies back in near the
  pointer.
* **It is too small/big:** Settings → *Size*. 100 % is the new default; 1.0
  used 125 %.
* **Diagnostics:** start with `--diag` to get `diag.log` and `status.json` in
  the data folder, including any animation-check failures.

## Project layout

```
src/core/       simulation: 3D rig and camera, crow motor, brain, world, items, affection, save schema, QA checker
src/main/       Electron main process: overlays, tray, storage, native window tracking (win32/X11)
src/renderer/   overlay drawing, sounds, setup/rename/settings windows
test/           unit, state/transition, foot-contact, checker-mutation, game-flow and soak tests; Windows E2E
scripts/        bundling, icon rendering, QA sheets, build scripts
docs/           AFFECTION.md (trust and gift tables), QA-REPORT.md
```

Desktop Crow is made by **tordev**. See [CREDITS.md](CREDITS.md) for assets and
third-party software. Licence: MIT, copyright (c) 2026 tordev.
