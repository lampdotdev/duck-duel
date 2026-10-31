# Duck Duel

Kind: game (web, three.js on Lamp's game runtime)

A party game: rubber ducks squirt each other, first to pop 7 wins. Three stages, picked on the title: a bathtub, a pond
and a swimming pool, each bigger than the view, with the camera following the players' ducks. One to six ducks: the
keyboard (or controller 1), up to three more controllers, and phones joining by QR code (Phone/index.html). Bots fill
the empty ducks up to four. Bubbles on the water give triple squirts, rapid fire, turbo paddling or an extra life.

Based on CAUSTIC//VOLUME (https://github.com/ScottieFox/caustic-volume) by ScottieFox, MIT license, at commit
d87351bff19831aa9d11c0679605fad6797b133f. The water, caustics, ripple simulation, sun and duck shape come from its
`lite/` version (Web/water.js, Web/duck.js); the bathtub, ducks' game, bots, phones and HUD are new.

- Web/water.js: the stages (`STAGES`), sea waves, ripples, caustics. Web/duck.js: duck mesh and colours.
- Web/play.js: ducks, squirts, bots, pickups, scoring. Web/game.js: title, stage picker, camera, countdown, rounds, pause, phones.
- Flow: title (Play, How to play, QR) → stage choice → joining (roster + QR) → countdown → play; one SQUIRT from a phone on any of the first three goes straight to the countdown, on the stage last picked. Then play → pause / results (Rematch keeps stage; Change stage).
- Look: bath-toy label: chunky yellow letters with a deep teal outline, tile-white cards with thick teal edges and hard drop shadows, rubber buttons that press down, bobbing selected items. Colours are CSS variables at the top of Web/hud.js and Phone/index.html.
- Web/hud.js: all screens, scoreboard, tags, menus. Web/qr.js: QR code for the phone link. Web/audio.js: sounds and music in code.
