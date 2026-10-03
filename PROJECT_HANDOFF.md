# Food Desert AI - Technical Project Handoff

Last updated: 2026-10-03 (access-test redesign, docs/07)
Primary audience: engineers and coding agents taking over implementation.
Secondary audience: technical product owners needing implementation-level detail.

The method contract is `docs/07-access-test-redesign.md`; this file maps it
onto the code. Decisions and their rejected alternatives live in
`DECISIONS.md`.

## 1. Product Intent and System Boundaries

For one searched US point, the app estimates whether the 2020 census tract
containing it meets USDA ERS's low-income and low-access test (the measure
often called a food desert), shows the counts behind the answer and the two
published USDA maps beside it, and recomputes the test when the visitor places
stores. A city search can also be summarized across the tracts inside the
city boundary.

Boundaries:

1. USDA rates tracts, not cities. The verdict is always per tract; a city gets
   a summary, never a verdict.
2. It is an estimate with ERS's rule, not an official designation.
3. No projections: no jobs, dollars, health outcomes or commute costs. The
   scenario reports computed access numbers only.
4. Everything runs in the browser except Census ACS (`api/acs.js`, keeps
   `CENSUS_KEY` server-side). The data the test needs is either keyless
   (Census TIGERweb, CORS) or committed under `public/data/`.

## 2. The Rule (what the app computes)

Unit: the 2020 census tract containing the point.

1. For each populated 2020 Census block (POP100 > 0), `d` = straight-line
   (haversine) miles from the block's internal point to the nearest counted
   store.
2. `T` = 1 mi if the tract is urban, 10 mi if rural. Urban/rural from ERS 2025
   `Urban`; without an ERS row, the population majority of block `UR` codes
   (`urbanSource: 'block_ur'`).
3. `beyond` = residents with `d > T` (a block at exactly `T` is within);
   `share = beyond / population`.
4. Low access = `share >= 0.33 || beyond >= 500`.
5. Low income = ERS 2025 `LowIncomeTracts` as published.
6. Verdict = three-valued AND: a known `false` decides NOT MET; otherwise any
   unknown input gives UNKNOWN with a named reason.

Unknown reasons (each shown in plain words): `tract_unavailable`, `no_tract`,
`no_residents`, `blocks_unavailable`, `blocks_incomplete`,
`stores_unavailable`, `income_unavailable`, `urban_unavailable`.

Counted stores: SNAP Retailer Locator `Store_Type IN ('Supermarket','Super
Store')` minus the hand-reviewed rules in `scripts/store-exclusions.json`
(warehouse clubs, military commissaries/exchanges, fuel stations).

## 3. Repository Layout

Runtime shell:

- `src/App.jsx` — landing ↔ tracker.
- `src/TrackerApp.jsx` — owns the search (`handleLocationSearch`), the payload
  (`communityData`), the placed pins, the URL hash, the City summary state and
  the pipeline log.

Pipeline (`src/pipeline/`, fetching):

- `tractLookup.js` — `lookupTract(lat, lng)` → `{ status, tract: { geoid,
  state, county, tract, name, basename, pop, hu, intptLat, intptLng } }` via
  TIGERweb Census2020 layer 6; `lookupPlace(lat, lng)` via layers 26/28
  (incorporated wins over CDP); `queryTiger` (GET helper).
- `blockLoader.js` — `loadTractBlocks(tract)`: bundled county file
  (`BUNDLED_COUNTIES` = 06085, 06001, 28151, 04001) or TIGERweb layer 10 live;
  block populations must sum to the tract POP100 or the result is
  `blocks_incomplete`.
- `storeLoader.js` — `loadStoresNear(bbox, radiusMi)` from the 2-degree tiles;
  a listed tile that fails makes the whole answer `stores_unavailable` (never
  an empty list).
- `ersLoader.js` — `loadErsTract(geoid20)` → `{ status, e2025, e2019,
  e2019Reason }`; 2019 rows match by identical GEOID only.
- `normalizer.js` — `buildCommunityData(lat, lng, { forceRefresh })` and the
  pure `assembleCommunityData(...)`; cache prefix `fds:community:v3:`.
- `placeLoader.js` — City summary: `loadPlaceSummary(place, lookups)` and the
  pure `assemblePlaceSummary(...)` (section 6).
- `cdcFetch.js`, `censusFetch.js` — community profile (CDC PLACES; ACS via
  `/api/acs`). Both fail independently of the test.

Engine (`src/engine/`, pure, no fetch):

- `lowAccess.js` — `nearestDistances(blocks, stores)` (grid-indexed),
  `nearestStore`, `populationLowAccessFromDistances`, `populationLowAccess`,
  `distanceBands`, `isBorderline`.
- `foodAccessVerdict.js` — `evaluateFoodAccess({ lowIncome, lowAccess,
  unknownReason })` → `{ status, qualifier, reason }`.
- `scenarioEngine.js` — `evaluatePlacedStoreScenario(communityData, pins)`.

