/*
 * Command-line demo: plans one of the sample jobs and prints the moves.
 *
 *   node demo.js                    list the sample jobs
 *   node demo.js reset              reset the pieces after a game
 *   node demo.js nf3 --big          full-size pieces: watch it move blockers
 *   node demo.js scramble --seed 42
 *   node demo.js swap --gcode plan.gcode
 */
import { writeFileSync } from 'node:fs';
import process from 'node:process';

import { cellAt, createBoard, parseCell, pieceName } from './src/board.js';
import { toGcode } from './src/gcode.js';
import { planArrangement } from './src/planner.js';
import { SCENARIOS, scenario } from './src/scenarios.js';
import { checkPlan } from './src/verify.js';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};
const id = args.find((arg, i) => !arg.startsWith('--') && !args[i - 1]?.startsWith('--'));

if (!id) {
  console.log('Usage: node demo.js <job> [--big | --size 0.6] [--seed N] [--gcode file]\n');
  for (const s of SCENARIOS) console.log(`  ${s.id.padEnd(9)} ${s.title}: ${s.description}`);
  process.exit(0);
}

const board = createBoard();
const pieceDiameter = args.includes('--big') ? 0.8 : Number(option('--size', 0.45));
const { from, to } = scenario(board, id, Number(option('--seed', 1)));

function draw(arrangement) {
  const s = board.storageColumns;
  const lines = [];
  for (let y = board.height - 1; y >= 0; y--) {
    let row = `${y + 1} `;
    for (let x = 0; x < board.width; x++) {
      if (x === s || x === s + 8) row += '| ';
      row += `${arrangement.get(cellAt(board, x, y)) ?? '.'} `;
    }
    lines.push(row);
  }
  lines.push(`${' '.repeat(2 * s + 4)}a b c d e f g h`);
  return lines.join('\n');
}

console.log(`Pieces ${pieceDiameter} of a square wide. Storage on both sides.\n`);
console.log(`${draw(from)}\n`);

const plan = planArrangement(board, from, to, { pieceDiameter });
plan.moves.forEach((move, i) => {
  const n = String(i + 1).padStart(3);
  console.log(`${n}. ${pieceName(move.piece).padEnd(13)} ${move.from.padStart(4)} -> ${move.to.padEnd(4)}  ${move.why}`);
});
if (!plan.ok) {
  console.error(`\nNo plan: ${plan.error}`);
  process.exit(1);
}

const after = new Map(from);
for (const move of plan.moves) {
  after.delete(parseCell(board, move.from));
  after.set(parseCell(board, move.to), move.piece);
}
console.log(`\n${draw(after)}\n`);

const { stats } = plan;
console.log(
  `${stats.moves} moves (${stats.temporary} temporary), ${stats.drag.toFixed(1)} squares dragged, ` +
    `${stats.travel.toFixed(1)} squares of empty travel, planned in ${stats.ms.toFixed(0)} ms`,
);
const check = checkPlan(board, from, to, plan.moves, { pieceDiameter });
console.log(check.ok ? 'Checked: no piece ever touches another, and the board matches the target.' : `CHECK FAILED: ${check.error}`);

const gcodeFile = option('--gcode');
if (gcodeFile) {
  writeFileSync(gcodeFile, toGcode(plan.moves));
  console.log(`G-code written to ${gcodeFile}`);
}
process.exit(check.ok ? 0 : 1);
