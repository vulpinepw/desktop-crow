# QA report — Desktop Crow 1.3.0

Desktop Crow is made by tordev. This report covers what changed in 1.3, 1.2
and 1.1, what was tested, what the tests found, what was fixed, and what was
not verified. All numbers are from the final code.

## What changed in 1.3

* **A new Settings window** in crow colours (crow-black with an iridescent
  blue-violet-teal sheen), in the clean style of shadcn/ui and without
  borders. The top shows your crow on a moon, framed by brambles and roses
  that grow in, sway and drop petals, all drawn by code (they can be switched
  off in Settings → System). On Windows 11 the title bar takes the same colour
  and the window loses its 1-pixel frame.
* **Friendship levels:** 20 levels across the five trust stages, a progress
  ring, what each stage changes, fourteen milestones and the points each kind
  of moment earns right now. A short message pops up over the crow at every
  new level.
* **Petting:** stroke the pointer back and forth over the crow without
  clicking. It stops, fluffs up, half-closes its eyes, chirps and hearts float
  up. +2 trust per petting session, at most 20 a day.
* **Moods:** besides hunger and energy the crow now has a happiness value
  (feeding, petting, gifts and dancing raise it; being annoyed, hunger and
  exhaustion lower it). It says how it feels in a speech bubble with a bar
  (*Hungry*, *Tired*, *Happy*, *Satisfied*, *Sad*) when its mood changes, as a
  reminder every few minutes while it needs something, and when you click it.
  Settings → Crow shows fullness, energy and happiness live. Mood is saved.
* **Dancing to music:** when Spotify, Deezer, YouTube Music, a music video on
  YouTube or another music player is playing, the crow sometimes dances
  (a new *dance* animation: head bobbing and bouncing to a beat, wing flicks,
  hop-turns, music notes). Playback is read from the Windows media controls
  (a PowerShell helper that exits with the app) or MPRIS on Linux; nothing
  leaves the computer. It can be switched off in Settings → Behaviour.
* **The box:** at every start the crow waits in a cardboard box with red tape
  and *OPEN ME* in red marker, wobbling now and then. Clicking it (or Feed)
  opens the flaps; the crow pops up inside and flies out; the box fades.
* **Treasures fix:** shiny things that drop onto the desktop could not be
  collected (clicking picked them up like a snack) and the ones the crow flew
  off with were simply gone. Now clicking one adds it to your treasures, the
  ones the crow stashes are added too, and the foil ball became a treasure.
  Gifts the crow is still fetching or carrying are now saved as well, so
  hiding or quitting at that moment no longer loses them.
* **Fix:** on a display scaled above 100 %, the crow was drawn up to 25 % too
  big after start until its drawing area was first resized.

## Results for 1.3.0

| Check | What it covers | Result |
|---|---|---|
| `npm test` | 129 tests: everything listed for 1.1 plus levels, milestones, treasures and gift saving, petting (a sleeping crow included, and not petting when the pointer only passes by), moods and bubbles, the box, dancing to music, music recognition rules and Linux MPRIS parsing | **129/129 pass** |
| Transition matrix | 15 animation states (dance and pet added) × 15 × 6 entry points × 2 seeds = 2,700 runs, 781,523 frames | **0 violations** |
| Soak sample (`node test/soak.js all 900 1-6`) | 54 runs of random use, 2,916,000 frames; the random pointer petted the crow 79 times | **54/54 runs clean** |
| Windows end-to-end | Packaged 1.3.0 build, real mouse, 27 checks: the box at start and opening it with a click, the mood bubble on a click, petting by stroking the mouse, dancing, plus the 22 earlier checks | **27/27**, twice in a row |

