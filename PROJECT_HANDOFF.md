# Food Desert AI - Technical Project Handoff

Last updated: 2026-10-03 (access-test redesign, docs/07; Suggest sites and the
action plan, docs/08)
Primary audience: engineers and coding agents taking over implementation.
Secondary audience: technical product owners needing implementation-level detail.

The method contract is `docs/07-access-test-redesign.md`, Suggest sites and
the action plan are `docs/08-suggest-sites-and-plan.md`, and the datasets are
`docs/data.md`; this file maps them onto the code. Decisions and their
rejected alternatives live in `DECISIONS.md`; where the project is now lives
in `STATE.md`.

## 1. Product Intent and System Boundaries

For one searched US point, the app estimates whether the 2020 census tract
containing it meets USDA ERS's low-income and low-access test (the measure
often called a food desert), shows the counts behind the answer and the two
published USDA maps beside it, recomputes the test when the visitor places
stores, suggests where supermarkets would change the result, and turns the
tract's numbers into a rules-based action plan. A city search can also be
summarized across the tracts inside the city boundary.

Boundaries:

1. USDA rates tracts, not cities. The verdict is always per tract; a city gets
   a summary, never a verdict.
2. It is an estimate with ERS's rule, not an official designation.
3. No projections: no jobs, dollars, health outcomes or commute costs. The
   scenario reports computed access numbers only.
4. No AI at runtime. Suggest sites is a deterministic search and the action
   plan is fixed rules over the tract's numbers.
5. Everything runs in the browser except Census ACS (`api/acs.js`, keeps
   `CENSUS_KEY` server-side). The data the test needs is either keyless
   (Census TIGERweb, CORS) or committed under `public/data/`.

## 2. The Rule (what the app computes)

Unit: the 2020 census tract containing the point.

1. For each populated 2020 Census block (POP100 > 0), `d` = straight-line
   (haversine) miles from the block's internal point to the nearest counted
   store.
2. `T` = 1 mi if the tract is urban, 10 mi if rural. Urban/rural from ERS 2025
   `Urban`; without an ERS row, the population majority of block `UR` codes
   (`urbanSource: 'block_ur'`). If the ERS file itself failed to load, the
   answer is `ers_unavailable`, never the block-UR stand-in.
3. `beyond` = residents with `d > T` (a block at exactly `T` is within);
   `share = beyond / population`.
4. Low access = `share >= 0.33 || beyond >= 500`.
5. Low income = ERS 2025 `LowIncomeTracts` as published.
6. Verdict = three-valued AND (`src/engine/foodAccessVerdict.js`): a known
   `false` decides NOT MET; otherwise any unknown input gives UNKNOWN with a
   named reason.

Unknown reasons, in the order `accessUnknownReason` in
`src/pipeline/normalizer.js` checks them: `tract_unavailable`,
`no_residents`, `stores_not_covered` (state FIPS 72, 60, 69: no SNAP, so no
SNAP stores; `NON_SNAP_STATES`), `blocks_incomplete`, `blocks_unavailable`,
`stores_unavailable`, `ers_unavailable`, `urban_unavailable`; then
`income_unavailable` when only the ERS row is missing (still NOT MET if not
low access). A point outside every tract (`no_tract`) returns no payload.

Counted stores: SNAP Retailer Locator `Store_Type IN ('Supermarket','Super
Store')` minus the hand-reviewed rules in `scripts/store-exclusions.json`
(warehouse clubs, military commissaries/exchanges, fuel stations), with that
file's hand-checked coordinate corrections applied (`docs/data.md`).

## 3. Repository Layout

Runtime shell:

- `src/main.jsx`, `src/App.jsx` — landing ↔ tracker; a hash with lat/lng
  boots straight into the tracker.
- `src/TrackerApp.jsx` — owns the search (`handleLocationSearch`), the payload
  (`communityData`), the placed pins (reducer with undo history), the URL
  hash, the City summary state, the Suggest sites request, the action plan
  and the pipeline log.

Pipeline (`src/pipeline/`, fetching):

- `tractLookup.js` — `lookupTract(lat, lng)` → `{ status, tract: { geoid,
  state, county, tract, name, basename, pop, hu, intptLat, intptLng } }` via
  TIGERweb Census2020 layer 6; `lookupPlace(lat, lng)` via layers 26/28
  (incorporated wins over CDP); `queryTiger` (GET helper); `TIGER_BASE`.
- `blockLoader.js` — `loadTractBlocks(tract)`: bundled county file
  (`BUNDLED_COUNTIES` = 06085, 06001, 28151, 04001) or TIGERweb layer 10 live;
  block populations must sum to the tract POP100 or the result is
  `blocks_incomplete`.
