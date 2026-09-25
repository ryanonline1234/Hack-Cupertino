# Roadmap: from planner to a real magnet chessboard

The planner in this repo already works. It turns "here is the board now, here
is how it should look" into collision-free drags and G-code. This roadmap
covers the rest: building a board that moves real pieces and plays a game
with you.

It is split into milestones you can finish one at a time, each with a
**done when** test. The first ones are cheap experiments that catch the
problems most likely to sink the project before you have spent much money.
Time estimates assume part-time work (a few hours on a weekend) and leave out
shipping, which can take one to three weeks for parts ordered online.

## How the board works

```
          chess pieces (steel washer + felt pad in each base)
  ═══════════════════════════════════════════════════  3 mm board top
                    ┌───────────┐
                    │ electro-  │  rides on the XY carriage,
                    │ magnet    │  about 1 mm under the board top
  ──────────────────┴───────────┴──────────────────  X beam
  Y rails on both sides, two stepper motors and belts

  laptop or Raspberry Pi ──USB──▶ Arduino Uno + CNC Shield (GRBL)
  runs this planner                moves the motors, switches the magnet
```

The planner decides the moves. GRBL firmware on an Arduino drives two stepper
motors to position the magnet, and switching the magnet on and off grabs and
releases pieces.

## Decisions to make first

