#!/usr/bin/env node
// Build the commercial site candidates for "Suggest sites"
// (docs/08-suggest-sites-and-plan.md §1, "Commercial").
//
// For each bundled county: one Overpass query (OpenStreetMap) over the county's
// populated-block extent (public/data/blocks/<SSCCC>.json) padded by 2 miles,
// asking for
//   - vacant shops: shop=vacant and disused:shop=* (nodes + ways);
//   - retail/commercial buildings: building=retail|commercial ways and
//     multipolygon relations with a footprint >= 10,000 sq ft
//     (building=supermarket is fetched too, but only a vacant or disused one
//     is a candidate, as a vacant shop);
//   - retail areas: landuse=retail ways and multipolygon relations >= 2 acres;
//   - every shop=supermarket and amenity=fast_food feature, only so they can be
//     excluded.
// Footprints come from the returned geometry (`out geom`) on a sinusoidal
// (equal-area) projection centered on each polygon, holes subtracted.
//
// Not candidates:
//   - anything tagged shop=supermarket or amenity=fast_food (whatever its size);
//   - a building or retail area in active use: any shop (other than vacant),
//     amenity, office, craft, healthcare, leisure, tourism or club tag on the
//     feature itself (measured 2026-10-03: warehouse clubs, restaurants,
//     hotels, clinics, lodges, offices, car dealers, department stores, malls);
//   - a building=supermarket that isn't vacant or disused;
//   - a candidate building or retail area with an operating supermarket (a
//     shop=supermarket node or polygon) inside it (measured 2026-10-03: 393 of
//     981 retail-area ways held one).
// A fast-food node inside a large building does NOT exclude it: measured on
// 2026-10-03, those buildings are malls, food courts and strip centers.
// A feature with disused:shop that is occupied again (the same active-use
// tags) is not "vacant". A vacant shop inside a counted building within 50 m
// of the building's centroid replaces the building (one site, the vacant
// one); more than 50 m apart, both stay. Retail areas are never replaced
// that way. Only candidates whose point lies inside the padded bbox are kept.
//
// Output: public/data/sites/<SSCCC>.json
//   { retrievedAt, source: 'OpenStreetMap via Overpass',
//     license: 'ODbL (© OpenStreetMap contributors)',
//     counts: { vacant, building, commercial_building, retail_area },
//     osmBase,            // OSM data timestamp reported by the Overpass server
//     bbox: [s, w, n, e], // the padded query box
//     sites: [[id, lat5, lng5, kind, sqft, name], ...] }
//   id 'n123' | 'w123' | 'r123'; kind 'vacant' | 'building' (building=retail)
//   | 'commercial_building' (building=commercial: offices or shops) |
//   'retail_area'; sqft = integer footprint (building kinds, building-tagged
//   vacant polygon) or lot area (retail_area), else null; name = OSM name,
//   trimmed, <= 60 chars, for vacant shops only (on any other feature the
//   name is the business there now), else ''.
//
// Network: build time only. Endpoints tried in order, each with retries and
// backoff (Retry-After honoured). A response with an Overpass `remark` (query
// timed out / ran out of memory: a partial result), a count mismatch, invalid
// JSON or no features is a failed attempt. A county whose query ultimately
// fails is not written (any earlier file is left as it was), and the script
// exits 1. Files are written to a temp name and renamed, so a killed run never
// leaves a partial county file.
//
// Usage: node scripts/build-site-candidates.mjs [SSCCC ...] [options]
//   (default: all four bundled counties, one query at a time)
//   --attempt-timeout=SEC  client timeout per HTTP attempt (default 200)
//   --attempts=N           attempts per endpoint (default 2)
//   --save-raw=DIR         also save each raw Overpass response to DIR (keep it out of the repo)
//   --from-raw=DIR         rebuild from responses saved with --save-raw (no network)
// Needs Node 20+ (built-in fetch). No dependencies.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

// Must match BUNDLED_COUNTIES in src/pipeline/blockLoader.js.
export const COUNTIES = ['06085', '06001', '28151', '04001'];
const COUNTY_NAMES = { '06085': 'Santa Clara CA', '06001': 'Alameda CA', '28151': 'Washington MS', '04001': 'Apache AZ' };

