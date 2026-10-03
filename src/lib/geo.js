export const EARTH_RADIUS_MILES = 3958.8;

// Placed stores and share links carry 4 decimals (≈11 m). Points that can
// become pins (suggested sites) are scored at this precision, so "Add as
// store" lands exactly where the site was scored. toFixed rounding, as a
// share link encodes it, so a replayed link decodes to the same number, and
// rounding twice changes nothing.
export const PIN_DECIMALS = 4;

export function roundCoord(x, decimals = PIN_DECIMALS) {
  return Number(Number(x).toFixed(decimals));
}

function toRad(degrees) {
  return (degrees * Math.PI) / 180;
}

// Same formula and radius as the app's original haversine, so distances
// stay bit-identical with earlier results.
export function haversineMiles(aLat, aLng, bLat, bLng) {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);

  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;

  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

// rings: [[[lng, lat], ...], ...] as ArcGIS/GeoJSON give them. Even-odd over
// every ring, so holes and multi-part polygons need no ring-role bookkeeping.
export function pointInPolygon(lat, lng, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}
