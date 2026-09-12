// One-time asset pipeline: rasterize US state boundaries into a dot grid
// for the landing hero map (UsaDotMap). No runtime geo dependency.
//
// Usage:
//   node scripts/gen-us-dotgrid.mjs <states-topojson> <out-json>
//
// Input: us-atlas states TopoJSON (e.g. states-10m.json).
// Output: { width, height, gap, regions, dots } where dots are [x, y]
//   grid centers on land, and regions hold the lon/lat->xy transform so the
//   client can project hotspot coordinates with the same math.
//
// Projection: per-region equirectangular with cos(latitude) correction and
// standard AK/HI/PR insets burned into the coordinates.
import { readFileSync, writeFileSync } from 'node:fs';

// Minimal TopoJSON decoder (arcs + quantized positions + Polygon/MultiPolygon
// only — everything us-atlas states needs). Keeps this pipeline dependency-free.
function decodeArcs(topo) {
  const { scale: [sx, sy], translate: [tx, ty] } = topo.transform;
  return topo.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => {
      x += dx; y += dy;
      return [x * sx + tx, y * sy + ty];
    });
  });
}

function stitchRing(arcs, indices) {
  const ring = [];
  for (const idx of indices) {
    const arc = idx >= 0 ? arcs[idx] : [...arcs[~idx]].reverse();
    for (let i = 0; i < arc.length; i++) {
      if (ring.length && i === 0) continue; // skip duplicated joint
      ring.push(arc[i]);
    }
  }
  return ring;
}

function decodeGeometry(arcs, geom) {
  if (!geom) return null;
  if (geom.type === 'Polygon') {
    return { type: 'Polygon', coordinates: geom.arcs.map((ring) => stitchRing(arcs, ring)) };
  }
  if (geom.type === 'MultiPolygon') {
    return {
      type: 'MultiPolygon',
      coordinates: geom.arcs.map((poly) => poly.map((ring) => stitchRing(arcs, ring))),
    };
  }
  return null;
}

const WIDTH = 1000;
const HEIGHT = 620;
const GAP = 8.5;

// [name, stateIds, lonMin, lonMax, latMin, latMax, boxX, boxY, boxW, boxH]
const REGIONS = [
  ['conus', null, -125.5, -66.5, 23.5, 49.8, 10, 10, 980, 460],
  ['alaska', ['02'], -180, -127, 51, 72, 10, 445, 250, 155],
  ['hawaii', ['15'], -161, -154, 18.5, 22.8, 285, 480, 150, 100],
  ['puertorico', ['72'], -67.5, -65.4, 17.8, 18.7, 830, 490, 110, 60],
];

function makeProject(region) {
  const [, , lonMin, lonMax, latMin, latMax, bx, by, bw, bh] = region;
  const midLat = ((latMin + latMax) / 2) * (Math.PI / 180);
  const cos = Math.cos(midLat);
  const k = Math.min(bw / ((lonMax - lonMin) * cos), bh / (latMax - latMin));
  const w = (lonMax - lonMin) * cos * k;
  const h = (latMax - latMin) * k;
  const ox = bx + (bw - w) / 2;
  const oy = by + (bh - h) / 2;
  return {
    project: ([lon, lat]) => [ox + (lon - lonMin) * cos * k, oy + (latMax - lat) * k],
    params: { lonMin, latMax, cos, k, ox, oy },
    bounds: { lonMin, lonMax, latMin, latMax },
  };
}

function eachPosition(geom, fn) {
  if (!geom) return;
  if (geom.type === 'Polygon') {
    for (const ring of geom.coordinates) for (const p of ring) fn(p);
  } else if (geom.type === 'MultiPolygon') {
    for (const poly of geom.coordinates) for (const ring of poly) for (const p of ring) fn(p);
  }
}

function ringContains(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function geomContains(geom, x, y) {
  if (!geom) return false;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  for (const poly of polys) {
    if (!ringContains(poly[0], x, y)) continue;
    let inHole = false;
    for (let r = 1; r < poly.length; r++) {
      if (ringContains(poly[r], x, y)) { inHole = true; break; }
    }
    if (!inHole) return true;
  }
  return false;
}

const [,, topoPath, outPath] = process.argv;
if (!topoPath || !outPath) {
  console.error('usage: node scripts/gen-us-dotgrid.mjs <states-topojson> <out-json>');
  process.exit(1);
}

const topo = JSON.parse(readFileSync(topoPath, 'utf8'));
const arcs = decodeArcs(topo);

// Group state geometries by region via FIPS id.
const byRegion = new Map(REGIONS.map(([name]) => [name, []]));
const seenIds = new Set();
for (const f of topo.objects.states.geometries) {
  const id = String(f.id ?? f.properties?.STATEFP ?? '').padStart(2, '0');
  seenIds.add(id);
  const region = REGIONS.find(([, ids]) => ids?.includes(id))?.[0]
    ?? (['02', '15', '72'].includes(id) ? null : 'conus');
  if (region) byRegion.get(region).push(decodeGeometry(arcs, f));
}
console.error('state ids:', [...seenIds].sort().join(','));

const regionsOut = [];
const dots = [];
for (const spec of REGIONS) {
  const [name] = spec;
  const { project, params, bounds } = makeProject(spec);
  regionsOut.push({ name, ...params, ...bounds });
  const geoms = byRegion.get(name);
  // Project polygons once, then grid-sample in pixel space.
  const projected = [];
  for (const g of geoms) {
    const mapPoly = (poly) => poly.map((ring) => ring.map(project));
    if (!g) continue;
    if (g.type === 'Polygon') projected.push(mapPoly(g.coordinates));
    else if (g.type === 'MultiPolygon') for (const p of g.coordinates) projected.push(mapPoly(p));
  }
  let xs = Infinity, ys = Infinity, xe = -Infinity, ye = -Infinity;
  for (const poly of projected) {
    for (const ring of poly) {
      for (const [x, y] of ring) {
        if (x < xs) xs = x; if (y < ys) ys = y;
        if (x > xe) xe = x; if (y > ye) ye = y;
      }
    }
  }
  const contains = (x, y) => {
    for (const poly of projected) {
      if (!ringContains(poly[0], x, y)) continue;
      let inHole = false;
      for (let r = 1; r < poly.length; r++) {
        if (ringContains(poly[r], x, y)) { inHole = true; break; }
      }
      if (!inHole) return true;
    }
    return false;
  };
  let count = 0;
  for (let gy = ys + GAP / 2; gy <= ye; gy += GAP) {
    for (let gx = xs + GAP / 2; gx <= xe; gx += GAP) {
      if (contains(gx, gy)) {
        dots.push([Math.round(gx * 10) / 10, Math.round(gy * 10) / 10]);
        count++;
      }
    }
  }
  console.error(`${name}: ${count} dots`);
}

writeFileSync(outPath, JSON.stringify({ width: WIDTH, height: HEIGHT, gap: GAP, regions: regionsOut, dots }));
console.error(`total ${dots.length} dots -> ${outPath}`);
