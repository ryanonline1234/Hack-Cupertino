# Decisions — Food Desert AI

Append-only. New decisions go on top with today's date; old entries are never
edited. Each entry names the rejected alternative.

## 2026-09-12 — User-placed stores recompute distance/designation with no network
`scenarioEngine.evaluatePlacedStoreScenario` regenerates the deterministic
pipeline sample points and re-runs the evaluator over fetched stores + placed
pins. Rejected alternative: refetching per scenario (wasteful — static layers
don't move) and travel-time routing (unlabeled precision the Haversine model
doesn't claim).

## 2026-09-12 — Placement is 2D-exact, 3D-drops-at-center, banner says so
Iframe clicks are unreadable cross-origin and the crosshair marks the analysis
point, not the camera target — so exact placement lives in the 2D fallback
and 3D drops at the analysis center. Rejected alternative: implying pan-to-aim
works in 3D, which would silently misplace stores.

## 2026-09-12 — PWA icons rendered from the brand SVG, CARTO tiles cached
PNG 192/512 (+maskable, +Apple touch) rendered headless from favicon.svg;
keyed CARTO tiles join the service-worker cache. Rejected alternative: SVG-only
manifest icons (iOS ignores them — app wouldn't be installable on iPhones).

## 2026-09-12 — Highlight is a hash-teleport overlay toggle, camera stays free
Toggling food-source highlight moves the Streets GL camera hash-only to a
top-down view instead of rebuilding the iframe URL (which reloaded the whole
map and reset the camera). Rejected alternative: keeping the reload, which
made exploring sources painful. Tradeoff recorded in code: overlay markers
align with the toggle-established view and may drift if the user pans, until
the next teleport (search, toggle, Recenter).

## 2026-09-12 — No client-side Overpass abort, stale responses dropped by nonce
The 8s (later 30s/60s) client timeout aborted every mirror for the 50-mile
metro query (measured 10–25s) and forced Unknown designations, so the abort
was removed entirely; bounding lives upstream (server 12s/mirror, function
limits). Rejected alternative: ever-longer timeouts, which only moved the
failure line. TrackerApp carries a search nonce so overlapping slow responses
can't paint stale communities.

## 2026-09-12 — 2D map gets native highlight markers from the same store data
MapView draws a Leaflet layer from the Overpass store points the 3D overlay
already had, so highlight works in both renderers as a pure toggle. Rejected
alternative: keeping highlight 3D-only with a "switch to 3D" dead end.

## 2026-09-11 — Free-tier OpenRouter models only, no paid flagships
Narrative runs on `google/gemma-4-31b-it:free` (strongest instruction-follower
in the free list, verified via the public models API) with a cross-provider
fallback, retry on 429/5xx, and server-side error logging. Rejected
alternative: `anthropic/claude-3-5-haiku`, which has no such OpenRouter ID and
caused upstream 5xx, and any paid model (cost + key-exposure risk for a
student project).

## 2026-09-11 — Location gate boots before the Streets GL iframe
The heavy 3D map stays unmounted until the visitor picks a place (deep links
bypass the gate), instead of loading a default city nobody asked for.
Rejected alternative: eager map + lazy data, which burned the slowest load on
the least-informed moment.

## 2026-09-11 — Server-side OpenRouter proxy, key never ships to the browser
`api/llmapi.js` holds `OPEN_ROUTER_API_KEY`; the client sends no secret in
production (dev-only `VITE_OPEN_ROUTER_API_KEY` for the Vite proxy).
Rejected alternative: client-side key, which would be extractable from the
bundle. (Related bug: a non-ASCII em dash in X-Title made every upstream call
throw — headers must stay Latin-1.)

## 2026-09-11 — Dotted-US-map hero reverted, upgraded globe restored
A canvas dot-grid hero (real state boundaries, clickable sample hotspots) was
built, shipped, then reverted the same day per owner preference for the
upgraded true-color globe. Rejected alternative (for now): keeping the dot
map — its generator and component were removed outright rather than left to
rot, so this stays a clean re-do if preference flips back.

## 2026-09-11 — Pipeline logs describe standby, never fake readiness
Boot logs claimed every connector "ready/online" before any fetch ran; they
now describe standby state. Rejected alternative: impressive-sounding boot
lines no judge could distinguish from real health checks.

## 2026-09-10 — Keyed CARTO voyager tiles for the US map mode
CARTO basemaps need an API key; the atlas uses the keyed rastertiles endpoint
(VITE_CARTO_KEY override, built-in public key). The marker scale switched
green/red → sequential orange for red-green colorblind readers. Rejected
alternative: unkeyed tiles (rate-limited/blocked) and the diverging scale.

## 2026-09-12 — Share-URL scenarios with no database (hash pins=)
Placed-store scenarios share via the URL hash: dropping a store appends
`pins=lat,lng;…` (4 decimals, 10-pin cap), a banner Share button force-writes
the hash and copies the link (clipboard API → execCommand → log fallback),
and a shared link auto-runs the pipeline then batch-restores the pins as
grocery pins with one impact recompute. Manual re-search clears pending link
pins so they never leak into a picked location. Rejected alternative: a
database/slug shortener — no backend state to maintain, and links work offline
from the URL alone. Verified headless against the real pipeline (geocoder +
Overpass via a local rewrite-mirroring harness): drop → pins= in hash →
Share copies link → fresh page replays "With 1 placed store".

## 2026-09-12 — Mobile info-only results page + compat-globe circle (spec docs/02)
Phones now skip the map shell entirely: `MobileResultsView` reuses
`LocationGate` pre-search and stacks the existing desktop panels
(designation, stats, narrative, log) in a page scroll — no iframe, no
canvas, no WebGL. Atlas mode and place-a-store are desktop-only on mobile
(atlas is a map with nothing to show; placement needs a surface to point
at); the footer says so and Share still works for handoff to desktop.
Rejected alternative: shrinking the desktop map layout to fit — slow,
fiddly, GPU-hungry, and unnecessary for a lookup that only needs the
answer. Separately, the iOS/Safari CSS globe fallback was a stretched
ellipse (rounded-full in a wide-short hero box); it is now a centered
square (`height: min(100%, 100vw)` + aspect-ratio), so always a circle.
WebGL path untouched — perspective can't stretch a sphere.

## 2026-09-12 — Narrative reliability batch (spec docs/03)
Prompt echo: weak free models restate formatting instructions into the
narrative card, so a deterministic `stripInstructionEcho` post-pass drops
meta-instruction sentences (per-paragraph, decimals shielded) with a
regression test built from the captured leak; prompts hardened too.
Generate now logs request/ready/fail lines via drilled onLog. Both
timeouts removed outright: Overpass per-mirror abort (slow mirrors
ran to Unknowns) and the 12s iframe watchdog ("timed out" flips); real
errors still rotate/retry. Example chips carry live-verified verdict
pills (Greenville MS designated; San Jose + Chicago served) — reputation
guesses were wrong for every city until headless badge reads corrected
them; unverified cities stay untagged. Both map renderers stay mounted
and track every query (toggle = visibility only; MapView invalidateSize
on show); cost is one hidden GL context, stated here instead of a footer.

## 2026-09-12 — 3D parked behind ENABLE_STREETS_GL; deep links; result card (spec docs/04)
Streets GL is out of the experience per owner call but fully intact behind
a single `ENABLE_STREETS_GL = false` flag in StreetsGlView (iframe
unmounted, toggles hidden, teleport parked); flipping it restores 3D with
no other edits, and parking removes the hidden-GL-context cost. Share
links now boot straight into the tracker (App skips landing+intro on
lat/lng hash) with sources highlighted (hl=1 forced on scenario shares,
consumed once at mount). New ScenarioResultCard shows the AFTER verdict
big, engine impact numbers, an explicit Recompute step, and a setup
breakdown gated by real tract values with a no-invented-capex footer.

## 2026-09-12 — Friend-suggested UI polish (spec docs/05)
GSAP, React Bits, Kokonut UI — each used where it earns its place, cut
where it doesn't. CountUp vendored (MIT) with reduced-motion + decimals
fixes; GSAP only for the SplitText hero reveal (landing scroll reveals
already existed — ScrollTrigger would duplicate them); Kokonut registry
skipped (Tailwind v4 requirement vs our v3.4, plus taste conflicts) in
favor of hand-adapted treatments: shared icon-tile PanelHeader, press
feedback, exact-property hovers, focus rings. "Rest bit"/"S" skipped as
message fragments. Dead StatCard/StatsPanel left untouched.

## 2026-09-12 — Globe composition, brand home, no-zoom, narrative budget, mirror race (spec docs/06)
PWA globe: geometry was already circular — the complaint was composition
(mound, then blob behind headline). Disc now smaller, pinned clear of the
headline, night-side shading. Brand buttons home to landing. Search inputs
16px so iOS stops auto-zooming. Narrative max_tokens 1000 + finish-both-
paragraphs prompt line. Critical find: removing the Overpass abort let a
hanging mirror (kumi.systems, verified hanging) wedge the pipeline
forever — api/overpass.js now races all mirrors, first success wins, zero
timeouts kept. 3× upstream load accepted at this traffic.
