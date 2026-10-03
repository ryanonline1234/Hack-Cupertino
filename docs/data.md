# Committed data

Everything the access test needs (except the live Census lookups) is committed
under `public/data/` and served as static files, so the deployed app doesn't
depend on the services the data was built from. This file lists each dataset:
where it comes from, what was kept and why, its format, counts and dates, its
terms, how to rebuild it, what the builder checks, and when to rebuild.

Rules that apply to all of them:

- Never hand-edit a generated file. Change the builder or its input
  (`scripts/store-exclusions.json`) and rebuild.
- Every builder is a Node 20+ script with no dependencies (built-in `fetch`).
  It prints counts, checks its own completeness, and exits non-zero without
  writing the failing file when a check fails.
- The tests read the committed files (the golden tracts in
  `tests/normalizer.test.js`, `tests/suggestSites.test.js`,
  `tests/siteLoader.test.js`, `tests/placeLoader.test.js`, and the
  coordinate-correction check in `tests/storeSnapshot.test.js`), so run
  `npm test` after any rebuild and before committing it.
- Counts and dates below were read from the files on 2026-10-03. Each file's
  own `retrievedAt` / manifest is the authority.

| Dataset | Path | Source | Data as of | Builder |
|---|---|---|---|---|
| Counted stores | `public/data/stores/` | USDA FNS SNAP Retailer Locator | USDA edit 2026-09-17, pulled 2026-10-03 | `scripts/build-store-snapshot.mjs` |
| ERS tract attributes | `public/data/ers/` | USDA ERS Food Access Research Atlas 2025 + 2019 | pulled 2026-10-03 | `scripts/build-ers-shards.mjs` |
| Census blocks (4 counties) | `public/data/blocks/` | Census TIGERweb, 2020 Census | pulled 2026-10-03 | `scripts/build-block-bundles.mjs` |
| Site candidates (4 counties) | `public/data/sites/` | OpenStreetMap via Overpass | OSM data 2026-10-03 | `scripts/build-site-candidates.mjs` |
| US map atlas (legacy) | `public/data/food_atlas.csv` | USDA ERS Food Access Research Atlas 2019 | committed 2026-04-11 | none |

Not committed (fetched live at runtime, each failing on its own with a named
Unknown or an "unavailable" row): Census TIGERweb (tract and place at the
point, blocks outside the bundled counties, the City summary's place polygon
and blocks), CDC PLACES (through the `/api/cdc` rewrite), Census ACS (through
`api/acs.js`), Nominatim and the Census geocoder (search).

---

## Counted stores — `public/data/stores/`

**Source.** USDA FNS SNAP Retailer Locator, ArcGIS FeatureServer layer 0:
`https://services1.arcgis.com/RLQu0rK7h4kbsBq5/arcgis/rest/services/snap_retailer_location_data/FeatureServer/0`.
The builder also reads Census TIGERweb 2020 States
(`tigerWMS_Census2020/MapServer/80`) for each state's bounding box.

**Selected.** `Store_Type IN ('Supermarket','Super Store')`. USDA's
low-access measure is supermarket-based, and the app follows SNAP's own type
label instead of second-guessing it, so a Target or Dollar General Market
labelled "Super Store" counts.

**Excluded** (`scripts/store-exclusions.json`, reviewed by hand 2026-10-02).
Each rule is a regular expression on `Store_Name` with a written reason; a
record is attributed to the first rule it matches, so the per-rule counts in
the manifest add up.

| Rule | Removed | Why |
|---|---|---|
| `costco` | 643 | warehouse club (paid membership) |
| `sams-club` | 593 | warehouse club |
| `bjs-wholesale` | 269 | warehouse club |
| `commissary` | 172 | military commissary (authorized patrons only) |
| `commissary-by-installation` | 6 | commissaries listed under the installation name |
| `navy-exchange` | 3 | on-installation retail |
| `naval-hospital-mini-mart` | 1 | on-installation retail (judgment call) |
| `marine-corps-exchange` | 0 | kept so a refresh can't let one in silently |
| `army-air-force-exchange` | 0 | same |
| `fuel-station` | 7 | supermarket-branded fuel stations |

