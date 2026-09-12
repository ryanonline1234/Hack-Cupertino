# 01 — User-placed "what-if" stores + PWA installability

Status: implemented 2026-09-12 (commit on main; gate all passed).
Self-review corrections folded in before code: 3D placement drops at the
analysis center only (crosshair ≠ camera target), placed pins render cyan in
both highlight overlays, scenario recompute notes the 200-store cap.

## A. Place-a-store scenario

### Goal
Let the user point at the map and ask "what if a grocery store opened HERE?"
— and see distance, designation, summary, and narrative answer with that
hypothetical store in the data. (Sim Lab pins exist today but drop at map
center only, through UI that is currently unreachable — see §A.5.)

### Placement UX (both renderers, no iframe reload)
1. Toolbar gains a **Place store** arm button (enabled when `hasData`).
   Arming shows a banner, like the highlight banner.
2. **2D fallback:** while armed, map clicks place instead of analyzing.
   `MapView` gains `placeArmed` + `onPlaceAt(lat, lng)`; armed clicks call
   `onPlaceAt`, unarmed clicks keep analyzing. Banner: "Click the map to
   place · Cancel".
3. **3D Streets GL:** iframe clicks are unreadable cross-origin and the
   crosshair marks the *analysis* point (not the camera target, which we
   cannot read), so 3D placement drops at the analysis center only — honest
   but coarse. **Exact placement lives in 2D** (switching is one tap);
   the banner says so. Banner: "3D drops at analysis center · switch to 2D
   for an exact spot · Drop here · Cancel".
4. Placed pins reuse the `simPins` array (`type: 'grocery'` + real coords);
   `addSimulationPin` gains optional `(type, lat, lng)` (defaults: map
   center, preserving old behavior). 10-pin cap, undo, clear: exposed in the
   armed banner (count + Undo + Clear + Done). Existing SimLabControls stays
   untouched (dead UI, out of scope).
5. Placed pins render on both maps: merged into the 3D highlight overlay
   and the 2D store layer in cyan (existing stores stay neon green), with
   tooltips reading "Placed store · X.X mi". Outside highlight/2D-armed
   contexts pins are banner-count only — no new always-on layer.

### Recompute — pure, no network
New `src/engine/scenarioEngine.js`, function
`evaluatePlacedStoreScenario(communityData, placedStores)`:
- Regenerates sample points with the exported `buildCommunitySamplePoints`
  (deterministic fixed offsets — same points the pipeline used).
- Nearest-per-sample over (`foodAccess.stores` — the 200 nearest-first
  capped points the pipeline kept — plus placed) with the same Haversine
  math, average → `afterAvg`; center-nearest likewise. The cap is an
  approximation, documented here: a placed store near the community (the
  only case the UI allows reasoning about) always dominates the min.
- Re-runs `evaluateFoodDesertDesignation` with identical inputs except the
  new distance → `{ beforeAvg, afterAvg, beforeDesignation,
  afterDesignation, placedCount }`; empty placed list → `null`.
- Pure function of (communityData, placedStores): unit-testable, no fetch.

### Executive summary — scenario delta line
`AICard` appends (outside the existing 3-line slice) when scenario is active:
"With N placed store(s): community average X → Y mi; designation A → B."
TrackerApp holds `scenarioResult` state, recomputed with each pin change,
passed to `AICard` as a prop and logged (`Scenario: ...` info lines).

### Narrative names the scenario
`AICard` prompt gains, only when pins exist: a "Placed-store scenario:"
block (count, avg before→after, designation before→after) plus one
instruction sentence directing paragraph 2 at it. Prompt stays two
paragraphs; the scenario makes it specific instead of longer.

### What this does NOT do
- No USDA/CDC refetch per scenario (static layers don't move with one store).
- No routing/travel-time math (Haversine estimates, labeled as such).
- No persistence beyond the session (share-URL for scenarios is future work).

## B. PWA installability
1. Real PNG icons: render `favicon.svg` at 512 via headless Chromium,
   derive 192/180 with padding for maskable + Apple touch.
   `public/pwa-192x192.png`, `public/pwa-512x512.png` (any+maskable),
   `public/apple-touch-icon.png` (180, opaque).
2. Manifest: point icons at the PNGs, add `id: '/'`.
3. `index.html`: apple-touch-icon link + `apple-mobile-web-app-capable`.
4. `vite.config.js` workbox: add `basemaps.cartocdn.com` tile caching
   (StaleWhileRevalidate, matching the OSM entry); keep `/api/` NetworkOnly.

## Verification gate (all passed 2026-09-12)
- [x] `npm run lint` clean; `npm test` green incl. new
  `scenarioEngine` unit tests (avg drop, rural flip, empty→null).
- [x] `npm run build` green; manifest lists PNG icons; `dist/` contains them.
- [x] Headless flow: arm → place → delta line + pipeline log line render;
  no console errors. Screenshot inspected (`Placed store · 0.1 mi` tooltip,
  cyan placed marker among green stores).
- [ ] Production deploy Ready; installability checklist (HTTPS, SW,
  192+512 icons, standalone, theme color) holds. (Verified post-deploy;
  the install prompt itself isn't headless-automatable.)
