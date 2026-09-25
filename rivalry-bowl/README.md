# Rivalry Bowl

A head-to-head, 8-bit college football game in the style of Retro Bowl College,
built so two people can play each other. It runs in a browser with no install,
and phones are the main target.

It is a fan-made game inspired by Retro Bowl College, and it is not affiliated with
New Star Games. The teams use school names and colors only, with no logos.

## Two ways to play

| Mode | Devices | How it works |
| --- | --- | --- |
| **Pass & Play** | One phone | You each play your own offense against the computer's defense. The game shows a "pass the phone" screen on every change of possession. |
| **Online** | Two phones | The offense's phone runs the play with zero input lag. The defense's phone watches live, picks the coverage (man, zone, blitz, prevent) and steers one defender. |

Online play runs through the claude.ai artifact `room` channel. Both phones open the
published artifact on claude.ai while signed in (two phones on the same account work),
tap **Online**, pick a school and, if asked, tap **Allow live connection**. They are then
matched automatically. The lobby's connection details show the permission state, whether
claude.ai handed over the live room, how many presence updates were confirmed, and every
viewer the room can see, so a stall can be diagnosed from a screenshot. When the file is opened anywhere else (a
download, GitHub Pages), only Pass & Play works and the Online screen says so.

## Controls

- **Snap**: tap PASS or RUN. On 4th down you also get PUNT and FG.
- **Throw**: touch anywhere and pull back, away from the end zone, like a slingshot.
  The reticle moves 1.6x as far as your finger, and the dotted arc shows where the ball
  lands. Release to throw, and lead your receiver. The arc stays faint until the pull is
  long enough; letting go before then cancels the throw.
- **Scramble**: drag forward to run with the QB. Once he crosses the line he can't throw.
- **Run after the catch**: the runner keeps going upfield. Drag up or down to weave,
  drag back to slow down, tap to juke, flick to dive. The stick ramps in gradually over
  the first 60 pixels of drag.
- **Kick**: drag down for power and sideways to aim (the ball goes the opposite way).
  Clear the white line on the power bar and watch the wind.
- **Defense (online only)**: pick a coverage before the snap, tap a defender to take
  control of him, then drag to steer him during the play.

## Rules

- College rules: 25-yard touchbacks on kickoffs, the PAT is a 20-yard kick, and the
  clock stops on incompletions, out-of-bounds plays, scores and timeouts.
- Overtime uses the college format. Each team gets a possession from the 25. From the
  2nd overtime you must go for two after a touchdown, and from the 3rd overtime on
  it is a two-point shootout.
- Quarter length (2 to 7 minutes), AI defense difficulty and real or even team
  ratings are set on the title screen.
- Weather (rain, snow) and wind are random each game. Wind moves kicks, and rain
  makes the ball slippery.

## Running it

Open `index.html` in a browser. It loads the files in `src/` directly.

`node tools/build.js` writes the single-file versions:

- `dist/rivalry-bowl.html`: a standalone page to open or host anywhere
- `dist/artifact.html`: the same page without the `<html>` wrapper, for publishing as a
  claude.ai artifact

## Code layout

| File | Role |
| --- | --- |
| `src/data.js` | Constants, the 30 schools, rosters generated from ratings, and a seeded RNG |
| `src/sim.js` | One play: formations, random routes, pass protection, coverage AI, ball flight, catches, tackles |
| `src/game.js` | Game flow: downs, clock, scoring, PATs, kicks, punts, halftime, overtime |
| `src/kick.js` | The field goal and extra point minigame |
| `src/render.js`, `src/font.js` | Canvas renderer and the 5x7 bitmap font |
| `src/input.js` | Touch gestures turned into throws, joystick, jukes, dives and kicks |
| `src/net.js` | Online play over presence, plus a BroadcastChannel transport for testing |
| `src/ui.js`, `src/main.js` | Menus and the frame loop |

`sim.js`, `game.js` and `kick.js` have no DOM dependency, so the node tools can run them.

## Testing tools

```sh
node tools/simtest.js 400 1      # pass/run rates with a bot QB (arg 2 = difficulty 0-2)
node tools/gametest.js 10 240 1  # full headless games with bots making every decision
node tools/coverage.js           # receiver separation by coverage call
# Browser tests (Playwright, Chromium):
node tools/playtest.js           # menus -> pass play, screenshots
node tools/uigame.js             # a whole game played through the UI with gestures
node tools/jitter.js             # on-screen motion smoothness of a running receiver
python3 -m http.server 8765 &    # then:
node tools/onlinetest.js         # two tabs matched automatically over #localnet
MOCK=1 node tools/onlinetest.js  # same, through a mock of the claude.ai room + permissions API
node tools/onlinejitter.js       # smoothness on the defending (streamed) side
```