**Coordinates.** A store whose coordinate is outside the US + territories box
or outside its own state's 2020 bounding box (plus about 5 km) is dropped, and
every such drop must be listed in `knownBadCoordinates` with a reason, or the
build fails (3 dropped: geocodes that landed in Minnesota/Iowa, the
Philippines and California for stores in Wisconsin, Guam and New York).

**Coordinate corrections.** `coordinateCorrections` in the same file holds
hand-verified fixes to bad upstream coordinates that the state-box check
can't catch (a wrong point inside the right state). Each entry names the
record, the exact coordinate it replaces, the corrected coordinate, a reason
and its source (the SNAP record plus where the true location was confirmed,
e.g. an OpenStreetMap feature). The builder fails if the record is gone,
renamed, excluded, or no longer at the coordinate the entry replaces, so a
record USDA has fixed gets its entry removed instead of silently overriding
USDA. The manifest repeats the corrections and counts them (`counts.corrected`).

**Format.**
- `manifest.json`: `source`, `serviceUrl`, `where`, `dataLastEditDate`,
  `retrievedAt`, `counts` (`supermarket`, `superStore`, `excluded` per rule,
  `badCoordinates`, `corrected`, `kept`, `keptSupermarket`, `keptSuperStore`),
  `exclusionRule`, `badCoordinates` (each with its reason),
  `coordinateCorrections`, `tileDeg: 2`, `tileRow`, and `tiles`
  (`{ "<latFloor>_<lngFloor>": count }`, floors are multiples of 2).
- `<latFloor>_<lngFloor>.json`: `[[lat, lng, type, name], …]`, lat/lng to 5
  decimals, `type` `"M"` (Supermarket) or `"S"` (Super Store), `name` as USDA
  lists it (at most 60 characters; escaped before it reaches the map).
- A tile absent from `manifest.tiles` means no counted stores there. A listed
  tile that fails to load makes the answer `stores_unavailable`, never an
  empty list (`src/pipeline/storeLoader.js`).

**Counts (manifest of 2026-10-03).** USDA data last edited 2026-09-17,
retrieved 2026-10-03 05:51 UTC. Pulled 19,641 Supermarket + 20,683 Super
Store = 40,324; excluded 1,694; dropped 3 bad coordinates; corrected 1; kept
38,627 (19,452 Supermarket, 19,175 Super Store) in 281 tiles, about 1.8 MB
with the manifest.

