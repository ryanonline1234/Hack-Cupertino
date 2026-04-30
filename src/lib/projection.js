/*
 * Lat/lng → screen-pixel projection used by the StreetsGlView highlight
 * overlay. We render absolute-positioned HTML markers ON TOP of the
 * cross-origin Streets GL iframe; since we can't read its camera state,
 * the overlay is only valid when WE control the camera.
 *
 * Constraints:
 *   • Highlight mode forces the iframe into a top-down view (pitch=90,
 *     yaw=0). At pitch=90 the projection collapses to a simple Mercator
 *     translation around the center, which is what these helpers compute.
 *   • The iframe's `pointer-events` are turned off in highlight mode so
 *     the user can't change the camera and break alignment.
 *
 * Streets GL camera distance is in meters (camera altitude above ground
 * for top-down view). Its perspective FOV at top-down is approximately
 * 50° vertical — good enough for marker placement without forking the
 * engine. Tweakable via the FOV_DEG constant if alignment drifts.
 */

const METERS_PER_LAT_DEG = 110_574; // average; varies < 1% with latitude
const FOV_DEG = 50;
const FOV_RAD = (FOV_DEG * Math.PI) / 180;

function lngMetersPerDeg(lat) {
  // Length of one degree of longitude shortens with cos(latitude).
  return 111_320 * Math.cos((lat * Math.PI) / 180);
}

/*
 * Given:
 *   center  : { lat, lng } — what the camera is centered on
 *   distance: camera altitude in meters (Streets GL's `distance` param)
 *   viewport: { width, height } in CSS pixels
 *
 * Returns a projector function:  ({lat, lng}) → { x, y } | null
 *   where x, y are CSS pixel offsets from the iframe's top-left corner.
 *   Returns null for points that fall outside the viewport with a small
 *   margin so we don't render hundreds of off-screen markers.
 */
export function makeTopDownProjector(center, distance, viewport) {
  const visibleHeightMeters = 2 * distance * Math.tan(FOV_RAD / 2);
  const pixelsPerMeter = viewport.height / visibleHeightMeters;
  const lngMetersDeg = lngMetersPerDeg(center.lat);

  const halfW = viewport.width / 2;
  const halfH = viewport.height / 2;
  // Clip generously — a marker just outside the viewport is fine to skip.
  const margin = 32;

  return function project({ lat, lng }) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const metersNorth = (lat - center.lat) * METERS_PER_LAT_DEG;
    const metersEast = (lng - center.lng) * lngMetersDeg;
    // Screen +y points down, geo north points up → invert.
    const dx = metersEast * pixelsPerMeter;
    const dy = -metersNorth * pixelsPerMeter;
    const x = halfW + dx;
    const y = halfH + dy;
    if (x < -margin || x > viewport.width + margin) return null;
    if (y < -margin || y > viewport.height + margin) return null;
    return { x, y };
  };
}

/*
 * Pick a camera "distance" (altitude in meters) to roughly frame the
 * given list of points around `center`. Returns a value clamped to a
 * sensible range so the user always sees recognizable streets/buildings.
 */
export function pickCameraDistance(center, points, fallbackMeters = 1800) {
  if (!points || points.length === 0) return fallbackMeters;
  const lngMetersDeg = lngMetersPerDeg(center.lat);

  let maxRadiusMeters = 0;
  for (const p of points) {
    const metersNorth = (p.lat - center.lat) * METERS_PER_LAT_DEG;
    const metersEast = (p.lng - center.lng) * lngMetersDeg;
    const r = Math.hypot(metersEast, metersNorth);
    if (r > maxRadiusMeters) maxRadiusMeters = r;
  }

  // Solve for camera altitude such that maxRadius fits within ~70% of the
  // viewport's smaller dimension. visibleHeight = 2 * d * tan(fov/2), so
  //   d = maxRadius / (0.70 * tan(fov/2))
  const targetDistance = maxRadiusMeters / (0.70 * Math.tan(FOV_RAD / 2));

  // Clamp so a single tract isn't framed at 50m or 50km.
  return Math.max(800, Math.min(8000, targetDistance || fallbackMeters));
}
