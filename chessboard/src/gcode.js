/*
 * Turns a plan into G-code for a GRBL-style XY gantry: a rapid move with the
 * magnet off to get under a piece, then feed moves with it on to drag it.
 * Coordinates are millimetres from the outer corner of the left storage area
 * (the gantry's home), so square centers sit at (x + 0.5) * squareMm.
 *
 * The magnet defaults to M8/M9 (the coolant pin on a GRBL CNC shield, easy to
 * wire to a relay or MOSFET); change magnetOn/magnetOff to match the wiring.
 */
export function toGcode(moves, options = {}) {
  const {
    squareMm = 50,
    dragFeed = 2000, // mm/min while a piece is on the magnet
    magnetOn = 'M8',
    magnetOff = 'M9',
    settleSeconds = 0.2, // pause so the piece grabs or settles before moving on
  } = options;
  const mm = (v) => ((v + 0.5) * squareMm).toFixed(1);
  const lines = ['; robotic chessboard plan', 'G21 ; millimetres', 'G90 ; absolute positions', magnetOff];
  moves.forEach((move, i) => {
    const [start, ...rest] = move.path;
    lines.push(`; ${i + 1}. ${move.piece} ${move.from} -> ${move.to} (${move.kind})`);
    lines.push(`G0 X${mm(start.x)} Y${mm(start.y)}`);
    lines.push(magnetOn, `G4 P${settleSeconds}`);
    for (const point of rest) lines.push(`G1 X${mm(point.x)} Y${mm(point.y)} F${dragFeed}`);
    lines.push(magnetOff, `G4 P${settleSeconds}`);
  });
  lines.push('G0 X0 Y0 ; home');
  return `${lines.join('\n')}\n`;
}
