/*
 * Independent replay of a plan. Checks every drag against every other piece
 * with brute-force geometry (no lattice, no shortcuts) and confirms the play
 * area ends up exactly like the target. Used by the tests and the simulator
 * so the planner never grades its own homework.
 */
import { cellName, cellX, cellY, isPlayCell, parseCell, pieceName, toArrangement } from './board.js';
import { pointSegmentDistance } from './motion.js';

const EPS = 1e-9;

export function checkPlan(board, from, to, moves, { pieceDiameter = 0.45 } = {}) {
  const pieces = toArrangement(board, from);
  const target = toArrangement(board, to);
  const problem = (error) => ({ ok: false, error });
  const at = (point, cell) =>
    Math.abs(point.x - cellX(board, cell)) < EPS && Math.abs(point.y - cellY(board, cell)) < EPS;

  for (const [i, move] of moves.entries()) {
    const label = `Move ${i + 1}`;
    const source = parseCell(board, move.from);
    const destination = parseCell(board, move.to);
    if (pieces.get(source) !== move.piece) return problem(`${label}: no ${pieceName(move.piece)} on ${move.from}`);
    if (pieces.has(destination)) return problem(`${label}: ${move.to} is already taken`);
    if (!at(move.path[0], source) || !at(move.path.at(-1), destination)) {
      return problem(`${label}: path does not run from ${move.from} to ${move.to}`);
    }
    for (const p of move.path) {
      if (p.x < -EPS || p.y < -EPS || p.x > board.width - 1 + EPS || p.y > board.height - 1 + EPS) {
        return problem(`${label}: path leaves the board`);
      }
    }
    for (const [cell, piece] of pieces) {
      if (cell === source) continue;
      for (let k = 1; k < move.path.length; k++) {
        const a = move.path[k - 1];
        const b = move.path[k];
        if (pointSegmentDistance(cellX(board, cell), cellY(board, cell), a.x, a.y, b.x, b.y) < pieceDiameter - EPS) {
          return problem(
            `${label}: the ${pieceName(move.piece)} would hit the ${pieceName(piece)} on ${cellName(board, cell)}`,
          );
        }
      }
    }
    pieces.delete(source);
    pieces.set(destination, move.piece);
  }

  for (let cell = 0; cell < board.cellCount; cell++) {
    if (!isPlayCell(board, cell) || pieces.get(cell) === target.get(cell)) continue;
    const got = pieces.get(cell) ? `the ${pieceName(pieces.get(cell))}` : 'nothing';
    const wanted = target.get(cell) ? `the ${pieceName(target.get(cell))}` : 'nothing';
    return problem(`${cellName(board, cell)} ends up with ${got} instead of ${wanted}`);
  }
  return { ok: true, arrangement: pieces };
}
