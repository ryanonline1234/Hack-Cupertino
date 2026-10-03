# 08 — Suggest sites and a rules-based action plan (no runtime AI)

Status: approved 2026-10-03 (owner: "go with recs" on option A). Builds on
docs/07. Go/no-go Thu Oct 8 18:00; if it isn't green, the docs/07 redesign
ships without it. Claude writes the code; each module goes in
docs/AI_USE_LOG.md the day it lands.

## Why

The owner asked for "an AI that solves food deserts and maps out the plan,
like replacing this McDonald's with a Sprouts". Naming a business to replace
and a chain to bring in claims what the app can't know (ownership, lot size,
zoning, retailer interest), and an LLM asked for that produces confident
specifics — the failure that got the narrative removed. The docs/07 engine
can instead search for the placements that change the measured result, and
plain rules can turn the tract's computed facts into a sourced checklist.

## 1. Suggest sites (deterministic)

`src/engine/suggestSites.js`

`suggestSites({ blocks, threshold, candidates, existingPins = [], maxSites = 3,
lowIncome })` →
`{ source: 'commercial' | 'blocks', picks: [{ candidate, gain, beyondAfter,
shareAfter, lowAccessAfter, verdictAfter }], flippedAt: number | null,
reason: null | 'not_low_access' | 'no_gain' | 'unknown_baseline' }`

- `blocks`: `access.blocks` (`{ pop, hu, lat, lng, miles }`, baseline miles).
  Counting `existingPins` (format `s`) are applied first, so suggestions build
  on the user's scenario.
- Greedy max-coverage: each step picks the candidate that brings the most
  residents newly within `threshold` (gain = Σ pop of blocks currently beyond T
  that the candidate puts within T). Ties: more residents within ½ mi (urban
  only), then the smaller distance to the tract's population-weighted center,
  then candidate id. After each pick, per-block distances update to
  min(current, distance to the pick). Stops at `maxSites`, at gain 0, or as
  soon as low access is gone (the verdict can no longer be MET).
- Returns `reason: 'not_low_access'` with no picks when the baseline isn't low
  access, `unknown_baseline` when access is Unknown.
- `verdictAfter` uses `evaluateFoodAccess` with the tract's `lowIncome`.
- Candidates are `{ id, lat, lng, label, kind, sqft?, name? }`, at pin
  precision (4 decimals, `roundCoord` in `src/lib/geo.js`): the site loader
  and `blockCandidates` round them before scoring, so "Add as store" lands
  exactly where a pick was scored and the scenario card repeats the list's
  numbers. (Rounding after scoring moved boundary blocks across T: review of
  2026-10-03, 9 picks in the bundled counties.)

Candidate sources:
- **Commercial** (bundled counties 06085, 06001, 28151, 04001 only): existing
  commercial sites from OpenStreetMap, pulled at build time by
  `scripts/build-site-candidates.mjs` into `public/data/sites/<SSCCC>.json`
  (dated, committed): vacant or disused shops (`shop=vacant`,
  `disused:shop=*` not occupied again), retail and commercial buildings with
  a footprint of at least 10,000 sq ft (`building=retail|commercial`
  polygons), and `landuse=retail` areas of at least 2 acres (centroid).
  Not candidates: fast-food lots and operating supermarkets; any building or
  retail area in active use (a `shop` other than `vacant`, or an `amenity`,
  `office`, `craft`, `healthcare`, `leisure`, `tourism` or `club` tag on the
  feature: warehouse clubs, restaurants, hotels, clinics, lodges, offices,
  car dealers, department stores, malls); a `building=supermarket` that
  isn't vacant or disused; and any building or retail area with a
  `shop=supermarket` node or polygon inside it. Format:
  `{ retrievedAt, source: 'OpenStreetMap via Overpass', license: 'ODbL (©
  OpenStreetMap contributors)', counts, osmBase, bbox, sites: [[id, lat, lng,
  kind, sqft, name], …] }`, kind `vacant` | `building` (`building=retail`) |
  `commercial_building` (`building=commercial`, often offices) |
  `retail_area`; `name` only for vacant shops (on anything else it's the
  business there now), else `''`.
  Use candidates within the tract's block bounding box expanded by T.
