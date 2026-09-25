/*
 * Collision-aware routing for a piece dragged by the magnet under the board.
 *
 * Pieces are discs `pieceDiameter` square widths across, resting on square
 * centers. A dragged piece travels over a half-square lattice (square centers,
 * edge midpoints and corners, diagonal steps allowed) and must keep one full
 * diameter between its center and every other piece's center, so the two
 * never touch. Pieces up to half a square wide always fit along the lines
 * between squares; bigger ones can get boxed in, and then the planner has to
 * move whatever is in the way.
 */
import { cellAt, cellX, cellY } from './board.js';

const EPS = 1e-9;
const DIAGONAL = Math.SQRT1_2;
const STEPS = [
  [1, 0, 0.5], [-1, 0, 0.5], [0, 1, 0.5], [0, -1, 0.5],
  [1, 1, DIAGONAL], [1, -1, DIAGONAL], [-1, 1, DIAGONAL], [-1, -1, DIAGONAL],
];
// Extra cost per step for every piece the step would push through, used when
// looking for the route that disturbs the fewest pieces.
const PUSH_COST = 3;
// Occupancy value for a piece that a soft route may not push through.
export const FIXED = 2;

export function pointSegmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared
    ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared))
    : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function distanceToPath(px, py, points) {
  if (points.length === 1) return Math.hypot(px - points[0].x, py - points[0].y);
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    best = Math.min(best, pointSegmentDistance(px, py, a.x, a.y, b.x, b.y));
  }
  return best;
}

export function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

class MinHeap {
  constructor() {
    this.items = [];
    this.keys = [];
  }

  get size() {
    return this.items.length;
  }

  push(item, key) {
    const { items, keys } = this;
    let i = items.length;
    items.push(item);
    keys.push(key);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= key) break;
      items[i] = items[parent];
      keys[i] = keys[parent];
      i = parent;
    }
    items[i] = item;
    keys[i] = key;
  }

  pop() {
    const { items, keys } = this;
    const top = items[0];
    const lastItem = items.pop();
    const lastKey = keys.pop();
    const n = items.length;
    if (n === 0) return top;
    let i = 0;
    while (2 * i + 1 < n) {
      let child = 2 * i + 1;
      if (child + 1 < n && keys[child + 1] < keys[child]) child += 1;
      if (keys[child] >= lastKey) break;
      items[i] = items[child];
      keys[i] = keys[child];
      i = child;
    }
    items[i] = lastItem;
    keys[i] = lastKey;
    return top;
  }
}

