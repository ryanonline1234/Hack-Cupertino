# Food Desert Simulator - Technical Project Handoff

Last updated: 2026-04-12
Primary audience: engineers and coding agents taking over implementation.
Secondary audience: technical product owners needing implementation-level detail.

## 1. Product Intent and System Boundaries

The application is a tract-centric decision support tool for food access analysis in the US. It combines USDA, CDC, Census, and OSM-derived data to:

1. Classify food access designation state for the selected community.
2. Surface the evidence chain behind classification decisions.
3. Estimate intervention impact (access, health, economic, and true-cost dimensions).
4. Provide scenario tooling for strategic planning and comparison.

Current architecture assumes one selected location at a time, resolved to one tract context, with projection outputs computed in-browser.

## 2. Current Decision Standard (Important)

Food desert classification is currently distance-first using a community-average distance model with explicit Unknown handling.

Primary threshold rules:

1. Urban: designated when community-average supermarket distance >= 1 mile.
2. Rural: designated when community-average supermarket distance >= 5 miles.
3. If distance is unavailable, final designation defaults to Unknown.

Implementation:

- Classification evaluator: src/engine/foodDesertEvaluation.js
- Pipeline wiring: src/pipeline/normalizer.js

Distance model inputs:

- Distance for classification uses sampled community-average distance.
- Center-point nearest distance is retained as a reference metric for transparency.

## 3. Repository Layout and Ownership

Top-level runtime files:

- App shell and orchestration: src/App.jsx
- Map/search experience: src/components/StreetsGlView.jsx
- Profile, trace, confidence badges, compare UI: src/components/CommunityStatsPanel.jsx
- Narrative generation: src/components/AICard.jsx

Data pipeline modules:

- Geocoder and tract resolution: src/pipeline/geocoder.js
- USDA tract ingestion and derived USDA context: src/pipeline/usdaFetch.js
- CDC health metrics: src/pipeline/cdcFetch.js
- Census ACS demographics: src/pipeline/censusFetch.js
- OSM distance service: src/pipeline/storeDistanceFetch.js
- Data normalization/merge: src/pipeline/normalizer.js

Core engines:

- Designation evaluator: src/engine/foodDesertEvaluation.js
- Impact projection: src/engine/projectionEngine.js
- Simulation scoring: src/engine/simulationEngine.js
- Model constants/correlations: src/engine/correlations.js

Test coverage roots:

- Designation behavior: tests/foodDesertEvaluation.test.js
- USDA fixtures and divergence checks: tests/knownFoodDesertCases.test.js
- Projection economics calibration: tests/projectionEconomics.test.js
- Community-average distance helpers: tests/storeDistanceFetch.test.js

## 4. End-to-End Data Flow

Request path:

1. User selects location in map/search UI.
2. App requests normalized tract payload from buildCommunityData.
3. buildCommunityData resolves tract metadata and fetches source payloads in parallel.
4. Normalizer computes classification context and projection inputs.
5. App computes impact output with projectImpact.
6. UI renders profile, confidence, trace, and impact sections.

Fetch sequence in normalizer:

1. coordsToGeo(lat, lng)
2. getUsdaData(fips)
3. getCdcData(stateAbbr, fips)
4. getCensusData(fips)
5. getNearestSupermarketDistance(lat, lng)

## 5. Distance Model Internals (Community-Average)

Distance module: src/pipeline/storeDistanceFetch.js

What it does now:

1. Queries Overpass for supermarket-tagged elements within 50 miles of the center.
2. Builds 9 sample points (center + offsets).
3. Computes nearest-store distance for each sample point via Haversine.
4. Computes community average from sample nearest distances.
5. Exposes both:
   - communityAverageSupermarketMiles (primary for classification)
   - centerNearestSupermarketMiles (reference only)

Returned distance payload fields:

1. nearestSupermarketMiles: backward-compatible alias carrying community average.
2. communityAverageSupermarketMiles
3. centerNearestSupermarketMiles
4. communityDistanceSampleCount
5. distanceModel
6. isTwentyFivePlusMiles
7. checkedRadiusMiles
8. source

Failure behavior:

- Endpoint failover attempts second Overpass host.
- On full failure, returns null distance fields and source=unavailable.

Known caveats:

1. Not road-network travel time/distance.
2. OSM tagging completeness affects quality.
3. Sampling model is spatially representative, not population-weighted.

## 6. Classification Engine Contract

Evaluator API: evaluateFoodDesertDesignation

Inputs:

1. isRural
2. nearestSupermarketMiles (currently community average from pipeline)
3. isTwentyFivePlusMiles
4. usdaLilaFlag
5. urbanThresholdMiles (default 1)
6. ruralThresholdMiles (default 5)
7. unavailableMode (default unknown)

