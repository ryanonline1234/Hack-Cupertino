import assert from 'node:assert/strict';
import test from 'node:test';

import {
  START_FEN,
  cellName,
  createBoard,
  parseCell,
  parseFEN,
  storageCells,
  toArrangement,
  toFEN,
  toObject,
  withCapturedInStorage,
} from '../src/board.js';
import { hungarian } from '../src/hungarian.js';

const board = createBoard();

test('every cell name round-trips', () => {
  for (let cell = 0; cell < board.cellCount; cell++) {
    assert.equal(parseCell(board, cellName(board, cell)), cell);
  }
  assert.equal(cellName(board, parseCell(board, 'a1')), 'a1');
  assert.equal(cellName(board, parseCell(board, 'L1-1')), 'L1-1');
  assert.equal(cellName(board, parseCell(board, 'R2-8')), 'R2-8');
  assert.throws(() => parseCell(board, 'i9'));
  assert.throws(() => parseCell(board, 'L3-1'));
});

test('FEN placement round-trips', () => {
  for (const fen of [START_FEN, '2r2rk1/pp1bqppp/2n1pn2/3p4/3P4/2PBPN2/P1Q2PPP/R4RK1', '8/8/8/8/8/8/8/8']) {
    assert.equal(toFEN(board, parseFEN(board, fen)), fen);
  }
  assert.equal(parseFEN(board, `${START_FEN} w KQkq - 0 1`).size, 32);
  assert.throws(() => parseFEN(board, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP'));
  assert.throws(() => parseFEN(board, 'rnbqkbnr/pppppppp/9/8/8/8/PPPPPPPP/RNBQKBNR'));
  assert.throws(() => parseFEN(board, 'rnbqkbnr/ppppxppp/8/8/8/8/PPPPPPPP/RNBQKBNR'));
});

test('arrangements accept names and reject junk', () => {
  const arrangement = toArrangement(board, { e1: 'K', 'R1-1': 'q' });
  assert.deepEqual(toObject(board, arrangement), { e1: 'K', 'R1-1': 'q' });
  assert.throws(() => toArrangement(board, { e1: 'X' }));
  assert.throws(() => toArrangement(board, new Map([[999, 'K']])));
});

test('captured pieces go to storage, white right and black left', () => {
  const middlegame = parseFEN(board, '2r2rk1/pp1bqppp/2n1pn2/3p4/3P4/2PBPN2/P1Q2PPP/R4RK1');
  const full = withCapturedInStorage(board, middlegame);
  assert.equal(full.size, 32);
  const right = new Set(storageCells(board, 'R'));
  const left = new Set(storageCells(board, 'L'));
  for (const [cell, piece] of full) {
    if (middlegame.has(cell)) continue;
    assert.ok(piece === piece.toUpperCase() ? right.has(cell) : left.has(cell), `${piece} stored on the wrong side`);
  }
  const count = (piece) => [...full.values()].filter((p) => p === piece).length;
  assert.deepEqual(['K', 'Q', 'R', 'B', 'N', 'P'].map(count), [1, 1, 2, 2, 2, 8]);
  assert.deepEqual(['k', 'q', 'r', 'b', 'n', 'p'].map(count), [1, 1, 2, 2, 2, 8]);
});

test('hungarian finds the cheapest assignment', () => {
  assert.deepEqual(hungarian([]), []);
  assert.deepEqual(hungarian([[4, 1, 3], [2, 0, 5], [3, 2, 2]]), [1, 0, 2]);

  // Compare with brute force on small random matrices.
  const permutations = (items) => (items.length <= 1 ? [items] : items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest])));
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let trial = 0; trial < 25; trial++) {
    const n = 1 + (trial % 6);
    const cost = Array.from({ length: n }, () => Array.from({ length: n }, () => Math.round(random() * 20)));
    const total = (columns) => columns.reduce((sum, column, row) => sum + cost[row][column], 0);
    const best = Math.min(...permutations([...Array(n).keys()]).map(total));
    assert.equal(total(hungarian(cost)), best);
  }
});
