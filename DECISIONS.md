# Decisions — Food Desert AI

Append-only. New decisions go on top with today's date; old entries are never
edited. Each entry names the rejected alternative.

## 2026-10-03 — The verdict is USDA ERS's low-income & low-access test on 2020 Census blocks (docs/07)
The old verdict averaged straight-line distance at 9 fixed points within 1.5 mi
of one geocoded anchor and compared it to 1 mi / 5 mi, with no income test; a
city search judged ~6 sq mi of downtown, and one placed store could never pull
the average under 1.295 mi. Now, for the 2020 tract at the point: residents of
each populated block are beyond the limit when the block's internal point is
more than 1 mi (urban) / 10 mi (rural, ERS 2025 Urban flag) from a counted
store; low access = 33% or 500 residents beyond; low income = ERS 2025
LowIncomeTracts; three-valued AND. Rejected alternatives: keeping the mean-
distance rule under an honest label (still click-dependent and not USDA's
statistic), and block-group polygon sampling from the unmerged skyrmp branch
(still a mean, still one tract). Owner chose to have Claude write all of it;
each module is in docs/AI_USE_LOG.md.

## 2026-10-03 — Counted stores = a bundled, dated USDA SNAP list; Overpass deleted
Supermarket + Super Store from the SNAP retailer service (data 2026-09-17),
minus warehouse clubs, military commissaries/exchanges and fuel stations
(scripts/store-exclusions.json, counts in the manifest), in 2-degree tiles.
Target and Dollar General Market count because SNAP's own type label is
followed. Rejected: live OSM/Overpass (6 of 8 calls failed on 2026-10-02 and
OSM misses in-town supermarkets in Delta towns, creating false rural deserts),
a live SNAP query during judging (third-party runtime dependency; its errors
come back as HTTP 200), and an OSM+SNAP union (adds mislabelled shops). Known
gap, disclosed in the UI: supermarkets that don't take SNAP are missing. The
list is frozen at the code freeze so the video and judges see the same numbers.

## 2026-10-03 — Scope: a tract verdict, a no-verdict Point line, and a City summary with no city pill
USDA rates tracts, not cities. A city search shows the tract at the point plus
"USDA rates census tracts, not cities"; the City summary reports in-city
residents beyond their own tract's limit and residents in tracts meeting the
test, sum-checked against the place's 2020 population (San Jose 1,013,240), and
never a single city verdict. Rejected: one city-level designation (no USDA
basis; the numbers swing from 0.03% to 8% by method) and treating Nominatim's
point as the city.

## 2026-10-03 — Impact shows computed access counts only; projections deleted
Before/after residents beyond the limit, residents brought within it, the test
result, the gap to the limits, half-mile residents and a labelled no-vehicle
estimate, all from the same block computation. The 58% baseline, jobs, dollars,
diabetes/obesity and receipt numbers are gone; a collapsed context box cites
what studies found (checked against the PubMed abstracts on 2026-10-03).
Rejected: keeping the projections with better citations (their constants
couldn't be traced, and the evidence doesn't support point estimates).

## 2026-10-03 — Store customization is format only
Supermarket/supercenter counts; small grocery, dollar store and farmers/mobile
market don't, each with USDA's reason. Pins travel in a parallel pt= key so old
links still parse as supermarkets. Rejected: size, SNAP/WIC, price tier and
names — nothing the app measures responds to them.

## 2026-10-03 — Client timeouts on the new loaders (30 s; 60 s for the City summary)
TIGERweb, store-tile, ERS and CDC/ACS requests abort after 30 s and read as a
named Unknown with a Try again path, never cached. This doesn't repeat the
Overpass mistake recorded above: these are small point/attribute queries that
answer in under a second, and a timeout can only make the result Unknown, never
a wrong verdict. CDC/ACS no longer hold up the verdict. Rejected: no timeouts
(a hung host would leave the spinner up forever).

## 2026-10-02 — Store names are escaped before Leaflet; pass-through rewrites are exact
Leaflet writes string tooltip content with innerHTML, and store names come from
OpenStreetMap, which anyone can edit, so a shop=supermarket node named with an
<img onerror> tag ran script on the app origin (reproduced in headless
Chromium). Tooltips now go through src/lib/storeTooltip.js, which escapes the
name. Rejected alternative: stripping names server-side in api/overpass.js,
which leaves the sink unsafe for any other source of names. Separately, the
three remaining vercel.json rewrites (Census geocoder, Nominatim, CDC) were
wildcards that would serve any upstream path, including Nominatim's own HTML
and script, on the app origin; each is now a named parameter constrained to
the exact paths the app calls (checked with @vercel/routing-utils 6.6.0: the
5 used paths map as before, others match nothing). Rejected alternative:
replacing them with dedicated functions, more code for no added safety while
they carry no keys. The local Vite proxies stay prefix-based (dev only).

