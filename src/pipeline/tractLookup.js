// Point -> 2020 census tract (and the place containing it), straight from
// TIGERweb in the browser: keyless, CORS-enabled, no proxy.
export const TIGER_BASE =
  'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer';

const LAYER_TRACTS = 6;
const LAYER_INCORPORATED = 26;
const LAYER_CDP = 28;
const TRACT_FIELDS = 'GEOID,STATE,COUNTY,TRACT,NAME,BASENAME,POP100,HU100,INTPTLAT,INTPTLON';
const PLACE_FIELDS = 'GEOID,NAME,BASENAME,POP100';
const TIMEOUT_MS = 30_000;

function withTimeout() {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? { signal: AbortSignal.timeout(TIMEOUT_MS) }
    : {};
}

// GET <layer>/query. Resolves to the parsed JSON, or null on any failure:
// network error, non-OK status, or ArcGIS's HTTP-200 `{ error }` reply.
export async function queryTiger(layer, queryParams) {
  try {
    const qs = new URLSearchParams({ ...queryParams, f: 'json' });
    const res = await fetch(`${TIGER_BASE}/${layer}/query?${qs}`, withTimeout());
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || json.error || !Array.isArray(json.features)) return null;
    return json;
  } catch {
    return null;
  }
}

function validPoint(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

function pointQuery(lat, lng, outFields) {
  return {
    geometry: `${lng},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields,
    returnGeometry: 'false',
  };
}

const toNumber = (v) => (v === null || v === undefined || v === '' ? Number.NaN : Number(v));
const finiteOrNull = (v) => {
  const n = toNumber(v);
  return Number.isFinite(n) ? n : null;
};
const isCount = (n) => Number.isInteger(n) && n >= 0;

// A point on a shared edge intersects two features; take the lowest GEOID so
// the answer doesn't depend on server ordering.
function firstByGeoid(features) {
  const attrs = features.map((f) => f?.attributes ?? null);
  if (attrs.some((a) => a === null)) return null;
  return attrs.sort((a, b) => String(a.GEOID).localeCompare(String(b.GEOID)))[0];
}

function parseTract(a) {
  if (!a || typeof a.GEOID !== 'string' || !/^\d{11}$/.test(a.GEOID)) return null;
  const pop = toNumber(a.POP100);
  if (!isCount(pop)) return null;
  return {
    geoid: a.GEOID,
    state: typeof a.STATE === 'string' ? a.STATE : a.GEOID.slice(0, 2),
    county: typeof a.COUNTY === 'string' ? a.COUNTY : a.GEOID.slice(2, 5),
    tract: typeof a.TRACT === 'string' ? a.TRACT : a.GEOID.slice(5),
    name: a.NAME ?? null,
    basename: a.BASENAME ?? null,
    pop,
    hu: finiteOrNull(a.HU100),
    intptLat: finiteOrNull(a.INTPTLAT),
    intptLng: finiteOrNull(a.INTPTLON),
  };
}

function parsePlace(a, kind) {
  if (!a || typeof a.GEOID !== 'string' || !/^\d{7}$/.test(a.GEOID)) return null;
  return {
    geoid: a.GEOID,
    name: a.NAME ?? null,
    basename: a.BASENAME ?? null,
    pop: finiteOrNull(a.POP100),
    kind,
  };
}

// -> { status: 'ok', tract } | { status: 'no_tract' } | { status: 'unavailable' }
export async function lookupTract(lat, lng) {
  if (!validPoint(lat, lng)) return { status: 'no_tract' };
  const json = await queryTiger(LAYER_TRACTS, pointQuery(lat, lng, TRACT_FIELDS));
  if (!json) return { status: 'unavailable' };
  if (json.features.length === 0) return { status: 'no_tract' };
  const tract = parseTract(firstByGeoid(json.features));
  return tract ? { status: 'ok', tract } : { status: 'unavailable' };
}

// -> { status: 'ok', place } | { status: 'no_place', place: null }
//    | { status: 'unavailable', place: null }
// Incorporated places win over CDPs (Census never lets the two overlap, so an
// incorporated hit stands even when the CDP query failed).
export async function lookupPlace(lat, lng) {
  if (!validPoint(lat, lng)) return { status: 'no_place', place: null };
  const [inc, cdp] = await Promise.all([
    queryTiger(LAYER_INCORPORATED, pointQuery(lat, lng, PLACE_FIELDS)),
    queryTiger(LAYER_CDP, pointQuery(lat, lng, PLACE_FIELDS)),
  ]);
  let place = null;
  if (inc?.features.length) {
    place = parsePlace(firstByGeoid(inc.features), 'incorporated');
  } else if (!inc || !cdp) {
    return { status: 'unavailable', place: null };
  } else if (cdp.features.length) {
    place = parsePlace(firstByGeoid(cdp.features), 'cdp');
  } else {
    return { status: 'no_place', place: null };
  }
  return place ? { status: 'ok', place } : { status: 'unavailable', place: null };
}
