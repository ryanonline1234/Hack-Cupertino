/*
 * Shared location-search helpers: fuzzy Nominatim autocomplete first, exact
 * Census geocoder as fallback. Used by the StreetsGlView map search bar and
 * the LocationGate so both surfaces suggest the same way.
 *
 * Suggestion shape: { short, full, lat, lng, type, cls, placeKind, placeName }
 *   placeKind: 'city' | 'neighborhood' | 'address' | 'other' (see
 *              placeKindFromNominatim); Census-geocoder matches are 'address'.
 *   placeName: the short name ("San Jose", "Alviso", "Cupertino Library").
 * geocodeAddress resolves to { lat, lng, placeKind, placeName }.
 */

/*
 * Demo chips. `verdict` is a claim about the tract at that exact point under
 * docs/07's rule (Greenville 28151000600, Alviso 06085504602, Cupertino
 * 06085508101 — the golden tracts); re-verify live before changing a point
 * or adding a tag. Untagged entries make no claim. `pins` are placed after
 * the analysis loads, like share-link pins; `placeKind: 'city'` makes the
 * search behave like a city search (the City notice).
 */
export const EXAMPLE_LOCATIONS = [
  // Tract 28151000600 internal point.
  { label: 'Greenville, MS', lat: 33.40168, lng: -91.06553, verdict: 'met' },
  {
    label: 'Alviso, San Jose',
    lat: 37.42605,
    lng: -121.97524,
    verdict: 'met',
    pins: [{ lat: 37.42105, lng: -121.9727, format: 's' }],
    note: 'with a store placed in the village',
  },
  // Tract 06085508101 internal point (TIGERweb Census2020 layer 6 INTPTLAT/INTPTLON).
  { label: 'Cupertino, CA', lat: 37.33028, lng: -122.0233, verdict: 'not_met' },
  { label: 'San Jose, CA', lat: 37.33617, lng: -121.89059, placeKind: 'city', placeName: 'San Jose' },
  { label: 'Detroit, MI', lat: 42.331, lng: -83.046 },
  { label: 'Compton, CA', lat: 33.894, lng: -118.220 },
];

/*
 * Verdict pill for example chips: red for "Meets test" (the tract meets
 * USDA's low-income & low-access test), neutral for "Doesn't meet".
 * Returns null for untagged locations — no pill, no claim.
 */
export function verdictTag(loc) {
  if (loc?.verdict === 'met') {
    return {
      text: 'Meets test',
      color: 'var(--danger)',
      border: '1px solid color-mix(in srgb, var(--danger) 45%, transparent)',
      background: 'color-mix(in srgb, var(--danger) 14%, transparent)',
    };
  }
  if (loc?.verdict === 'not_met') {
    return {
      text: "Doesn't meet",
      color: 'rgba(255,255,255,0.75)',
      border: '1px solid rgba(255,255,255,0.22)',
      background: 'rgba(255,255,255,0.06)',
    };
  }
  return null;
}

const CITY_TYPES = new Set(['city', 'town', 'village', 'municipality']);
const NEIGHBORHOOD_TYPES = new Set(['suburb', 'neighbourhood', 'neighborhood', 'quarter', 'city_district']);
// Nominatim place_rank 26+ is a street, building or POI: a precise spot.
const ADDRESS_MIN_RANK = 26;

// Nominatim jsonv2 item -> what kind of place the visitor searched for.
// Counties, states, postcodes and localities are 'other': none of them is a
// city USDA could be asked about, and none pins one spot.
export function placeKindFromNominatim(item) {
  if (!item || typeof item !== 'object') return 'other';
  const { addresstype } = item;
  if (CITY_TYPES.has(addresstype)) return 'city';
  if (NEIGHBORHOOD_TYPES.has(addresstype)) return 'neighborhood';
  // Older responses without addresstype: a place node's type says the same.
  if (!addresstype && (item.category ?? item.class) === 'place' && CITY_TYPES.has(item.type)) return 'city';
  if (item.address?.house_number) return 'address';
  const rank = Number(item.place_rank);
  if (Number.isFinite(rank) && rank >= ADDRESS_MIN_RANK) return 'address';
  return 'other';
}

export function shortName(displayName) {
  return (displayName || '').split(',').slice(0, 3).join(',').trim();
}

function firstPart(text) {
  return String(text || '').split(',')[0].trim();
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

export async function geocodeByCensus(query, limit = 6) {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const url = `/api/census-geocoder/geocoder/locations/onelineaddress?address=${encodeURIComponent(trimmed)}&benchmark=Public_AR_Current&format=json`;
  const json = await fetchJson(url);
  const matches = json?.result?.addressMatches || [];

  return matches
    .slice(0, limit)
    .map((item) => ({
      short: shortName(item.matchedAddress || ''),
      full: item.matchedAddress || '',
      lat: Number(item?.coordinates?.y),
      lng: Number(item?.coordinates?.x),
      type: 'address',
      cls: 'place',
      // The Census geocoder only matches street addresses.
      placeKind: 'address',
      placeName: firstPart(item.matchedAddress),
    }))
    .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng));
}

export function suggestionFromNominatim(item) {
  return {
    short: shortName(item?.display_name),
    full: item?.display_name || '',
    lat: parseFloat(item?.lat),
    lng: parseFloat(item?.lon),
    type: item?.type,
    cls: item?.category ?? item?.class,
    placeKind: placeKindFromNominatim(item),
    placeName: (typeof item?.name === 'string' && item.name.trim()) || firstPart(item?.display_name),
  };
}

export async function fetchNominatimSuggestions(query, limit = 6) {
  // jsonv2 + addressdetails carry addresstype, place_rank and
  // address.house_number, which placeKindFromNominatim reads.
  const params = `q=${encodeURIComponent(query)}&format=jsonv2&addressdetails=1&limit=${limit}&countrycodes=us`;
  // Proxy first (same-origin on Vercel), direct second.
  const urls = [`/api/nominatim/search?${params}`, `https://nominatim.openstreetmap.org/search?${params}`];
  let lastError = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { 'Accept-Language': 'en-US,en' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items = (Array.isArray(data) ? data : [])
        .map(suggestionFromNominatim)
        .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng));
      if (items.length) return items;
      // Empty result: try the next source before giving up.
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Nominatim search failed');
}

export async function fetchSuggestions(query) {
  // Nominatim first: fuzzy autocomplete so partial input ("chicago south",
  // "austin tx") produces a dropdown. Census second: exact-address fallback
  // when Nominatim is throttled or returns nothing.
  try {
    const fuzzy = await fetchNominatimSuggestions(query, 6);
    if (fuzzy.length) return fuzzy;
  } catch {
    // Fall through to Census.
  }
  try {
    return await geocodeByCensus(query, 6);
  } catch {
    return [];
  }
}

function geocodeResult(item) {
  return { lat: item.lat, lng: item.lng, placeKind: item.placeKind, placeName: item.placeName };
}

export async function geocodeAddress(query) {
  try {
    const fuzzy = await fetchNominatimSuggestions(query, 1);
    if (fuzzy.length) return geocodeResult(fuzzy[0]);
  } catch {
    // Fall through to Census.
  }
  const matches = await geocodeByCensus(query, 1);
  if (!matches.length) {
    throw new Error('Location not found — try a US city, address, or ZIP code');
  }
  return geocodeResult(matches[0]);
}