Lib: `geo.js` (haversine, point in polygon), `urlState.js` (hash codec),
`storeFormats.js` (pin formats), `locationSearch.js` (Nominatim + Census
geocoder, `placeKindFromNominatim`), `storeTooltip.js` (`escapeHtml` for
Leaflet HTML), `stateCodes.js`, `projection.js`.

Components: `CommunityStatsPanel.jsx` (Tract view, City notice, hosts
`CitySummary.jsx`), `ScenarioResultCard.jsx`, `StreetsGlView.jsx` + `MapView.jsx`
(2D Leaflet map; Streets GL 3D parked behind `ENABLE_STREETS_GL`),
`LocationGate.jsx`, `MobileResultsView.jsx`, `DesignationAtlasView.jsx` (US
map: ERS 2019 CSV by state), `AgentStatusFeed.jsx` (pipeline log).

Data builders (`scripts/`, Node; print counts, assert completeness, exit 1 on
any failed check): `build-store-snapshot.mjs`, `build-ers-shards.mjs`,
`build-block-bundles.mjs`; `check-bundle-for-keys.mjs` runs after
`vite build`.

Tests (`tests/`, `node --test`): `lowAccess`, `foodAccessVerdict`,
`scenarioEngine`, `normalizer`, `loaders`, `placeLoader`, `urlState`,
`locationSearch`, `storeTooltip`, `acsHandler`, `clientFetch`, `keyHygiene`,
`bundleGuard`.

## 4. Data (committed, dated)

- `public/data/stores/` — `manifest.json` (`source, serviceUrl,
  dataLastEditDate, retrievedAt, counts, tileDeg: 2, tiles`) and
  `<latFloor>_<lngFloor>.json` rows `[lat, lng, type, name]` (`type` `M` =
  Supermarket, `S` = Super Store). A tile absent from the manifest has no
  counted stores.