Found and fixed while building 1.3: in one real-mouse run the petting did not
register, because the crow could still decide to hop or walk off while the
first strokes were coming in. The crow now holds still while the pointer
strokes it, and a sleeping crow wakes up to be petted; the same scripted
strokes then registered within a second in every attempt.
| Music helper | Run on the development PC: it found the Spotify app's media session (paused at the time) in half a second; the packaged app starts it from `app.asar.unpacked` and it is gone after Quit | checked |
| Linux smoke test | 1.3.0 AppImage under WSLg: box opened, Feed, a dance, Hide/Show, Settings opened | **pass** |
| Settings window | Every tab rendered; the computed border and outline of every element were checked; title bar colour applied (3 of 3 calls succeeded) | **no borders or outlines** |

## What changed in 1.2

* **Settings window without borders:** cards, tabs, the name field, buttons,
  drop-downs (their open list included), switches and sliders have no border
  or outline. Tabs, focus and hover are shown with background colours
  instead. The first-launch and rename windows are unchanged.
* **The blue button is no longer a gift.** Common gifts are now the bottle
  cap, paperclip, smooth pebble and glossy black feather. Buttons already
  collected leave the Treasures list when an older save is loaded.
* **No comments** in the source code, build scripts or configuration, and
  the scripts bundled into the app are written without comments too.
* **Credits:** made by tordev, shown in Settings → System, the installers'
  metadata, `LICENSE`, `README.md` and `CREDITS.md`.
* **Fix:** the Size slider could not go below 75 % (the app still clamped it
  to the 1.0 range); it now goes down to 60 % as labelled.

## Results for 1.2.0

The crow's motion code is unchanged in 1.2 (removing comments was checked to
leave every JavaScript file identical after minification), so the full
216-run soak was not repeated; a 54-run sample was run instead.

| Check | What it covers | Result |
|---|---|---|
| `npm test` | The 103 tests listed below | **103/103 pass** |
| Transition matrix | 2,028 runs, 598,875 frames | **0 violations** |
| Soak sample (`node test/soak.js all 900 1-6`) | 9 layouts × 6 seeds × 15 simulated minutes = 54 runs, 2,916,000 frames, including 706 pick-ups and 16 gifts delivered | **54/54 runs clean** |
| Windows end-to-end | Packaged 1.2.0 build, real mouse, 22 checks | **22/22** |
| Linux smoke test | 1.2.0 AppImage under WSLg | **pass** |
| Settings window | Rendered in light and dark mode, including with a drop-down open; the computed border and outline of every element were checked | **no borders or outlines** |
| Packages | `app.asar`: version 1.2.0, author tordev, no comments in the app's own 44 files; the Windows `.exe` files list tordev as company and copyright holder | checked |

## What changed in 1.1

* **Perspective:** the desktop is now a floor seen from slightly above (a
  camera tilted 36° down), like *Desktop Goose*. The crow is a 3D rig seen
  from any side, and walks, hops and flies anywhere on the screen instead of
  along the bottom. Window top edges and the taskbar remain perches.
* **Picking it up:** press on the crow and drag. It is carried wherever the
  pointer goes (other monitors too), dangles and struggles now and then, and
  flutters down where it is let go (onto a window edge or the taskbar if its
  feet are at one; a flick sends it off in that direction).
* **Smaller:** the default size is 100 % of the new scale (1.0 used 125 %);
  existing saves are migrated to 80 % of their old size. Slider: 60–160 %.
* **No white outline** around the crow.

## Results for 1.1.0

