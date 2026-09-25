/*
 * Sample jobs for the demo, the simulator and the tests. Each one is a
 * starting arrangement (storage included) and a target for the play area.
 */
import { START_FEN, parseFEN, withCapturedInStorage } from './board.js';

// A typical middlegame after a few trades; the captured pieces sit in storage.
const MIDDLEGAME = '2r2rk1/pp1bqppp/2n1pn2/3p4/3P4/2PBPN2/P1Q2PPP/R4RK1';
// Richard Réti's king-and-pawn study (1921).
const RETI_STUDY = '7K/8/k1P5/7p/8/8/8/8';
const AFTER_NF3 = 'rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R';
const COLOURS_SWAPPED = 'RNBQKBNR/PPPPPPPP/8/8/8/8/pppppppp/rnbqkbnr';

export const SCENARIOS = [
  {
    id: 'reset',
    title: 'Reset after a game',
    description: 'Put every piece back on its starting square, including the captured ones.',
  },
  {
    id: 'study',
    title: 'Set up a study',
    description: 'Clear the board down to the four pieces of Réti’s famous endgame study.',
  },
  {
    id: 'nf3',
    title: 'Play 1. Nf3',
    description: 'One knight move. Easy with slim pieces; with full-size ones the knight is boxed in.',
  },
  {
    id: 'swap',
    title: 'Swap the colours',
    description: 'Every piece trades places with its opposite number.',
  },
  {
    id: 'scramble',
    title: 'Tidy a scrambled board',
    description: 'All 32 pieces dropped at random, board and storage alike.',
  },
];

// Small, fast, seedable PRNG so a "random" board can be reproduced.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// All 32 pieces scattered over random cells of the whole grid.
export function scrambledBoard(board, seed) {
  const random = mulberry32(seed);
  const cells = Array.from({ length: board.cellCount }, (_, i) => i);
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  const pieces = [...parseFEN(board, START_FEN).values()];
  return new Map(pieces.map((piece, i) => [cells[i], piece]));
}

export function scenario(board, id, seed = 1) {
  const start = () => parseFEN(board, START_FEN);
  switch (id) {
    case 'reset':
      return { from: withCapturedInStorage(board, parseFEN(board, MIDDLEGAME)), to: parseFEN(board, START_FEN) };
    case 'study':
      return { from: start(), to: parseFEN(board, RETI_STUDY) };
    case 'nf3':
      return { from: start(), to: parseFEN(board, AFTER_NF3) };
    case 'swap':
      return { from: start(), to: parseFEN(board, COLOURS_SWAPPED) };
    case 'scramble':
      return { from: scrambledBoard(board, seed), to: parseFEN(board, START_FEN) };
    default:
      throw new Error(`Unknown scenario "${id}"`);
  }
}