| Decision | Recommendation | Why |
|---|---|---|
| Square size | 50 mm | Stable pieces, and the full grid with storage is 600 × 400 mm. For a smaller build, 40 mm squares with 20 mm bases also work. |
| Storage | Two columns on each side (the planner's default) | Holds a full 32-piece set. One column per side (`createBoard({ storageColumns: 1 })`) makes the board 100 mm narrower but can run out of room in long games. |
| Pieces | 3D-printed, bases at most 24 mm wide | At up to half a square wide, pieces slide between the others, so each piece moves once (see the table in the README). |
| What the magnet grabs | An electromagnet on the carriage and a steel washer in each piece, with no magnets in the pieces | A piece with a magnet in it sticks to the electromagnet's iron core even when the power is off, and gets dragged around. |
| Gantry | A simple XY frame with one motor per axis, or a reused two-axis laser engraver frame that covers 600 × 400 mm | One motor per axis is the easiest to build and debug. CoreXY is lighter but trickier to get right. |
| Controller | Arduino Uno + CNC Shield V3 running GRBL 1.1, with TMC2209 drivers | Cheap, well documented, and runs the G-code this repo writes. TMC2209 drivers are nearly silent. |
| Knowing where pieces are | Version 1: no sensors. Version 2: sensors under the squares. | The software can track every move it makes itself. Sensors are a big job, so add them once everything else works. |

## Milestone 0: planner and simulator ✅

Done in this repo:

- [x] Assign pieces to target squares, order the moves, and route every drag around the other pieces
- [x] Move blockers aside and back when full-size pieces are boxed in
- [x] Independent checker that replays each plan
- [x] G-code output for a GRBL gantry
- [x] Animated simulator (`simulator.html`) and command-line demo (`demo.js`)

## Milestone 1: magnet test (1 weekend, about $30)

The riskiest question is whether a magnet under the board can drag a piece
smoothly. Answer it before building anything else.

- [ ] Buy a 12 V electromagnet (20–25 mm across, rated for 2–3 kg of holding force), a logic-level MOSFET module, a flyback diode (1N5819 or 1N4007), a 12 V power supply, steel washers 18–20 mm across, felt pads, and a 3 mm sample of your board material (acrylic, MDF or plywood).
- [ ] Wire the magnet through the MOSFET, with the diode across the magnet's terminals and its stripe toward +12 V. Without the diode, switching the coil off can destroy the MOSFET.
- [ ] 3D-print three test pieces: a pawn, a knight and a king (the tallest). Leave a pocket in each base for a washer, and glue a felt pad on the bottom.
- [ ] Hold the magnet under the board sample, by hand or on a block, and drag each piece around. Try gaps from 1 to 5 mm and different speeds.

**Done when:** the king follows the magnet across 25 cm ten times in a row
without tipping or getting left behind, and stays put when the magnet is off.

**If it fails:** use a thinner board top, a bigger washer, a stronger magnet or
a heavier, wider base; drag more slowly; keep the top smooth and the pieces on
felt.

## Milestone 2: the gantry moves accurately (2–3 weekends, about $100–150)

- [ ] Build the frame. 2020 aluminium extrusion with V-slot wheels is the usual choice. The carriage has to reach every square center: a 550 × 350 mm range for 50 mm squares.
- [ ] Mount two NEMA 17 stepper motors with GT2 belts and 20-tooth pulleys, plus a limit switch on each axis for homing.
- [ ] Flash GRBL 1.1 onto the Arduino and set it up:
  - steps per mm, `$100` and `$101`: 80 for GT2 belts on 20-tooth pulleys at 1/16 microstepping, or 40 at 1/8 (check your driver's jumpers)
  - maximum speed, `$110` and `$111`, and acceleration, `$120` and `$121`
  - homing, `$22=1`
- [ ] Drive it by hand from a free G-code sender such as Universal Gcode Sender, CNCjs or LaserGRBL.
- [ ] Accuracy test: tape paper over the frame, clip a pen to the carriage, and visit all 96 square centers.

**Done when:** after homing, the pen hits every square center within ±1 mm,
three runs in a row.

## Milestone 3: first automated moves (1–2 weekends)

- [ ] Mount the electromagnet on the carriage, with shims so its top sits about 1 mm below the board top.
- [ ] Connect the MOSFET input to the CNC Shield's coolant pin (`CoolEn`, Arduino pin A3). `M8` then turns the magnet on and `M9` turns it off, which is what `toGcode` writes.
- [ ] Fix the board top on standoffs so it can't sag (sag changes the gap), and cover it with a printed 12 × 8 grid: the chessboard plus the storage slots.
- [ ] Software: add calibration to `src/gcode.js`, with an origin offset and a measured square size for each axis. Measure them by jogging the magnet to the centers of a1 and h8.
- [ ] Set up the pieces the way `node demo.js reset` prints its starting board, write the G-code with `node demo.js reset --gcode reset.gcode`, and run it from the sender.
- [ ] Tune the drag speed (start at 1000 mm/min), the acceleration, and the pause after switching the magnet.

**Done when:** the 22-move reset job runs three times in a row with every
piece centered on its square at the end.

## Milestone 4: play a game against the computer (2–3 weekends)

No sensors yet. You enter every move on a screen, your own included, and the
robot moves all the pieces. The software always knows where everything is,
because it made every move itself.

- [ ] Software: `send.js`, which streams G-code to GRBL over USB. It homes with `$H` first, sends one line at a time and waits for `ok`, and stops on `error` or `ALARM`.
- [ ] Software: save the physical position of every piece, storage included, to a file after each finished move, so a crash or restart doesn't lose track.
- [ ] Software: a game loop using chess.js for the rules and Stockfish for the computer's moves. After each move, plan from the current arrangement to the new position. Captured pieces go to storage automatically.
- [ ] Software: turn `simulator.html` into a controller. Click a piece and a square to make a move, preview the plan, then send it.
- [ ] Keep two spare queens in storage for promotions. The planner refuses any target it doesn't have the pieces for.

**Done when:** you play a full game against Stockfish to checkmate, and then
one click resets the board.

## Milestone 5: detect moves made by hand (3–4 weekends)

- [ ] Put a sensor under each of the 64 squares: reed switches or Hall-effect sensors (for example the A3144), read through eight 74HC165 shift registers or four CD74HC4067 multiplexers by the Arduino, an ESP32 or a Raspberry Pi.
- [ ] These sensors need a small magnet in every piece, which brings back the sticking problem from the decisions table. Before committing, test a fix: put the electromagnet on a small servo lift so it drops away when it's off, use a servo-lifted permanent magnet instead, or change the planner so the magnet travels along the lines between squares when it's off.
- [ ] Software: read the occupancy grid over serial and work out your move with chess.js. A normal move empties one square and fills another, a capture empties two squares before one fills, and castling changes four squares.
- [ ] Software: after every robot move, compare the sensors with the expected position, and retry or warn when a piece didn't land.

**Done when:** you play a whole game by hand without touching the screen, and
the board notices when you knock a piece off its square.

## Milestone 6: online play and polish (ongoing)

- [ ] Play online through the Lichess Board API, which is made for physical boards: stream your game and send your moves with a personal API token.
- [ ] Make it quieter: TMC2209 drivers in StealthChop mode, rubber feet, gentler acceleration.
- [ ] Make it faster: aim for an average robot move under 5 seconds.
- [ ] Build an enclosure with a power switch, a fuse and tidy wiring.
- [ ] Run a reliability soak: random jobs from `src/scenarios.js` overnight, counting misplaced pieces.
- [ ] Planner: a look-ahead search to cut temporary moves when pieces are full size.

## Parts and rough budget

Prices are rough online prices in US dollars; shop around.

| Part | Rough price |
|---|---|
| Arduino Uno (clone) + CNC Shield V3 | $15–25 |
| 2 × TMC2209 stepper drivers (A4988s are cheaper but louder) | $10–20 |
| 2 × NEMA 17 stepper motors | $20–30 |
| GT2 belt, 20-tooth pulleys, idlers | $10–15 |
| 2020 V-slot extrusion, wheels, brackets, screws | $50–90 |
| 2 limit switches | $3–5 |
| 12 V electromagnet, 20–25 mm | $6–12 |
| Logic-level MOSFET module + flyback diode | $3–6 |
| 12 V 5 A power supply + inline fuse | $12–20 |
| 3 mm board top + printed board sheet | $15–30 |
| Pieces: filament, 34 steel washers, felt pads | $15–25 |
| **Total** | **about $160–280** |

Milestone 5 adds roughly $20–40 for sensors, shift registers and wiring. An
old 3D printer or laser engraver can supply the motors, belts, rails and
controller for less.

## Risks to watch

| Risk | Early warning | Fix |
|---|---|---|
| Magnet too weak through the board | Drags stutter in Milestone 1 | Thinner top, bigger washer, stronger magnet, slower drags |
| Pieces follow the magnet when it's off | Pieces creep during travel moves | No magnets in pieces, or lift the magnet away (Milestone 5) |
| Tall pieces tip over | The king wobbles when a drag starts | Lower acceleration, a heavier or wider base, felt pads |
| Board top sags | Drags work at the edges but not in the middle | Support the top from underneath and check the gap in several places |
| Squares drift out of line | Pieces land off-center on one side | Square up the frame, then redo homing and calibration |
| Too noisy | Reviews of commercial robotic boards complain about this | TMC2209 drivers, rubber mounts, slower moves |
| Magnet overheats | Too hot to touch after a long job | It's only on while dragging; use PWM to lower its power |

## Safety

- Use low voltage only: 12 or 24 V from an enclosed power supply. Don't wire mains power yourself.
- Put a fuse on the 12 V line and secure every wire so nothing can catch in the belts.
- Always fit the flyback diode across the electromagnet.