| Check | What it covers | Result |
|---|---|---|
| `npm test` | 103 tests: rig and camera geometry (9), text and pronouns (3), trust/gift/spawn tables and their documentation (10), save file and migration (8), world: floor areas, perches, exits (10), checker mutation tests (20), every state and the transition matrix at 3 sizes and 4 layouts (4), foot contact (7), game flows including pick-up and drag (23), short soak on every layout (9) | **103/103 pass** (about a minute) |
| Transition matrix (`npm run test:matrix`) | 13 animation states (being carried included) × 13 × 6 entry points × 2 seeds = 2,028 runs, 598,875 frames | **0 violations** |
| Long soak (`npm run test:soak`) | 9 monitor/taskbar layouts × 24 seeds × 30 simulated minutes = 216 runs, 23,328,000 frames (108 simulated hours) of random use: 7,988 clicks, 6,512 pick-ups (3.9 hours of being carried in all), 361 snack drags (210 hand-feedings), 16,366 tray feeds, 71 gifts delivered, 4,037 hide/show cycles, 4,753 pause toggles, 93,061 window moves/opens/closes, 758 monitor-layout changes | **216/216 runs clean** |
| Windows end-to-end (`npm run test:e2e:win`) | The real app driven with the real mouse, packaged: 22 checks (below), including picking the crow up, carrying it for 5 s and letting go | **22/22** |
| Linux smoke test | The AppImage under WSLg (Ubuntu 22.04, Wayland + XWayland, no FUSE) | **pass** |
| Resource use | CPU and memory of all processes, packaged app, nothing else running (README, *Resource use*) | 22–27 % of one core active, 14–17 % paused, 1.3–1.5 % hidden |
| Visual review | Contact sheets of all 13 states and 7 transition pairs (carrying included), foot-path strips, a 12-heading turntable, icons | reviewed |

### What the motion checker enforces on every frame

`src/core/qa.js` runs on every simulated frame of every test (and live in the
app with `--diag`):

* **Popping/snapping:** no tracked point of the crow (15) moves more than 22
  units in a frame (38 for wing tips); no single-frame spike against its
  neighbours; no one-frame twitch (a point out of line with the frames before
  and after it by more than 4 units; 30 for flapping wing tips); every pose
  channel (heading, head position, angle and turn, hip height, pitch, wings,
  flap, tail, fluff) within a per-frame limit; hip acceleration at most
  14,000 units/s².
* **Feet:** a planted foot never moves (tolerance 10⁻⁶ px) and sits exactly at
  floor height; toes never below the floor; knees always above it; legs never
  stretched past their reach (a floating foot); the body always over the line
  between its feet.
* **Floor:** body, head, beak, wings and tail never below the floor (under a
  flying crow, the floor is lower by its height).
* **Where it stands:** a standing crow is on the walkable floor (the work
  area less margins that keep it on screen) or exactly on its perch line;
  every part of it is on a screen.
* **Being carried:** the user's motion is not judged (it is reported as an
  external shift); around the moments it is picked up and let go only motion
  relative to the body is judged, and the body may not move faster than a
  carried crow can.
* **Transitions:** only legal state changes, and sleep must finish waking up
  before anything else (unless startled or picked up); no NaN or out-of-range
  values.

`test/qa.test.js` injects one fault of each kind into a copy of the pose and
checks that the checker reports it, so a rule that silently stopped working
would fail the suite.

### Scenarios

* **Every state and transition:** idle, walk, hop, fly, land, perch, eat,
  sleep, peck, gift-drop, react-to-click, react-to-food-spawn and being
  carried. Each state is entered from every state at 6 points of that state's
  cycle, at 60 %, 100 % and 160 % size.
* **Foot contact, frame by frame** (`test/feet.test.js`): walks in 8
  directions across the desktop at two speeds and 3 sizes (planted feet move
  0 px, sit exactly on the floor, one foot always down); 12 hops per size in
  different directions, which leave the floor only with the leg exactly
  straight and land with both feet exactly on the floor; turning on the spot
  (small turns stepped, big ones hopped); standing states keep their feet
  perfectly still; landings from flight; riding a window edge while the window
  is dragged; the window flung away or closed under the crow.
* **Roaming:** left alone for 20 minutes it stands in at least 4 of 5
  horizontal bands of the screen; snacks land all over the desktop.
* **Picking up** (`test/sim.test.js` and the soak): a quick press is a click,
  press-and-move picks it up; carried across the screen it hangs from the
  pointer where it was grabbed; let go, it lands near that spot; let go at a
  window's top edge, it sits on the edge; a lost button-up still lets go;
  snatched while bringing a gift, it drops the gift (and the notification
  still comes); caught while leaving on Hide, it still leaves once let go.
