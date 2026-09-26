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
viewer the room can see, so a stall can be diagnosed from a screenshot.

**Backup sync.** Two phones signed in to the same account in the Claude app were each
shown alone in the live room, although both connected and every update was confirmed.
The page can also sync through the artifact's shared database: if the live room shows
nobody else for 8 seconds, both phones switch to it and match there. Its round trip is
about a third of a second. The defender you steer runs on your own phone, so that delay
shows only in how late you see the offense, not in how he answers the stick. The defense
phone draws the play by carrying the latest update forward instead of buffering (the
ball in flight follows its exact throw), which in the mock cut how far behind it runs
from about 350 ms to 100-150 ms on the backup and from 133 ms to about 66 ms on the room.
A page that declares the database is private to the owner's organization, so
this version is published separately (`dist/artifact-online.html`, capabilities
`room` + `db`) from the public one (`dist/artifact.html`, `room` only). The public page
can't pair two phones on one account; after 9 seconds alone its lobby says so and links
to the online version (set `ONLINE_URL` when building to change the link). When the file
is opened anywhere else (a download, GitHub Pages), only Pass & Play works and the Online
screen says so.

## Controls

- **Read the play**: before the snap the camera pulls back and each receiver's route is
  drawn in his color (a dashed arrow shows the run lane). A key in the corner lists who
  runs each route and his best ratings; `*` marks a star. **New play** rerolls the
  formation and routes; the play clock keeps running.
- **Snap**: tap PASS or RUN. On 4th down you also get PUNT and FG.
- **Throw**: touch anywhere and pull back, away from the end zone, like a slingshot.
  The reticle moves 1.6x as far as your finger, and the dotted arc shows where the ball
  lands. Release to throw, and lead your receiver. The arc stays faint until the pull is
  long enough; letting go before then cancels the throw. With **aim assist** on (title
  screen), a reticle near where a receiver will be locks onto his catch point and turns
  green, with a ring on that receiver.
- **Move**: the joystick is fixed in the bottom-left corner (bottom-right with Settings →
  Stick side) and has its own finger, so the other thumb stays free for the buttons. The QB moves with it in the pocket; once he
  crosses the line he can't throw. After a catch or handoff the runner keeps going
  upfield until you steer him. **JUKE** and **DIVE** are buttons on the right. A
  steered runner turns a 90 degree cut in about 83 ms.
- **Kick**: drag down for power and sideways to aim (the ball goes the opposite way).
  Clear the white line on the power bar and watch the wind.
- **Defense (online only)**: pick a coverage before the snap; it carries over to later
  plays until you change it. Tap any defender to take control of him (before or during
  the play). He is run by the computer until you touch the stick; from then on he runs
  on your phone with no network delay and stops when you let go. **SWITCH** jumps to the
  free defender nearest the ball and **DIVE** lays out for a tackle (with the stick idle it
  aims at where the runner is going), or, with the ball in the air, stretches for it. Point
  the stick roughly at a ball carrier and your defender takes the pursuit angle that cuts
  him off, at full pursuit speed. A missed dive or tackle is a short stumble played on your
  own phone where your defender is, so he never jumps back. Tackles are judged
  against where the ball carrier was on your screen, so the lag doesn't cost you
  tackles. The HUD shows the link type and the measured round trip.

## Teams and ratings

Every player has his own ratings (SPD, HND, ELU, ARM, ACC, RSH, TKL, COV...), built from
his school's position-group rating, his own spread, and the school's stars. The stars
follow each program's long-standing identity: deep-threat receivers at Ohio State and
LSU, edge rushers at Alabama, linebackers at Penn State, option quarterbacks at Army and
Navy, and so on. Team select lists each school's key players. Names are made up: real
rosters change every season and the game makes no claim to match them. Displayed SPD
comes straight from a player's speed in yards per second, so equal SPD means equal speed
at any position.

## Defense

The computer defenders play pattern-matching zone (each zone defender takes a different
receiver instead of two chasing one), break on the ball at full speed when it's thrown,
contest catches from a little farther than they can catch, and pursue a ball carrier
faster than they cover. A defender who misses a tackle is back up in about 0.4 s. With
bot quarterbacks (`node tools/passdiag.js`), throws to open men complete about 87% and
throws forced into coverage about 75% with 7-8% intercepted; full games average about
18 points a team (`node tools/gametest.js`).

## Streaks, growth and the series

- **Player stats** are kept for every player (passing, rushing, receiving, tackles, sacks,
  picks) and the halftime and final screens show each side's standouts.
- **Hot streaks**: each play, every player's recent form fades a little and whoever made
  the play gains (a pick, an incompletion or a stuffed run cost some). Hot players (a flame
  over them, `~` in the play key) run a bit faster, catch, throw and tackle a bit better;
  on fire doubles it. A QB who throws a pick is rattled (worse accuracy) until his next
  completion. It cools off when they go quiet, so about two players are hot at a time.
- **Growth**: after each game a school's players improve from what they did in it (150
  passing yards, two TD passes, 50 receiving yards, a TD catch, 40 rushing yards, three
  tackles, a sack, a pick, a win...), one point per milestone, up to +12 per rating. It's
  saved per school on the phone that played it; online, each phone brings its own
  school's growth to the game (packed into a short string such as `o8:SPD3HND4`, since
  the live room allows 4 KiB of presence per phone). Team select shows a program's record and total growth,
  with a ▲ on improved players. Settings can turn it off or reset it; even ratings ignore it.
- **Series**: the head-to-head record between the two names is kept and shown on the title
  and final screens.
- **Clock tools**: in the last two minutes of a half, SPIKE stops the clock at the cost of
  a down; with the lead, KNEEL loses a yard and keeps it running.
- **Settings**: stick side (left or right), vibration on big moments (Android; iOS doesn't
  allow it), sound, growth.

## Stadiums

Every school plays at home in its own stadium (`RB.ENV` in `src/data.js`): the stadium's
name on the stand facing, the usual kickoff light (day, dusk or night with light towers),
and pixel-art scenery past the stands: mountains in Boulder, Salt Lake and Seattle
(with the lake and sailboats), the Coliseum's arches and torch, the Texas tower lit
orange, the golden dome in South Bend, the bay at Annapolis, fall trees in the Big Ten.
Signatures on the field: Boise State's blue turf, Tennessee's checkerboard end zones,
Georgia's hedges, Penn State's white-out crowd. Each game opens on the home stadium
while the welcome and coin toss play; the kick view shows the same scenery behind the
posts. No logos.

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
MOCK=1 ISOLATED=1 DB=1 node tools/onlinetest.js  # room shows each phone alone; db backup pairs them
node tools/onlinejitter.js       # smoothness on the defending (streamed) side
MOCK=1 node tools/onlinedef.js   # defense: tap to switch, joystick steering, sticky call
node tools/response.js           # how fast a joystick cut changes the runner's direction
node tools/owntest.js            # online defense tackles judged against the defense's screen
node tools/passdiag.js           # where passing yards come from: separation, air yards, YAC, INT%
MOCK=1 ISOLATED=1 DB=1 node tools/onlinelag.js  # how far behind the defense phone's picture is
MOCK=1 ISOLATED=1 DB=1 node tools/onlinechase.js  # chase and dive: the defender never jumps
```
