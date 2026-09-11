/*
 * Shared location-search helpers: fuzzy Nominatim autocomplete first, exact
 * Census geocoder as fallback. Used by the StreetsGlView map search bar and
 * the TrackerApp location gate so both surfaces suggest the same way.
 *
 * Suggestion shape: { short, full, lat, lng, type, cls }
 */

export const EXAMPLE_LOCATIONS = [
  { label: 'San Jose, CA',       lat: 37.339, lng: -121.894 },
  { label: 'Chicago South Side', lat: 41.773, lng: -87.632  },
  { label: 'Detroit, MI',        lat: 42.331, lng: -83.046  },
  { label: 'Compton, CA',        lat: 33.894, lng: -118.220 },
];

export function shortName(displayName) {
  return (displayName || '').split(',').slice(0, 3).join(',').trim();
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
    }))
    .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng));
}

export async function fetchNominatimSuggestions(query, limit = 6) {
  const params = `q=${encodeURIComponent(query)}&format=json&limit=${limit}&countrycodes=us`;
  // Proxy first (same-origin on Vercel), direct second — mirrors geocoder.js.
  const urls = [`/api/nominatim/search?${params}`, `https://nominatim.openstreetmap.org/search?${params}`];
  let lastError = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { 'Accept-Language': 'en-US,en' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items = (data || [])
        .map((item) => ({
          short: shortName(item.display_name),
          full: item.display_name,
          lat: parseFloat(item.lat),
          lng: parseFloat(item.lon),
          type: item.type,
          cls: item.class,
        }))
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

export async function geocodeAddress(query) {
  try {
    const fuzzy = await fetchNominatimSuggestions(query, 1);
    if (fuzzy.length) return { lat: fuzzy[0].lat, lng: fuzzy[0].lng };
  } catch {
    // Fall through to Census.
  }
  const matches = await geocodeByCensus(query, 1);
  if (!matches.length) {
    throw new Error('Location not found — try a US city, address, or ZIP code');
  }
  return { lat: matches[0].lat, lng: matches[0].lng };
}
