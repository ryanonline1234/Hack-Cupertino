# 07 — Access-test redesign: USDA rule on Census blocks, honest scope, store formats, measured impact

Status: approved 2026-10-02 (owner: "go ahead with the redesigns"; Claude
writes all code, each module logged in docs/AI_USE_LOG.md the day it lands;
text-only edits to LandingPage.tsx allowed). Code freeze Sun Oct 11; City
summary ships only if green by Thu Oct 8 18:00.

## Why

Measured on main @ e69da03 (session of 2026-10-02):

- The verdict is the unweighted mean of 9 fixed points within 1.5 mi of one
  geocoded anchor, compared to 1 mi (urban) / 5 mi (rural). Income never
  enters. A city search ("San Jose") judges ~6 sq mi of downtown.
- A lone placed store can't pull that mean under 1.295 mi, so one store can
  never flip an urban verdict at the search point. Alviso never flips.
- USDA does not rate cities, only census tracts; ERS calls the measure
  "low-income and low-access" and now publishes two maps (LRAM 2019
  supermarkets; SRAM 2025 all SNAP stores) that disagree.
- Impact numbers (residents, jobs, $, diabetes) come from hand-picked
  constants and a phantom 58% baseline, appear before any store is placed,
  reward duplicate pins, and cite sources that couldn't be traced.
- OSM `shop=supermarket` misses in-town supermarkets in Delta towns (false
  rural deserts) and Overpass failed 6 of 8 calls on 2026-10-02.

## The rule (what the app computes)

Unit: the **2020 census tract** containing the searched point.

- For each populated 2020 Census block `b` (POP100 > 0), `d_b` = straight-line
  (haversine, miles) distance from the block's internal point to the nearest
  **counted store**.
- `T` = 1 mi if the tract is urban, 10 mi if rural. Urban/rural from ERS 2025
  `Urban`; if the ERS row is missing, the population-majority of block `UR`
  (`U` vs `R`), labelled as such.
- `beyond` = Σ pop_b where `d_b > T` (a block at exactly `T` is within).
  `share` = beyond / population.
- **Low access** = `share >= 0.33 || beyond >= 500`.
- **Low income** = ERS 2025 `LowIncomeTracts` (1/0) as published.
- **Verdict** = three-valued AND of low income and low access: `false` wins;
  otherwise any `null` gives Unknown.
- Click-invariant: any point in the same tract gives the same verdict.

Unknown, never a guess (each with a named reason):

| reason | when |
|---|---|
| `tract_unavailable` | point → tract lookup failed (network) |
| `no_tract` | point is outside any US tract |
| `no_residents` | tract POP100 = 0 ("USDA does not rate tracts without residents") |
| `blocks_unavailable` | block fetch failed |
| `blocks_incomplete` | Σ block POP100 ≠ tract POP100 |
| `stores_unavailable` | any needed store tile failed to load |
| `income_unavailable` | no ERS 2025 row (verdict can still be NOT MET if not low access) |

## Data (built by scripts, committed, dated)

All builders live in `scripts/`, print counts, and assert their own
completeness. Generated files are committed so the deployed app never
depends on the build-time services.

### Stores — `public/data/stores/`
Source: USDA FNS SNAP Retailer Locator ArcGIS FeatureServer
(`services1.arcgis.com/RLQu0rK7h4kbsBq5/.../snap_retailer_location_data/FeatureServer/0`).
Counted set = `Store_Type IN ('Supermarket','Super Store')` minus exclusions
reviewed by hand and committed in `scripts/store-exclusions.json` (warehouse
clubs: Costco, Sam's Club, BJ's Wholesale; military commissaries/exchanges;
fuel stations), each rule with its match count. Target and Dollar General
Market count (SNAP's own type label is followed; LRAM counted mass
merchandisers).

- `manifest.json`: `{ source, serviceUrl, dataLastEditDate, retrievedAt,
  counts: {supermarket, superStore, excluded: {rule: n}, kept}, tileDeg: 2,
  tiles: { "<latFloor>_<lngFloor>": n } }` where floors are multiples of 2.
- `<latFloor>_<lngFloor>.json`: `[[lat, lng, type, name], …]`, lat/lng to 5
  decimals, `type` `"M"` (Supermarket) or `"S"` (Super Store).