The one correction (Bashas' Dine Market 33, Chinle AZ) was added after that
pull: tile `36_-110.json` and the manifest were edited in place to what the
builder writes for it, without a fresh pull, so `retrievedAt` still dates
the 05:51 pull. That is the one exception to "never hand-edit"; the next
rebuild regenerates both from the service.

**Terms.** USDA FNS data, a US federal government work (not subject to US
copyright, 17 U.S.C. § 105); see FNS for its terms of use. A corrected
coordinate taken from OpenStreetMap is attributed in its entry's `source`.

**Rebuild.**

```bash
node scripts/build-store-snapshot.mjs
node scripts/build-store-snapshot.mjs --review=/tmp/store-review.txt   # also list every excluded, corrected and dropped record for hand review (keep it out of the repo)
```

**Self-checks (exit 1 on any failure).**
- Unique `Record_ID` count equals the service's `returnCountOnly` for the same
  where-clause, taken before and after the pull, and per `Store_Type`.
- Every coordinate correction names a pulled record with the same store name,
  still at exactly the coordinate it replaces, and not excluded by a rule.
- Every coordinate is finite, inside the US + territories box and inside its
  state's bounding box, or listed in `knownBadCoordinates`.
- `kept = pulled − excluded − dropped`, and equals the sum of the tile counts.
- Exclusion rules are well formed (unique ids, a pulled field, a reason).

**When to rebuild.** Once before the Oct 11 code freeze, to pick up USDA's
latest edits: rebuild, read the `--review` file for new exclusion matches and
bad coordinates, run `npm test` (the golden tracts depend on the stores), and
re-verify the demo chips. Never after the freeze, so the demo video and the
judges see the same numbers.

---

## ERS tract attributes — `public/data/ers/<SSCCC>.json`

**Sources.** USDA ERS Food Access Research Atlas REST services (keyless):
- 2025 (2020 tracts):
  `https://gisportal.ers.usda.gov/server/rest/services/FARA/FARA_2025_StraightLine/MapServer/4`,
  keyed by `CensusTract20` (never `CensusTract24`).
- 2019 (2010 tracts):
  `https://gisportal.ers.usda.gov/server/rest/services/FARA/FARA_2019/MapServer/30`,
  keyed by `GEOID10`.
- Cross-check: Census TIGERweb 2020 tracts (`tigerWMS_Census2020/MapServer/6`).

**Selected fields.**
- `f2025`: `Urban` (sets the 1 mi / 10 mi limit), `LowIncomeTracts` (the
  income half of the test), `POP2020`, `SD_SRAM_LA1and10` and
  `SD_SRAM_LILATracts_1And10` (the 2025 SNAP-store map reference),
  `TractHUNV` (no-vehicle housing units: the scenario's estimate and the
  action plan's "cover distance" rule), `OHU2020`, `PovertyRate`,
  `MedianFamilyIncome`, `GroupQuartersFlag`.
- `f2019`: `LILATracts_1And10`, `LA1and10`, `lapop1share`, `lapop10share`,
  `Urban` (the 2019 supermarket map reference).
- Everything else in the atlas (other distance thresholds, subgroup counts) is
  left out because nothing in the app reads it.

**Format.** `{ retrievedAt, sources: { 2025: url, 2019: url }, f2025: [field
names], t2025: { "<geoid20>": [values] }, f2019: [...], t2019: {
"<geoid10>": [values] } }`, one file per county. Shares and rates are rounded
to 2 decimals, income to an integer; flags and counts must already be whole
numbers.

**Counts (2026-10-03).** 3,222 county files, about 8.2 MB (16 MB on disk,
from per-file block overhead); 84,119 rows from
2025 (2020 tracts, 50 states + DC) and 73,769 from 2019 (2010 tracts);
retrieved 2026-10-03 05:47 UTC.

**Coverage notes.** 2025 has no Puerto Rico rows; 2019 has Puerto Rico rows
with every field null. A null 2019 share means "not published", never 0%.
The share for the tract's own 2019 limit (`lapop1share` urban,
`lapop10share` rural), which is the one the app shows, is null only on
tracts that aren't low access; the other share is often null (for example
`lapop10share` on all 24,006 urban low-access tracts). `MedianFamilyIncome`
250001 is the ACS top-code ("$250,000 or more"); 1,629 rows carry it. Of
the 566 zero-population 2020 tracts (50 states + DC), 295 have no 2025 row
and 271 have one with `POP2020` 0; the app reports every zero-population
tract as `no_residents`, never `income_unavailable`. 2019 rows
match a 2020 tract only by identical GEOID (`src/pipeline/ersLoader.js`).

**Terms.** USDA ERS data, a US federal government work (not subject to US
copyright, 17 U.S.C. § 105); see ERS for its citation and use terms.

**Rebuild.**

```bash
node scripts/build-ers-shards.mjs              # writes public/data/ers/
node scripts/build-ers-shards.mjs /tmp/ers     # or another output directory
```

**Self-checks (non-zero exit before any file is written).**
- Per layer: rows pulled equal the service's `returnCountOnly` (before and
  after the pull); unique OBJECTIDs and unique tract ids equal the row count;
  every tract id is 11 digits; rows written equal rows pulled.
- Against TIGERweb 2020 tracts (50 states + DC): every populated 2020 tract
  has a 2025 row, every 2025 id is a 2020 tract, and `POP2020 == POP100`.
- Old `<SSCCC>.json` files are removed only after the checks pass.

