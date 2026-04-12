import { coordsToGeo } from './geocoder.js';
import { getUsdaData } from './usdaFetch.js';
import { getCdcData } from './cdcFetch.js';
import { getCensusData } from './censusFetch.js';

export async function buildCommunityData(lat, lng) {
  const geo = await coordsToGeo(lat, lng);
  if (!geo) return null;

  const { fips, stateAbbr, zip } = geo;

  const [usdaData, cdcData, censusData] = await Promise.all([
    getUsdaData(fips),
    getCdcData(stateAbbr, fips),
    getCensusData(fips),
  ]);

  return {
    meta: {
      fips,
      zip,
      lat,
      lng,
      stateAbbr,
      retrievedAt: new Date().toISOString(),
    },
    foodAccess: { ...usdaData },
    health: { ...cdcData },
    demographics: { ...censusData },
  };
}