- `storeLoader.js` — `loadStoresNear(bbox, radiusMi)` from the 2-degree tiles;
  a listed tile that fails makes the whole answer `stores_unavailable` (never
  an empty list).
- `ersLoader.js` — `loadErsTract(geoid20)` → `{ status, e2025, e2019,
  e2019Reason }`; 2019 rows match by identical GEOID only.
- `normalizer.js` — `buildCommunityData(lat, lng, { forceRefresh,
  profileDeadlineMs })` and the pure `assembleCommunityData(...)`; cache
  prefix `fds:community:v3:`.
- `placeLoader.js` — City summary: `loadPlaceSummary(place, lookups)` and the
  pure `assemblePlaceSummary(...)` (section 6).
- `siteLoader.js` — Suggest sites candidates: `loadSiteCandidates(countyFips)`,
  `filterCandidatesToTract`, `tractCandidates`, `candidateFallback`
  (section 8).
- `cdcFetch.js`, `censusFetch.js` — community profile (CDC PLACES; ACS via
  `/api/acs`). Both fail independently of the test.

Engine (`src/engine/`, pure, no fetch):

- `lowAccess.js` — `nearestDistances(blocks, stores)` (grid-indexed),
  `nearestStore`, `populationLowAccessFromDistances`, `populationLowAccess`,
  `distanceBands`, `isBorderline`; `SHARE_THRESHOLD`, `COUNT_THRESHOLD`.
- `foodAccessVerdict.js` — `evaluateFoodAccess({ lowIncome, lowAccess,
  unknownReason })` → `{ status, qualifier, reason }`.
- `scenarioEngine.js` — `evaluatePlacedStoreScenario(communityData, pins)`.
- `suggestSites.js` — `suggestSites({ blocks, threshold, candidates,
  existingPins, maxSites, lowIncome })`, `blockCandidates(blocks)`.
- `actionPlan.js` — `buildActionPlan({ access, ers, scenario, suggestions,
  meta })`, `VERIFIED_SOURCES`, `PLAN_TITLE`, `PLAN_FOOTER`.

Lib (`src/lib/`): `format.js` (guarded count/share/mile formatters shared by
the panels, the plan and the log), `geo.js` (haversine, point in polygon,
`roundCoord` / `PIN_DECIMALS`), `urlState.js` (hash codec), `storeFormats.js`
(pin formats), `siteLabels.js` (suggested-site labels and the caveat),
`locationSearch.js` (Nominatim + Census geocoder, `placeKindFromNominatim`,
`EXAMPLE_LOCATIONS`), `storeTooltip.js` (`escapeHtml` for Leaflet HTML),
`stateCodes.js`, `projection.js`, `utils.ts` (`cn`).

Components: `CommunityStatsPanel.jsx` (Tract view, City notice; hosts
`CitySummary.jsx`, the Suggest sites button or list and `ActionPlan.jsx`),
`SuggestedSites.jsx`, `ScenarioResultCard.jsx`, `StreetsGlView.jsx` +
`MapView.jsx` (2D Leaflet map with the armed Place-store banner and the
numbered suggestion markers; Streets GL 3D parked behind `ENABLE_STREETS_GL`),
`LocationGate.jsx`, `MobileResultsView.jsx`, `DesignationAtlasView.jsx` (US
map: ERS 2019 CSV by state), `AgentStatusFeed.jsx` (pipeline log),
`FeatureNav.jsx`, `ResizeHandle.jsx`.

Unused (no importer, not in the bundle): `src/components/ui/*.tsx`,
`src/ui/landing/GooeyNav.jsx`,
`src/ui/landing/FlexCarousel.jsx`, `src/utils/formatters.js`. See
`THIRD_PARTY_NOTICES.md` for the React Bits license on two of them.

Data builders (`scripts/`, Node 20+; print counts, assert completeness, exit
non-zero on any failed check without writing the failing file):
`build-store-snapshot.mjs`, `build-ers-shards.mjs`, `build-block-bundles.mjs`,
`build-site-candidates.mjs`; `store-exclusions.json` is the store builder's
hand-reviewed input; `check-bundle-for-keys.mjs` runs after `vite build`.

Tests (`tests/*.test.js`, `node --test`): `lowAccess`, `foodAccessVerdict`,
`scenarioEngine`, `suggestSites`, `actionPlan`, `normalizer`, `loaders`,
`placeLoader`, `siteLoader`, `siteCandidates` (the site builder, offline),
`storeSnapshot` (the store builder and its coordinate corrections, offline),
`siteLabels`, `format`, `urlState`, `locationSearch`, `storeTooltip`,
`acsHandler`, `clientFetch`, `keyHygiene`, `bundleGuard`. The golden-tract
tests read the committed `public/data/` through a stubbed `fetch`.