- Build asserts: unique `Record_ID` count of the pulled set equals the
  service's `returnCountOnly` for the same where-clause; zero bad coords.
- A tile absent from `manifest.tiles` means "no counted stores there"; a tile
  listed but failing to load means `stores_unavailable`. Never treat a fetch
  failure as an empty tile.

### ERS tract attributes — `public/data/ers/<SSCCC>.json` (one per county)
Sources: ERS FARA REST, `FARA_2025_StraightLine/MapServer/4` (2020 tracts)
and `FARA_2019/MapServer/30` (2010 tracts).
`{ retrievedAt, sources, f2025: [field names], t2025: { "<geoid20>": [...] },
   f2019: [...], t2019: { "<geoid10>": [...] } }`.
- f2025 = `Urban, LowIncomeTracts, POP2020, SD_SRAM_LA1and10,
  SD_SRAM_LILATracts_1And10, TractHUNV, OHU2020, PovertyRate,
  MedianFamilyIncome, GroupQuartersFlag` (keyed by `CensusTract20`; never
  `CensusTract24`).
- f2019 = `LILATracts_1And10, LA1and10, lapop1share, lapop10share, Urban`
  (keyed by `GEOID10`). A null 2019 share means "not published" (every null
  is on a tract that isn't low access), never 0%.
- `MedianFamilyIncome` 250001 is the ACS top-code: show "$250,000 or more".
- No 2025 rows exist for Puerto Rico; 295 zero-population (mostly water)
  tracts have none either — those are `no_residents`, not `income_unavailable`.

### Blocks bundle — `public/data/blocks/<SSCCC>.json` (bundled counties only)
Counties: 06085 Santa Clara, 06001 Alameda (CA-17), 28151 Washington MS
(Greenville demo), 04001 Apache AZ (Chinle rural case).
Source: TIGERweb `tigerWMS_Census2020/MapServer/10` (blocks) + `/6` (tracts)
+ `/26` and `/28` (incorporated places, CDPs).
`{ retrievedAt, source, tracts: { "<tract6>": { pop: <tract POP100>, name,
blocks: [[block4, pop, hu, lat, lng, ur, place7], …] } }, places: {
"<place7>": { name, pop } } }` where `place7` is the 7-digit place GEOID
containing the block's internal point (full-resolution polygon; incorporated
place wins over CDP) or `""`. Tract `name` is TIGERweb NAME ("Census Tract
5046.02"); place `name` keeps the Census suffix ("San Jose city"), so labels
strip it.
Everywhere else blocks come live from TIGERweb (keyless, CORS) per tract.

## Modules

### Engine (pure, no fetch)
`src/lib/geo.js` — `haversineMiles(aLat, aLng, bLat, bLng)` (moved from
storeDistanceFetch), `pointInPolygon`.

`src/engine/lowAccess.js`
- `nearestStoreMiles(point, stores)` → miles or `Infinity` (grid index allowed).
- `populationLowAccess(blocks, stores, thresholdMi)` →
  `{ population, beyond, share, byShare, byCount, lowAccess }`;
  `blocks: [{ pop, hu, lat, lng }]`, `stores: [{ lat, lng }]`. Population 0 →
  `lowAccess: null`.
- `distanceBands(blocks, stores, T)` → residents beyond T split into
  `[T, 1.1T)`, `[1.1T, 1.5T)`, `≥ 1.5T`.
- `isBorderline(blocks, stores, T)` → low-access flag differs between 0.9T and
  1.1T.

`src/engine/foodAccessVerdict.js`
- `evaluateFoodAccess({ lowIncome, lowAccess, unknownReason })` →
  `{ status: 'met'|'not_met'|'unknown', qualifier, reason }`, qualifier one
  of `li_la`, `la_not_li`, `li_not_la`, `neither`, `la_income_unknown`,
  `not_la_income_unknown`, `not_li_access_unknown`, `unknown`. `false` wins:
  not low income → NOT MET even when access is unknown, and not low access →
  NOT MET even when income is unknown.
- For scenario recompute: `nearestDistances(blocks, stores)` → per-block miles
  (grid-indexed, fine for ~35k blocks × ~1k stores) and
  `populationLowAccessFromDistances(blocks, distances, T)`; adding pins is
  `min(before, distanceToPins)` per block.

`src/engine/scenarioEngine.js` (rewritten)
- `evaluatePlacedStoreScenario(communityData, pins)` → `null` with no pins;
  otherwise `{ counting, nonCounting, before, after, broughtWithin, flipped,
  gap, halfMile, noVehicleEstimate }` using the same functions and the same
  T as the baseline. Only `format: 's'` pins join the store set; duplicates
  and far pins change nothing by construction.

### Pipeline
`src/pipeline/tractLookup.js` — point → `{ geoid, state, county, tract, name,
pop, hu, intptLat, intptLng }` via TIGERweb Census2020 layer 6; place lookup
via layers 26/28 → `{ geoid, name, pop } | null`.
`src/pipeline/blockLoader.js` — `loadTractBlocks(tract)` → bundled county file
if present, else TIGERweb layer 10; completeness check; `{ status, blocks,
source }`.
`src/pipeline/storeLoader.js` — `loadStoresNear(bbox, radiusMi)` → tiles via
manifest; `{ status, stores, dataset: { name, date } }`.
`src/pipeline/ersLoader.js` — `loadErsTract(geoid20)` → `{ status, e2025,
e2019 }` (2019 matched by identical GEOID only; otherwise `e2019: null` with
`reason: 'boundary_changed'`).
`src/pipeline/normalizer.js` (rewritten) — `buildCommunityData(lat, lng,
options)` → payload below. CDC PLACES and `/api/acs` stay for the community
profile and fail independently (`Promise.allSettled`). Cache prefix bumps to
`fds:community:v3:`.

Payload:
```
{ meta: { fips, stateAbbr, stateFips, countyFips, tractName, lat, lng,
          place: { geoid, name, kind } | null, retrievedAt },
  access: { status, reason, threshold, urban, urbanSource,
            population, beyond, share, byShare, byCount, lowAccess,
            borderline, bands, lowIncome, verdict,
            references: { lram2019, sram2025, differNote },
            point: { miles, store },        // nearest counted store to the exact spot
            blocks, stores, storesDataset }, // kept for scenario + map
  health, demographics, ers }
```

### URL state
`pins=lat,lng;…` unchanged (4 decimals, 10-pin cap) plus index-aligned
`pt=s;g;…`. Missing or invalid token → `s` (what old links meant). Pins and
tokens are paired before filtering. Lat/lng decode only when the key is
present and non-empty (fixes reload → 0,0).

## Scope: Point, Tract, City

- **Tract** (the verdict). Header: "Low-income & low-access test (USDA rule,
  supermarket-based) · estimate", subline "the measure often called a food
  desert". Pill: MEETS TEST / DOES NOT MEET / UNKNOWN. Scope line: "Census
  tract 5046.02 · ≈2,060 residents". Qualifier line, e.g. "Low income and low
  access: ≈1,900 of 2,060 residents (92%) live more than 1 mile from a counted
  supermarket." Borderline line when applicable. Distance bands. Footnote:
  "Estimated live with USDA ERS's rule; not an official USDA designation.
  Block populations include Census privacy noise; counts are rounded."