export const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
export const USER_AGENT =
  'food-desert-simulator/1.0 (build-time extract of commercial site candidates for a student food-access project; one query per county per data refresh)';
export const SOURCE = 'OpenStreetMap via Overpass';
export const LICENSE = 'ODbL (© OpenStreetMap contributors)';

export const MIN_BUILDING_SQFT = 10_000;
export const MIN_RETAIL_AREA_SQFT = 2 * 43_560;
export const DEDUPE_M = 50;
export const NAME_MAX = 60;
export const BBOX_PAD_MILES = 2;
// Fetched by the query (unchanged, so saved raw responses still rebuild).
const BUILDING_TYPES = ['retail', 'commercial', 'supermarket'];
// building value -> candidate kind; building=supermarket counts only vacant.
const BUILDING_KIND = { retail: 'building', commercial: 'commercial_building' };
export const KINDS = ['vacant', 'building', 'commercial_building', 'retail_area'];
const BUILDING_KINDS = new Set(['building', 'commercial_building']);
// A feature that carries any of these is in use: a disused:shop is occupied
// again (measured 2026-10-03 in 06085: offices, crafts, gyms, clinics in old
// shops), and a building or retail area is a business that is open there.
// shop=vacant is the one shop value that isn't a use.
const ACTIVE_USE_KEYS = ['shop', 'amenity', 'office', 'craft', 'healthcare', 'leisure', 'tourism', 'club'];
const inActiveUse = (tags) => ACTIVE_USE_KEYS.some((k) => tags[k] && !(k === 'shop' && tags[k] === 'vacant'));

// Server-side perimeter prefilters. Any planar region of area A has perimeter
// >= 2*sqrt(pi*A) (isoperimetric inequality), and Overpass length() of a
// closed way is its perimeter, so these drop only features that cannot reach
// the area thresholds: 10,000 sq ft -> >= 108.0 m, 2 acres -> >= 318.9 m.
const BUILDING_MIN_PERIM_M = 100;
const RETAIL_MIN_PERIM_M = 300;
const QUERY_TIMEOUT_S = 150;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------- geometry
const R = 6371008.8; // mean Earth radius, m
const RAD = Math.PI / 180;
const M_PER_DEG = R * RAD;
const SQFT_PER_M2 = 10.763910416709722;
const MILE_M = 1609.344;

const round5 = (v) => Math.round(v * 1e5) / 1e5;
const validPt = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
const samePt = (a, b) => a.lat === b.lat && a.lon === b.lon;
const isClosed = (ring) => ring.length >= 4 && samePt(ring[0], ring[ring.length - 1]);

function ringsBbox(rings) {
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  for (const ring of rings) {
    for (const p of ring) {
      if (p.lat < s) s = p.lat;
      if (p.lat > n) n = p.lat;
      if (p.lon < w) w = p.lon;
      if (p.lon > e) e = p.lon;
    }
  }
  return { s, w, n, e };
}

