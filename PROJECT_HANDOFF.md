# Food Desert Simulator - Project Handoff (IDE-Agnostic)

Last updated: 2026-04-12
Audience: engineers taking over in any IDE (VS Code, Cursor, WebStorm, Zed, etc.).

## 1) Scope and Product Intent

This app is a tract-centric US food access analysis tool. It merges multiple public sources to:

1. Classify designation state (designated, not designated, unknown).
2. Show why the classification happened (trace + source confidence).
3. Project intervention impact across access, health, economics, and trip true-cost.
4. Support scenario planning rather than static reporting.

## 2) IDE Migration Quick Checklist

Use this when moving the project to another IDE.

1. Open project root: `food-desert-simulator`.
2. Configure Node.js 20+ interpreter.
3. Ensure `.env` is loaded with required keys.
4. Set run command: `npm run dev -- --host 127.0.0.1 --port 5173`.
5. Set validation commands:
   - `npm run lint`
   - `npm test`
   - `npm run build`
6. Keep import alias behavior consistent (`@` alias is used in UI components).

## 3) Required Environment

Environment variables:

1. `VITE_CENSUS_KEY`
2. `VITE_ANTHROPIC_KEY`

Reference template:

1. `.env.example`

## 4) Runtime and Tooling

Stack:

1. React + Vite
2. Leaflet for map UI
3. Tailwind/PostCSS for styling
4. Framer Motion for transitions
5. Three.js + R3F for landing visual elements

NPM scripts:

1. `npm run dev`
2. `npm run build`
3. `npm run lint`
4. `npm run test`
5. `npm run preview`

## 5) Current Functional State

The app currently includes both tracker and nationwide modes:

1. Landing flow with animated intro overlay and handoff to main UI.
2. Tracker mode for location-specific tract analysis and scenario controls.
3. US Map mode (`DesignationAtlasView`) with preloaded designation overview.
4. Zoom-aware map behavior that shifts from broad summary to in-view stats.
5. Explainability surfaces in stats panel (trace/confidence/sensitivity/compare).

## 6) Architecture Map

Entry and orchestration:

1. `src/App.jsx`
2. `src/TrackerApp.jsx`
3. `src/main.jsx`

Landing and presentation:

1. `src/ui/landing/LandingPage.tsx`
2. `src/components/ui/particle-text-effect.tsx`

Core UI:

1. `src/components/CommunityStatsPanel.jsx`
2. `src/components/AICard.jsx`
3. `src/components/StreetsGlView.jsx`
4. `src/components/FeatureNav.jsx`
5. `src/components/DesignationAtlasView.jsx`

Data pipeline:

1. `src/pipeline/geocoder.js`
2. `src/pipeline/usdaFetch.js`
3. `src/pipeline/cdcFetch.js`
4. `src/pipeline/censusFetch.js`
5. `src/pipeline/storeDistanceFetch.js`
6. `src/pipeline/normalizer.js`

Engines:

1. `src/engine/foodDesertEvaluation.js`
2. `src/engine/projectionEngine.js`
3. `src/engine/simulationEngine.js`
4. `src/engine/correlations.js`

Tests:

1. `tests/foodDesertEvaluation.test.js`
2. `tests/knownFoodDesertCases.test.js`
3. `tests/projectionEconomics.test.js`
4. `tests/storeDistanceFetch.test.js`

## 7) End-to-End Data Flow

Location flow:

1. User selects/searches a location.
2. Tract context is resolved by geocoder.
3. USDA, CDC, Census, and distance sources are fetched.
4. Pipeline normalizes and merges source payloads.
5. Classification evaluator computes designation + trace fields.
6. Projection engine computes impact outputs.
7. UI renders metrics, narrative, and explainability panels.

## 8) Classification and Distance Model

Current designation behavior is distance-first with explicit Unknown handling.

Rules:

1. Urban threshold: 1 mile.
2. Rural threshold: 5 miles.
3. Missing required distance input: Unknown.

Distance model details:

1. Overpass query for supermarket-tagged candidates.
2. Multi-point sampling around center.
3. Community-average nearest distance for classification.
4. Center-point nearest retained as reference metric.

## 9) Caching and Freshness

1. Community payload caching:
   - In-memory + localStorage
   - TTL about 15 minutes
2. Narrative caching:
   - In-memory + localStorage
   - TTL about 6 hours

## 10) Quality Gates for Handoff

Run before merging or transferring ownership:

1. `npm run lint`
2. `npm test`
3. `npm run build`

Current expectation:

1. Lint passes.
2. Tests pass.
3. Build passes.

## 11) Known Risks

1. Overpass instability can degrade distance resolution.
2. OSM completeness varies by geography.
3. Distance model is sampled and not population-weighted.
4. Large vendor chunks are present in production build warnings.

## 12) Recommended Next Iterations

1. Population-weighted distance sampling.
2. Optional road-network fallback model.
3. Better telemetry around source failure and timing.
4. Additional tests for landing-to-tracker transition behavior.
5. Chunk-size optimization follow-up for heavy Three.js vendor bundles.

## 13) Successor Runbook

1. Validate env keys and run local server.
2. Run lint/test/build and confirm green baseline.
3. Verify both modes (`Tracker` and `US Map`) manually.
4. Verify landing intro and nav layering still behave correctly.
5. Preserve current output field contracts when changing pipeline behavior.