Outputs:

1. finalDesignation (designated | not_designated | unknown)
2. isFoodDesert (true | false | null)
3. distanceDesignation
4. usdaDesignation
5. sourceComparable
6. sourceDisagreement
7. designationMethod
8. distanceThresholdMiles
9. distanceRuleEvaluable
10. isFoodDesertByDistanceRule

Method labels currently used:

1. distance_rule_urban_1mi
2. distance_rule_rural_5mi
3. distance_rule_unavailable_unknown
4. distance_rule_unavailable_usda_fallback
5. distance_rule_unavailable

## 7. USDA Context vs Final Distance Classification

USDA-derived fields are still retained as diagnostics and policy context:

1. accessRule remains USDA 1/10-mile benchmark context.
2. qualifyingLowAccessPct for USDA low-access tests.
3. low-income tests based on poverty/income threshold logic.

Important distinction:

- USDA low-access benchmark in UI is not the same as final distance-first designation threshold.
- Final designation threshold is now 1 mile urban / 5 miles rural over community-average distance.

## 8. Projection Engine Technical Notes

Projection module: src/engine/projectionEngine.js

The engine emits:

1. foodAccess impact metrics
2. health impact metrics
3. economic impact metrics
4. true-cost before/after trip economics
5. simulation summary

Economic calibration currently includes:

1. Bounded capture rate.
2. Access-need factor from qualifying low-access share.
3. Revenue cap for practical single-store scale.
4. Transparency fields:
   - annualCapturedSalesRaw
   - annualRevenueCap
   - annualCapturedSalesCapped

Invariant maintained by tests:

- annualLocalImpact == round(annualCapturedSales * economicMultiplier)

## 9. Caching and Freshness

Community payload cache:

- In-memory + localStorage.
- TTL: 15 minutes.
- Meta attached as payload.meta.cache.
- Status values: fresh | memory | local.

Narrative cache:

- In-memory + localStorage.
- TTL: 6 hours.
- Scoped by FIPS key.

Force refresh path:

- UI can bypass community cache and force fresh retrieval.

## 10. UI Surfaces and Technical Behavior

Key transparency elements:

1. Source confidence badges.
2. Evaluation trace drawer (criterion-level details).
3. Threshold sensitivity panel with live override preview.
4. Scenario compare table (baseline/current/saved).

Distance presentation now:

1. Community avg supermarket distance (est.)
2. Center-point nearest (reference)

Logs now explicitly call out:

1. Community-average distance used for classification.
2. Center-point nearest as reference.
3. USDA benchmark diagnostics separately.

## 11. Environment and Runtime Configuration

Current env vars used:

1. VITE_CENSUS_KEY
2. VITE_ANTHROPIC_KEY

Vite proxy routes:

1. /api/census-geocoder
2. /api/nominatim
3. /api/cdc
4. /api/census
5. /api/llmapi

## 12. Testing and Build Commands

Primary checks:

1. npm test -- --runInBand
2. npm run build

Current status at handoff:

1. Tests passing: 29
2. Build: passing

## 13. Risk Register

1. Overpass availability and throttling can induce Unknown classifications.
2. OSM completeness can bias distance estimates by geography.
3. Community sample offsets are fixed and not tuned by tract geometry.
4. Current sampled average is not population-weighted.

## 14. Recommended Next Technical Iterations

1. Population-weighted sampling using Census block-group centroids and population weights.
2. Optional road-network distance fallback for high-stakes planning mode.
3. Persisted telemetry for stage timings and source failure rates.
4. Expand disagreement analytics dashboard (distance vs USDA cohorts over multiple tracts).
5. Snapshot tests for trace drawer wording and model metadata rendering.

## 15. Handoff Runbook for Successor Engineers

1. Start with this file and verify current thresholds in evaluator.
2. Confirm normalizer still passes community-average distance into evaluator.
3. Validate UI wording if changing policy thresholds.
4. Preserve backward-compatible distance fields unless migration is coordinated.
5. Run tests/build before and after modifying pipeline contracts.

## 16. Quick File Reference Map

- Classification thresholds: src/engine/foodDesertEvaluation.js
- Distance modeling: src/pipeline/storeDistanceFetch.js
- Merge and designation wiring: src/pipeline/normalizer.js
- Runtime logs and orchestration: src/App.jsx
- Profile/trace/stat rendering: src/components/CommunityStatsPanel.jsx
- Projection formulas: src/engine/projectionEngine.js
- Distance model tests: tests/storeDistanceFetch.test.js