// Signed shoelace area (m^2) and centroid of one ring on a sinusoidal
// projection centered on (lat0, lng0): x = R*dlng*cos(lat), y = R*dlat.
// Sinusoidal is equal-area, and at building/lot scale the projected edges are
// indistinguishable from the geodesic ones.
function ringAreaCentroid(ring, lat0, lng0) {
  let a2 = 0, cx = 0, cy = 0;
  const xy = ring.map((p) => [M_PER_DEG * (p.lon - lng0) * Math.cos(p.lat * RAD), M_PER_DEG * (p.lat - lat0)]);
  for (let i = 0; i < xy.length - 1; i++) {
    const [x1, y1] = xy[i];
    const [x2, y2] = xy[i + 1];
    const cross = x1 * y2 - x2 * y1;
    a2 += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  const area = a2 / 2;
  if (area === 0) return { area: 0, x: 0, y: 0 };
  return { area, x: cx / (6 * area), y: cy / (6 * area) };
}

// { outers: [ring], inners: [ring] } (closed rings of {lat, lon}) ->
// { sqft, lat, lng }: net area (outers minus holes, any winding) and the
// area-weighted centroid.
export function polygonMetrics({ outers, inners = [] }) {
  const bb = ringsBbox(outers);
  const lat0 = (bb.s + bb.n) / 2;
  const lng0 = (bb.w + bb.e) / 2;
  let area = 0, mx = 0, my = 0;
  for (const [rings, sign] of [[outers, 1], [inners, -1]]) {
    for (const ring of rings) {
      const r = ringAreaCentroid(ring, lat0, lng0);
      const a = Math.abs(r.area) * sign;
      area += a;
      mx += a * r.x;
      my += a * r.y;
    }
  }
  if (!(area > 0)) return { sqft: 0, lat: lat0, lng: lng0 };
  const lat = lat0 + my / area / M_PER_DEG;
  const lng = lng0 + mx / area / (M_PER_DEG * Math.cos(lat * RAD));
  return { sqft: area * SQFT_PER_M2, lat, lng };
}

// Join way segments (arrays of {lat, lon}) end to end into closed rings.
// Returns null if any ring cannot be closed or is degenerate.
export function assembleRings(segments) {
  const pool = segments.map((s) => [...s]);
  const rings = [];
  while (pool.length) {
    let ring = pool.shift();
    if (ring.length < 2) return null;
    while (!samePt(ring[0], ring[ring.length - 1])) {
      const end = ring[ring.length - 1];
      const i = pool.findIndex((s) => s.length >= 2 && (samePt(s[0], end) || samePt(s[s.length - 1], end)));
      if (i < 0) return null;
      let seg = pool.splice(i, 1)[0];
      if (!samePt(seg[0], end)) seg = [...seg].reverse();
      ring = ring.concat(seg.slice(1));
    }
    if (ring.length < 4) return null;
    rings.push(ring);
  }
  return rings;
}

// Even-odd over every ring (outers and holes alike).
function pointInRings(lat, lon, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const yi = ring[i].lat, xi = ring[i].lon, yj = ring[j].lat, xj = ring[j].lon;
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function haversineM(lat1, lng1, lat2, lng2) {
  const dLat = (lat2 - lat1) * RAD;
  const dLng = (lng2 - lng1) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// ---------------------------------------------------------------- bbox + query

// Extent of every populated block's internal point, padded by `padMiles` on
// all sides. The longitude pad uses the poleward edge, so it is >= padMiles
// everywhere in the box.
export function bboxFromBundle(bundle, padMiles = BBOX_PAD_MILES) {
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  for (const t of Object.values(bundle?.tracts ?? {})) {
    for (const row of t?.blocks ?? []) {
      const lat = row[3], lng = row[4];
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
      if (lng < w) w = lng;
      if (lng > e) e = lng;
    }
  }
  if (!Number.isFinite(s)) throw new Error('block bundle has no populated blocks');
  const padM = padMiles * MILE_M;
  const padLat = padM / M_PER_DEG;
  s -= padLat;
  n += padLat;
  const poleward = Math.max(Math.abs(s), Math.abs(n));
  const padLng = padM / (M_PER_DEG * Math.cos(poleward * RAD));
  return { s, w: w - padLng, n, e: e + padLng };
}

// Every statement carries the bbox explicitly: a global [bbox:...] setting
// would also apply to `out geom` and could clip geometry at the edge.
export function buildQuery({ s, w, n, e }) {
  const bb = `(${s.toFixed(6)},${w.toFixed(6)},${n.toFixed(6)},${e.toFixed(6)})`.replace(/\.?0+(?=[,)])/g, '');
  const types = `"^(${BUILDING_TYPES.join('|')})$"`;
  return [
    `[out:json][timeout:${QUERY_TIMEOUT_S}];`,
    '(',
    `  node["shop"="vacant"]${bb};`,
    `  way["shop"="vacant"]${bb};`,
    `  node["disused:shop"]${bb};`,
    `  way["disused:shop"]${bb};`,
    `  way["building"~${types}](if: length() >= ${BUILDING_MIN_PERIM_M})${bb};`,
    `  relation["building"~${types}]${bb};`,
    `  way["landuse"="retail"](if: length() >= ${RETAIL_MIN_PERIM_M})${bb};`,
    `  relation["landuse"="retail"]${bb};`,
    `  nwr["shop"="supermarket"]${bb};`,
    `  nwr["amenity"="fast_food"]${bb};`,
    ')->.all;',
    '.all out count;',
    '.all out geom;',
  ].join('\n');
}

// ---------------------------------------------------------------- response checks

// Throws unless the response is complete: an elements array led by the
// `out count` element whose per-type totals match what came back, no
// Overpass remark (Overpass reports a timeout or out-of-memory as a remark
// next to whatever it had produced so far), and at least one feature.
export function validateOverpass(json) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.elements)) throw new Error('response has no elements array');
  if (json.remark) throw new Error(`Overpass remark (failed or partial result): ${String(json.remark).slice(0, 200)}`);
  const [first, ...rest] = json.elements;
  if (!first || first.type !== 'count') throw new Error('count element missing: cannot check completeness');
  const t = first.tags ?? {};
  const want = { node: Number(t.nodes), way: Number(t.ways), relation: Number(t.relations) };
  const total = Number(t.total);
  if (![total, want.node, want.way, want.relation].every(Number.isInteger)) throw new Error('count element malformed');
  const got = { node: 0, way: 0, relation: 0 };
  for (const el of rest) {
    if (!el || !(el.type in got)) throw new Error(`unexpected element type ${el?.type} after the count`);
    got[el.type]++;
  }
  if (rest.length !== total || got.node !== want.node || got.way !== want.way || got.relation !== want.relation) {
    throw new Error(
      `count mismatch: got ${got.node}/${got.way}/${got.relation} nodes/ways/relations, count said ${want.node}/${want.way}/${want.relation}`,
    );
  }
  if (total === 0) throw new Error('empty result: refusing to write a county file with no OSM features');
  return { elements: rest, osmBase: json.osm3s?.timestamp_osm_base ?? null };
}