export function createMotion(board, pieceDiameter) {
  if (!(pieceDiameter > 0 && pieceDiameter < 1)) {
    throw new RangeError('pieceDiameter must be more than 0 and less than 1 square width');
  }
  const cols = 2 * board.width - 1;
  const rows = 2 * board.height - 1;
  const minGap = pieceDiameter - EPS;
  const nodeOf = (cell) => 2 * cellY(board, cell) * cols + 2 * cellX(board, cell);
  const pointOf = (node) => ({ x: (node % cols) / 2, y: Math.floor(node / cols) / 2 });

  // Occupied cells whose piece a straight drag from a to b would touch.
  function touched(occupied, ax, ay, bx, by, firstOnly = false) {
    const cells = [];
    const x0 = Math.max(0, Math.ceil(Math.min(ax, bx) - pieceDiameter));
    const x1 = Math.min(board.width - 1, Math.floor(Math.max(ax, bx) + pieceDiameter));
    const y0 = Math.max(0, Math.ceil(Math.min(ay, by) - pieceDiameter));
    const y1 = Math.min(board.height - 1, Math.floor(Math.max(ay, by) + pieceDiameter));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const cell = cellAt(board, x, y);
        if (occupied[cell] && pointSegmentDistance(x, y, ax, ay, bx, by) < minGap) {
          cells.push(cell);
          if (firstOnly) return cells;
        }
      }
    }
    return cells;
  }

  const segmentClear = (occupied, a, b) => touched(occupied, a.x, a.y, b.x, b.y, true).length === 0;

  // A* over the lattice from a square center to the nearest of `goalCells`.
  // `occupied` holds 0 for a free cell, 1 for a piece and FIXED for a piece
  // that must not be disturbed. In `soft` mode a step may push through
  // ordinary pieces at a price, which finds the route that disturbs the
  // fewest of them.
  function search(occupied, fromCell, goalCells, soft) {
    const goals = new Map(goalCells.map((cell) => [nodeOf(cell), cell]));
    const single = goalCells.length === 1 ? pointOf(nodeOf(goalCells[0])) : null;
    const estimate = (node) => {
      if (!single) return 0;
      const dx = Math.abs((node % cols) / 2 - single.x);
      const dy = Math.abs(Math.floor(node / cols) / 2 - single.y);
      return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
    };
    const cost = new Float64Array(cols * rows).fill(Infinity);
    const previous = new Int32Array(cols * rows).fill(-1);
    const closed = new Uint8Array(cols * rows);
    const open = new MinHeap();
    const start = nodeOf(fromCell);
    cost[start] = 0;
    open.push(start, estimate(start));

    while (open.size) {
      const node = open.pop();
      if (closed[node]) continue;
      closed[node] = 1;
      if (goals.has(node)) {
        const points = [];
        for (let n = node; n !== -1; n = previous[n]) points.push(pointOf(n));
        return { cell: goals.get(node), points: points.reverse() };
      }
      const c = node % cols;
      const r = (node - c) / cols;
      for (const [dc, dr, length] of STEPS) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const next = nr * cols + nc;
        if (closed[next]) continue;
        const hit = touched(occupied, c / 2, r / 2, nc / 2, nr / 2, !soft);
        if (hit.length && (!soft || hit.some((cell) => occupied[cell] === FIXED))) continue;
        const g = cost[node] + length + hit.length * PUSH_COST;
        if (g < cost[next]) {
          cost[next] = g;
          previous[next] = node;
          open.push(next, g + estimate(next));
        }
      }
    }
    return null;
  }

  // Shortcut the lattice route wherever a straight drag is still clear.
  function smooth(occupied, points) {
    const out = [points[0]];
    for (let i = 0; i < points.length - 1;) {
      let j = points.length - 1;
      while (j > i + 1 && !segmentClear(occupied, points[i], points[j])) j -= 1;
      out.push(points[j]);
      i = j;
    }
    return out;
  }

  // Route from `fromCell` to the nearest reachable cell in `goalCells`, with
  // `occupied` marking every other piece. Returns { cell, points, length }.
  function findPath(occupied, fromCell, goalCells, { soft = false } = {}) {
    if (!goalCells.length) return null;
    const route = search(occupied, fromCell, goalCells, soft);
    if (!route) return null;
    const points = soft ? route.points : smooth(occupied, route.points);
    return { cell: route.cell, points, length: pathLength(points) };
  }

  const reachable = (occupied, fromCell, goalCells) =>
    goalCells.length > 0 && search(occupied, fromCell, goalCells, false) !== null;

  // Flags every cell whose center a piece starting on `fromCell` can reach.
  function region(occupied, fromCell) {
    const seen = new Uint8Array(cols * rows);
    const stack = [nodeOf(fromCell)];
    seen[stack[0]] = 1;
    while (stack.length) {
      const node = stack.pop();
      const c = node % cols;
      const r = (node - c) / cols;
      for (const [dc, dr] of STEPS) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const next = nr * cols + nc;
        if (seen[next] || touched(occupied, c / 2, r / 2, nc / 2, nr / 2, true).length) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    const cells = new Uint8Array(board.cellCount);
    for (let cell = 0; cell < board.cellCount; cell++) cells[cell] = seen[nodeOf(cell)];
    return cells;
  }

  // Cells of the pieces a drag along `points` would touch.
  function blockers(occupied, points) {
    const found = new Set();
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      for (const cell of touched(occupied, a.x, a.y, b.x, b.y)) found.add(cell);
    }
    return [...found];
  }

  // True when a piece resting on `cell` is out of the way of every drag in `paths`.
  const clearOf = (cell, paths) =>
    paths.every((points) => distanceToPath(cellX(board, cell), cellY(board, cell), points) >= minGap);

  return { pieceDiameter, findPath, reachable, region, blockers, clearOf, segmentClear };
}