- **References** (always both): "USDA 2019 supermarket map (LRAM, 2010 tract
  boundaries): low income & low access — yes/no (share beyond: 61%)" or "no
  2019 row for this 2020 tract"; "USDA 2025 SNAP-store map (SRAM): yes/no —
  counts every SNAP store, including convenience and dollar stores". A
  computed line names which input differs.
- **Point**: "From this exact spot: nearest counted supermarket is {name},
  {d} mi (straight line). One spot doesn't decide USDA's test; the tract's
  residents do." No verdict.
- **City notice** (when the search was a city/town/village): "USDA rates census
  tracts, not cities. Showing tract {name}, the one at the point you
  searched." plus "Summarize {City}" when the City summary is available.
- **City summary** (Tier C, behind the Oct 8 gate): no pill. "Residents beyond
  the distance limit: ≈X of Y (Z%)"; "Residents in tracts meeting the test
  (estimate): ≈N (P%) · K of M tracts"; "Residents in USDA-flagged tracts: 2019
  map … · 2025 map …"; a sortable tract table (click → tract). Membership =
  block internal point inside the full-resolution place polygon; the sum must
  equal the place POP100 or the summary is Unknown. Boundary tracts are tested
  on all their blocks; totals count in-city residents only.
- City detection: Nominatim `addresstype ∈ {city, town, village,
  municipality}` (carried from both search surfaces: LocationGate and the
  in-map search) confirmed by a TIGERweb place whose name matches.