**When to rebuild.** Only when ERS publishes a new release or revises one.
Both releases are fixed, so there is no scheduled rebuild.

---

## Census blocks — `public/data/blocks/<SSCCC>.json` (bundled counties)

**Source.** Census TIGERweb `tigerWMS_Census2020/MapServer`: layer 10 (2020
blocks with POP100 > 0), layer 6 (2020 tracts, including unpopulated ones),
layers 26 (incorporated places) and 28 (census-designated places) with
full-resolution polygons.

**Why these counties.** 06085 Santa Clara and 06001 Alameda (CA-17), 28151
Washington MS (the Greenville demo) and 04001 Apache AZ (the Chinle rural
case). Bundling them keeps the demo tracts off live block calls and gives the
City summary place membership without a polygon query. Every other county's
blocks come live from TIGERweb, one tract at a time.

**Format.** `{ retrievedAt, source, tracts: { "<tract6>": { pop, name,
blocks: [[block4, pop, hu, lat, lng, ur, place7], …] } }, places: {
"<place7>": { name, pop } } }`. `lat`/`lng` is the block's internal point;
`ur` is the Census urban/rural code; `place7` is the place whose
full-resolution polygon contains the internal point (incorporated place
preferred over a CDP), or `""`.

**Counts (retrieved 2026-10-03 05:47 UTC).**

| County | Tracts | Populated blocks | Population | Places |
|---|---|---|---|---|
| 04001 Apache AZ | 18 | 3,801 | 66,021 | 39 |
| 06001 Alameda CA | 379 | 13,193 | 1,682,353 | 20 |
| 06085 Santa Clara CA | 408 | 14,497 | 1,936,259 | 24 |
| 28151 Washington MS | 19 | 1,541 | 44,922 | 9 |

About 1.6 MB in all.

**Terms.** US Census Bureau 2020 Census data, a US federal government work
(not subject to US copyright, 17 U.S.C. § 105). Block counts include the
Census Bureau's disclosure-avoidance noise.

**Rebuild.**

```bash
node scripts/build-block-bundles.mjs            # all four counties
node scripts/build-block-bundles.mjs 28151      # one county
```

An unknown county exits 2 without a network call. Adding a county also means
adding it to `BUNDLED_COUNTIES` in `src/pipeline/blockLoader.js` and
`COUNTIES` in `scripts/build-site-candidates.mjs`.

