# Food Desert AI

> Type a US place and see whether its 2020 census tract meets USDA's low-income and low-access test (the measure often called a food desert), the counts behind the answer, and what one new supermarket would change. It is an estimate computed live with USDA ERS's rule, not an official USDA designation.

A React app that computes USDA ERS's low-income & low-access test on 2020 Census blocks and USDA's list of SNAP-authorized supermarkets, shows both published USDA maps beside the estimate, and recomputes the test when you place a store. Built for the [Congressional App Challenge](https://www.congressionalappchallenge.us/) — see [`docs/CAC_SUBMISSION.md`](docs/CAC_SUBMISSION.md) for the submission packet. The method contract is [`docs/07-access-test-redesign.md`](docs/07-access-test-redesign.md).

## Purpose (one sentence)

For any US place, Food Desert AI estimates whether the census tract there meets USDA ERS's low-income and low-access test, shows the counts and reasons behind the answer, and recomputes it with the stores you place.

## Target audience

- City planners and public-health teams evaluating grocery interventions
- Students, educators, and community advocates learning how food access is measured
- Congressional App Challenge judges evaluating idea, implementation, and code quality

## How it decides

USDA rates census tracts, not cities, so the unit is the **2020 census tract** containing the searched point.

1. **Tract:** Census TIGERweb (Census 2020, layer 6) at the point.
2. **Residents:** every populated 2020 Census block in the tract (POP100 > 0), from a committed county file (Santa Clara and Alameda CA, Washington MS, Apache AZ) or live from TIGERweb. The block populations must add up to the tract's 2020 population, or the answer is Unknown.
3. **Stores:** USDA SNAP-authorized retailers labelled "Supermarket" or "Super Store" (SNAP Retailer Locator, dated snapshot in `public/data/stores/`), minus hand-reviewed exclusions (warehouse clubs, military commissaries and exchanges, fuel stations; `scripts/store-exclusions.json`).
4. **Distance:** straight-line (haversine) miles from each block's internal point to the nearest counted store.
5. **Distance limit T:** 1 mile if USDA ERS 2025 flags the tract urban, 10 miles if rural. Without an ERS row, the majority of block residents' Census urban/rural code decides, and the app says so.
6. **Low access:** at least 33% of the tract's residents, or at least 500 of them, live more than T from a counted store (a block at exactly T is within).
7. **Low income:** USDA ERS 2025 `LowIncomeTracts`, as published.
8. **Result:** MEETS TEST only when both hold. A known "no" on either decides DOES NOT MEET. Otherwise the result is UNKNOWN with a named reason (tract lookup failed, no residents, blocks incomplete, a store tile failed to load, no ERS row, …). The app never guesses.

Any point in the same tract gives the same result. The exact spot only adds one line, the distance to its nearest counted supermarket, and no verdict.

**References.** Every estimate shows USDA's 2019 supermarket map (LRAM; 2010 tract boundaries, matched to the 2020 tract by identical GEOID only) and its 2025 SNAP-store map (SRAM, which counts SNAP-authorized stores of every size, including convenience and dollar stores but not farmers markets). When either disagrees with the estimate, the app names the input that differs.

**City searches.** A city search shows the tract at the searched point and says so. "Summarize {city}" adds up the tract test for the residents inside the Census place boundary: a block counts when its internal point lies inside the full-resolution place polygon; the in-city blocks must add up to the place's 2020 population exactly, or the summary is Unknown; tracts on the city line are tested on all their residents, and totals count in-city residents only. It reports residents beyond their own tract's limit, residents in tracts meeting the test, residents in tracts flagged on the 2019 and 2025 USDA maps, and a sortable tract table that opens each tract.

**Placing stores.** A pin is a supermarket or supercenter (counts), a small grocery or corner store, a dollar store, or a farmers or mobile market (shown, but USDA's supermarket-based measure doesn't count them). The scenario reruns the same rule on the same blocks, with each block's distance the smaller of its baseline and its nearest supermarket pin: residents beyond T, residents brought within T, the test result, the gap still to close, and for urban tracts the residents within ½ mile and an estimate of no-vehicle households beyond ½ mile (ERS `TractHUNV` apportioned by housing units). These are computed access numbers; the app makes no jobs, dollar or health projections.

## Features

1. The tract test above, computed live, with an evaluation trace, distance bands, a borderline flag and Unknown-with-reason handling.
2. Both published USDA maps (2019 LRAM, 2025 SRAM) beside every estimate, with the differing input named.
3. City notice and City summary for city searches.
4. Store placement in four formats with a computed before → after scenario, editable on desktop and phone.
5. Share links that replay the location and the placed stores (`pins=` and `pt=` in the URL hash).
6. Community profile for the tract: Census ACS 5-year (population, poverty, median household income) and CDC PLACES (diabetes, obesity).
7. US map mode: USDA's 2019 atlas (LRAM) flags aggregated by state.
8. Phone layout (information only, no map) and an installable PWA with an offline app shell (data calls stay network-only; stale data is never presented as fresh).

## Tech stack

| Layer | Tools / languages |
|---|---|
| UI | React 19, Vite, Tailwind CSS, Framer Motion, GSAP (landing), Leaflet (2D map; the Streets GL 3D view is parked behind a flag) |
| Data pipeline | JavaScript (ES modules) in the browser: Census TIGERweb (keyless), committed data in `public/data/` (SNAP store tiles, USDA ERS shards, block bundles), CDC PLACES, Census ACS |
| APIs | One Vercel serverless function, `api/acs.js` (Census ACS; keeps `CENSUS_KEY` server-side), run locally by a Vite dev middleware; CDC PLACES, Nominatim and the Census geocoder through `vercel.json` rewrites (the Vite dev proxy locally) |
| Data builders | `scripts/build-store-snapshot.mjs`, `build-ers-shards.mjs`, `build-block-bundles.mjs` (Node; each prints counts and asserts its own completeness) |
| Tests | Node built-in test runner (`node --test`) |
| PWA | `vite-plugin-pwa` (Workbox) |

## Quick start

Prerequisites: Node.js 20+ and npm.

```bash
npm install
cp .env.example .env   # then fill in keys (optional — see below)
npm run dev -- --host 127.0.0.1 --port 5173
```

### Environment variables

| Variable | Required? | Used by |
|---|---|---|
| `CENSUS_KEY` | No | Census ACS figures in the community profile, read server-side by `api/acs.js` (Vercel) and by the local dev middleware. Never prefix it with `VITE_`: Vite inlines `VITE_*` values into the client bundle. The tract test does not use ACS. |
| `VITE_CARTO_KEY` | No | Optional override for the US map's CARTO raster tiles; the built-in key is public by design |

**Judges / reviewers without keys:** the app runs without any key. The tract test, the USDA map references, the City summary, the store scenario, share links and the US map all work. Without `CENSUS_KEY`, the community profile's Census ACS rows show "unavailable".

`npm run build` ends with `scripts/check-bundle-for-keys.mjs`, which fails the build if any private key value (or a known key shape) appears in `dist/`. It prints the variable name, never the value.

### Build / lint / test

```bash
npm run lint     # eslint
npm test         # unit tests (node --test tests/**/*.test.js)
npm run build    # production build to dist/, then the bundle key check
npm run preview  # serve the production build locally
```

Current status: re-verify with the commands above before submitting.

## Project structure

```text
src/
  App.jsx                  # landing ↔ tracker shell
  TrackerApp.jsx           # search → tract payload → panels; pins, share links, City summary
  pipeline/
    tractLookup.js         # point → 2020 tract (and Census place) via TIGERweb
    blockLoader.js         # a tract's 2020 blocks: bundled county file or TIGERweb live
    storeLoader.js         # counted SNAP stores from the committed tiles
    ersLoader.js           # USDA ERS 2025 / 2019 rows from the committed shards
    normalizer.js          # buildCommunityData: the tract-test payload
    placeLoader.js         # City summary: in-city blocks, per-tract test, totals
    cdcFetch.js            # CDC PLACES (community profile)
    censusFetch.js         # Census ACS via /api/acs (community profile)
  engine/
    lowAccess.js           # nearest-store distances, low-access counts, bands, borderline
    foodAccessVerdict.js   # three-valued "low income AND low access"
    scenarioEngine.js      # placed-store recompute on the same blocks
  components/              # map, Tract view, City summary, scenario card, US map, phone view
  ui/landing/              # landing page
  lib/ utils/              # geo, URL state, store formats, location search, formatting
api/
  acs.js                   # Census ACS for one tract (CENSUS_KEY stays server-only)
scripts/
  build-store-snapshot.mjs # SNAP Retailer Locator → public/data/stores/
  build-ers-shards.mjs     # USDA ERS FARA 2025 + 2019 → public/data/ers/
  build-block-bundles.mjs  # TIGERweb blocks, tracts, places → public/data/blocks/
  store-exclusions.json    # hand-reviewed store exclusions
  check-bundle-for-keys.mjs  # post-build guard: no private key may ship in dist/
tests/                     # engine, loaders, payload, scenario, City summary, URL codec, ACS handler
public/data/               # committed, dated data: stores/, ers/, blocks/, food_atlas.csv (US map)
docs/
  07-access-test-redesign.md  # the method contract
  CAC_SUBMISSION.md        # Congressional App Challenge packet
PROJECT_HANDOFF.md         # implementation-level technical handoff
```

## Data sources

1. US Census Bureau TIGERweb (`tigerWMS_Census2020`): 2020 tracts, blocks (population, housing units, urban/rural code, internal points), incorporated places and census-designated places.
2. USDA FNS SNAP Retailer Locator: SNAP-authorized "Supermarket" and "Super Store" retailers, as a dated snapshot.
3. USDA ERS Food Access Research Atlas: the 2025 straight-line release (urban and low-income flags, the SRAM low-access and LILA flags, no-vehicle households, poverty rate, median family income) and the 2019 release (LILA flag and low-access shares); the 2019 CSV also feeds the US map.
4. CDC PLACES (diabetes, obesity) and Census ACS 5-year (population, poverty, median household income) for the community profile.

### Caveats (shown in-app where relevant)

1. It is an estimate made with USDA ERS's rule, not an official USDA designation; ERS's published maps stay the record and are shown beside it.
2. Distances are straight-line miles from 2020 Census block internal points, not road distance or travel time.
3. The store list is SNAP-authorized supermarkets and super stores as SNAP labels them; a supermarket that doesn't take SNAP is missing.
4. Census block populations include the Census Bureau's privacy noise; the app rounds counts.
5. `Unknown` is intentional when an input is missing, and always names the reason — the app refuses to guess.

## AI disclosure (Congressional App Challenge)

Per CAC rules, all AI usage is disclosed here and in [`docs/CAC_SUBMISSION.md`](docs/CAC_SUBMISSION.md):

- **What uses AI:** one optional feature — the Community Narrative panel, which turns the already-computed metrics into two short paragraphs via OpenRouter, free tier only (`google/gemma-4-31b-it:free`, fallback `nvidia/nemotron-3-super-120b-a12b:free`). All classification, distance modeling, and impact math is deterministic code in `src/engine/` and `src/pipeline/`, covered by unit tests.
- **What AI did not do:** app architecture, data pipeline, engines, UI, tests, and docs reflect the student's own design and implementation; AI tools assisted with specific implementation and documentation tasks only.
- **Human contribution:** the student(s) designed the system, wrote and debugged the code, chose data sources and thresholds, built the evidence-trace UX, and verified behavior with tests and builds.

## IDE setup

Open the repository root (`food-desert-simulator`) as the project root, use Node 20+, ensure `.env` is loaded, and keep the `@` import alias mapped to `src` (see `vite.config.js`).

## Technical handoff

Implementation-level transfer details (thresholds, pipeline contracts, caching, risk register): [`PROJECT_HANDOFF.md`](PROJECT_HANDOFF.md).

## License

MIT — see [`LICENSE`](LICENSE). Students retain IP ownership of their submission; the license covers the public code repository.
