/*
 * The arranging brain of the robotic chessboard. Given where every piece is
 * now and where the pieces should end up, it returns the ordered list of drags
 * for the magnet under the board.
 *
 *   1. Assign. Identical pieces are interchangeable, so each target square is
 *      matched with a piece of the right type so that the total distance is
 *      as small as possible (Hungarian algorithm, one run per piece type).
 *      Pieces left over go to storage.
 *   2. Order. Keep running whichever move has a free destination, nearest to
 *      the magnet first. When every destination is still taken (pieces that
 *      have to trade places) one of them steps onto a spare square first.
 *   3. Route. Every drag is routed around the other pieces. If a piece is
 *      boxed in (full-size pieces packed together) the pieces in the way step
 *      aside and are brought back afterwards.
 *
 * Plans are pure data: nothing here talks to hardware. See gcode.js for the
 * bridge to a GRBL-style gantry and verify.js for an independent check.
 */
import {
  cellDistance,
  cellName,
  cellX,
  cellY,
  isPlayCell,
  pieceName,
  storageCells,
  toArrangement,
} from './board.js';
import { hungarian } from './hungarian.js';
import { FIXED, createMotion } from './motion.js';

const STORAGE = -1; // task goal meaning "any free storage cell"
const MAX_CLEARING_DEPTH = 3;

const plural = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;

function cloneWorld(world) {
  return {
    at: world.at.slice(),
    pieces: world.pieces.map((piece) => ({ ...piece })),
    tasks: new Map(world.tasks),
    magnet: { ...world.magnet },
  };
}

// Runs `attempt` on a copy of the world and keeps the result only if it
// succeeds, so a failed idea never leaves half-made moves behind.
function transact(world, moves, attempt) {
  const trial = cloneWorld(world);
  const trialMoves = [];
  if (!attempt(trial, trialMoves)) return false;
  Object.assign(world, trial);
  moves.push(...trialMoves);
  return true;
}

/**
 * @param board   from createBoard()
 * @param from    current arrangement: Map, FEN, or { cellName: piece }
 * @param to      target for the play area (storage is free-form)
 * @param options pieceDiameter in square widths (default 0.45),
 *                home: where the magnet starts, in square units
 * @returns { ok, moves, stats } or { ok: false, error, moves, stats }
 */
