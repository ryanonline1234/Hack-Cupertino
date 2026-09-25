/*
 * Board layout for a robotic chessboard: the 8x8 play area plus storage
 * columns on each side where captured or unused pieces wait.
 *
 * Everything is measured in square widths. Square centers sit on integer
 * points: x runs left to right across [left storage | files a-h | right
 * storage] and y runs from rank 1 (y = 0) up to rank 8 (y = 7).
 */

export const FILES = 'abcdefgh';
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

const PIECES = 'KQRBNPkqrbnp';
const PIECE_NAMES = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
const FULL_SET = { K: 1, Q: 1, R: 2, B: 2, N: 2, P: 8 };

export function createBoard({ storageColumns = 2 } = {}) {
  if (!Number.isInteger(storageColumns) || storageColumns < 1) {
    throw new RangeError('storageColumns must be a positive integer');
  }
  const width = 8 + 2 * storageColumns;
  return { storageColumns, width, height: 8, cellCount: width * 8 };
}

export const cellX = (board, cell) => cell % board.width;
export const cellY = (board, cell) => Math.floor(cell / board.width);
export const cellAt = (board, x, y) => y * board.width + x;

export function isPlayCell(board, cell) {
  const file = cellX(board, cell) - board.storageColumns;
  return file >= 0 && file < 8;
}

export function cellDistance(board, a, b) {
  return Math.hypot(cellX(board, a) - cellX(board, b), cellY(board, a) - cellY(board, b));
}

// Play squares use algebraic names (e4). Storage cells are named by side,
// column counted outward from the board, and rank: L1-3, R2-8.
export function cellName(board, cell) {
  const x = cellX(board, cell);
  const rank = cellY(board, cell) + 1;
  const s = board.storageColumns;
  if (x < s) return `L${s - x}-${rank}`;
  if (x >= s + 8) return `R${x - s - 7}-${rank}`;
  return `${FILES[x - s]}${rank}`;
}

export function parseCell(board, name) {
  const s = board.storageColumns;
  const square = /^([a-h])([1-8])$/.exec(name);
  if (square) return cellAt(board, s + FILES.indexOf(square[1]), Number(square[2]) - 1);
  const slot = /^([LR])(\d+)-([1-8])$/.exec(name);
  const column = slot ? Number(slot[2]) : 0;
  if (column >= 1 && column <= s) {
    const x = slot[1] === 'L' ? s - column : s + 7 + column;
    return cellAt(board, x, Number(slot[3]) - 1);
  }
  throw new Error(`Unknown cell "${name}"`);
}

// Storage cells on one side ('L' or 'R'): the column next to the board
// first, rank 1 upward.
export function storageCells(board, side) {
  const cells = [];
  for (let column = 1; column <= board.storageColumns; column++) {
    const x = side === 'L' ? board.storageColumns - column : board.storageColumns + 7 + column;
    for (let y = 0; y < board.height; y++) cells.push(cellAt(board, x, y));
  }
  return cells;
}

export const isWhite = (piece) => piece === piece.toUpperCase();

export function pieceName(piece) {
  return `${isWhite(piece) ? 'white' : 'black'} ${PIECE_NAMES[piece.toLowerCase()]}`;
}

// Reads the piece-placement field of a FEN string into a Map of cell -> piece.
export function parseFEN(board, fen) {
  const ranks = fen.trim().split(/\s+/)[0].split('/');
  if (ranks.length !== 8) throw new Error(`FEN needs 8 ranks, got ${ranks.length}`);
  const arrangement = new Map();
  ranks.forEach((row, i) => {
    let file = 0;
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') {
        file += Number(ch);
      } else if (PIECES.includes(ch) && file < 8) {
        arrangement.set(cellAt(board, board.storageColumns + file, 7 - i), ch);
        file += 1;
      } else {
        throw new Error(`Bad FEN rank "${row}"`);
      }
    }
    if (file !== 8) throw new Error(`FEN rank "${row}" does not cover 8 squares`);
  });
  return arrangement;
}

// Writes the play area (storage is ignored) as a FEN piece-placement field.
export function toFEN(board, arrangement) {
  const rows = [];
  for (let y = 7; y >= 0; y--) {
    let row = '';
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const piece = arrangement.get(cellAt(board, board.storageColumns + file, y));
      if (!piece) {
        empty += 1;
        continue;
      }
      if (empty) row += empty;
      empty = 0;
      row += piece;
    }
    rows.push(empty ? row + empty : row);
  }
  return rows.join('/');
}

// Accepts a FEN string, a Map of cell -> piece, or an object of
// cell name -> piece ({ e1: 'K', 'R1-1': 'q' }) and returns a fresh Map.
export function toArrangement(board, input) {
  if (typeof input === 'string') return parseFEN(board, input);
  const entries = input instanceof Map
    ? [...input]
    : Object.entries(input).map(([name, piece]) => [parseCell(board, name), piece]);
  const arrangement = new Map();
  for (const [cell, piece] of entries) {
    if (!Number.isInteger(cell) || cell < 0 || cell >= board.cellCount) {
      throw new RangeError(`Cell ${cell} is off the board`);
    }
    if (typeof piece !== 'string' || piece.length !== 1 || !PIECES.includes(piece)) {
      throw new Error(`Unknown piece "${piece}"`);
    }
    arrangement.set(cell, piece);
  }
  return arrangement;
}

export function toObject(board, arrangement) {
  return Object.fromEntries(
    [...arrangement].sort(([a], [b]) => a - b).map(([cell, piece]) => [cellName(board, cell), piece]),
  );
}

// Puts whatever a full 32-piece set is missing into storage, white on the
// right and black on the left. Turns a mid-game FEN into the full physical
// state of the board, captured pieces included.
export function withCapturedInStorage(board, arrangement) {
  const result = new Map(arrangement);
  const count = (piece) => [...result.values()].filter((p) => p === piece).length;
  for (const [side, white] of [['R', true], ['L', false]]) {
    const missing = [];
    for (const [type, n] of Object.entries(FULL_SET)) {
      const piece = white ? type : type.toLowerCase();
      for (let i = count(piece); i < n; i++) missing.push(piece);
    }
    const free = storageCells(board, side).filter((cell) => !result.has(cell));
    if (missing.length > free.length) {
      throw new Error(`Not enough storage for ${missing.length} captured pieces`);
    }
    missing.forEach((piece, i) => result.set(free[i], piece));
  }
  return result;
}
