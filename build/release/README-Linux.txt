Desktop Crow 1.4.0 for Linux (x86_64)
Made by tordev.

Two packages are included; use either one.

AppImage (any distribution)
---------------------------
  ./Desktop-Crow-1.4.0-x86_64.AppImage

If it does not start, make it executable first (some unzip tools drop the
permission):

  chmod +x Desktop-Crow-1.4.0-x86_64.AppImage

AppImages need FUSE 2: "sudo apt install libfuse2" on Ubuntu 22.04,
"sudo apt install libfuse2t64" on Ubuntu 24.04, or start it with
--appimage-extract-and-run.

On Ubuntu 24.04 and newer, if it closes at once with a "SUID sandbox"
message, use the .deb instead or start the AppImage with --no-sandbox.

Debian/Ubuntu package
---------------------
  sudo apt install ./desktop-crow_1.4.0_amd64.deb

Then start Desktop Crow from the application menu, or run "desktop-crow".

New in 1.4.0
------------
* 50 friendship levels. Levels 1 to 20 are exactly as before; levels 21 to 50
  come after them for the closest friends, with new milestones at 35 and 50.
* Droppings: now and then your crow leaves a white dropping on your screen.
  Press on it and rub it away with your pointer (or click it three times).
  Left there, it makes the crow unhappy and then unwell: it coughs, slows
  down and wears a fever ice bag with a thermometer in its beak until it gets
  better. It cannot die. Settings > Crow shows its health; Settings >
  Behaviour turns droppings off.

Notes
-----
* Wayland: the app re-launches itself on XWayland automatically. The crow
  can only perch on windows that also run through XWayland.
* GNOME shows tray icons only with the AppIndicator extension (Ubuntu has it
  on). Without a tray, right-click the crow: it opens the same menu.
* Quit: tray menu (or right-click the crow) > Quit Desktop Crow, or run
  "desktop-crow --quit".
* Save file: ~/.config/desktop-crow/save.json
* Every time it starts, your crow waits in a cardboard box marked OPEN ME:
  click the box to let it out.
* Pet it by stroking your pointer back and forth over it without clicking.
* It tells you in a bubble when it is hungry, tired, happy, satisfied, sad,
  bothered by a mess, or sick.
* It sometimes dances when a music player reports music playing over MPRIS
  (Spotify, browsers, Rhythmbox and others). Needs dbus-send.
* Settings > Friendship shows your friendship level (1 to 50), the five
  stages of trust and seventeen milestones to unlock.
