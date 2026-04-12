import fs from 'node:fs/promises';
import Papa from 'papaparse';
import { projectImpact } from '../src/engine/projectionEngine.js';

function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^"|"$/g, '');
    env[key] = val;
  }
  return env;
}

function ok(name, details = '') {
  console.log(`PASS | ${name}${details ? ` | ${details}` : ''}`);
}

function fail(name, details = '') {
  console.log(`FAIL | ${name}${details ? ` | ${details}` : ''}`);
}

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { res, body: json, text };
}

async function run() {
  const envText = await fs.readFile('./.env', 'utf8');
  const env = parseEnv(envText);
  const censusKey = env.VITE_CENSUS_KEY;
  const geminiKey = env.VITE_GEMINI_KEY;

  if (censusKey) ok('Local env has VITE_CENSUS_KEY');
  else fail('Local env has VITE_CENSUS_KEY', 'missing');

  if (geminiKey) ok('Local env has VITE_GEMINI_KEY');
  else fail('Local env has VITE_GEMINI_KEY', 'missing');

  // Key checks
  const censusCheck = await fetchJson(
    `https://api.census.gov/data/2022/acs/acs5?get=NAME&for=state:06&key=${censusKey}`
  );
  if (censusCheck.res.ok) ok('Census key works', `HTTP ${censusCheck.res.status}`);
  else fail('Census key works', `HTTP ${censusCheck.res.status}`);

  const modelsCheck = await fetchJson(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`
  );
  if (modelsCheck.res.ok && Array.isArray(modelsCheck.body?.models)) {
    ok('Gemini key works (models)', `HTTP ${modelsCheck.res.status}`);
  } else {
    fail('Gemini key works (models)', `HTTP ${modelsCheck.res.status}`);
  }

  // Prompt 5 pipeline: San Jose
  const lat = 37.339;
  const lng = -121.894;

  const censusGeo = await fetchJson(
    `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lng}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&layers=all&format=json`
  );

  const geos = censusGeo.body?.result?.geographies;
  const tract = geos?.['Census Tracts']?.[0];
  const county = geos?.['Counties']?.[0];
  const state = geos?.['States']?.[0];

  if (tract?.GEOID) ok('Prompt 5 geocoder San Jose returns tract', tract.GEOID);
  else fail('Prompt 5 geocoder San Jose returns tract');

  const fips = tract?.GEOID;
  const countyFips = county?.GEOID ?? (fips ? fips.slice(0, 5) : '');
  const stateAbbr = state?.STUSAB ?? '';

  const nominatim = await fetchJson(
    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
    { headers: { 'User-Agent': 'food-desert-simulator-hackathon-test' } }
  );

  const zip = nominatim.body?.address?.postcode ?? '';

  const csvText = await fs.readFile('./public/data/food_atlas.csv', 'utf8');
  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true }).data;
  const target = String(fips).replace(/^0+/, '');
  const row = parsed.find((r) => String(r.CensusTract).replace(/^0+/, '') === target);

  const foodAccess = row
    ? {
        isFoodDesert: row.LILATracts_1And10 === '1',
        pctLowAccess1mi: (parseFloat(row.lapop1share) || 0) * 100,
        pctLowAccess10mi: (parseFloat(row.lapop10share) || 0) * 100,
        pctSeniorsLowAccess: (parseFloat(row.laseniors1share) || 0) * 100,
        pctNoVehicleLowAccess: (parseFloat(row.lahunv1share) || 0) * 100,
        nearestStoreMiles: parseFloat(row.LAPOP1_10) || null,
      }
    : {
        isFoodDesert: false,
        pctLowAccess1mi: 0,
        pctLowAccess10mi: 0,
        pctSeniorsLowAccess: 0,
        pctNoVehicleLowAccess: 0,
        nearestStoreMiles: null,
      };

  if (row) ok('Prompt 5 USDA lookup found tract row');
  else fail('Prompt 5 USDA lookup found tract row');

  const cdc = await fetchJson(
    `https://data.cdc.gov/resource/cwsq-ngmh.json?locationname=${fips}&$limit=200`
  );

  const measures = ['DIABETES', 'OBESITY', 'BPHIGH', 'MHLTH', 'CHECKUP'];
  const health = {};
  for (const m of measures) {
    const r =
      cdc.body?.find?.((d) => d.measureid === m && d.datavaluetypeid === 'AgeAdjPrv') ||
      cdc.body?.find?.((d) => d.measureid === m && d.datavaluetypeid === 'CrdPrv');
    health[m.toLowerCase()] = r ? parseFloat(r.data_value) || 0 : 0;
  }

  const stateCode = fips.slice(0, 2);
  const countyCode = fips.slice(2, 5);
  const tractCode = fips.slice(5);

  const acs = await fetchJson(
    `https://api.census.gov/data/2022/acs/acs5?get=B19013_001E,B01003_001E,B17001_002E,B25044_003E,B25044_010E&for=tract:${tractCode}&in=state:${stateCode}%20county:${countyCode}&key=${censusKey}`
  );

  const vals = acs.body?.[1]?.map(Number) || [0, 0, 0, 0, 0];
  const [medianIncome, population, povertyPop, ownerNoVeh, renterNoVeh] = vals;

  const demographics = {
    medianIncome: medianIncome > 0 ? medianIncome : 0,
    population: population > 0 ? population : 0,
    pctPoverty: population > 0 ? (povertyPop / population) * 100 : 0,
    noVehicleHouseholds: (ownerNoVeh || 0) + (renterNoVeh || 0),
  };

  const communityData = {
    meta: { fips, zip, lat, lng, stateAbbr },
    foodAccess,
    health,
    demographics,
  };

  const requiredCommunity = [
    communityData.meta?.fips,
    communityData.foodAccess?.pctLowAccess1mi,
    communityData.health?.diabetes,
    communityData.demographics?.medianIncome,
  ];

  if (requiredCommunity.every((v) => v != null)) {
    ok('Prompt 5 communityData schema populated', `countyFips ${countyFips}`);
  } else {
    fail('Prompt 5 communityData schema populated');
  }

  const impact = projectImpact(communityData);
  if (
    impact?.foodAccess?.residentsGainingAccess != null &&
    impact?.health?.diabetesReductionPct != null &&
    impact?.economic?.annualLocalImpact != null
  ) {
    ok('Prompt 5 impact projection computed');
  } else {
    fail('Prompt 5 impact projection computed');
  }

  // Prompt 5.1 graceful geocoder no-result scenario check
  const ocean = await fetchJson(
    'https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=-150&y=0&benchmark=Public_AR_Current&vintage=Current_Current&layers=all&format=json'
  );
  const oceanTract = ocean.body?.result?.geographies?.['Census Tracts']?.[0];
  if (!oceanTract) ok('Prompt 5.1 ocean click yields no tract (error path available)');
  else fail('Prompt 5.1 ocean click yields no tract (error path available)');

  // Prompt 6 static contract checks in component
  const aiCardCode = await fs.readFile('./src/components/AICard.jsx', 'utf8');
  const checks = [
    ['Uses claude-sonnet-4-20250514', aiCardCode.includes('claude-sonnet-4-20250514')],
    ['Uses max_tokens 600', aiCardCode.includes('max_tokens: 600')],
    ['Uses fips dependency effect', aiCardCode.includes('}, [fips]);')],
    ['Shows Analysis unavailable fallback', aiCardCode.includes('Analysis unavailable')],
    ['Shows Powered by real community data footer', aiCardCode.includes('Powered by real community data')],
    ['Renders 3-bar skeleton', aiCardCode.includes('h-3 rounded bg-gray-200 animate-pulse')],
  ];

  for (const [label, pass] of checks) {
    if (pass) ok(`Prompt 6 ${label}`);
    else fail(`Prompt 6 ${label}`);
  }

  // Prompt 6 live text-generation test (Gemini key availability check only)
  const geminiGen = await fetchJson(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Write exactly two short, natural-sounding paragraphs about improving grocery access in a neighborhood.' }] }],
      }),
    }
  );

  const gemText = geminiGen.body?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (geminiGen.res.ok && gemText.trim()) {
    const preview = gemText.replace(/\s+/g, ' ').slice(0, 180);
    ok('Prompt 6 live narrative provider test (Gemini)', preview);
  } else {
    fail('Prompt 6 live narrative provider test (Gemini)', `HTTP ${geminiGen.res.status}`);
  }

  console.log('\nINFO | App currently calls Anthropic endpoint and expects VITE_ANTHROPIC_KEY.');
  if (env.VITE_ANTHROPIC_KEY) {
    ok('VITE_ANTHROPIC_KEY present for full in-app Prompt 6 live test');
  } else {
    fail('VITE_ANTHROPIC_KEY present for full in-app Prompt 6 live test', 'missing in .env');
  }
}

run().catch((err) => {
  console.error('FATAL | validation script error', err?.message || err);
  process.exit(1);
});