## 2026-10-02 — Review fixes to the relay batch: fail closed, cache only complete answers
An adversarial review of the batch (reproduced under Vercel's own Node
runtime) found that Vercel's lazy req.body getter throws on invalid JSON, which
crashed /api/overpass instead of answering 400; the handler now catches it, and
the dev middleware now copies Vercel's body semantics so dev can't hide it
again. The 256 B cap now checks Content-Length before the body is read (Vercel
hands over a parsed object, so its re-serialized size proved nothing).
/api/acs rejects any parameter but fips (cache-busting), and sends no-store
when the state median is missing, so a transient Census failure can't sit at
the CDN for a day. The community cache prefix moves to v2 so zeros written by
pre-deploy clients are never read back. Rejected alternative: shipping as
first committed, since each of these is reachable by a stranger or by an
ordinary deploy.

## 2026-10-02 — Runtime AI narrative removed end to end (closes the /api/llmapi relay)
api/llmapi.js forwarded any caller's messages and any model id to OpenRouter on
the project key, and the narrative it fed leaked model reasoning in 11 of 11
audited runs. Deleted: api/llmapi.js, AICard (including its Executive Summary,
which was all 58%-baseline projections), narrativeSanitize, citeNumbers, the
dev proxy to openrouter.ai and tmp/prompt5_6_validation.mjs. This supersedes
the narrative entries above, and the earlier claim that the key "never ships
to the browser" was false in production: the bundle carried the LLMApi key
stored as VITE_ANTHROPIC_KEY (verified 2026-10-02; revocation is the
owner's step, pending). Rejected alternative: keep it behind a model
allowlist, origin check and rate limit, which is more work to guard a feature
that kept failing its own quality bar.

## 2026-10-02 — Census key moves server-side behind /api/acs
The client read VITE_CENSUS_KEY, so Vite inlined it into every production
bundle since April. api/acs.js now holds CENSUS_KEY on the server, accepts only
an 11-digit tract FIPS (GET, CDN-cacheable for a day) and requests a fixed
variable list, returning the same five fields as before so no number on screen
changes. The keyless /api/census pass-through rewrite is gone. Rejected
alternatives: switching to the keyless ERS FARA 2025 tract row today (changes
what users see: family vs household income, no state median), and keyless
Census calls (api.census.gov now redirects them to missing_key).

## 2026-10-02 — /api/overpass accepts {lat, lng} only and builds the query itself
It used to forward any Overpass QL posted to it, with ACAO *. Now: POST JSON
{lat, lng} inside US bounds (lat 17–72, lng −180 to −64), body ≤ 256 B, the
server builds the same 50-mile shop=supermarket query, the mirror race and
no-timeout policy are unchanged, and ACAO * is gone. The client's direct-mirror
fallbacks are removed, so a function failure now reads Unknown instead of
trying third-party mirrors from the browser. Rejected alternative: deleting
Overpass now. That waits on the bundled SNAP store-list decision.

## 2026-10-02 — The build fails if a private key reaches dist/
`npm run build` runs scripts/check-bundle-for-keys.mjs: it compares every
private env value (plain and URL-encoded) and known key shapes against the
built files and prints only file, variable name and length. VITE_CARTO_KEY is
allowlisted as public by design. Negative control: run against a build of
7361547 (the production commit) it fails on both leaked keys. Local dev now
runs the real api/ handlers through vite-plugin-api-dev.js instead of proxying
around them. Rejected alternative: a key-prefix grep only, which misses the
40-hex Census key and anything without a known prefix.

## 2026-10-02 — Old deployments stay exposed until the keys are revoked
Code changes don't reach old deployments: they keep their functions and the
keys they were built with until the keys are revoked at the provider and
Deployment Protection covers non-production URLs. Revocation is the owner's
step (LLMApi, OpenRouter, Census), not a code change. Rejected alternative:
deleting old deployments, which can't be undone and isn't needed once the
keys are dead.

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