* **Screen edges and monitors** (simulated): single monitor with the taskbar
  at the bottom, top, left, right or auto-hidden; two equal monitors; a taller
  monitor at negative coordinates; stacked monitors; mixed DPI with a gap and
  an offset; monitors unplugged and re-plugged and taskbars toggled while the
  crow walks, sits or flies. Flights between monitors go through the shared
  edge, and never draw the crow in the gap between them.
* **Game flows:** tray Feed, drag-to-feed, gifts fetched, delivered with the
  notification *"<name> brought you something!"* and collected; uncollected
  gifts restored; Hide/Show (including Show while it is on its way out);
  Pause; click-through; annoyance; rename and pronouns in notifications;
  position and heading saved and restored; the crow's monitor unplugged;
  repaint pacing.

### Windows end-to-end checks (22)

App starts; one overlay per display covering it exactly; native window
tracking works; the crow stands on the desktop floor; overlay is topmost;
click-through away from the crow; the overlay captures the mouse over the
crow; clicking the crow triggers its reaction; **pressing on it and moving
the mouse picks it up; still held after 5 seconds of carrying; let go, it
lands where it was dropped** (4 px away in the final run); click-through
restored afterwards; Feed drops a treat and the crow eats it; Hide (overlays
hidden) and Show (crow lands again); Pause; `--quit` stops every process; the
save is written on quit; a restart restores the saved state and position; a
second quit also leaves nothing running.

### Linux smoke test

The final AppImage under WSLg (Ubuntu 22.04, Wayland session with XWayland,
no FUSE), default start with `--appimage-extract-and-run`: re-launched itself
on X11, 60 fps, native X11 window tracking available, Feed eaten, Hide and
Show, live motion checker 0 violations, `--quit` leaves no processes, save
written.

## Bugs found and fixed while building 1.1

| # | Found by | Problem | Fix |
|---|---|---|---|
| 1 | Foot-contact test | On touch-down the landing speed was handed to the legs with the wrong sign (carried over from the old y-down side view): the hips bounced up instead of taking the landing, and a balance step fired on landing. | Sign fixed; the legs absorb the landing. |
| 2 | Matrix, soak | With landings absorbed, a double hop re-launched the very frame it landed, reversing the hips in one frame; and the lift-off frame lost the rest of that frame's rise. | The second hop waits until the legs have taken the landing; the lift-off frame carries the remaining rise. The balance guard stands down during a push-off. |
| 3 | Soak | Hopping onto a window edge while the window was resized: the in-air steering yanked the crow 41 px sideways toward what was left of the edge. | The landing spot is re-validated in the air; if it is gone it lands on the desktop there. Steering is limited to small corrections. |
| 4 | Soak | A window shrank so the perched crow was left at the very end of its edge: its feet re-stepped forever (it could never take off), and the next push-off pulled it back onto the edge (an 11 px teleport). | It steps off onto the desktop instead; push-offs never pull it in; waiting for a step before a take-off is capped. |
| 5 | Soak | A take-off facing away from the destination swung wide, off the edge of the screen. | Every flight banks toward its destination in a short lead-in. |
| 6 | Soak (mixed DPI) | Flights between monitors crossed the 10 px gap where only one monitor exists, drawing the crow above the laptop screen's top edge (the route check sampled too coarsely and tested the shadow, not the crow). | Routes and flight heights are checked every few pixels against where the crow is drawn. |
| 7 | Soak | The crow could be dropped onto the very end of the taskbar, half off the screen. | The taskbar perch keeps the same side margins as the floor. |
| 8 | Soak | After a monitor layout change a walk continued (off the floor) toward a spot that no longer existed. | Walks re-aim at the floor and first step back onto it. |
| 9 | Live app log | A walk target 90–110° to one side ended the walk instantly, so the crow kept deciding to walk and not walking. | It turns to face the target first. |
| 10 | Soak | Show while the crow was already flying out past the screen edge: it turned back at the edge and dipped a pixel below the screen. | Already at the edge, it goes out and comes straight back in. |
| 11 | Windows E2E (real mouse) | The overlay's always-on-top refresh (every 4 s) made Windows cancel a drag in progress: the crow was dropped mid-carry. | No refresh during a drag; a cancel while the button is physically held is ignored (a lost button-up is still caught by a button-state check). |
| 12 | CPU measurement | After Hide, an overlay with snacks on it kept repainting its last frame at 60 fps. | Hiding stops the overlays' drawing, and an overlay that gets no new frames stops by itself. |
| 13 | Matrix | A foot's toes snapped to the body's heading the moment it lifted. | Toes keep the foot's own heading and swing round with it. |
| 14 | Matrix | Hop-turns of up to 180° exceeded the turn-rate limit. | Big turns get a little longer in the air. |
| 15 | Soak | The wing's elevation was the arcsine of the flap value, so strong strokes snapped the wing to vertical for a frame. | The flap sets the angle linearly (up to 75°). |
| 16 | Soak | Landing on a window edge: the feet jumped onto the edge line at touch-down; a landing re-planned mid-air snapped the reaching legs. | The landing stance is computed for the perch line, and a changed landing spot glides the stance over. |
| 17 | Soak | A crow let go mid-swing flew off faster than a flight is ever drawn. | The fling speed is capped. |
| 18 | Soak | Picked up mid-turn or mid-push: the turn stopped dead, the push's speed was lost (a one-frame jolt). | Both carry over into being held. |

