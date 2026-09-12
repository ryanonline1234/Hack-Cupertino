# 02 — Mobile info-only results page + compat-globe circle fix

Status: implemented 2026-09-12. Gate: lint clean, 39/39 tests,
build green; headless 390×844 hash-link load → launch → pipeline shows
designation info with 0 iframes / 0 canvases, Share present, no Place-store
leak, 0px horizontal overflow (screenshots inspected); iPhone-UA landing
renders the compat globe at 390×390 square, screenshot-confirmed circle.

## A. Problem
1. On phones the tracker still mounts the heavy Streets GL / 2D map
   (slow, fiddly, GPU-hungry) even though a designated-area lookup only
   needs the answer: designation, key stats, narrative, impact.
2. The landing hero globe renders as a stretched ellipse on iOS
   (all iOS browsers + installed PWA report Safari UA → the CSS
   `GlobeCompatibilityFallback`, whose `rounded-full` div sits in a
   wide-short non-square box).

## B. Mobile results page (new, no new data plumbing)
- New `src/components/MobileResultsView.jsx`, rendered by TrackerApp
  instead of the map shell whenever `isMobile` is true.
- Pre-search: reuses `LocationGate` full-screen (same fuzzy search).
- Post-search: sticky slim header (brand, New-search toggle, Share when
  data is present) + the existing `<Panels>` stack
  (CommunityStatsPanel, AICard narrative, AgentStatusFeed log) in a
  natural page scroll. No iframe, no canvas map, no WebGL.
- Designation-atlas mode is desktop-only: on mobile the mode toggle is
  hidden and `mode` is forced to tracker (atlas is a map; without a map
  it has nothing to show).
- Place-a-store is desktop-only (placement needs a map surface); the
  mobile footer says so and points at Share — the copied link replays
  the full simulation on desktop.
- Touch: action buttons ≥44px tall; no horizontal scroll at 360px;
  existing dark-void/cyan/neon tokens kept (no re-theme in this batch).

## C. Globe circle fix
- `GlobeCompatibilityFallback` centers a true square
  (`height: min(100%, 100vw)` + `aspect-ratio: 1`) so `rounded-full`
  is always a circle, in every container shape. WebGL path untouched
  (perspective projection can't stretch a sphere).

## Gate (must all pass before done)
1. `npm run lint`, `npm test`, `npm run build` green.
2. Headless 390×844: hash-link load → launch → pipeline → designation
   text visible, zero `<iframe>`/map `<canvas>` in the app shell.
3. iPhone-UA headless screenshot of landing hero: globe renders a
   circle (inspected pixels), no ellipse.
4. Desktop flow unchanged (spot-check: existing share-URL E2E untouched).