export function planArrangement(board, from, to, options = {}) {
  const { pieceDiameter = 0.45, home = { x: 0, y: 0 } } = options;
  const startedAt = performance.now();
  const motion = createMotion(board, pieceDiameter);
  const current = toArrangement(board, from);
  const target = toArrangement(board, to);
  for (const cell of target.keys()) {
    if (!isPlayCell(board, cell)) {
      throw new Error(`Targets must be squares on the board, got ${cellName(board, cell)}`);
    }
  }
  const storage = [...storageCells(board, 'L'), ...storageCells(board, 'R')];
  const moves = [];

  const world = {
    at: new Int16Array(board.cellCount).fill(-1), // cell -> piece id
    pieces: [], // { type, cell, displaced }
    tasks: new Map(), // piece id -> goal cell, or STORAGE
    magnet: { ...home },
  };
  for (const [cell, type] of [...current].sort(([a], [b]) => a - b)) {
    world.at[cell] = world.pieces.length;
    world.pieces.push({ type, cell, displaced: false });
  }

  const summary = () => ({
    moves: moves.length,
    temporary: moves.filter((m) => m.kind === 'aside' || m.kind === 'buffer').length,
    drag: moves.reduce((sum, m) => sum + m.drag, 0),
    travel: moves.reduce((sum, m) => sum + m.travel, 0),
    ms: performance.now() - startedAt,
  });
  const failure = (error) => ({ ok: false, error, moves, stats: summary() });

  // Rough cost of sending a piece to storage: across to the nearest storage column.
  const storageDistance = (cell) => {
    if (!isPlayCell(board, cell)) return 0;
    const x = cellX(board, cell);
    const s = board.storageColumns;
    return Math.min(x - (s - 1), s + 8 - x);
  };

  // 1. Assign pieces to target squares.
  for (const type of new Set([...current.values(), ...target.values()])) {
    const sources = [];
    world.pieces.forEach((piece, id) => {
      if (piece.type === type) sources.push(id);
    });
    const goals = [...target].filter(([, piece]) => piece === type).map(([cell]) => cell);
    if (sources.length < goals.length) {
      const have = sources.length === 1 ? 'is' : 'are';
      return failure(
        `The target needs ${plural(goals.length, pieceName(type))} but only ${sources.length} ${have} available`,
      );
    }
    const spare = sources.length - goals.length;
    const cost = sources.map((id) => {
      const cell = world.pieces[id].cell;
      return [
        ...goals.map((goal) => cellDistance(board, cell, goal)),
        ...new Array(spare).fill(storageDistance(cell)),
      ];
    });
    hungarian(cost).forEach((column, row) => {
      const id = sources[row];
      const cell = world.pieces[id].cell;
      if (column < goals.length) {
        if (goals[column] !== cell) world.tasks.set(id, goals[column]);
      } else if (isPlayCell(board, cell)) {
        world.tasks.set(id, STORAGE);
      }
    });
  }

  const occupiedWithout = (w, id) => {
    const occupied = new Uint8Array(board.cellCount);
    w.pieces.forEach((piece, other) => {
      if (other !== id) occupied[piece.cell] = 1;
    });
    return occupied;
  };

  // Cells a piece's task could finish on right now.
  const destinations = (w, id) => {
    const goal = w.tasks.get(id);
    if (goal === STORAGE) return storage.filter((cell) => w.at[cell] < 0);
    return w.at[goal] < 0 ? [goal] : [];
  };

  // Free cells that no pending task needs and that keep clear of `sweeps`.
  // Big pieces prefer spots away from squares still to be filled, so a piece
  // parked now is not in the way of the next move as well.
  const spareCells = (w, sweeps, exclude) => {
    const needed = new Set(w.tasks.values());
    const cells = [];
    for (let cell = 0; cell < board.cellCount; cell++) {
      if (w.at[cell] < 0 && !needed.has(cell) && cell !== exclude && motion.clearOf(cell, sweeps)) {
        cells.push(cell);
      }
    }
    if (pieceDiameter <= 0.5) return cells;
    const goals = [...needed].filter((goal) => goal !== STORAGE);
    const roomy = cells.filter((cell) => goals.every((goal) =>
      Math.max(Math.abs(cellX(board, cell) - cellX(board, goal)), Math.abs(cellY(board, cell) - cellY(board, goal))) > 1));
    return roomy.length ? roomy : cells;
  };

  function apply(w, out, id, path, note) {
    const piece = w.pieces[id];
    const fromCell = piece.cell;
    const toCell = path.cell;
    const goal = w.tasks.get(id);
    const finished = goal === toCell || (goal === STORAGE && !isPlayCell(board, toCell));
    let kind;
    let why;
    if (finished) {
      w.tasks.delete(id);
      kind = isPlayCell(board, toCell) ? 'place' : 'store';
      if (kind === 'store') why = 'not needed, off to storage';
      else why = piece.displaced ? 'back into position' : 'into position';
      piece.displaced = false;
    } else if (note.kind === 'buffer') {
      kind = 'buffer';
      why = note.for === undefined
        ? 'spare spot to break a deadlock'
        : `spare spot so the ${pieceName(w.pieces[note.for].type)} can have ${cellName(board, fromCell)}`;
    } else {
      kind = 'aside';
      why = note.for === undefined
        ? 'out of the way'
        : `out of the way of the ${pieceName(w.pieces[note.for].type)}`;
    }
    const start = path.points[0];
    out.push({
      piece: piece.type,
      from: cellName(board, fromCell),
      to: cellName(board, toCell),
      kind,
      why,
      path: path.points,
      travel: Math.hypot(start.x - w.magnet.x, start.y - w.magnet.y),
      drag: path.length,
    });
    w.at[fromCell] = -1;
    w.at[toCell] = id;
    piece.cell = toCell;
    w.magnet = { ...path.points[path.points.length - 1] };
  }

  // Big pieces fill storage from the outer column inward, like a car park,
  // so parked pieces never wall in the free spots behind them.
  function fillGroups(cells) {
    if (pieceDiameter <= 0.5 || cells.some((cell) => isPlayCell(board, cell))) return [cells];
    const s = board.storageColumns;
    const column = (cell) => (cellX(board, cell) < s ? s - cellX(board, cell) : cellX(board, cell) - s - 7);
    const groups = [];
    for (let c = s; c >= 1; c--) {
      const group = cells.filter((cell) => column(cell) === c);
      if (group.length) groups.push(group);
    }
    return groups;
  }

  function moveDirect(w, out, id, cells, note) {
    const occupied = occupiedWithout(w, id);
    for (const group of fillGroups(cells)) {
      const path = motion.findPath(occupied, w.pieces[id].cell, group);
      if (path) {
        apply(w, out, id, path, note);
        return true;
      }
    }
    return false;
  }

  // Drag piece `id` to one of `cells`, first moving whatever is in the way.
  // Pieces moved aside keep clear of every route in `sweeps` (the drags this
  // one is making room for). Pieces in `guarded` are mid-move and stay put.
  function moveClearing(w, out, id, cells, sweeps, depth, guarded, note) {
    if (moveDirect(w, out, id, cells, note)) return true;
    if (depth >= MAX_CLEARING_DEPTH || !cells.length) return false;
    const occupied = occupiedWithout(w, id);
    for (const other of guarded) occupied[w.pieces[other].cell] = FIXED;
    const route = motion.findPath(occupied, w.pieces[id].cell, cells, { soft: true });
    if (!route) return false;
    const allSweeps = [...sweeps, route.points];
    const allGuarded = [...guarded, id];

    for (const cell of motion.blockers(occupied, route.points)) {
      const blocker = w.at[cell];
      if (blocker < 0) continue; // already moved while clearing an earlier blocker
      const homeCell = w.pieces[blocker].cell;
      const settled = !w.tasks.has(blocker);
      // A blocker that has somewhere to be anyway goes straight there if it can.
      const ownGoal = settled
        ? []
        : destinations(w, blocker).filter((c) => c !== route.cell && motion.clearOf(c, allSweeps));
      const parking = (tw) => {
        const spare = spareCells(tw, allSweeps, route.cell);
        if (!settled || !isPlayCell(board, homeCell)) return spare;
        // Prefer a spot the piece can get home from once this move is done.
        const after = occupiedWithout(tw, blocker);
        after[tw.pieces[id].cell] = 0;
        after[route.cell] = 1;
        const back = motion.region(after, homeCell);
        const returnable = spare.filter((c) => back[c]);
        return returnable.length ? returnable : spare;
      };
      const cleared =
        (ownGoal.length > 0 &&
          transact(w, out, (tw, tout) =>
            moveClearing(tw, tout, blocker, ownGoal, allSweeps, depth + 1, allGuarded, {}))) ||
        transact(w, out, (tw, tout) =>
          moveClearing(tw, tout, blocker, parking(tw), allSweeps, depth + 1, allGuarded,
            { kind: 'aside', for: id }));
      if (!cleared) return false;
      if (settled) {
        const moved = w.pieces[blocker];
        moved.displaced = true;
        if (isPlayCell(board, homeCell)) w.tasks.set(blocker, homeCell);
        else if (isPlayCell(board, moved.cell)) w.tasks.set(blocker, STORAGE);
      }
    }
    return moveDirect(w, out, id, [route.cell], note);
  }

  // When every destination is taken, step one piece onto a spare square.
  // With big pieces, free the deepest squares first (the back rank before
  // the pawns) so they can be filled while there is still room around them.
  function breakDeadlock(depth, candidates = [...world.tasks.keys()]) {
    const waitingFor = (id) => {
      const cell = world.pieces[id].cell;
      const waiting = [...world.tasks].find(([, goal]) => goal === cell);
      return waiting ? waiting[0] : undefined;
    };
    // Keep the spare spot off the straight line of the piece that is waiting.
    const spareFor = (id) => {
      const waiting = waitingFor(id);
      if (waiting === undefined) return spareCells(world, [], -1);
      const line = [world.pieces[waiting].cell, world.pieces[id].cell].map((cell) => ({
        x: cellX(board, cell),
        y: cellY(board, cell),
      }));
      const clear = spareCells(world, [line], -1);
      return clear.length ? clear : spareCells(world, [], -1);
    };
    const groups = new Map();
    for (const id of candidates) {
      const rank = depth ? depth.get(world.pieces[id].cell) ?? -1 : 0;
      if (!groups.has(rank)) groups.set(rank, []);
      groups.get(rank).push(id);
    }
    for (const rank of [...groups.keys()].sort((a, b) => b - a)) {
      let best = null;
      for (const id of groups.get(rank)) {
        const goal = world.tasks.get(id);
        const path = motion.findPath(occupiedWithout(world, id), world.pieces[id].cell, spareFor(id));
        if (!path) continue;
        const onward = goal === STORAGE ? storageDistance(path.cell) : cellDistance(board, path.cell, goal);
        const score = path.length + onward;
        if (!best || score < best.score) best = { id, path, score };
      }
      if (best) {
        apply(world, moves, best.id, best.path, { kind: 'buffer', for: waitingFor(best.id) });
        return true;
      }
      const cleared = groups.get(rank).some((id) => {
        const note = { kind: 'buffer', for: waitingFor(id) };
        return transact(world, moves, (w, out) => moveClearing(w, out, id, spareFor(id), [], 0, [], note));
      });
      if (cleared) return true;
    }
    return false;
  }

  // With full-size pieces, a square deep inside the final formation (the back
  // rank behind the pawns) must be filled before the squares around it. Peel
  // the unfilled target squares away from the outside in, with pieces already
  // home held in place; the last squares peeled off are the first to fill.
  function fillDepths(w) {
    const depth = new Map();
    const occupied = new Uint8Array(board.cellCount);
    w.pieces.forEach((piece, id) => {
      if (!w.tasks.has(id)) occupied[piece.cell] = 1;
    });
    const remaining = new Set([...w.tasks.values()].filter((goal) => goal !== STORAGE));
    for (const cell of remaining) occupied[cell] = 1;
    const exits = storage.filter((cell) => !occupied[cell]);
    for (let round = 0; remaining.size; round++) {
      const escaped = [...remaining].filter((cell) => {
        occupied[cell] = 0;
        const free = motion.reachable(occupied, cell, exits);
        occupied[cell] = 1;
        return free;
      });
      // Squares walled in by pieces already home come first; reaching them
      // means moving those pieces whatever the order.
      for (const cell of escaped.length ? escaped : [...remaining]) {
        depth.set(cell, round);
        remaining.delete(cell);
        occupied[cell] = 0;
      }
    }
    return depth;
  }

  // Pieces sitting on the deepest target squares still to be filled, when
  // none of those squares is free yet and no eviction is waiting.
  function deepOccupants(depth, ready) {
    let deepest = 0;
    for (const goal of world.tasks.values()) {
      if (goal !== STORAGE) deepest = Math.max(deepest, depth.get(goal));
    }
    const shallowOnly = ready.every((id) => {
      const goal = world.tasks.get(id);
      return goal !== STORAGE && depth.get(goal) < deepest;
    });
    if (deepest === 0 || !shallowOnly) return [];
    return [...world.tasks.values()]
      .filter((goal) => goal !== STORAGE && depth.get(goal) === deepest && world.at[goal] >= 0)
      .map((goal) => world.at[goal]);
  }

  // 2 + 3. Order and route the moves.
  const reach = (id) => {
    const cell = world.pieces[id].cell;
    return Math.hypot(cellX(board, cell) - world.magnet.x, cellY(board, cell) - world.magnet.y);
  };
  const limit = 50 + 10 * world.tasks.size;

  while (world.tasks.size) {
    if (moves.length > limit) return failure('Gave up: the plan kept growing without finishing');
    // Small pieces never block each other, so only distance matters. Big
    // ones clear clutter off the board first, then fill from the inside out.
    const depth = pieceDiameter > 0.5 ? fillDepths(world) : null;
    const ready = [...world.tasks.keys()].filter((id) => destinations(world, id).length > 0);
    // While the deepest squares are still taken, emptying them comes before
    // anything shallower, so pieces moved out of the way are not put back
    // only to be moved again.
    const occupants = depth ? deepOccupants(depth, ready) : [];
    if (occupants.length) {
      const leaving = occupants.filter((id) => ready.includes(id));
      if (leaving.some((id) => moveDirect(world, moves, id, destinations(world, id), {}))) continue;
      if (breakDeadlock(depth, occupants)) continue;
    }
    if (!ready.length) {
      if (!breakDeadlock(depth)) return failure('Stuck: every piece that still has to move is boxed in');
      continue;
    }
    const tierOf = (id) => {
      if (!depth) return 0;
      const goal = world.tasks.get(id);
      return goal === STORAGE ? -Infinity : -(depth.get(goal) ?? 0);
    };
    const tiers = new Map();
    for (const id of ready.sort((a, b) => reach(a) - reach(b) || a - b)) {
      const tier = tierOf(id);
      if (!tiers.has(tier)) tiers.set(tier, []);
      tiers.get(tier).push(id);
    }
    const moved = [...tiers.keys()].sort((a, b) => a - b).some((tier) => {
      const ids = tiers.get(tier);
      return (
        ids.some((id) => moveDirect(world, moves, id, destinations(world, id), {})) ||
        ids.some((id) =>
          transact(world, moves, (w, out) => moveClearing(w, out, id, destinations(w, id), [], 0, [], {})))
      );
    });
    if (!moved) return failure('Stuck: no route for any remaining piece, even after moving blockers');
  }

  return { ok: true, moves, stats: summary() };
}