## 4. Data (committed, dated)

Full detail (sources, selection, counts, terms, rebuild commands,
self-checks) is in `docs/data.md`. Shapes:

- `public/data/stores/` — `manifest.json` (`source, serviceUrl, where,
  dataLastEditDate, retrievedAt, counts, badCoordinates,
  coordinateCorrections, tileDeg: 2, tiles`) and
  `<latFloor>_<lngFloor>.json` rows `[lat, lng, type, name]` (`type` `M` =
  Supermarket, `S` = Super Store). A tile absent from the manifest has no
  counted stores. USDA data of 2026-09-17; 38,627 counted stores.
- `public/data/ers/<SSCCC>.json` — per county: `f2025`/`t2025` (2020 tracts,
  keyed by `CensusTract20`) and `f2019`/`t2019` (2010 tracts, keyed by
  `GEOID10`). `MedianFamilyIncome` 250001 is the ACS top-code ("$250,000 or
  more").
- `public/data/blocks/<SSCCC>.json` — bundled counties only: `tracts: {
  tract6: { pop, name, blocks: [[block4, pop, hu, lat, lng, ur, place7]] } }`,
  `places: { place7: { name, pop } }` (`place7` = the place whose
  full-resolution polygon contains the block's internal point; `pop` is the
  place's POP100).
- `public/data/sites/<SSCCC>.json` — bundled counties only: OpenStreetMap
  commercial-site candidates `[id, lat, lng, kind, sqft, name]` with
  per-kind `counts`, `osmBase` and `license` (ODbL; `README.md` beside them).
- `public/data/food_atlas.csv` — ERS 2019 atlas for the US map mode only (no
  builder).

## 5. End-to-End Data Flow (tract)

1. Search (gate, in-map search, example chip, share link, map click) →
   `handleLocationSearch(lat, lng, { placeKind, placeName, pins,
   fromSharedLink, forceRefresh, keepCitySummary })`. A new search drops any
   open suggestions.
2. `buildCommunityData`: cache (memory, then localStorage, 15 min TTL) →
   `lookupTract` → in parallel: `loadTractBlocks` (then `loadStoresNear` over
   the blocks' bbox + 30 mi), `loadErsTract`, `lookupPlace`; CDC PLACES and
   ACS start alongside and get until `PROFILE_DEADLINE_MS` (12 s) after they
   started, or until the access inputs are in if that is later; a call that
   hasn't answered by then shows the default profile with status `timeout`.
3. `assembleCommunityData` computes distances, the low-access stats, bands,
   borderline, the verdict, the references (with the differing input named)
   and the exact-spot line.
4. Payload: `{ meta: { fips, stateAbbr, stateFips, countyFips, tractName,
   lat, lng, place, placeStatus, profileStatus, retrievedAt, cache },
   access: { status, reason, threshold, urban, urbanSource, population,
   beyond, share, byShare, byCount, lowAccess, borderline, bands, lowIncome,
   verdict, references: { lram2019, sram2025, differNote }, point, blocks
   (with baseline miles), blocksSource, stores (area + 5 mi, for the map),
   storesDataset }, health, demographics, ers }`.
5. Payloads carrying a fetch-failure reason, a failed place lookup or a
   failed/timed-out profile call are never cached.
6. `TrackerApp` derives the scenario (`evaluatePlacedStoreScenario`), the
   suggestions (section 8) and the action plan (section 9) from the payload
   in memory; none of them fetch except the one site-candidate file.

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
   'unknown', reason }` with no totals (`no_place`, `place_unavailable`,
   `place_incomplete`, `blocks_unavailable`, `blocks_incomplete`,
   `tracts_unavailable`, `stores_unavailable`, `stores_not_covered`,
   `ers_unavailable`, `urban_unavailable`, `no_residents`, `cancelled`). A
   tract that is itself Unknown (e.g. no ERS 2025 row) is counted and named
   separately, not hidden.

Measured 2026-10-03 (headless Chromium, dev build): San Jose (bundled)
in-city population 1,013,240 across 235 tracts in about 0.3 s; Sacramento
(live, place 0664000) 524,943 across 147 tracts in about 3 s. The client
timeout is 60 s per request.

The summary state lives in `TrackerApp` (`citySummary`), survives opening a
tract from its table (`keepCitySummary: true`), and closes on any other
search; a stale run is dropped by nonce and aborted.

## 7. Placed-Store Scenario

Pins: `{ id, lat, lng, format, createdAt }`, `format` in `s` (supermarket or
supercenter, counts), `g`, `d`, `f` (shown, not counted). Up to 10 pins
(`MAX_SHARED_PINS`), with Undo (20 steps) and Clear.
`evaluatePlacedStoreScenario` returns `null` without pins, otherwise `{
counting, nonCounting, before, after, broughtWithin, flipped, gap, halfMile,
noVehicleEstimate }`, recomputing each block's distance as `min(baseline,
nearest counting pin)` with the same `T` and income flag. Duplicates and far
pins change nothing by construction. `noVehicleEstimate` apportions ERS
`TractHUNV` by block housing units and is hidden under 20.

URL hash: `lat`, `lng`, `layout`, panel sizes, `hl`, `pins=lat,lng;…` (4
decimals) and index-aligned `pt=s;g;…` (missing/invalid token → `s`; omitted
when every pin is `s`).

## 8. Suggest Sites (docs/08 §1, §3)

Offered when the baseline is known and low access (`canSuggest` in
`TrackerApp`), from the Tract view button and the armed Place-store banner.

1. `handleSuggestSites` loads the county's candidate file once
   (`loadSiteCandidates`: `not_bundled` outside the four counties,
   `unavailable` when the file fails or doesn't check out; failures aren't
   cached).
2. `tractCandidates` keeps the candidates inside the tract's populated-block
   box grown by T; none → block points, with the reason (`not_bundled`,
   `unavailable`, `none_in_range`).
3. `suggestSites` (pure, milliseconds) applies the visitor's counting pins
   first, then greedily picks up to 3 candidates by residents newly within T
   (ties: urban residents newly within ½ mi, nearer the population-weighted
   center, smaller id), stopping at gain 0 or when the tract stops being low
   access. If no commercial candidate gains anyone it reruns on block points
   (`no_gain_commercial`). Candidates sit at pin precision (`roundCoord`), so
   "Add as store" reproduces the list's numbers exactly.
4. The picks are recomputed whenever the pins change. When commercial picks
   leave the tract low access (Greenville 28151000600 in the default mode),
   the list offers "Try Census block points instead" (`canTryBlocks`, mode
   `blocks`) and then "Back to commercial sites"; the visitor switches, the
   app doesn't.
5. Desktop draws numbered dashed markers (not pins); phones get the list only.
   "Add as store" adds an `s` pin; "Add all" adds every pick as one Undo step;
   suggestions never enter the URL until added. Every list carries the
   distance-only caveat (`SUGGEST_SITES_CAVEAT`); commercial picks add the
   OpenStreetMap credit and data date.

## 9. Action Plan (docs/08 §2)

`buildActionPlan` returns `[]` unless the verdict is MET or NOT MET, else at
most 6 items in this rule order: site a full-line grocer near the suggested
sites (only when the picks flip MET → NOT MET); SNAP and WIC authorization
(low access + low income); cover distance (ERS `TractHUNV` ≥ 100 or rural;
SNAP online purchasing, which isn't available in Guam or the US Virgin
Islands); GusNIP incentives (low income); healthy-food financing (low access +
low income); access limited but not low income; distance isn't the barrier
(not low access). Each `why` quotes only input numbers through `lib/format.js`
guards, and an item is dropped if any of its sources is missing from
`VERIFIED_SOURCES` (each with the date it was read). Not linked because they
didn't verify on 2026-10-03: USDA Rural Development's HFFI page (HTTP 403 to a
scripted fetch) and California FreshWorks (HTTP 500); adding a verified
`caFreshWorks` source re-enables the California line. Recomputed whenever the
pins or the suggestions change; rendered under the references by
`ActionPlan.jsx`.

## 10. UI Surfaces

1. Tract view: verdict card (header, pill, scope line, qualifier sentence,
   borderline), Suggest sites button or list, distance bands, exact-spot line,
   references with the differing input named, action plan, sources note,
   evaluation trace, community profile.
2. City notice and City summary (sortable table; a row opens that tract).
3. Scenario card (map overlay on desktop, stacked on phones) with per-pin
   format select and remove, and the collapsed context box (jobs and health
   studies; no projections).
4. Pipeline log: one line per step from the payload, plus scenario,
   suggestion and City summary lines.

Number rules: counts to about the nearest 10 (exact below 100) with "≈",
shares to whole percent, never rounded up to a USDA limit the tract is under,
"computed" never "measured", every Unknown names its reason.

## 11. Caching and Freshness

- Community payload: memory + localStorage, 15 min TTL, keyed by the point
  (5 decimals); `meta.cache.status` is `fresh | memory | local`. Force refresh
  ("Try again") bypasses both. Writes sweep old prefixes and expired entries.
- Loaders cache their committed files per session (bundles, ERS shards, store
  manifest and tiles, site-candidate files); a failed load is never cached.
- City summary: not cached; its bundle reads use their own in-memory cache.
- Suggestions and the action plan: derived in memory, never stored.
- Service worker (`vite-plugin-pwa`, Workbox): precaches the app shell
  (`js, css, html, svg, png, ico, woff2`; not the `public/data` JSON);
  `/api/*` is network-only; OSM and CARTO tiles are stale-while-revalidate
  (600 entries, 7 days), as is the parked Streets GL shell (200 entries, 3
  days). `public/data` files have no service-worker route, so they always
  come from the network (then the loaders' in-memory cache).

## 12. Environment and Runtime Configuration

Env vars:

1. `CENSUS_KEY` (server-only, read by `api/acs.js` on Vercel and by the local
   dev middleware in `vite-plugin-api-dev.js`; never `VITE_`-prefixed).
2. `VITE_CARTO_KEY` (optional; public-by-design raster tile key override).

The runtime AI narrative (`api/llmapi.js`, AICard) was removed on 2026-10-02
and Overpass (`api/overpass.js`) on the same day; see `DECISIONS.md`.
`npm run build` runs `scripts/check-bundle-for-keys.mjs`, which fails the
build if a private key value or key shape is in `dist/`.

Local API route (`vite-plugin-api-dev.js` runs the real handler in dev and
preview): `/api/acs` → `api/acs.js` (GET `?fips=<11-digit tract>` only;
returns population, poverty rate and median household income, which the
profile shows, plus two fields the UI doesn't read).

Production pass-through rewrites (`vercel.json`, no keys) are limited to the
exact upstream paths the app calls: `/api/census-geocoder/geocoder/
{geographies/coordinates, locations/onelineaddress}`, `/api/nominatim/
{search, reverse}` and `/api/cdc/resource/cwsq-ngmh.json`. The Vite dev
server proxies the same three prefixes.

TIGERweb is called directly from the browser (keyless, CORS): GET for point
lookups and per-tract blocks, POST for the City summary's polygon and
`GEOID IN` queries.

## 13. Testing and Build Commands

1. `npm test` (`node --test tests/**/*.test.js`; offline)
2. `npm run lint` / `npx eslint .` (two pre-existing errors in the unused
   `src/ui/landing/GooeyNav.jsx`)
3. `npm run build` (vite build + bundle key check), `npm run preview`
4. Data builders: see `docs/data.md`. After any rebuild, run `npm test`.

## 14. Risk Register

1. TIGERweb availability: a failed tract, block or polygon call gives Unknown
   with its reason (never a partial count). Bundled counties avoid the block
   calls for the demo tracts.
2. The SNAP list misses supermarkets that don't take SNAP, and follows SNAP's
   own store-type labels. Bad upstream coordinates inside the right state are
   caught only by hand (`coordinateCorrections`).
3. Census block populations carry disclosure-avoidance noise.
4. Very large live cities send a large polygon in each POST page; untested
   above Sacramento's size.
5. Store snapshot freshness: rebuild once before the Oct 11 freeze, never
   after (the video and the judges must see the same numbers).
6. Connecticut: `/api/acs` fails for 2020 CT tract ids (ACS 2022 uses the
   planning-region county codes); profile rows show "unavailable", the
   verdict is unaffected.
7. `/api/acs` has no rate limit (a Vercel Firewall rule is pending).
8. Search calls Nominatim as the visitor types (debounced 300 ms in
   `LocationGate.jsx`, 280 ms in `StreetsGlView.jsx`); the Nominatim Usage Policy
   caps use at 1 request per second and does not allow client-side
   autocomplete.
9. Action-plan links were verified on 2026-10-03; program pages move (FNS
   paths already moved to fna.usda.gov). Re-check `VERIFIED_SOURCES` before
   the freeze.

## 15. Handoff Runbook

1. Read `docs/07-access-test-redesign.md`, `docs/08-suggest-sites-and-plan.md`,
   then this file.
2. Change the rule only in `src/engine/` and keep `normalizer.js`,
   `scenarioEngine.js`, `suggestSites.js` and `placeLoader.js` on the same
   functions.
3. Rebuild data with the `scripts/` builders; never hand-edit generated files.
4. Run tests, lint and build before and after changing a pipeline contract.
