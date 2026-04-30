async function fetchJsonWithFallback(requests) {
  let lastError = null;

  for (const req of requests) {
    try {
      const res = await fetch(req.url, req.options || {});
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('All provider requests failed');
}

export async function coordsToGeo(lat, lng) {
  try {
    const censusJson = await fetchJsonWithFallback([
      {
        url: `/api/census-geocoder/geocoder/geographies/coordinates?x=${lng}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&layers=all&format=json`,
      },
      {
        url: `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lng}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&layers=all&format=json`,
      },
    ]);

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
    try {
      const nomData = await fetchJsonWithFallback([
        {
          url: `/api/nominatim/reverse?lat=${lat}&lon=${lng}&format=jsonv2`,
          options: { headers: { 'Accept-Language': 'en-US,en' } },
        },
        {
          url: `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=jsonv2`,
          options: { headers: { 'Accept-Language': 'en-US,en' } },
        },
      ]);
      zip = nomData?.address?.postcode ?? '';
    } catch {
      zip = '';
    }

    return { fips, countyFips, stateFips, stateAbbr, zip };
  } catch {
    return null;
  }
}