**Self-checks (a failing county's file is not written; exit 1).**
- Blocks, tracts and places pulled equal each layer's `returnCountOnly`; all
  GEOIDs unique.
- Every tract: the sum of block POP100 equals the tract POP100.
- Every block's internal point is inside the county envelope.
- Every place assigned to a block, and every populated envelope place,
  reconciles: in-county block population plus out-of-county populated blocks
  inside its polygon (live from layer 10) equals the place POP100.
- San Jose (0668000) adds up to exactly 1,013,240 in 06085.

**When to rebuild.** The 2020 Census doesn't change; rebuild only to add a
county.

---

## Site candidates — `public/data/sites/<SSCCC>.json` (bundled counties)

**Source.** OpenStreetMap through the Overpass API, one query per bundled
county over its populated-block extent padded by 2 miles. Endpoints tried in
order: `overpass-api.de`, `overpass.private.coffee`, `overpass.kumi.systems`.

**Selected** (docs/08 §1): vacant or disused shops (`shop=vacant`,
`disused:shop=*` not occupied again); `building=retail` and
`building=commercial` footprints of at least 10,000 sq ft; `landuse=retail`
areas of at least 2 acres. Footprints are computed from the returned geometry
on an equal-area projection, holes subtracted.

**Excluded.** Anything tagged `shop=supermarket` or `amenity=fast_food`; any
building or retail area in active use (a `shop` other than `vacant`, or an
`amenity`, `office`, `craft`, `healthcare`, `leisure`, `tourism` or `club`
tag); a `building=supermarket` that isn't vacant or disused; any building or
retail area with an operating supermarket inside it. The point of the list is
existing commercial space, not a plan to replace a business, so a name is kept
only for vacant shops.

**Format.** `{ retrievedAt, source: 'OpenStreetMap via Overpass', license:
'ODbL (© OpenStreetMap contributors)', counts: { vacant, building,
commercial_building, retail_area }, osmBase, bbox: [s, w, n, e], sites: [[id,
lat, lng, kind, sqft, name], …] }`; `id` is `n…`, `w…` or `r…` (OSM node, way,
relation). The app rounds points to pin precision when it loads them
(`src/pipeline/siteLoader.js`) and rejects a file whose rows don't match its
`counts`.

**Counts (retrieved 2026-10-03 16:02–16:03 UTC; OSM data of 16:01–16:02 UTC).**

| County | Vacant | Retail bldg | Commercial bldg | Retail area | Total |
|---|---|---|---|---|---|
| 04001 Apache AZ | 2 | 9 | 5 | 9 | 25 |
| 06001 Alameda CA | 704 | 358 | 471 | 251 | 1,784 |
| 06085 Santa Clara CA | 581 | 319 | 528 | 314 | 1,742 |
| 28151 Washington MS | 1 | 0 | 14 | 1 | 16 |

**Terms.** © OpenStreetMap contributors, Open Database License (ODbL) 1.0.
These files are not covered by the repository's MIT license;
`public/data/sites/README.md` carries the notice with the data. The app
credits OpenStreetMap under the Suggested sites list whenever it shows
commercial picks.

**Rebuild.**

```bash
node scripts/build-site-candidates.mjs                       # all four counties
node scripts/build-site-candidates.mjs 06085 --save-raw=/tmp/osm-raw
node scripts/build-site-candidates.mjs --from-raw=/tmp/osm-raw   # rebuild from saved responses, no network
```

Other options: `--attempt-timeout=SEC` (default 200), `--attempts=N` per
endpoint (default 2). An unknown option or county exits 2 before any network
call.

**Self-checks.** A response with an Overpass `remark` (timed out or partial),
a count element that doesn't match the features returned, invalid JSON or no
features is a failed attempt. Every row is checked (id shape, unique ids,
inside the query box, known kind, size at or above its threshold, name only on
vacant shops) and the per-kind counts must add up. A county that ultimately
fails is not written (any earlier file stays) and the script exits 1; files
are written to a temp name and renamed, so a killed run leaves no partial
file.

**When to rebuild.** Optional. OSM changes daily and nothing requires a
refresh; if you do rebuild, do it before the freeze and run `npm test`.

---

## US map atlas (legacy) — `public/data/food_atlas.csv`

**Source.** USDA ERS Food Access Research Atlas, 2019 release (2010 tracts):
<https://www.ers.usda.gov/data-products/food-access-research-atlas>. An
extract committed at Hack Cupertino on 2026-04-11 (commits `569a99d`,
`29c56bf`); there is no builder and how the columns were extracted isn't
recorded.

**Used by.** Only the US map mode (`src/components/DesignationAtlasView.jsx`,
parsed with PapaParse), which counts tracts with `LILATracts_1And10 = 1` per
state. The tract test does not read it; it uses the ERS shards above.

**Format.** CSV, 13 columns: `CensusTract, State, County, Urban,
LILATracts_1And10, lapop1share, lapop10share, laseniors1share, lahunv1share,
LAPOP1_10, PovertyRate, MedianFamilyIncome, LALOWI1_10`. Unpublished values
are the string `NULL`. 72,531 rows (50 states + DC), about 5.8 MB.

**Check (2026-10-03).** Every one of the 72,531 tract ids is in the ERS 2019
layer (via the committed shards) with the same `LILATracts_1And10` value.

**Terms.** USDA ERS data, a US federal government work (not subject to US
copyright, 17 U.S.C. § 105).

**When to rebuild.** Don't edit it. If the US map ever needs new data, derive
it from the ERS shards (`f2019` carries `LILATracts_1And10`) with a script
rather than replacing the CSV by hand.