- `public/data/ers/<SSCCC>.json` — per county: `f2025`/`t2025` (2020 tracts,
  keyed by `CensusTract20`) and `f2019`/`t2019` (2010 tracts, keyed by
  `GEOID10`). `MedianFamilyIncome` 250001 is the ACS top-code ("$250,000 or
  more").
- `public/data/blocks/<SSCCC>.json` — bundled counties only: `tracts: {
  tract6: { pop, name, blocks: [[block4, pop, hu, lat, lng, ur, place7]] } }`,
  `places: { place7: { name, pop } }` (`place7` = the place whose
  full-resolution polygon contains the block's internal point; `pop` is the
  place's POP100).
- `public/data/food_atlas.csv` — ERS 2019 atlas for the US map mode only.

## 5. End-to-End Data Flow (tract)

1. Search (gate, in-map search, example chip, share link, map click) →
   `handleLocationSearch(lat, lng, { placeKind, placeName, pins,
   fromSharedLink, forceRefresh, keepCitySummary })`.
2. `buildCommunityData`: cache (memory, then localStorage, 15 min TTL) →
   `lookupTract` → in parallel: `loadTractBlocks` (then `loadStoresNear` over
   the blocks' bbox + 30 mi), `loadErsTract`, `lookupPlace`, CDC PLACES, ACS.
3. `assembleCommunityData` computes distances, the low-access stats, bands,
   borderline, the verdict, the references and the exact-spot line.
4. Payload: `{ meta: { fips, stateAbbr, stateFips, countyFips, tractName,
   lat, lng, place, retrievedAt, cache }, access: { status, reason,
   threshold, urban, urbanSource, population, beyond, share, byShare,
   byCount, lowAccess, borderline, bands, lowIncome, verdict, references,
   point, blocks (with baseline miles), blocksSource, stores (area + 5 mi),
   storesDataset }, health, demographics, ers }`.
5. Payloads carrying a fetch-failure reason are never cached.

## 6. City Summary (`src/pipeline/placeLoader.js`)

Shown only for a city search (Nominatim `addresstype` city/town/village/
municipality, carried as `lastSearch.placeKind === 'city'`) whose TIGERweb
place at the point has a matching name; the "Summarize {City}" button calls
`TrackerApp.runCitySummary({ ...meta.place, countyFips })`.

1. In-city blocks. If the searched tract's county is bundled and the place's
   in-place blocks across the bundled counties of its state add up to the
   bundle's recorded POP100, use the bundles. Otherwise live: the place
   polygon (TIGERweb layer 26 or 28, full resolution, `outSR=4326`) and every
   populated layer-10 block intersecting it (POST with the polygon;
   `returnCountOnly` first; six side-by-side pages above 3,000 blocks; unique
   GEOIDs must equal the count), filtered by internal point in polygon.
2. The in-city population must equal the place POP100, else Unknown
   `place_incomplete`.
3. Tract details for every touched tract (layer 6, POST `GEOID IN (...)`,
   100 per query): name, POP100, internal point.
4. All blocks of each touched tract: bundled, or reuse the in-city blocks when
   they already sum to the tract POP100, else `loadTractBlocks`.
5. ERS rows per tract, stores over all those blocks' bbox + 30 mi, then the
   same engine functions as the tract view, tract by tract.
6. Output: residents beyond their own tract's limit (in-city blocks only),
   residents in tracts meeting the test and the tract count, residents in
   tracts flagged on the 2019 map (identical GEOID) and the 2025 SRAM map, and
   a tract list `{ geoid, basename, inCityPop, population, share, status,
   threshold, intptLat, intptLng, ... }`. Any load failure → `{ status:
   'unknown', reason }` with no totals (`place_unavailable`, `no_place`,
   `place_incomplete`, `blocks_unavailable`, `blocks_incomplete`,
   `tracts_unavailable`, `stores_unavailable`, `ers_unavailable`,
   `urban_unavailable`, `no_residents`). A tract that is itself Unknown (e.g.
   no ERS 2025 row) is counted and named separately, not hidden.

Measured 2026-10-03 (headless Chromium, dev build): San Jose (bundled)
in-city population 1,013,240 across 235 tracts in about 0.3 s; Sacramento
(live, place 0664000) 524,943 across 147 tracts in about 3 s.

The summary state lives in `TrackerApp` (`citySummary`), survives opening a
tract from its table (`keepCitySummary: true`), and closes on any other
search; a stale run is dropped by nonce and aborted.

## 7. Placed-Store Scenario

Pins: `{ id, lat, lng, format, createdAt }`, `format` in `s` (supermarket or
supercenter, counts), `g`, `d`, `f` (shown, not counted). Up to 10 pins.
`evaluatePlacedStoreScenario` returns `null` without pins, otherwise `{
counting, nonCounting, before, after, broughtWithin, flipped, gap, halfMile,
noVehicleEstimate }`, recomputing each block's distance as `min(baseline,
nearest counting pin)` with the same `T` and income flag. Duplicates and far
pins change nothing by construction.

URL hash: `lat`, `lng`, `layout`, panel sizes, `pins=lat,lng;…` (4 decimals)
and index-aligned `pt=s;g;…` (missing/invalid token → `s`).

## 8. UI Surfaces

1. Tract view: verdict card (header, pill, scope line, qualifier sentence,
   borderline), distance bands, exact-spot line, references with the
   differing input named, sources note, evaluation trace, community profile.
2. City notice and City summary (sortable table; a row opens that tract).
3. Scenario card (map overlay on desktop, stacked on phones) with per-pin
   format select and remove.
4. Pipeline log: one line per step from the payload.

Number rules: counts to about the nearest 10 (exact below 100) with "≈",
shares to whole percent, "computed" never "measured", every Unknown names its
reason.

## 9. Caching and Freshness

- Community payload: memory + localStorage, 15 min TTL, keyed by the point
  (5 decimals); `meta.cache.status` is `fresh | memory | local`. Force refresh
  bypasses both.
- Loaders cache their committed files per session (bundles, ERS shards, store
  manifest and tiles); a failed load is never cached.
- City summary: not cached; its bundle reads use their own in-memory cache.

## 10. Environment and Runtime Configuration

Env vars:

1. `CENSUS_KEY` (server-only, read by `api/acs.js` on Vercel and by the local
   dev middleware in `vite-plugin-api-dev.js`; never `VITE_`-prefixed).
2. `VITE_CARTO_KEY` (optional; public-by-design raster tile key override).

The runtime AI narrative (`api/llmapi.js`, AICard) was removed on 2026-10-02
and Overpass (`api/overpass.js`) on the same day; see `DECISIONS.md`.
`npm run build` runs `scripts/check-bundle-for-keys.mjs`, which fails the
build if a private key value or key shape is in `dist/`.

Local API route (`vite-plugin-api-dev.js` runs the real handler in dev and
preview): `/api/acs` → `api/acs.js` (GET `?fips=<11-digit tract>`).

Production pass-through rewrites (`vercel.json`, no keys) are limited to the
exact upstream paths the app calls: `/api/census-geocoder/geocoder/
{geographies/coordinates, locations/onelineaddress}`, `/api/nominatim/
{search, reverse}` and `/api/cdc/resource/cwsq-ngmh.json`. The Vite dev
server proxies the same three prefixes.

TIGERweb is called directly from the browser (keyless, CORS): GET for point
lookups and per-tract blocks, POST for the City summary's polygon and
`GEOID IN` queries.

## 11. Testing and Build Commands

1. `npm test` (node --test)
2. `npx eslint .` (two pre-existing errors in `src/ui/landing/GooeyNav.jsx`)
3. `npm run build` (vite build + bundle key check)

## 12. Risk Register

1. TIGERweb availability: a failed tract, block or polygon call gives Unknown
   with its reason (never a partial count). Bundled counties avoid the block
   calls for the demo tracts.
2. The SNAP list misses supermarkets that don't take SNAP, and follows SNAP's
   own store-type labels.
3. Census block populations carry disclosure-avoidance noise.
4. Very large live cities send a large polygon in each POST page; untested
   above Sacramento's size.

## 13. Handoff Runbook

1. Read `docs/07-access-test-redesign.md`, then this file.
2. Change the rule only in `src/engine/` and keep `normalizer.js`,
   `scenarioEngine.js` and `placeLoader.js` on the same functions.
3. Rebuild data with the `scripts/` builders; never hand-edit generated files.
4. Run tests, lint and build before and after changing a pipeline contract.
