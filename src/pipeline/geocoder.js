export async function coordsToGeo(lat, lng) {
  try {
    const [censusRes, nominatimRes] = await Promise.all([
      fetch(
        `/api/census-geocoder/geocoder/geographies/coordinates?x=${lng}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&layers=all&format=json`
      ),
      fetch(
        `/api/nominatim/reverse?lat=${lat}&lon=${lng}&format=json`
      ),
    ]);

    if (!censusRes.ok) return null;

    const censusJson = await censusRes.json();
    const geo = censusJson?.result?.geographies;

    if (!geo?.['Census Tracts']?.[0]) return null;

    const tract = geo['Census Tracts'][0];
    const county = geo['Counties']?.[0];
    const state = geo['States']?.[0];

    const fips = tract.GEOID;
    const countyFips = county?.GEOID ?? fips.slice(0, 5);
    const stateFips = state?.STATE ?? fips.slice(0, 2);
    const stateAbbr = state?.STUSAB ?? '';

    let zip = '';
    if (nominatimRes.ok) {
      const nomData = await nominatimRes.json();
      zip = nomData?.address?.postcode ?? '';
    }

    return { fips, countyFips, stateFips, stateAbbr, zip };
  } catch {
    return null;
  }
}
