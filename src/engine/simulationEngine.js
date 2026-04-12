const PIN_WEIGHTS = {
  grocery: 1.0,
  transit: 0.65,
  pantry: 0.45,
};

export const PIN_LABELS = {
  grocery: 'Grocery',
  transit: 'Transit Hub',
  pantry: 'Pantry',
};

const RADIUS_MILES = 2;
const BASELINE_COVERAGE = 0.58;

function toRad(degrees) {
  return (degrees * Math.PI) / 180;
}

function haversineMiles(aLat, aLng, bLat, bLng) {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return 3958.8 * c;
}

function clamp01(value) {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export function summarizeSimulation({ center, pins = [] }) {
  const pinCounts = {
    grocery: 0,
    transit: 0,
    pantry: 0,
  };

  for (const pin of pins) {
    if (pinCounts[pin.type] != null) pinCounts[pin.type] += 1;
  }

  if (!center || pins.length === 0) {
    return {
      mode: 'baseline',
      pinCount: 0,
      radiusMiles: RADIUS_MILES,
      pinCounts,
      rawContribution: BASELINE_COVERAGE,
      coverageScore: BASELINE_COVERAGE,
    };
  }

  let contribution = 0;
  for (const pin of pins) {
    const weight = PIN_WEIGHTS[pin.type] || 0.35;
    const distance = haversineMiles(center.lat, center.lng, pin.lat, pin.lng);
    const spatialFactor = clamp01(1 - distance / RADIUS_MILES);
    contribution += weight * spatialFactor;
  }

  // Diminishing returns: each additional pin contributes less than linear.
  const coverageScore = clamp01(1 - Math.exp(-contribution));

  return {
    mode: 'sim-lab',
    pinCount: pins.length,
    radiusMiles: RADIUS_MILES,
    pinCounts,
    rawContribution: contribution,
    coverageScore,
  };
}