## Store customization

Pin = `{ id, lat, lng, format }`. Format chips in the armed "Place store"
banner (sticky choice) and an editable per-pin list (format select + remove)
in the scenario card, which also renders on mobile.

| code | label | counts? | line shown |
|---|---|---|---|
| `s` | Supermarket or supercenter | yes | — |
| `g` | Small grocery or corner store | no | "USDA's supermarket-based measure doesn't count small grocers." |
| `d` | Dollar store | no | "USDA's supermarket-based measure excludes dollar stores." |
| `f` | Farmers or mobile market | no | "Neither USDA map counts farmers or mobile markets." |

Size, SNAP/WIC, price tier and names are out: nothing the app measures
responds to them.

## Impact (computed only)

Shown only with ≥ 1 counting pin and a known baseline. Rows, before → after:
residents beyond T; residents brought within T; test result; if not flipped,
the gap ("≈X residents still beyond 1 mi; needs under 500 and under 33%");
urban: residents within ½ mi; "≈ no-vehicle households beyond ½ mi"
(ERS `TractHUNV` apportioned by block housing units; hidden under 20). Footer:
"This tract's residents only; straight-line distance from 2020 Census block
centers." Labels say "computed", never "measured".

Context box (not projections):
- Jobs: "Grocery retailers (NAICS 445110: supermarkets and other grocers)
  average about 45 employees per establishment (BLS QCEW 2025); new stores
  partly shift jobs from existing ones (Neumark, Zhang & Ciccarella 2008)."
- Health: "No measurable BMI change after new supermarkets in Philadelphia
  (Cummins et al. 2014) or Pittsburgh (Dubowitz et al. 2015); no change in
  children's diets in the Bronx (Elbel et al. 2015); food insecurity fell
  11.8% relative to a comparison neighborhood in Pittsburgh (Richardson et al.
  2017). This app does not project health outcomes."

Deleted: the 0.58 baseline and every projection (residents/jobs/$/diabetes/
obesity/commute/receipt), ScenarioCompare, "If 1 grocery store opened",
correlations.js, ACCESS CRISIS badges, ThresholdSensitivityPanel (5 mi),
SimilarTracts (hardcoded flags), dead ImpactPanel/StatsPanel/RadarChart if
unused, the 9-point sampler, Overpass (`api/overpass.js`, client, dev route),
usdaFetch's CSV path for the verdict.

## Demo examples

Greenville MS 28151000600 (robust flip; replaces 000702, which is never low
income), Alviso 06085504602 with a village pin (37.42105, -121.9727) for the
local flip, Cupertino 06085508101 as a served example. Chips re-verified live
before the freeze; untagged chips make no claim.

## Acceptance (tests first, offline, dated fixtures in tests/fixtures/access/)

- lowAccess: share 33% and count 499/500 edges; `d == T` counts within; pop 0
  → null; duplicate store → identical result; adding a store never raises
  `beyond`.
- Verdict: full 3×3 truth table.
- Loader failures → Unknown with the named reason (never `[]` stores, never
  partial blocks).
- Scenario: 0 pins → null; non-`s` pins → no change; duplicate and 30-mi pins
  → no change; monotone; `broughtWithin ≤ before.beyond`.
- Codec: legacy link (no `pt`), invalid token, pairing, no-lat hash.
- Golden tracts (from the committed snapshot + fixtures): Alviso 06085504602
  low income + low access, village pin flips it; Greenville 28151000600 flips
  with one pin at its internal point; Los Altos Hills tract → NOT MET (not low
  income); Cupertino 06085508101 not low access; Chinle 04001944202 low access
  by count only (rural, T = 10 mi).
- Then: lint (GooeyNav's 2 pre-existing errors excepted), build + key check,
  browser checks at 1280 and 390 px on the demo tracts, preview deploy.
