import assert from 'node:assert/strict';
import test from 'node:test';

import { START_FEN, cellName, createBoard, parseCell, parseFEN } from '../src/board.js';
import { FIXED, createMotion } from '../src/motion.js';

const board = createBoard();

function occupancy(fen, without) {
  const occupied = new Uint8Array(board.cellCount);
  for (const cell of parseFEN(board, fen).keys()) occupied[cell] = 1;
  if (without) occupied[parseCell(board, without)] = 0;
  return occupied;
}

test('slim pieces slip between the pawns', () => {
  const motion = createMotion(board, 0.45);
  const occupied = occupancy(START_FEN, 'g1');
  const path = motion.findPath(occupied, parseCell(board, 'g1'), [parseCell(board, 'f3')]);
  assert.ok(path, 'knight should find a way out');
  assert.equal(cellName(board, path.cell), 'f3');
  assert.deepEqual(path.points[0], { x: 8, y: 0 });
  assert.deepEqual(path.points.at(-1), { x: 7, y: 2 });
  for (let i = 1; i < path.points.length; i++) {
    assert.ok(motion.segmentClear(occupied, path.points[i - 1], path.points[i]));
  }
});

test('full-size pieces are boxed in, and the soft route names one blocker', () => {
  const motion = createMotion(board, 0.8);
  const occupied = occupancy(START_FEN, 'g1');
  const g1 = parseCell(board, 'g1');
  const f3 = parseCell(board, 'f3');
  assert.equal(motion.findPath(occupied, g1, [f3]), null);
  const soft = motion.findPath(occupied, g1, [f3], { soft: true });
  assert.ok(soft);
  assert.deepEqual(motion.blockers(occupied, soft.points).map((cell) => cellName(board, cell)), ['g2']);

  // A piece marked FIXED is never pushed through.
  occupied[parseCell(board, 'g2')] = FIXED;
  const around = motion.findPath(occupied, g1, [f3], { soft: true });
  assert.ok(!motion.blockers(occupied, around.points).includes(parseCell(board, 'g2')));
});

test('open lines become one straight drag', () => {
  const motion = createMotion(board, 0.8);
  const occupied = occupancy('8/8/8/8/8/8/8/R7', 'a1');
  const path = motion.findPath(occupied, parseCell(board, 'a1'), [parseCell(board, 'a4')]);
  assert.equal(path.points.length, 2);
  assert.equal(path.length, 3);
});

test('multiple goals pick the nearest reachable one', () => {
  const motion = createMotion(board, 0.45);
  const occupied = new Uint8Array(board.cellCount);
  const path = motion.findPath(occupied, parseCell(board, 'a1'), ['h8', 'L1-1', 'R2-8'].map((n) => parseCell(board, n)));
  assert.equal(cellName(board, path.cell), 'L1-1');
});

test('region floods only what a piece can reach', () => {
  const motion = createMotion(board, 0.8);
  const occupied = occupancy(START_FEN, 'e1');
  const region = motion.region(occupied, parseCell(board, 'e1'));
  assert.equal(region[parseCell(board, 'e1')], 1);
  assert.equal(region[parseCell(board, 'e4')], 0);
  assert.throws(() => createMotion(board, 1));
  assert.throws(() => createMotion(board, 0));
});