Test-harness and tooling fixes: the test-command reader rejected files with a
byte-order mark (PowerShell writes one); a measurement script passed JSON
through a PowerShell argument, which strips quotes (the run was discarded and
repeated); CPU numbers taken while the long soak was running were discarded
(noise) and re-measured on an idle machine.

Checker tolerances changed, with the reason: flapping wing tips may step 38
units per frame (a full-speed flap is ~34); their spike ratio is 4.5 (seen
from the side, the far tip moves toward or away from the camera for part of
each stroke, so its on-screen step swings between ~3 and ~13 px within a
normal flap); frames around a pick-up or let-go are judged relative to the
body, with a 5-unit twitch limit.

## Not verified

* **Dancing to a song actually playing:** the dance was tested with a
  simulated "music playing" signal, and the helper was run against the
  Spotify app while it was paused; no song was played during testing.
  Linux music detection was tested with sample `dbus-send` replies only.
* **Petting by hand:** petting was tested with scripted mouse strokes; how
  easy it feels to trigger by hand was not judged by a person.

* **The Windows installer itself was not run on this PC:** an earlier Desktop
  Crow (installed 23 September) is present and the new installer would
  replace it. The app inside the installer passed the end-to-end test.
  Updating over 1.0 or 1.1 (keeping the save, migrating the size) is covered
  by unit tests only.
* **A person dragging the crow:** dragging was tested with scripted mouse
  input (in simulation and on the real app); how it *feels* by hand was not
  judged by a person.
* **Linux desktops:** tested under WSLg only, not on a GNOME or KDE session;
  the tray icon, notifications and the Ubuntu 24.04 sandbox restriction were
  not tried there. The `.deb` was built but not installed.
* **Multi-monitor and other taskbar positions** were exercised in simulation
  only; this PC has one monitor with the taskbar at the top.
* **Wayland-native windows** cannot be perched on (Wayland does not reveal
  window positions to other programs); only XWayland windows can.

## Re-running

```bash
npm test                      # everything below except the long soak and the E2E, about a minute
npm run test:matrix           # full transition matrix report
npm run test:soak             # 216 long runs, about 25 min on one core
node test/soak.js mixedDpi 1800 12        # one layout/seed
node test/blackbox.js <layout> <kind> <seconds> <seed> [point]   # frames leading up to a failure
npm run test:e2e:win -- "dist\win-unpacked\Desktop Crow.exe"   # Windows, packaged build (moves the mouse)
npm run qa:sheets             # contact sheets in qa/out/
```