- **Blocks** (everywhere else, or when no commercial candidate gains
  anything): the tract's populated block internal points.

Labels (fixed strings; the only third-party text is a vacant shop's name,
escaped):
- vacant: "Vacant shop{ · name} (OpenStreetMap)"
- building: "Retail building, ≈{sqft rounded to 1,000} sq ft footprint (OpenStreetMap)"
- commercial_building: "Commercial building (offices or shops), ≈{sqft rounded to 1,000} sq ft footprint (OpenStreetMap)"
- retail_area: "Retail area, ≈{acres, 1 decimal} acres (OpenStreetMap)"
- blocks: "Inside a populated Census block (not a commercial site)" (true
  however blocks were reached; the list's note says why)

Always shown with the suggestions: "Distance only. Ignores land, zoning,
cost, and whether a grocer would open there. Commercial sites are existing
OpenStreetMap features; the app doesn't know whether they're available."

## 2. Action plan (rules, sourced)

`src/engine/actionPlan.js`

`buildActionPlan({ access, ers, scenario, suggestions, meta })` → `[{ id,
title, why, action, sources: [{ name, url }] }]`, at most 6 items, ordered.
Every `why` quotes the tract's computed numbers (same guarded formatters as
the panel); no item invents a number. Rules:

| when | item |
|---|---|
| suggestions picked and they flip the verdict | "Site a full-line grocery store near suggested site 1" (or "…near suggested sites 1 and 2", "…1, 2 and 3" when the flip takes more picks) — why: residents brought within T and the flip |
| low access, low income | "Make sure a new store can take SNAP and WIC" (FNS retailer authorization; WIC is by state agency) |
| no-vehicle households ≥ 100 (ERS TractHUNV) or rural | "Cover distance a single store can't": SNAP online purchasing; mobile market or transit routes |
| low income | "Make healthy food cheaper, not just closer": the Gus Schumacher Nutrition Incentive Program (GusNIP) |
| low access, low income | "Financing for a grocery in a low-income, low-access area": America's Healthy Food Financing Initiative (Reinvestment Fund in partnership with USDA, `investinginfood.com`). California FreshWorks for CA tracts is wired in but off: its site didn't verify on 2026-10-03 (HTTP 500), so no CA line shows until a verified `caFreshWorks` source is added |
| low access, not low income | "Access is limited, but this isn't a low-income tract, so USDA's test isn't met and low-income financing programs may not apply" |
| not low access | "Distance isn't the barrier here; affordability may be" (GusNIP, SNAP) |

Program links are verified against the official pages before they ship; any
link that can't be verified is dropped with its item. The card is titled
"Action plan · rules applied to this tract's numbers" and ends with "Not
advice from USDA; check each program's current eligibility."

## 3. UI

- "Suggest sites" button in the Tract view (when access is known and low
  access) and in the armed Place-store banner. Results: numbered dashed
  markers on the map (not pins) and a "Suggested sites" list with each pick's
  label, "+≈N residents within T", the verdict after, an "Add as store" button
  (adds a format-`s` pin, which then enters share links like any pin), "Add
  all", and Dismiss. Suggestions never enter the URL until added. Works on
  mobile as a list (no map).
- The action plan renders under the References block when the verdict is
  known.
- Log lines: "Suggested sites (computed): 2 sites from OpenStreetMap
  commercial candidates → tract would no longer meet the test".

## Acceptance

- suggestSites: Alviso 06085504602 with block candidates finds a site with
  gain ≥ 1,800 (the village); Greenville 28151000600 flips with one site on
  block candidates (in the app's default mode its only gaining commercial
  site brings ≈1,060 within 1 mi and leaves it meeting the test, so the list
  offers "Try Census block points instead");
  `not_low_access` for Cupertino 06085508101; existing counting pins are
  respected; deterministic (same input → same picks); gain never negative;
  stops at the flip.
- Commercial candidates load only for bundled counties; a failed candidate
  file falls back to blocks with the blocks label (never silently empty).
- actionPlan: each rule's trigger and non-trigger; every number in `why`
  appears in the inputs; every URL is in the verified list.
- Headless: Alviso → Suggest sites → Add as store → flip; Greenville; mobile
  list; share link after adding.
