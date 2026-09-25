# Robotic chessboard: arrangement planner

The software brain for a self-moving chessboard, built before any hardware
exists. Tell it where every piece is now and where the pieces should end up,
and it returns the exact list of drags for the magnet under the board: which
piece, from where, to where, along which route, and why.

It handles every job a robotic board needs: resetting after a game (captured
pieces come back from storage), setting up a position, playing a move, or
tidying a board where pieces were dropped anywhere. Every plan is replayed by
an independent checker that confirms no piece ever touches another and the
board ends up exactly right.

This folder is self-contained (plain JavaScript, no dependencies, Node 20+)
and does not touch the Food Desert AI app in the rest of the repo.

## Try it

```bash
cd chessboard
node demo.js                 # list the sample jobs
node demo.js reset           # put everything back after a game
node demo.js nf3 --big       # full-size pieces: watch it move a blocker and put it back
node demo.js scramble --seed 7
node demo.js swap --gcode plan.gcode   # also write G-code for the gantry
npm test                     # unit tests, random boards, all Chess960 setups
```

To watch it animated, serve this folder and open the simulator:

```bash
npm run sim                  # then open http://localhost:8000/simulator.html
```

(From the repo root, `npm run dev` also serves it at `/chessboard/simulator.html`.)

## How it thinks

1. **Assign.** Identical pieces are interchangeable, so each target square is
   matched with a piece of the right type to keep the total distance as small
   as possible (Hungarian algorithm, one run per piece type). Pieces left over
   go to storage.
2. **Order.** It keeps running whichever move has a free destination, nearest
   to the magnet first. When every destination is still taken (two pieces that
   must trade places), one of them steps onto a spare square first.
3. **Route.** Each drag is routed around the other pieces with A* search on a
   half-square grid (centers, edges and corners of squares). A route is only
   allowed if the dragged piece stays one full piece width away from every
   other piece the whole way.
4. **Clear the way.** If a piece is boxed in, a second search finds the route
   that disturbs the fewest pieces. Those pieces step aside to spots they can
   get back from, then return. With full-size pieces it also fills the board
   from the inside out (back rank before pawns) and fills storage from the
   outer column in, so it doesn't wall itself in.
5. **Check.** `verify.js` replays the plan with brute-force geometry, so the
   planner never grades its own homework.

This is a search-based planner, not a trained neural network, on purpose. It
has to be right every time (one bad drag knocks pieces over), it needs no
training data, it plans in milliseconds on a Raspberry Pi-class computer, and
every move comes with a reason you can show on screen.

## Piece size matters

Pieces are modeled as discs `pieceDiameter` square widths across. Up to half a
square, a piece always fits along the lines between other pieces, so each
piece moves once. Wider pieces get boxed in and the planner has to move
blockers:

| Job | Slim pieces (0.45) | Full-size pieces (0.8) |
|---|---|---|
| Reset after a game | 22 moves | 26 moves (4 temporary) |
| Set up a study | 32 | 32 |
| Play 1. Nf3 | 1 | 3 (1 temporary) |
| Swap the colours | 48 (16 temporary) | 53 (20 temporary) |
| Tidy a scrambled board | 33 (1 temporary) | 36 (3 temporary) |
| Chess960 setup, average of all 960 | 15.6 (3.6 temporary) | 38.3 (17.1 temporary) |

**Hardware tip:** choose pieces whose base is at most half a square wide (for
example 25 mm bases on 50 mm squares). The robot gets faster and simpler.

## The board model

```
L2 L1 | a b c d e f g h | R1 R2     8 ranks tall
```

Two storage columns on each side hold 32 pieces, enough for a full set. Play
squares use normal names (`e4`); storage slots are named by side, column
counted outward, and rank (`L1-3`, `R2-8`). Positions are in square widths
with square centers on whole numbers, x from the left storage edge and y from
rank 1.

## Using it from code

```js
import { START_FEN, createBoard } from './src/board.js';
import { planArrangement } from './src/planner.js';
import { toGcode } from './src/gcode.js';

const board = createBoard();
const now = { e4: 'P', d5: 'p', 'R1-1': 'Q' /* ...every piece, storage included */ };
const plan = planArrangement(board, now, START_FEN, { pieceDiameter: 0.45 });

for (const move of plan.moves) {
  console.log(move.piece, move.from, move.to, move.kind, move.why, move.path);
}
const gcode = toGcode(plan.moves, { squareMm: 50 });
```

Inputs can be a FEN string, a `Map` of cell to piece, or an object keyed by
cell name. The target only describes the 64 play squares; anything not needed
there ends up in storage. If the target needs pieces that don't exist (a
second queen), you get `{ ok: false, error }` instead of a plan.

`toGcode` writes plain GRBL G-code: a rapid move with the magnet off to get
under a piece, then feed moves with it on. The magnet defaults to `M8`/`M9`
(the coolant pin on a GRBL CNC shield, easy to wire to a relay or MOSFET).

## Files

| File | What it does |
|---|---|
| `src/board.js` | Board layout, cell names, FEN, captured pieces into storage |
| `src/hungarian.js` | Minimum-cost assignment |
| `src/motion.js` | Collision geometry, A* routing, path smoothing |
| `src/planner.js` | The planner: assign, order, route, clear the way |
| `src/verify.js` | Independent replay checker |
| `src/gcode.js` | Plan to G-code |
| `src/scenarios.js` | Sample jobs shared by the demo, simulator and tests |
| `demo.js` | Command-line demo |
| `simulator.html` | Animated top-down simulator |
| `tests/` | `node --test` suites |

## What's next

- **Sensing:** the planner needs to know the current arrangement. Hall-effect
  sensors or reed switches under each square tell you which squares are
  occupied; the last known position plus chess rules tells you which piece.
- **Playing games:** after each engine or online move, call the planner with
  the new FEN as the target. Captures go to storage automatically.
- **Hardware:** an XY gantry (CoreXY or two-axis) running GRBL, with an
  electromagnet on the carriage, can run the G-code output directly.
- **Smarter full-size planning:** a look-ahead search could cut the temporary
  moves for crowded rearrangements like Chess960 setups.
