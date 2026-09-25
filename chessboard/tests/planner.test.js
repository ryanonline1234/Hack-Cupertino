import assert from 'node:assert/strict';
import test from 'node:test';

import { START_FEN, cellAt, createBoard } from '../src/board.js';
import { toGcode } from '../src/gcode.js';
import { planArrangement } from '../src/planner.js';
import { SCENARIOS, mulberry32, scenario, scrambledBoard } from '../src/scenarios.js';
import { checkPlan } from '../src/verify.js';

const board = createBoard();
const SLIM = 0.45;
const FULL_SIZE = 0.8;

function planAndCheck(from, to, pieceDiameter) {
  const plan = planArrangement(board, from, to, { pieceDiameter });
  assert.ok(plan.ok, plan.error);
  const check = checkPlan(board, from, to, plan.moves, { pieceDiameter });
  assert.ok(check.ok, check.error);
  return plan;
}

// Chess960 start position number n (0-959), standard numbering.
function chess960(n) {
  const rank = Array(8).fill(null);
  const empties = () => rank.map((piece, i) => (piece ? -1 : i)).filter((i) => i >= 0);
  let q = n;
  rank[2 * (q % 4) + 1] = 'B';
  q = Math.floor(q / 4);
  rank[2 * (q % 4)] = 'B';
  q = Math.floor(q / 4);
  rank[empties()[q % 6]] = 'Q';
  q = Math.floor(q / 6);
  const [a, b] = [[0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4]][q];
  const open = empties();
  rank[open[a]] = 'N';
  rank[open[b]] = 'N';
  const [r1, k, r2] = empties();
  rank[r1] = 'R';
  rank[k] = 'K';
  rank[r2] = 'R';
  const white = rank.join('');
  return `${white.toLowerCase()}/pppppppp/8/8/8/8/PPPPPPPP/${white}`;
}

test('an arranged board needs no moves', () => {
  const plan = planAndCheck(START_FEN, START_FEN, SLIM);
  assert.equal(plan.moves.length, 0);
});

test('two pieces trading places take three moves', () => {
  const from = { e4: 'N', d5: 'n' };
  const plan = planAndCheck(from, '8/8/8/3N4/4n3/8/8/8', SLIM);
  assert.equal(plan.moves.length, 3);
  assert.equal(plan.moves[0].kind, 'buffer');
});

test('slim pieces reset a game with one drag per piece that moved', () => {
  const { from, to } = scenario(board, 'reset');
  const plan = planAndCheck(from, to, SLIM);
  assert.equal(plan.stats.temporary, 0);
  assert.equal(plan.moves.length, 22);
});

test('a full-size knight gets out by moving the pawn and putting it back', () => {
  const { from, to } = scenario(board, 'nf3');
  const plan = planAndCheck(from, to, FULL_SIZE);
  assert.deepEqual(
    plan.moves.map((m) => `${m.piece} ${m.from}-${m.to} ${m.kind}`),
    ['P g2-h3 aside', 'N g1-f3 place', 'P h3-g2 place'],
  );
  assert.equal(plan.moves[2].why, 'back into position');
});

test('every sample job plans and checks out, slim and full-size', () => {
  for (const { id } of SCENARIOS) {
    for (const size of [SLIM, 0.6, FULL_SIZE]) {
      const { from, to } = scenario(board, id);
      planAndCheck(from, to, size);
    }
  }
});

test('random boards, random targets', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const random = mulberry32(seed * 7919);
    const from = scrambledBoard(board, seed);
    const pieces = [...from.values()].filter(() => random() < 0.6);
    const squares = [];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) squares.push(cellAt(board, board.storageColumns + x, y));
    for (let i = squares.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [squares[i], squares[j]] = [squares[j], squares[i]];
    }
    const to = new Map(pieces.map((piece, i) => [squares[i], piece]));
    for (const size of [SLIM, FULL_SIZE]) planAndCheck(from, to, size);
  }
});

test('Chess960 setups from the standard start, even with full-size pieces', () => {
  for (const n of [0, 100, 518, 959]) {
    planAndCheck(START_FEN, chess960(n), SLIM);
    planAndCheck(START_FEN, chess960(n), FULL_SIZE);
  }
  assert.equal(chess960(518), START_FEN);
});

test('asking for pieces that do not exist fails politely', () => {
  const plan = planArrangement(board, START_FEN, '3QQ3/8/8/8/8/8/8/8');
  assert.equal(plan.ok, false);
  assert.match(plan.error, /2 white queens but only 1 is available/);
  assert.throws(() => planArrangement(board, START_FEN, { 'L1-1': 'K' }), /Targets must be squares/);
});

test('G-code switches the magnet once per move', () => {
  const { from, to } = scenario(board, 'nf3');
  const plan = planAndCheck(from, to, FULL_SIZE);
  const gcode = toGcode(plan.moves, { squareMm: 40 });
  assert.equal(gcode.match(/^M8$/gm).length, plan.moves.length);
  assert.equal(gcode.match(/^M9$/gm).length, plan.moves.length + 1);
  // Move 1 starts under g2: column 2 + 6 = 8, row 1, so (8.5 * 40, 1.5 * 40).
  assert.match(gcode, /^G0 X340\.0 Y60\.0$/m);
});
