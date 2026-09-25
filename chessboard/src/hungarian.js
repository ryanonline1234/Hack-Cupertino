/*
 * Minimum-cost assignment for a square cost matrix (Hungarian algorithm with
 * potentials, O(n^3)). Returns `columnOf`, where row i is matched with
 * column columnOf[i] and the total cost over all rows is as small as possible.
 */
export function hungarian(cost) {
  const n = cost.length;
  const u = new Float64Array(n + 1);
  const v = new Float64Array(n + 1);
  const rowOf = new Int32Array(n + 1); // 1-based row matched to column j, 0 = none
  const way = new Int32Array(n + 1);

  for (let i = 1; i <= n; i++) {
    rowOf[0] = i;
    let j0 = 0;
    const minv = new Float64Array(n + 1).fill(Infinity);
    const used = new Uint8Array(n + 1);
    do {
      used[j0] = 1;
      const i0 = rowOf[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const reduced = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (reduced < minv[j]) {
          minv[j] = reduced;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[rowOf[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (rowOf[j0] !== 0);
    do {
      const j1 = way[j0];
      rowOf[j0] = rowOf[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const columnOf = new Array(n);
  for (let j = 1; j <= n; j++) columnOf[rowOf[j] - 1] = j - 1;
  return columnOf;
}