// ---------------------------------------------------------------- network
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const host = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};
// Overpass error pages are HTML/XML; keep the readable part.
const snippet = (text) => {
  const t = String(text ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const m = t.match(/(?:Error|runtime error)[^.]*\./i);
  const s = (m ? m[0] : t).slice(0, 160);
  return s ? ` (${s})` : '';
};

export async function fetchOverpass(query, opts = {}) {
  const {
    endpoints = ENDPOINTS,
    fetchImpl = globalThis.fetch,
    sleep = defaultSleep,
    attemptsPerEndpoint = 2,
    attemptTimeoutMs = 200_000,
    backoffMs = 5_000,
    log = () => {},
  } = opts;
  const errors = [];
  for (let ei = 0; ei < endpoints.length; ei++) {
    const endpoint = endpoints[ei];
    for (let attempt = 1; attempt <= attemptsPerEndpoint; attempt++) {
      let waitMs = backoffMs * 2 ** (attempt - 1);
      const t0 = Date.now();
      try {
        const res = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'User-Agent': USER_AGENT,
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: new URLSearchParams({ data: query }).toString(),
          signal: AbortSignal.timeout(attemptTimeoutMs),
        });
        const text = await res.text();
        if (!res.ok) {
          const ra = Number(res.headers?.get?.('retry-after'));
          if (Number.isFinite(ra) && ra > 0) waitMs = Math.min(ra * 1000, 120_000);
          throw new Error(`HTTP ${res.status}${snippet(text)}`);
        }
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          throw new Error(`invalid JSON (${text.length} bytes)${snippet(text)}`);
        }
        const v = validateOverpass(json);
        log(`${host(endpoint)} attempt ${attempt}: ok, ${text.length.toLocaleString('en-US')} B in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
        return { ...v, endpoint, bytes: text.length };
      } catch (e) {
        const msg = `${host(endpoint)} attempt ${attempt}: ${e?.name === 'TimeoutError' ? `client timeout after ${attemptTimeoutMs / 1000} s` : e?.message ?? e}`;
        errors.push(msg);
        log(msg);
        const last = ei === endpoints.length - 1 && attempt === attemptsPerEndpoint;
        if (!last) await sleep(waitMs);
      }
    }
  }
  throw new Error(`all Overpass endpoints failed:\n  ${errors.join('\n  ')}`);
}

// ---------------------------------------------------------------- candidates

export function cleanName(s) {
  const t = String(s ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, '')
    .trim();
  return Array.from(t).slice(0, NAME_MAX).join('').trim();
}

// Geometry of one element: { lat, lng, rings?, bbox?, sqft? } or null if unusable.
function shapeOf(el, stats) {
  if (el.type === 'node') return validPt(el) ? { lat: el.lat, lng: el.lon } : null;
  if (el.type === 'way') {
    const g = el.geometry;
    if (!Array.isArray(g) || g.length < 2 || !g.every(validPt)) return null;
    if (isClosed(g)) {
      const m = polygonMetrics({ outers: [g] });
      return { lat: m.lat, lng: m.lng, sqft: m.sqft, rings: [g], bbox: ringsBbox([g]) };
    }
    const bb = ringsBbox([g]);
    return { lat: (bb.s + bb.n) / 2, lng: (bb.w + bb.e) / 2, line: true };
  }
  if (el.type === 'relation') {
    if (el.tags?.type !== 'multipolygon') {
      stats.skippedRelations++;
      return null;
    }
    const outerSegs = [], innerSegs = [];
    for (const m of el.members ?? []) {
      if (m.type !== 'way') continue;
      if (!Array.isArray(m.geometry) || !m.geometry.every(validPt)) return null;
      if (m.role === 'inner') innerSegs.push(m.geometry);
      else if (m.role === 'outer' || m.role === '') outerSegs.push(m.geometry);
    }
    const outers = assembleRings(outerSegs);
    const inners = assembleRings(innerSegs);
    if (!outers || !outers.length || !inners) return null;
    const m = polygonMetrics({ outers, inners });
    const rings = [...outers, ...inners];
    return { lat: m.lat, lng: m.lng, sqft: m.sqft, rings, bbox: ringsBbox(outers) };
  }
  return null;
}

// Coarse grid over polygon bboxes for point-in-polygon lookups.
const CELL_DEG = 0.01;
function makeGrid() {
  const cells = new Map();
  const key = (i, j) => `${i},${j}`;
  return {
    add(item) {
      const { s, w, n, e } = item.shape.bbox;
      for (let i = Math.floor(s / CELL_DEG); i <= Math.floor(n / CELL_DEG); i++) {
        for (let j = Math.floor(w / CELL_DEG); j <= Math.floor(e / CELL_DEG); j++) {
          const k = key(i, j);
          if (!cells.has(k)) cells.set(k, []);
          cells.get(k).push(item);
        }
      }
    },
    containing(lat, lng) {
      const list = cells.get(key(Math.floor(lat / CELL_DEG), Math.floor(lng / CELL_DEG))) ?? [];
      return list.filter((it) => {
        const b = it.shape.bbox;
        return lat >= b.s && lat <= b.n && lng >= b.w && lng <= b.e && pointInRings(lat, lng, it.shape.rings);
      });
    },
  };
}

const TYPE_ORDER = { n: 0, r: 1, w: 2 };
const compareIds = (a, b) => TYPE_ORDER[a[0]] - TYPE_ORDER[b[0]] || Number(a.slice(1)) - Number(b.slice(1));

// Overpass elements -> { sites: [[id, lat5, lng5, kind, sqft, name]], counts, stats }.
export function buildCandidates(elements, bbox) {
  const stats = {
    elements: 0,
    duplicates: 0,
    skippedRelations: 0,
    invalidGeometry: 0,
    tooSmall: 0,
    excludedTagged: 0,
    excludedOccupied: 0,
    excludedSupermarketBuilding: 0,
    excludedContainsSupermarket: 0,
    buildingsContainingFastFood: 0,
    notVacantReused: 0,
    outsideBbox: 0,
    dedupedBuildings: 0,
  };
  const seen = new Set();
  const candidates = [];
  const pois = []; // operating supermarkets and fast food, for containment checks
  const inBbox = (lat, lng) => lat >= bbox.s && lat <= bbox.n && lng >= bbox.w && lng <= bbox.e;

  for (const el of elements) {
    if (!el || !['node', 'way', 'relation'].includes(el.type) || !Number.isInteger(el.id)) continue;
    const id = `${el.type[0]}${el.id}`;
    if (seen.has(id)) {
      stats.duplicates++;
      continue;
    }
    seen.add(id);
    stats.elements++;
    const tags = el.tags ?? {};
    const supermarket = tags.shop === 'supermarket';
    const fastFood = tags.amenity === 'fast_food';
    const disused = tags['disused:shop'];
    const hasDisused = typeof disused === 'string' && disused !== '' && disused !== 'no';
    const vacant = tags.shop === 'vacant' || (hasDisused && !inActiveUse(tags));
    if (hasDisused && !vacant && tags.shop !== 'vacant') stats.notVacantReused++;
    const buildingType = BUILDING_TYPES.includes(tags.building);
    const retailLand = tags.landuse === 'retail';
    if (!vacant && !buildingType && !retailLand && !supermarket && !fastFood) continue;

    const shape = shapeOf(el, stats);
    if (!shape) {
      if (el.type !== 'relation' || el.tags?.type === 'multipolygon') stats.invalidGeometry++;
      continue;
    }
    if (supermarket || fastFood) pois.push({ id, lat: shape.lat, lng: shape.lng, supermarket, fastFood });

    let kind = null;
    let sqft = null;
    if (vacant) {
      kind = 'vacant';
      if (shape.rings && tags.building && tags.building !== 'no') sqft = Math.round(shape.sqft);
    } else if (buildingType && shape.rings && shape.sqft >= MIN_BUILDING_SQFT) {
      kind = BUILDING_KIND[tags.building] ?? 'supermarket_building';
      sqft = Math.round(shape.sqft);
    } else if (retailLand && shape.rings && shape.sqft >= MIN_RETAIL_AREA_SQFT) {
      kind = 'retail_area';
      sqft = Math.round(shape.sqft);
    } else if (buildingType || retailLand) {
      if (shape.rings) stats.tooSmall++;
      else stats.invalidGeometry++;
    }
    if (!kind) continue;
    if (supermarket || fastFood) {
      stats.excludedTagged++;
      continue;
    }
    // Not vacant (that was settled above), so any use tag means it's open.
    if (kind !== 'vacant' && inActiveUse(tags)) {
      stats.excludedOccupied++;
      continue;
    }
    if (kind === 'supermarket_building') {
      stats.excludedSupermarketBuilding++;
      continue;
    }
    if (!inBbox(shape.lat, shape.lng)) {
      stats.outsideBbox++;
      continue;
    }
    candidates.push({ id, kind, sqft, name: kind === 'vacant' ? cleanName(tags.name) : '', shape });
  }

  // Buildings and retail areas holding an operating supermarket are that
  // supermarket (or its shopping center), not a site for a new one.
  const grid = makeGrid();
  for (const c of candidates) if (BUILDING_KINDS.has(c.kind) || c.kind === 'retail_area') grid.add(c);
  const drop = new Set();
  for (const p of pois) {
    for (const b of grid.containing(p.lat, p.lng)) {
      if (b.id === p.id) continue;
      if (p.supermarket && !drop.has(b.id)) {
        drop.add(b.id);
        stats.excludedContainsSupermarket++;
      } else if (p.fastFood && !p.supermarket && BUILDING_KINDS.has(b.kind) && !b.fastFoodSeen) {
        b.fastFoodSeen = true;
        stats.buildingsContainingFastFood++;
      }
    }
  }
  // A vacant shop inside a counted building, within 50 m of its centroid, is the same site.
  for (const v of candidates) {
    if (v.kind !== 'vacant') continue;
    for (const b of grid.containing(v.shape.lat, v.shape.lng)) {
      if (!BUILDING_KINDS.has(b.kind) || drop.has(b.id)) continue;
      if (haversineM(v.shape.lat, v.shape.lng, b.shape.lat, b.shape.lng) <= DEDUPE_M) {
        drop.add(b.id);
        stats.dedupedBuildings++;
      }
    }
  }

  const kept = candidates.filter((c) => !drop.has(c.id)).sort((a, b) => compareIds(a.id, b.id));
  const counts = Object.fromEntries(KINDS.map((k) => [k, 0]));
  for (const c of kept) counts[c.kind]++;
  const sites = kept.map((c) => [c.id, round5(c.shape.lat), round5(c.shape.lng), c.kind, c.sqft, c.name]);
  return { sites, counts, stats };
}

// ---------------------------------------------------------------- per county

function checkRows(sites, counts, bbox) {
  const fails = [];
  const ids = new Set();
  for (const r of sites) {
    const [id, lat, lng, kind, sqft, name] = r;
    if (r.length !== 6) fails.push(`row ${id}: ${r.length} fields`);
    if (typeof id !== 'string' || !/^[nwr]\d+$/.test(id)) fails.push(`bad id ${id}`);
    if (ids.has(id)) fails.push(`duplicate id ${id}`);
    ids.add(id);
    if (!(lat >= bbox.s && lat <= bbox.n && lng >= bbox.w && lng <= bbox.e)) {
      // round5 can nudge a point on the edge by <= 0.000005 deg
      if (!(lat >= bbox.s - 1e-5 && lat <= bbox.n + 1e-5 && lng >= bbox.w - 1e-5 && lng <= bbox.e + 1e-5)) fails.push(`${id} outside bbox`);
    }
    if (!KINDS.includes(kind)) fails.push(`${id} bad kind ${kind}`);
    if (!(sqft === null || (Number.isInteger(sqft) && sqft > 0))) fails.push(`${id} bad sqft ${sqft}`);
    if (BUILDING_KINDS.has(kind) && !(sqft >= MIN_BUILDING_SQFT)) fails.push(`${id} building below threshold`);
    if (kind === 'retail_area' && !(sqft >= MIN_RETAIL_AREA_SQFT)) fails.push(`${id} retail area below threshold`);
    if (typeof name !== 'string' || Array.from(name).length > NAME_MAX) fails.push(`${id} bad name`);
    if (kind !== 'vacant' && name !== '') fails.push(`${id} name on a non-vacant site`);
  }
  const sum = KINDS.reduce((s, k) => s + counts[k], 0);
  if (sum !== sites.length) fails.push(`counts sum ${sum} != rows ${sites.length}`);
  return fails;
}

function writeAtomic(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, text);
    renameSync(tmp, file);
  } finally {
    if (existsSync(tmp)) rmSync(tmp, { force: true });
  }
}

export async function buildCounty(ssccc, opts = {}) {
  const {
    root = ROOT,
    log = console.log,
    now = () => new Date(),
    saveRawDir = null,
    fromRawDir = null,
    ...fetchOpts
  } = opts;
  const say = (msg) => log(`[${ssccc}] ${msg}`);
  try {
    const bundle = JSON.parse(readFileSync(path.join(root, 'public', 'data', 'blocks', `${ssccc}.json`), 'utf8'));
    const bbox = bboxFromBundle(bundle);
    const query = buildQuery(bbox);
    say(`bbox s ${bbox.s.toFixed(5)} w ${bbox.w.toFixed(5)} n ${bbox.n.toFixed(5)} e ${bbox.e.toFixed(5)} (populated-block extent + ${BBOX_PAD_MILES} mi)`);

    let retrievedAt, endpoint, elements, osmBase, bytes;
    if (fromRawDir) {
      const raw = JSON.parse(readFileSync(path.join(fromRawDir, `${ssccc}.overpass.json`), 'utf8'));
      if (raw.query !== query) throw new Error('saved raw response was made with a different query');
      ({ elements, osmBase } = validateOverpass(raw.json));
      ({ retrievedAt, endpoint } = raw);
      bytes = JSON.stringify(raw.json).length;
      say(`from saved response (${endpoint}, retrieved ${retrievedAt})`);
    } else {
      const r = await fetchOverpass(query, { ...fetchOpts, log: say });
      retrievedAt = now().toISOString();
      ({ elements, osmBase, endpoint, bytes } = r);
      if (saveRawDir) {
        mkdirSync(saveRawDir, { recursive: true });
        writeFileSync(
          path.join(saveRawDir, `${ssccc}.overpass.json`),
          JSON.stringify({ retrievedAt, endpoint, query, json: { osm3s: { timestamp_osm_base: osmBase }, elements: [countElement(elements), ...elements] } }),
        );
      }
    }

    const { sites, counts, stats } = buildCandidates(elements, bbox);
    const fails = checkRows(sites, counts, bbox);
    if (fails.length) throw new Error(`row checks failed: ${fails.slice(0, 10).join('; ')}`);

    const doc = {
      retrievedAt,
      source: SOURCE,
      license: LICENSE,
      counts,
      osmBase,
      bbox: [round5(bbox.s), round5(bbox.w), round5(bbox.n), round5(bbox.e)],
      sites,
    };
    const json = JSON.stringify(doc);
    const file = path.join(root, 'public', 'data', 'sites', `${ssccc}.json`);
    writeAtomic(file, json);
    const size = Buffer.byteLength(json);
    const gz = gzipSync(json, { level: 9 }).length;
    const byType = { node: 0, way: 0, relation: 0 };
    for (const el of elements) byType[el.type]++;
    say(`${endpoint} (OSM base ${osmBase}); response ${bytes.toLocaleString('en-US')} B; elements n/w/r ${byType.node}/${byType.way}/${byType.relation}`);
    say(`candidates: ${KINDS.map((k) => `${k} ${counts[k]}`).join(', ')} (total ${sites.length})`);
    say(`stats ${JSON.stringify(stats)}`);
    say(`wrote public/data/sites/${ssccc}.json: ${size.toLocaleString('en-US')} B raw, ${gz.toLocaleString('en-US')} B gzip -9`);
    return { ok: true, ssccc, counts, stats, rows: sites.length, bytes: size, gzipBytes: gz, endpoint, osmBase };
  } catch (e) {
    say(`FAILED, not written: ${e?.message ?? e}`);
    return { ok: false, ssccc, error: String(e?.message ?? e) };
  }
}

function countElement(elements) {
  const c = { node: 0, way: 0, relation: 0 };
  for (const el of elements) c[el.type]++;
  return { type: 'count', id: 0, tags: { nodes: String(c.node), ways: String(c.way), relations: String(c.relation), total: String(elements.length) } };
}

// ---------------------------------------------------------------- main
export async function main(argv) {
  const flags = new Map();
  const targets = [];
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, ...v] = a.slice(2).split('=');
      flags.set(k, v.join('='));
    } else targets.push(a);
  }
  const known = new Set(['attempt-timeout', 'attempts', 'save-raw', 'from-raw']);
  for (const k of flags.keys()) {
    if (!known.has(k)) {
      console.error(`unknown option --${k}`);
      return 2;
    }
  }
  const list = targets.length ? targets : COUNTIES;
  for (const t of list) {
    if (!COUNTIES.includes(t)) {
      console.error(`unknown county ${t}; bundled counties: ${COUNTIES.join(', ')}`);
      return 2;
    }
  }
  const opts = {
    attemptTimeoutMs: flags.has('attempt-timeout') ? Number(flags.get('attempt-timeout')) * 1000 : undefined,
    attemptsPerEndpoint: flags.has('attempts') ? Number(flags.get('attempts')) : undefined,
    saveRawDir: flags.get('save-raw') || null,
    fromRawDir: flags.get('from-raw') || null,
  };
  for (const k of Object.keys(opts)) if (opts[k] === undefined) delete opts[k];
  if (opts.attemptTimeoutMs !== undefined && !(opts.attemptTimeoutMs > 0)) {
    console.error('bad --attempt-timeout (seconds > 0)');
    return 2;
  }
  if (opts.attemptsPerEndpoint !== undefined && !(Number.isInteger(opts.attemptsPerEndpoint) && opts.attemptsPerEndpoint > 0)) {
    console.error('bad --attempts (integer > 0)');
    return 2;
  }

  const results = [];
  for (const t of list) {
    console.log(`[${t}] ${COUNTY_NAMES[t]}`);
    results.push(await buildCounty(t, opts));
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`done: ${results.length - failed.length}/${results.length} counties written${failed.length ? `; FAILED ${failed.map((r) => r.ssccc).join(', ')}` : ''}`);
  return failed.length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2));
}
