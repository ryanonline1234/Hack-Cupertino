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

  // Final designation uses USDA flag first; if USDA row was missing, apply a conservative
  // fallback based on low-access burden and socioeconomic stress.
  const derivedFoodDesert =
    !usdaData.hasUsdaMatch &&
    (
      (Number(usdaData.pctLowAccess1mi || 0) >= 33 || Number(usdaData.pctLowAccess10mi || 0) >= 33)
      &&
      (Number(censusData.pctPoverty || 0) >= 20 || Number(usdaData.pctNoVehicleLowAccess || 0) >= 10)
    );

  const foodAccess = {
    ...usdaData,
    isFoodDesert: Boolean(usdaData.isFoodDesert || derivedFoodDesert),
    designationMethod: usdaData.isFoodDesert
      ? (usdaData.designationMethod || 'usda_lila')
      : (derivedFoodDesert ? 'derived_low_access_poverty' : (usdaData.designationMethod || 'not_designated')),
  };

  return {
    meta: {
      fips,
      zip,
      lat,
      lng,
      stateAbbr,
      retrievedAt: new Date().toISOString(),
    },
    foodAccess,
    health: { ...cdcData },
    demographics: { ...censusData },
  };
}
